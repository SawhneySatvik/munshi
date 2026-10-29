-- 20 · The grid: a person's batch of catalogue changes, which core turns into one grid.apply draft the owner approves
-- (BLUEPRINT §2.10.10, MERCHANTS-DESIGN §3.4). Ops rows, append-only: a batch names the snapshot of the catalogue it was
-- opened on, which it pins (holder 'grid', §2.5), and its changes come only in its own transaction, by the member who
-- opened it (MS006, GR3's database part), at most 500 (GR4). The agent reads a batch only as cells of grid.batch.
-- No column here names a table of a later file.
set local role munshi_owner;

create table ops.grid_batch (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  base_snapshot_id uuid not null,
  source text not null check (source in ('typed', 'pasted', 'file')),
  document_id uuid,
  created_by uuid not null,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, base_snapshot_id) references snap.snapshot,
  foreign key (tenant_id, document_id) references ops.document,
  foreign key (tenant_id, created_by) references ops.member,
  check ((source = 'file') = (document_id is not null))
);

-- A change: a new price for an item, or a new item (its fields as a JSON object) keyed within the batch.
create table ops.grid_change (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  batch_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  kind text not null check (kind in ('price', 'new_item')),
  item_id uuid,
  add_key text check (add_key ~ '^[a-z0-9_-]{1,40}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  new_item jsonb check (jsonb_typeof(new_item) = 'object'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, batch_id) references ops.grid_batch,
  foreign key (tenant_id, item_id) references books.item,
  check ((kind = 'price') = (item_id is not null)),
  check ((kind = 'new_item') = (add_key is not null)),
  check ((kind = 'new_item') = (new_item is not null))
);

-- A batch is an active member's own, stamped; a document is its tenant's import; it pins its base snapshot.
create function ops.grid_batch_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
    raise exception 'grid refused: a batch is an active member''s own' using errcode = 'MS007';
  end if;
  if new.document_id is not null and not exists (
       select 1 from ops.document d where d.tenant_id = new.tenant_id and d.id = new.document_id and d.kind = 'import' and d.erased_at is null) then
    raise exception 'grid refused: a batch''s file is an import document' using errcode = 'MS007';
  end if;
  new.created_by := ctx_actor;
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.grid_batch_guard() from public;

create function ops.grid_pin() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into snap.pin (tenant_id, snapshot_id, holder, holder_id) values (new.tenant_id, new.base_snapshot_id, 'grid', new.id)
    on conflict do nothing;
  return null;
end $$;
revoke execute on function ops.grid_pin() from public;

-- A change comes only in its batch's transaction, by the member who opened it (MS006).
create function ops.grid_change_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.grid_batch b
        where b.tenant_id = new.tenant_id and b.id = new.batch_id and b.created_txid = txid_current()
          and b.created_by = nullif(current_setting('munshi.actor_id', true), '')::uuid) then
    raise exception 'grid refused: a change is added in its batch''s transaction, by the member who opened it' using errcode = 'MS006';
  end if;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.grid_change_guard() from public;

create trigger guard before insert on ops.grid_batch for each row execute function ops.grid_batch_guard();
create trigger pin after insert on ops.grid_batch for each row execute function ops.grid_pin();
create trigger guard before insert on ops.grid_change for each row execute function ops.grid_change_guard();

-- Indexes, one per statement, each asserted in pg_index (G10). grid_batch_snapshot spares the snapshot purge's key
-- check a scan (R4 I1).
create index grid_batch_snapshot on ops.grid_batch (tenant_id, base_snapshot_id);
create index grid_batch_member on ops.grid_batch (tenant_id, created_by, created_at);
create unique index grid_change_line on ops.grid_change (tenant_id, batch_id, line_no);
create unique index grid_change_add_key on ops.grid_change (tenant_id, batch_id, add_key) where add_key is not null;

-- RLS and the grants: the app's, append-only.
alter table ops.grid_batch enable row level security;
alter table ops.grid_batch force row level security;
create policy tenant_isolation on ops.grid_batch
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.grid_batch from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.grid_batch to munshi_app;

alter table ops.grid_change enable row level security;
alter table ops.grid_change force row level security;
create policy tenant_isolation on ops.grid_change
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.grid_change from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.grid_change to munshi_app;
