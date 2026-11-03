-- 16 · Offers, sale discounts and loyalty. Books, through books.write.
-- An offer is a price: the owner's own command, never an AI draft (b_offer_by_person). Every discount on a bill is a
-- sale_discount row naming its source, a child of its sale that reverses with it; an offer's redemptions stay within its
-- caps under a per-offer lock (b_offer_cap). Loyalty points are a running balance per customer, numbered and summed by
-- the database under a per-customer lock, never below zero (b_loyalty_tally, MS009); a caller's seq and balance are
-- overwritten. z_sale_total is redefined here: a sale's total is its lines' gross less its discounts.
-- No column here names a table of a later file.
set local role munshi_owner;

create table books.offer (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('percent_off', 'amount_off')),
  percent_bp int check (percent_bp between 1 and 9000),
  amount_off_minor bigint check (amount_off_minor > 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  scope text not null check (scope in ('all', 'category', 'items')),
  category text check (char_length(category) between 1 and 60),
  min_spend_minor bigint check (min_spend_minor >= 0),
  code text check (code ~ '^[A-Z0-9]{4,16}$'),
  max_redemptions int check (max_redemptions > 0),
  per_customer_limit int check (per_customer_limit > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default false,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (ends_at > starts_at),
  -- the kind's amount and only it
  check ((kind = 'percent_off') = (percent_bp is not null)),
  check ((kind = 'amount_off') = (amount_off_minor is not null)),
  check (currency is not null or (amount_off_minor is null and min_spend_minor is null)),
  check ((scope = 'category') = (category is not null))
);

-- An item offer's items carry the scope as a constant in their key, so only an `items` offer has any.
create unique index offer_scope on books.offer (tenant_id, id, scope);

create table books.offer_item (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  offer_id uuid not null,
  offer_scope text generated always as ('items') stored,
  item_id uuid not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, offer_id, offer_scope) references books.offer (tenant_id, id, scope),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- Ending an offer early, once; the reason is a decision code (ref.reason_use 'decision').
create table books.offer_end (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  offer_id uuid not null,
  ended_at timestamptz not null,
  reason text not null,
  reason_use text generated always as ('decision') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, offer_id) references books.offer,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.loyalty_rule (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  earn_per_100 int not null check (earn_per_100 between 0 and 10000),
  point_value_minor bigint not null check (point_value_minor >= 1),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  min_redeem int not null check (min_redeem >= 1),
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- A customer's points: earned and redeemed by sale.record, reversed by sale.reverse, each naming its sale, whose customer
-- it is (by the composite key on the sale). seq and balance_after are b_loyalty_tally's.
create table books.loyalty_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid not null,
  kind text not null check (kind in ('earned', 'redeemed', 'reversal')),
  points bigint not null check (points <> 0),
  seq bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  sale_id uuid not null,
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, sale_id, customer_id) references books.sale (tenant_id, id, customer_id),
  foreign key (tenant_id, reverses_id) references books.loyalty_entry,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((kind = 'reversal') = (reverses_id is not null)),
  check (kind <> 'earned' or points > 0),
  check (kind <> 'redeemed' or points < 0),
  check ((reverses_id is null) = (reason is null))
);

-- A loyalty discount names the redemption of its own sale.
create unique index loyalty_entry_sale on books.loyalty_entry (tenant_id, id, sale_id);

-- A discount on a bill: on a line (line_no) or the whole sale (NULL); on a GST-invoiced sale every discount names its
-- line, and the line's tax_minor is the tax inside its discounted price (checked by 18's z_invoice_total). Its
-- amount is positive unless a reversal; it names exactly its source's row, and a manual discount carries a
-- discount reason. Two reason columns: the discount's own (use 'discount') and, as on every reversible book,
-- the reversal's (use 'reversal').
create table books.sale_discount (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  sale_id uuid not null,
  line_no int check (line_no between 1 and 500),
  source text not null check (source in ('offer', 'loyalty', 'manual')),
  offer_id uuid,
  loyalty_entry_id uuid,
  discount_reason text,
  discount_reason_use text generated always as ('discount') stored,
  amount_minor bigint not null,
  currency char(3) not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, sale_id, currency) references books.sale (tenant_id, id, currency),
  foreign key (tenant_id, sale_id, line_no) references books.sale_line (tenant_id, sale_id, line_no),
  foreign key (tenant_id, offer_id) references books.offer,
  foreign key (tenant_id, loyalty_entry_id, sale_id) references books.loyalty_entry (tenant_id, id, sale_id),
  foreign key (discount_reason, discount_reason_use) references ref.reason_use,
  foreign key (tenant_id, reverses_id) references books.sale_discount,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((source = 'offer') = (offer_id is not null)),
  check ((source = 'loyalty') = (loyalty_entry_id is not null)),
  check ((source = 'manual') = (discount_reason is not null)),
  check ((reverses_id is null) = (amount_minor > 0)),
  check ((reverses_id is null) = (reason is null))
);

