-- 0003 · Snapshots (the only source of a shown number), findings, drafts and decisions.
set local role munshi_owner;

-- A snapshot is one named read the server ran and stored; each cell is one typed value of that read.
-- A shown number renders from a cell ⟨snap:ID·row·col⟩, never from model text.
create table snap.snapshot (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  query_name text not null,
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  actor_id uuid,
  run_id uuid,
  row_count integer not null check (row_count >= 0),
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, actor_id) references ops.member,
  foreign key (tenant_id, run_id) references ops.run
);

-- integer / money (minor units) / quantity (milli-units) use num; exactly the columns of the kind are set.
create table snap.snapshot_cell (
  tenant_id uuid not null references ops.tenant,
  snapshot_id uuid not null,
  row_no integer not null check (row_no >= 0),
  col text not null,
  kind text not null check (kind in ('integer', 'money', 'quantity', 'text', 'date', 'timestamp', 'null')),
  num bigint,
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  unit text,
  txt text,
  day date,
  at timestamptz,
  primary key (tenant_id, snapshot_id, row_no, col),
  foreign key (tenant_id, snapshot_id) references snap.snapshot,
  check ((num is not null) = (kind in ('integer', 'money', 'quantity'))),
  check ((currency is not null) = (kind = 'money')),
  check ((unit is not null) = (kind = 'quantity')),
  check ((txt is not null) = (kind = 'text')),
  check ((day is not null) = (kind = 'date')),
  check ((at is not null) = (kind = 'timestamp'))
);

-- A snapshot closes when its transaction commits: created_txid is stamped here (a caller-supplied value could name a
-- later transaction), and a cell is accepted only in the transaction that created its snapshot.
create function snap.snapshot_txn() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'snapshot' then
    new.created_txid := txid_current();
    return new;
  end if;
  perform 1 from snap.snapshot s
   where s.tenant_id = new.tenant_id and s.id = new.snapshot_id and s.created_txid = txid_current();
  if not found then
    raise exception 'snapshot cell refused: its snapshot was not created in this transaction' using errcode = 'MS006';
  end if;
  return new;
end $$;
revoke execute on function snap.snapshot_txn() from public;
create trigger txn before insert on snap.snapshot for each row execute function snap.snapshot_txn();
create trigger txn before insert on snap.snapshot_cell for each row execute function snap.snapshot_txn();

-- A watcher's finding; dedupe_key keeps one finding per situation.
create table ops.finding (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  snapshot_id uuid not null,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, dedupe_key),
  foreign key (tenant_id, snapshot_id) references snap.snapshot,
  foreign key (tenant_id, run_id) references ops.run
);

-- A proposed change to the books. based_on lists the snapshot cells it relied on, re-checked at decision time.
create table approval.draft (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  command_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  based_on jsonb not null default '[]' check (jsonb_typeof(based_on) = 'array'),
  run_id uuid,
  proposed_by uuid,
  finding_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'executed', 'rejected', 'stale', 'failed')),
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ops.run,
  foreign key (tenant_id, proposed_by) references ops.member,
  foreign key (tenant_id, finding_id) references ops.finding,
  check (run_id is not null or proposed_by is not null)
);

-- A new draft is proposed, and created_txid is stamped so a decision can refuse a draft of its own transaction.
create function approval.stamp_draft() returns trigger language plpgsql as $$
begin
  if new.status <> 'proposed' then
    raise exception 'draft refused: a new draft is proposed' using errcode = 'MS002';
  end if;
  new.created_txid := txid_current();
  return new;
end $$;
revoke execute on function approval.stamp_draft() from public;
create trigger stamp before insert on approval.draft for each row execute function approval.stamp_draft();

-- A person's verdict on a draft: one per draft, ever. created_txid is stamped by the trigger below and is what the
-- book guard compares with txid_current(), so a decision admits book writes only inside the transaction that made it.
create table approval.decision (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  draft_id uuid not null,
  verdict text not null check (verdict in ('approved', 'rejected')),
  decided_by uuid not null,
  reason text,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, draft_id),
  foreign key (tenant_id, draft_id) references approval.draft,
  foreign key (tenant_id, decided_by) references ops.member
);

