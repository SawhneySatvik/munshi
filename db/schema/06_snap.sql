-- 06 · Snapshots and their pins. A snapshot is the only source of a number on screen: one row holding
-- its typed cells as JSON (checked and stamped by snap.snap_check, 02), immutable. A snapshot cited by a draft, finding,
-- answer, brief, release or grid batch is pinned by that holder's own trigger; the jobs role purges unpinned display,
-- watch and evidence snapshots after 7 days. The finding pin-release policy names ai.finding, so 07 creates it.
-- No column here names a table of a later file.
set local role munshi_owner;

create table snap.snapshot (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  query_name text not null check (query_name ~ '^[a-z][a-z0-9_.]{1,80}$'),
  params jsonb not null default '{}',
  params_sha256 bytea not null check (octet_length(params_sha256) = 32),
  purpose text not null check (purpose in ('display', 'evidence', 'watch', 'release')),
  columns jsonb not null,
  rows jsonb not null,
  rows_sha256 bytea not null check (octet_length(rows_sha256) = 32),
  row_count int not null check (row_count between 0 and 500),
  actor_id uuid,
  run_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, actor_id) references ops.member,
  foreign key (tenant_id, run_id) references ai.run
);
create trigger snap_check before insert or update on snap.snapshot for each row execute function snap.snap_check();

-- A pin holds a snapshot against the purge. The foreign key (on delete restrict) closes the race with the purge in the
-- database: a pin insert takes a key-share lock on its snapshot, so a purge that reaches that snapshot
-- waits and then fails its delete, and a pin whose snapshot was purged first fails its own key; either way no pin is left
-- without its snapshot. (SKIP LOCKED would need UPDATE on snap.snapshot, which no role holds, so the purge treats
-- 23503 as "skip this one".) A pin is inserted only by a holder's trigger and never deleted, but by the sandbox reset
-- and by 07's pin_release policy.
create table snap.pin (
  tenant_id uuid not null references ops.tenant,
  snapshot_id uuid not null,
  holder text not null check (holder in ('draft', 'finding', 'answer', 'brief', 'release', 'grid')),
  holder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, snapshot_id, holder, holder_id),
  foreign key (tenant_id, snapshot_id) references snap.snapshot on delete restrict
);
create trigger from_holder before insert on snap.pin for each row execute function ops.only_from_trigger();

-- Indexes, one per statement, each asserted in pg_index by the gate tests. snapshot_reuse serves a display read's
-- lookup of the newest identical snapshot with no run; snapshot_purge the jobs purge.
create index snapshot_reuse on snap.snapshot (tenant_id, query_name, params_sha256, rows_sha256, created_at)
  where purpose = 'display' and run_id is null;
create index snapshot_purge on snap.snapshot (tenant_id, created_at) where purpose in ('display', 'watch', 'evidence');

-- RLS and the grants. The public role reads only snapshots a release pins, and only release pins.
alter table snap.snapshot enable row level security;
alter table snap.snapshot force row level security;
create policy tenant_isolation on snap.snapshot
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy snapshot_public on snap.snapshot as restrictive for select to munshi_public
  using (exists (select 1 from snap.pin p where p.tenant_id = snapshot.tenant_id and p.snapshot_id = snapshot.id and p.holder = 'release'));
create policy snapshot_purge on snap.snapshot as restrictive for delete to munshi_jobs
  using (purpose in ('display', 'watch', 'evidence') and created_at < now() - interval '7 days'
         and not exists (select 1 from snap.pin p where p.tenant_id = snapshot.tenant_id and p.snapshot_id = snapshot.id));
revoke all on snap.snapshot from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on snap.snapshot to munshi_app;
grant select, insert, delete on snap.snapshot to munshi_jobs;
grant select on snap.snapshot to munshi_agent, munshi_public;

alter table snap.pin enable row level security;
alter table snap.pin force row level security;
create policy tenant_isolation on snap.pin
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy pin_public on snap.pin as restrictive for select to munshi_public using (holder = 'release');
revoke all on snap.pin from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on snap.pin to munshi_app;
grant select, insert, delete on snap.pin to munshi_jobs;
grant select on snap.pin to munshi_public;