-- b_offer_by_person: an offer is a price, so it is never created from an AI run's draft, only by a person's own command
-- or a person's own draft.
create function books.offer_by_person() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if exists (select 1 from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
              where d.tenant_id = new.tenant_id and d.id = new.decision_id and dr.source = 'run') then
    raise exception 'offer refused: an offer is a person''s own, never an AI draft' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.offer_by_person() from public;

-- b_offer_cap: under the offer's lock (the chain lock first), its live redemptions (sales with an unreversed
-- discount naming it) stay within max_redemptions, and a customer's within per_customer_limit, which needs a named
-- customer. A sale is one redemption however many of its lines the offer discounts.
create function books.offer_cap() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  o books.offer;
  buyer uuid;
begin
  if new.source <> 'offer' or new.reverses_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(2, hashtext(new.tenant_id::text || new.offer_id::text));
  if exists (select 1 from books.sale_discount d
              where d.tenant_id = new.tenant_id and d.sale_id = new.sale_id and d.offer_id = new.offer_id) then
    return new;
  end if;
  select * into o from books.offer x where x.tenant_id = new.tenant_id and x.id = new.offer_id;
  select s.customer_id into buyer from books.sale s where s.tenant_id = new.tenant_id and s.id = new.sale_id;
  if o.max_redemptions is not null and (
       select count(distinct d.sale_id) from books.sale_discount d
        where d.tenant_id = new.tenant_id and d.offer_id = new.offer_id and d.reverses_id is null
          and not exists (select 1 from books.sale_discount r where r.tenant_id = d.tenant_id and r.reverses_id = d.id)) >= o.max_redemptions then
    raise exception 'discount refused: the offer has been redeemed % times, its limit', o.max_redemptions using errcode = 'MS009';
  end if;
  if o.per_customer_limit is not null then
    if buyer is null then
      raise exception 'discount refused: an offer with a per-customer limit needs a named customer' using errcode = 'MS009';
    end if;
    if (select count(distinct d.sale_id) from books.sale_discount d
          join books.sale s on s.tenant_id = d.tenant_id and s.id = d.sale_id
         where d.tenant_id = new.tenant_id and d.offer_id = new.offer_id and d.reverses_id is null and s.customer_id = buyer
           and not exists (select 1 from books.sale_discount r where r.tenant_id = d.tenant_id and r.reverses_id = d.id)) >= o.per_customer_limit then
      raise exception 'discount refused: this customer has redeemed the offer % times, its limit', o.per_customer_limit using errcode = 'MS009';
    end if;
  end if;
  return new;
end $$;
revoke execute on function books.offer_cap() from public;

-- b_loyalty_tally: seq and balance_after from the customer's last entry, under the customer's lock (the chain lock
-- first); below zero is MS009.
create function books.loyalty_tally() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  last_seq bigint;
  last_balance bigint;
begin
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(3, hashtext(new.tenant_id::text || new.customer_id::text));
  select l.seq, l.balance_after into last_seq, last_balance from books.loyalty_entry l
   where l.tenant_id = new.tenant_id and l.customer_id = new.customer_id order by l.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.balance_after := coalesce(last_balance, 0) + new.points;
  if new.balance_after < 0 then
    raise exception 'loyalty refused: % points against a balance of %', new.points, coalesce(last_balance, 0) using errcode = 'MS009';
  end if;
  return new;
end $$;
revoke execute on function books.loyalty_tally() from public;

