-- 0002 · ops: tenants, shops, members, who may run which direct command, documents, agent runs.
-- Operational, not books: the app writes these rows directly; the agent reads none of them (only agent_view).
-- Every tenant table: tenant_id leads every key, RLS enabled and forced, context only from SET LOCAL munshi.*.
set local role munshi_owner;

create table ops.tenant (
  tenant_id uuid primary key,
  name text not null,
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table ops.shop (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table ops.member (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text,
  role text not null check (role in ('owner', 'manager', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- Global and read-only at runtime: which member role may run which direct command. The same for every tenant (a
-- tenant's members carry their role), so no runtime role can grant itself authority. Changed only by a migration.
create table ops.command_authority (
  command text not null,
  role text not null check (role in ('owner', 'manager', 'staff')),
  primary key (command, role)
);

insert into ops.command_authority (command, role)
select c, 'owner' from unnest(array[
  'item.create', 'price.set', 'supplier.create', 'customer.create', 'staff.create',
  'sale.record', 'purchase.record', 'stock.count', 'stock.waste', 'reorder.place',
  'credit.record', 'payment.record', 'attendance.record', 'journal.post', 'message.send'
]) as c
union all
select c, 'manager' from unnest(array[
  'item.create', 'supplier.create', 'customer.create',
  'sale.record', 'purchase.record', 'stock.count', 'stock.waste', 'reorder.place',
  'credit.record', 'payment.record', 'attendance.record', 'message.send'
]) as c
union all
select c, 'staff' from unnest(array['sale.record', 'payment.record', 'stock.waste']) as c;

-- Metadata of an uploaded photo or bill; the bytes live in a blob store under storage_key.
create table ops.document (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('photo', 'bill', 'other')),
  storage_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null,
  bytes integer not null check (bytes > 0),
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, sha256),
  foreign key (tenant_id, uploaded_by) references ops.member
);

-- One agent or watcher run; its trace carries ids and labels only, never untrusted text.
create table ops.run (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  trigger text not null check (trigger in ('question', 'watcher', 'brief')),
  started_by uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, started_by) references ops.member
);

create table ops.run_trace (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  seq integer not null check (seq > 0),
  kind text not null,
  label text not null,
  refs jsonb not null default '[]' check (jsonb_typeof(refs) = 'array'),
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, run_id, seq),
  foreign key (tenant_id, run_id) references ops.run
);

-- Row-level security: enabled and forced (the owner is subject too, which keeps views tenant-scoped).
alter table ops.tenant enable row level security;
alter table ops.tenant force row level security;
create policy tenant_isolation on ops.tenant
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.shop enable row level security;
alter table ops.shop force row level security;
create policy tenant_isolation on ops.shop
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.member enable row level security;
alter table ops.member force row level security;
create policy tenant_isolation on ops.member
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.document enable row level security;
alter table ops.document force row level security;
create policy tenant_isolation on ops.document
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.run enable row level security;
alter table ops.run force row level security;
create policy tenant_isolation on ops.run
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.run_trace enable row level security;
alter table ops.run_trace force row level security;
create policy tenant_isolation on ops.run_trace
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- Privileges: revoke everything, then grant exactly what the app needs. The agent gets nothing here.
revoke all on ops.tenant from public, munshi_app, munshi_agent;
grant select, insert on ops.tenant to munshi_app;

revoke all on ops.shop from public, munshi_app, munshi_agent;
grant select, insert on ops.shop to munshi_app;

revoke all on ops.member from public, munshi_app, munshi_agent;
grant select, insert on ops.member to munshi_app;

revoke all on ops.command_authority from public, munshi_app, munshi_agent;
grant select on ops.command_authority to munshi_app;

revoke all on ops.document from public, munshi_app, munshi_agent;
grant select, insert on ops.document to munshi_app;

revoke all on ops.run from public, munshi_app, munshi_agent;
grant select, insert, update (ended_at) on ops.run to munshi_app;

revoke all on ops.run_trace from public, munshi_app, munshi_agent;
grant select, insert on ops.run_trace to munshi_app;
