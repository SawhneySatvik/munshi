-- 17 · Packages: prepaid packs and memberships, and their liability. Books, through
-- books.write. A plan is an item of kind package with its service lines; a holding is a named customer's, made in its
-- sale's transaction (so its currency and customer are the sale's); its entries carry the sessions per service
-- and the liability per holding as running balances the database sets under a per-holding lock and keeps at or above
-- zero (b_package_tally, MS009), each kind bound to its command: sold by sale.record in the holding's sale, redeemed by
-- package.redeem, expired by an approved package.expire (draft-only), a reversal by sale.reverse.
-- No column here names a table of a later file.
set local role munshi_owner;

create table books.package_plan (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  item_id uuid not null,
  item_kind text generated always as ('package') stored,
  kind text not null check (kind in ('sessions', 'value')),
  value_minor bigint check (value_minor > 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  validity_days int not null check (validity_days between 1 and 1095),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((kind = 'value') = (value_minor is not null)),
  check ((value_minor is null) = (currency is null))
);

-- A sessions plan's lines carry the plan's kind as a constant in their key, so a value plan has none.
create unique index package_plan_kind on books.package_plan (tenant_id, id, kind);

create table books.package_plan_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  plan_id uuid not null,
  plan_kind text generated always as ('sessions') stored,
  line_no int not null check (line_no between 1 and 100),
  item_id uuid not null,
  item_kind text generated always as ('service') stored,
  sessions int not null check (sessions between 1 and 100),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, plan_id, plan_kind) references books.package_plan (tenant_id, id, kind),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.package_holding (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid not null,
  plan_id uuid not null,
  sale_id uuid not null,
  starts_on date not null,
  expires_on date not null,
  liability_minor bigint not null check (liability_minor >= 0),
  currency char(3) not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, sale_id, currency) references books.sale (tenant_id, id, currency),
  foreign key (tenant_id, sale_id, customer_id) references books.sale (tenant_id, id, customer_id),
  foreign key (tenant_id, plan_id) references books.package_plan,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (expires_on >= starts_on)
);

-- An entry keeps its holding's currency.
create unique index package_holding_currency on books.package_holding (tenant_id, id, currency);

-- One holding's movements: sessions per service (NULL, with item_id, for a value plan) and the liability (value_minor,
-- signed: the money this row moves). seq, sessions_after and value_after are b_package_tally's.
create table books.package_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  holding_id uuid not null,
  shop_id uuid not null,
  item_id uuid,
  kind text not null check (kind in ('sold', 'redeemed', 'expired', 'reversal')),
  sessions int,
  value_minor bigint not null,
  currency char(3) not null,
  seq bigint not null,
  sessions_after int check (sessions_after >= 0),
  value_after bigint not null check (value_after >= 0),
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, holding_id, currency) references books.package_holding (tenant_id, id, currency),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, reverses_id) references books.package_entry,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((kind = 'reversal') = (reverses_id is not null)),
  check ((item_id is null) = (sessions is null)),
  check (kind <> 'sold' or (coalesce(sessions, 0) >= 0 and value_minor >= 0)),
  check (kind not in ('redeemed', 'expired') or (coalesce(sessions, 0) <= 0 and value_minor <= 0)),
  check ((reverses_id is null) = (reason is null))
);

-- b_package_tally: each kind is its command's (sold also only in its holding's sale transaction, a redemption only
-- until the holding's expires_on, inclusive, in the tenant's zone), then seq, the service's sessions and the holding's
-- value from their last entries under the holding's lock (the chain lock first); below zero is MS009.
create function books.package_tally() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  by_command text;
  owner_command text;
  last_seq bigint;
  last_value bigint;
  last_sessions int;
