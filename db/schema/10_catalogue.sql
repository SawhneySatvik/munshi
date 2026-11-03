-- 10 · The catalogue: items, their revisions, aliases and prices, and their commands' ref
-- rows. Books: written only through books.write (a_write) and audited (z_audit); append-only, the latest in effect wins
-- (`order by effective_from desc, created_at desc, id desc`). No column here names a table of a later file.
--
-- Every books table carries the stamp [S] (created_by, decision_id, created_txid, created_at), set by books.write
-- whatever the caller sends; none here is reversible. Kinds and variants are core's capability checks: the
-- book guard never reads a capability.
set local role munshi_owner;

-- An item's identity: what it is (a good, a service, a package) and its unit. It never changes; a variant names its
-- parent. The kind travels in a composite key, so a stock move or a booking can name only an item of its own kind.
create table books.item (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  kind text not null check (kind in ('good', 'service', 'package')),
  unit text not null check (unit in ('piece', 'pack', 'kg', 'g', 'l', 'ml', 'm', 'session')),
  parent_item_id uuid,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  foreign key (tenant_id, parent_item_id) references books.item,
  check ((kind = 'service') = (unit = 'session')),
  check (parent_item_id is distinct from id)
);

-- What may change about an item: its name, category, barcode, variant attributes, duration (services), tax codes and
-- whether it is sold. A service's revision carries its duration and nothing else does (b_revision_kind).
create table books.item_revision (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  item_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  category text check (char_length(category) <= 60),
  barcode text check (char_length(barcode) between 1 and 64),
  attrs jsonb not null default '{}' check (jsonb_typeof(attrs) = 'object' and not jsonb_path_exists(attrs,
    'strict $.* ? (@.type() != "string" || !(@ like_regex "^.{1,30}$"))')),
  duration_min int check (duration_min between 5 and 600),
  hsn_sac text check (hsn_sac ~ '^[0-9]{4,8}$'),
  tax_class text check (tax_class ~ '^[a-z0-9_]{2,40}$'),
  sellable boolean not null default true,
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create function books.revision_kind() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if (new.duration_min is not null) is distinct from
     (select i.kind = 'service' from books.item i where i.tenant_id = new.tenant_id and i.id = new.item_id) then
    raise exception 'revision refused: a service''s revision gives its duration, and no other item''s does' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.revision_kind() from public;

-- Another name a counter search or a bill line matches: NFKC, trimmed, lower case, one item per alias.
create table books.item_alias (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  item_id uuid not null,
  alias text not null check (char_length(alias) between 1 and 120 and alias = lower(btrim(normalize(alias, NFKC)))),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- The selling price from effective_from on (tax-inclusive); the latest in effect wins.
create table books.price (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  item_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create trigger a_write before insert or update or delete on books.item for each row execute function books.write();
create trigger z_audit after insert on books.item for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.item_revision for each row execute function books.write();
create trigger b_revision_kind before insert on books.item_revision for each row execute function books.revision_kind();
create trigger z_audit after insert on books.item_revision for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.item_alias for each row execute function books.write();
create trigger z_audit after insert on books.item_alias for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.price for each row execute function books.write();
create trigger z_audit after insert on books.price for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create unique index item_kind on books.item (tenant_id, id, kind);
create index item_parent on books.item (tenant_id, parent_item_id);
create index item_revision_latest on books.item_revision (tenant_id, item_id, effective_from desc, created_at desc);
create index item_revision_barcode on books.item_revision (tenant_id, barcode) where barcode is not null;
create unique index item_alias_name on books.item_alias (tenant_id, alias);
create index price_item on books.price (tenant_id, item_id, effective_from desc, created_at desc);

-- The book table manifest, the commands, who runs or approves them, what each writes, and its capability.
-- grid.apply (draft-only) writes these tables; package.plan.create adds its rows here from 17.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.item', null, null, false, '{}', '{}', '{}'),
  ('books.item_revision', null, null, false, '{}', '{}', '{b_revision_kind}'),
  ('books.item_alias', null, null, false, '{}', '{}', '{}'),
  ('books.price', null, null, false, '{}', '{}', '{}');
insert into ref.command (command, draft_only) values
  ('item.create', false), ('item.revise', false), ('item.alias', false), ('price.set', false), ('grid.apply', true);
insert into ref.command_authority (command, role) values
  ('item.create', 'owner'), ('item.create', 'manager'), ('item.revise', 'owner'), ('item.alias', 'owner'),
  ('item.alias', 'manager'), ('price.set', 'owner'), ('grid.apply', 'owner');
insert into ref.command_table (command, rel) values
  ('item.create', 'books.item'), ('item.create', 'books.item_revision'), ('item.revise', 'books.item_revision'),
  ('item.alias', 'books.item_alias'), ('price.set', 'books.price'),
  ('grid.apply', 'books.item'), ('grid.apply', 'books.item_revision'), ('grid.apply', 'books.price');
insert into ref.command_capability (command, capability, use) values
  ('item.create', 'counter', 'start'), ('item.revise', 'counter', 'start'), ('item.alias', 'counter', 'start'),
  ('price.set', 'counter', 'start'), ('grid.apply', 'counter', 'start');

-- RLS and the grants. The public role reads only what live slots need of a revision: ids, duration, sellable and
-- times, never a name or a price.
alter table books.item enable row level security;
alter table books.item force row level security;
create policy tenant_isolation on books.item
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.item from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.item to munshi_app;
grant select on books.item to munshi_jobs;
-- 21's order_request_flow checks a site request's line items as the public (ids and the kind, no name or number).
grant select (tenant_id, id, kind) on books.item to munshi_public;

alter table books.item_revision enable row level security;
alter table books.item_revision force row level security;
create policy tenant_isolation on books.item_revision
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.item_revision from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.item_revision to munshi_app;
grant select on books.item_revision to munshi_jobs;
grant select (tenant_id, id, item_id, duration_min, sellable, effective_from, created_at) on books.item_revision to munshi_public;

alter table books.item_alias enable row level security;
alter table books.item_alias force row level security;
create policy tenant_isolation on books.item_alias
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.item_alias from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.item_alias to munshi_app;
grant select on books.item_alias to munshi_jobs;

alter table books.price enable row level security;
alter table books.price force row level security;
create policy tenant_isolation on books.price
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.price from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.price to munshi_app;
grant select on books.price to munshi_jobs;