-- Overwrites created_txid (a caller-supplied value could name a future transaction and replay the decision there),
-- and requires the decider to be the acting member and the draft to be still awaiting a decision, proposed in an
-- earlier transaction (so one transaction cannot both propose a change and approve it).
create function approval.stamp_decision() returns trigger language plpgsql as $$
declare
  draft_txid bigint;
begin
  new.created_txid := txid_current();
  new.created_at := now();
  if new.decided_by is distinct from nullif(current_setting('munshi.actor_id', true), '')::uuid then
    raise exception 'decision refused: decided_by is not the acting member' using errcode = 'MS002';
  end if;
  select dr.created_txid into draft_txid from approval.draft dr
   where dr.tenant_id = new.tenant_id and dr.id = new.draft_id and dr.status = 'proposed';
  if not found then
    raise exception 'decision refused: the draft is not awaiting a decision' using errcode = 'MS002';
  end if;
  if draft_txid = txid_current() then
    raise exception 'decision refused: the draft was proposed in this transaction' using errcode = 'MS002';
  end if;
  return new;
end $$;
revoke execute on function approval.stamp_decision() from public;
create trigger stamp before insert on approval.decision for each row execute function approval.stamp_decision();

-- A draft is decided once: its status moves only away from 'proposed', and only as its decision says: executed under
-- an approved decision made in this transaction, rejected under a rejected decision, stale or failed while undecided.
create function approval.draft_status() returns trigger language plpgsql as $$
declare
  verdict text;
  decided_txid bigint;
begin
  if old.status <> 'proposed' then
    raise exception 'draft refused: status % is final', old.status using errcode = 'MS002';
  end if;
  select d.verdict, d.created_txid into verdict, decided_txid
    from approval.decision d where d.tenant_id = new.tenant_id and d.draft_id = new.id;
  if new.status = 'executed' and (verdict is distinct from 'approved' or decided_txid is distinct from txid_current()) then
    raise exception 'draft refused: executed needs an approved decision made in this transaction' using errcode = 'MS002';
  elsif new.status = 'rejected' and verdict is distinct from 'rejected' then
    raise exception 'draft refused: rejected needs a rejected decision' using errcode = 'MS002';
  elsif new.status in ('stale', 'failed') and verdict is not null then
    raise exception 'draft refused: the draft is decided' using errcode = 'MS002';
  end if;
  return new;
end $$;
revoke execute on function approval.draft_status() from public;
create trigger status before update on approval.draft for each row execute function approval.draft_status();

alter table snap.snapshot enable row level security;
alter table snap.snapshot force row level security;
create policy tenant_isolation on snap.snapshot
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table snap.snapshot_cell enable row level security;
alter table snap.snapshot_cell force row level security;
create policy tenant_isolation on snap.snapshot_cell
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.finding enable row level security;
alter table ops.finding force row level security;
create policy tenant_isolation on ops.finding
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table approval.draft enable row level security;
alter table approval.draft force row level security;
create policy tenant_isolation on approval.draft
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table approval.decision enable row level security;
alter table approval.decision force row level security;
create policy tenant_isolation on approval.decision
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

revoke all on snap.snapshot from public, munshi_app, munshi_agent;
grant select, insert on snap.snapshot to munshi_app;
grant select on snap.snapshot to munshi_agent;

revoke all on snap.snapshot_cell from public, munshi_app, munshi_agent;
grant select, insert on snap.snapshot_cell to munshi_app;
grant select on snap.snapshot_cell to munshi_agent;

revoke all on ops.finding from public, munshi_app, munshi_agent;
grant select, insert, update (status, updated_at) on ops.finding to munshi_app;

revoke all on approval.draft from public, munshi_app, munshi_agent;
grant select, insert, update (status, updated_at) on approval.draft to munshi_app;

revoke all on approval.decision from public, munshi_app, munshi_agent;
grant select, insert on approval.decision to munshi_app;

create index snapshot_query on snap.snapshot (tenant_id, query_name, created_at);
create index finding_status on ops.finding (tenant_id, status);
create index draft_status on approval.draft (tenant_id, status);