-- z_sale_total (15's, redefined): a sale's total equals its lines' gross less its discounts, at commit (MS004).
create or replace function books.sale_total() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.total_minor is distinct from coalesce(
       (select sum(l.gross_minor) from books.sale_line l where l.tenant_id = new.tenant_id and l.sale_id = new.id), 0)
     - coalesce((select sum(d.amount_minor) from books.sale_discount d where d.tenant_id = new.tenant_id and d.sale_id = new.id), 0) then
    raise exception 'sale refused: its total is not its lines'' gross less its discounts' using errcode = 'MS004';
  end if;
  return null;
end $$;

create trigger a_write before insert or update or delete on books.offer for each row execute function books.write();
create trigger b_offer_by_person before insert on books.offer for each row execute function books.offer_by_person();
create trigger z_audit after insert on books.offer for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.offer_item for each row execute function books.write();
create trigger z_audit after insert on books.offer_item for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.offer_end for each row execute function books.write();
create trigger z_audit after insert on books.offer_end for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.loyalty_rule for each row execute function books.write();
create trigger z_audit after insert on books.loyalty_rule for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.loyalty_entry for each row execute function books.write();
create trigger b_loyalty_tally before insert on books.loyalty_entry for each row execute function books.loyalty_tally();
create trigger z_audit after insert on books.loyalty_entry for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.sale_discount for each row execute function books.write();
create trigger b_offer_cap before insert on books.sale_discount for each row execute function books.offer_cap();
create trigger z_audit after insert on books.sale_discount for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests; the composite-key targets are above, by
-- their tables.
create index offer_window on books.offer (tenant_id, starts_at, ends_at);
create unique index offer_code on books.offer (tenant_id, code) where code is not null;
create index offer_item_item on books.offer_item (tenant_id, item_id);
create index offer_item_offer on books.offer_item (tenant_id, offer_id);
create unique index offer_end_once on books.offer_end (tenant_id, offer_id);
create index loyalty_rule_from on books.loyalty_rule (tenant_id, effective_from desc, created_at desc);
create unique index loyalty_entry_seq on books.loyalty_entry (tenant_id, customer_id, seq);
create index loyalty_entry_by_sale on books.loyalty_entry (tenant_id, sale_id);
create unique index loyalty_entry_reverses on books.loyalty_entry (tenant_id, reverses_id) where reverses_id is not null;
create index sale_discount_sale on books.sale_discount (tenant_id, sale_id);
create index sale_discount_offer on books.sale_discount (tenant_id, offer_id);
create unique index sale_discount_reverses on books.sale_discount (tenant_id, reverses_id) where reverses_id is not null;

-- The book table manifest and the commands. sale.record and sale.reverse gain the discount and
-- loyalty tables.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.offer', null, null, false, '{}', '{}', '{b_offer_by_person}'),
  ('books.offer_item', 'books.offer', 'offer_id', false, '{}', '{}', '{}'),
  ('books.offer_end', null, null, false, '{}', '{}', '{}'),
  ('books.loyalty_rule', null, null, false, '{}', '{}', '{}'),
  ('books.loyalty_entry', null, null, true, '{points}', '{customer_id}', '{b_loyalty_tally}'),
  ('books.sale_discount', 'books.sale', 'sale_id', true, '{amount_minor}', '{line_no,source,offer_id,discount_reason,currency}', '{b_offer_cap}');
insert into ref.command (command, draft_only) values
  ('offer.create', false), ('offer.end', false), ('loyalty.rule.set', false);
insert into ref.command_authority (command, role) values
  ('offer.create', 'owner'), ('offer.end', 'owner'), ('loyalty.rule.set', 'owner');
insert into ref.command_table (command, rel) values
  ('offer.create', 'books.offer'), ('offer.create', 'books.offer_item'), ('offer.end', 'books.offer_end'),
  ('loyalty.rule.set', 'books.loyalty_rule'),
  ('sale.record', 'books.sale_discount'), ('sale.record', 'books.loyalty_entry'),
  ('sale.reverse', 'books.sale_discount'), ('sale.reverse', 'books.loyalty_entry');
insert into ref.command_capability (command, capability, use) values
  ('offer.create', 'offers', 'start'), ('offer.end', 'offers', 'finish'), ('loyalty.rule.set', 'loyalty', 'start');

-- RLS and the grants: books are the app's (S I) and the jobs role's (S) only.
alter table books.offer enable row level security;
alter table books.offer force row level security;
create policy tenant_isolation on books.offer
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.offer from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.offer to munshi_app;
grant select on books.offer to munshi_jobs;

alter table books.offer_item enable row level security;
alter table books.offer_item force row level security;
create policy tenant_isolation on books.offer_item
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.offer_item from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.offer_item to munshi_app;
grant select on books.offer_item to munshi_jobs;

alter table books.offer_end enable row level security;
alter table books.offer_end force row level security;
create policy tenant_isolation on books.offer_end
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.offer_end from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.offer_end to munshi_app;
grant select on books.offer_end to munshi_jobs;

alter table books.loyalty_rule enable row level security;
alter table books.loyalty_rule force row level security;
create policy tenant_isolation on books.loyalty_rule
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.loyalty_rule from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.loyalty_rule to munshi_app;
grant select on books.loyalty_rule to munshi_jobs;

alter table books.loyalty_entry enable row level security;
alter table books.loyalty_entry force row level security;
create policy tenant_isolation on books.loyalty_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.loyalty_entry from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.loyalty_entry to munshi_app;
grant select on books.loyalty_entry to munshi_jobs;

alter table books.sale_discount enable row level security;
alter table books.sale_discount force row level security;
create policy tenant_isolation on books.sale_discount
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.sale_discount from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.sale_discount to munshi_app;
grant select on books.sale_discount to munshi_jobs;