begin
  by_command := coalesce((select dr.command from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                           where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                         nullif(current_setting('munshi.command', true), ''));
  owner_command := case new.kind when 'sold' then 'sale.record' when 'redeemed' then 'package.redeem'
                                  when 'expired' then 'package.expire' else 'sale.reverse' end;
  if by_command is distinct from owner_command then
    raise exception 'package refused: % entries are written by %, not %', new.kind, owner_command, by_command using errcode = 'MS001';
  end if;
  if new.kind = 'redeemed' and (select h.expires_on from books.package_holding h where h.tenant_id = new.tenant_id and h.id = new.holding_id)
       < (now() at time zone (select t.time_zone from ops.tenant t where t.tenant_id = new.tenant_id))::date then
    raise exception 'package refused: the holding has expired; it is redeemed only until its expires_on' using errcode = 'MS009';
  end if;
  if new.kind = 'sold' and not exists (select 1 from books.package_holding h
                                        where h.tenant_id = new.tenant_id and h.id = new.holding_id and h.created_txid = txid_current()) then
    raise exception 'package refused: a holding is sold only in its sale''s transaction' using errcode = 'MS006';
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(4, hashtext(new.tenant_id::text || new.holding_id::text));
  select e.seq, e.value_after into last_seq, last_value from books.package_entry e
   where e.tenant_id = new.tenant_id and e.holding_id = new.holding_id order by e.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.value_after := coalesce(last_value, 0) + new.value_minor;
  if new.item_id is not null then
    select e.sessions_after into last_sessions from books.package_entry e
     where e.tenant_id = new.tenant_id and e.holding_id = new.holding_id and e.item_id = new.item_id order by e.seq desc limit 1;
    new.sessions_after := coalesce(last_sessions, 0) + new.sessions;
  else
    new.sessions_after := null;
  end if;
  if new.value_after < 0 or new.sessions_after < 0 then
    raise exception 'package refused: the holding would have % left in value and % sessions', new.value_after, new.sessions_after
      using errcode = 'MS009';
  end if;
  return new;
end $$;
revoke execute on function books.package_tally() from public;

create trigger a_write before insert or update or delete on books.package_plan for each row execute function books.write();
create trigger z_audit after insert on books.package_plan for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.package_plan_line for each row execute function books.write();
create trigger z_audit after insert on books.package_plan_line for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.package_holding for each row execute function books.write();
create trigger z_audit after insert on books.package_holding for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.package_entry for each row execute function books.write();
create trigger b_package_tally before insert on books.package_entry for each row execute function books.package_tally();
create trigger z_audit after insert on books.package_entry for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests; the composite-key targets are above, by
-- their tables.
create unique index package_plan_item on books.package_plan (tenant_id, item_id);
create unique index package_plan_line_no on books.package_plan_line (tenant_id, plan_id, line_no);
create index package_plan_line_item on books.package_plan_line (tenant_id, item_id);
create index package_holding_customer on books.package_holding (tenant_id, customer_id);
create index package_holding_expiry on books.package_holding (tenant_id, expires_on);
create index package_holding_sale on books.package_holding (tenant_id, sale_id);
create unique index package_entry_seq on books.package_entry (tenant_id, holding_id, seq);
create unique index package_entry_reverses on books.package_entry (tenant_id, reverses_id) where reverses_id is not null;

-- The book table manifest and the commands. sale.record and sale.reverse gain the holding and
-- its entries.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.package_plan', null, null, false, '{}', '{}', '{}'),
  ('books.package_plan_line', 'books.package_plan', 'plan_id', false, '{}', '{}', '{}'),
  ('books.package_holding', 'books.sale', 'sale_id', false, '{}', '{}', '{}'),
  ('books.package_entry', null, null, true, '{sessions,value_minor}', '{holding_id,shop_id,item_id,currency}', '{b_package_tally}');
insert into ref.command (command, draft_only) values
  ('package.plan.create', false), ('package.redeem', false), ('package.expire', true);
insert into ref.command_authority (command, role) values
  ('package.plan.create', 'owner'), ('package.redeem', 'owner'), ('package.redeem', 'manager'), ('package.redeem', 'staff'),
  ('package.expire', 'owner');
insert into ref.command_table (command, rel)
select 'package.plan.create', t from unnest(array['books.item', 'books.item_revision', 'books.price', 'books.package_plan',
                                                  'books.package_plan_line']) t
union all
select c, t from unnest(array['package.redeem', 'package.expire']) c,
                 unnest(array['books.package_entry', 'books.journal_entry', 'books.journal_line']) t
union all
select c, t from unnest(array['sale.record', 'sale.reverse']) c, unnest(array['books.package_holding', 'books.package_entry']) t;
insert into ref.command_capability (command, capability, use) values
  ('package.plan.create', 'packages', 'start'), ('package.redeem', 'packages', 'finish'), ('package.expire', 'packages', 'finish');

-- RLS and the grants: books are the app's (S I) and the jobs role's (S) only.
alter table books.package_plan enable row level security;
alter table books.package_plan force row level security;
create policy tenant_isolation on books.package_plan
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.package_plan from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.package_plan to munshi_app;
grant select on books.package_plan to munshi_jobs;

alter table books.package_plan_line enable row level security;
alter table books.package_plan_line force row level security;
create policy tenant_isolation on books.package_plan_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.package_plan_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.package_plan_line to munshi_app;
grant select on books.package_plan_line to munshi_jobs;

alter table books.package_holding enable row level security;
alter table books.package_holding force row level security;
create policy tenant_isolation on books.package_holding
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.package_holding from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.package_holding to munshi_app;
grant select on books.package_holding to munshi_jobs;

alter table books.package_entry enable row level security;
alter table books.package_entry force row level security;
create policy tenant_isolation on books.package_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.package_entry from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.package_entry to munshi_app;
grant select on books.package_entry to munshi_jobs;
