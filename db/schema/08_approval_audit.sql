-- 08 · Drafts and decisions, the audit chain and its checkpoints, and the three audit functions (BLUEPRINT §2.7, §2.9,
-- §2.10.11). audit.entry_hash takes the audit table's row type, and the verifiers read it, so they are created here,
-- after their table (R4 B1). No column here names a table of a later file.
set local role munshi_owner;

-- A proposed change to the books: its command, payload (ids, codes and numbers), the cells it relied on (based_on, 1 to
-- 50 refs) and the cell behind every payload number (payload_refs: path → ref). Proposed by a member or a run, as
-- munshi_app; every snapshot it cites is pinned for as long as the draft exists. A person who edits a draft makes a new
-- one naming the old (supersedes_id), and the old becomes superseded in that transaction.
create table approval.draft (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  command text not null references ref.command,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  based_on jsonb not null,
  payload_refs jsonb not null default '{}',
  source text not null check (source in ('member', 'run')),
  proposed_by uuid,
  run_id uuid,
  finding_id uuid,
  desk text check (desk ~ '^[a-z_]{2,40}$'),
  supersedes_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'executed', 'rejected', 'stale', 'failed', 'superseded')),
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, proposed_by) references ops.member,
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, finding_id) references ai.finding,
  foreign key (tenant_id, supersedes_id) references approval.draft,
  check (source <> 'member' or proposed_by is not null),
  check ((source = 'run') = (run_id is not null))
);

create function approval.stamp_draft() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
    raise exception 'draft refused: a draft is proposed through the app, by an active member or for their run' using errcode = 'MS002';
  end if;
  if new.status <> 'proposed' then
    raise exception 'draft refused: a new draft is proposed' using errcode = 'MS002';
  end if;
  if jsonb_typeof(new.based_on) is distinct from 'array' or jsonb_array_length(new.based_on) not between 1 and 50
     or jsonb_typeof(new.payload_refs) is distinct from 'object'
     or exists (select 1 from (select v from jsonb_array_elements(new.based_on) a(v)
                               union all select v from jsonb_each(new.payload_refs) p(k, v)) r
                 where jsonb_typeof(r.v) <> 'object' or r.v - array['snapshotId', 'row', 'col'] <> '{}'::jsonb
                    or jsonb_typeof(r.v -> 'snapshotId') is distinct from 'string' or (r.v ->> 'snapshotId') !~ uuid_re
                    or jsonb_typeof(r.v -> 'row') is distinct from 'number' or (r.v ->> 'row') !~ '^[0-9]{1,3}$'
                    or jsonb_typeof(r.v -> 'col') is distinct from 'string' or (r.v ->> 'col') !~ '^[a-z_][a-z0-9_]{0,62}$') then
    raise exception 'draft refused: based_on is 1 to 50 refs and payload_refs maps paths to refs, each {snapshotId, row, col}'
      using errcode = 'MS002';
  end if;
  if new.supersedes_id is not null and not exists (
       select 1 from approval.draft d where d.tenant_id = new.tenant_id and d.id = new.supersedes_id
          and d.status = 'proposed' and d.command = new.command) then
    raise exception 'draft refused: an edit supersedes a proposed draft of the same command' using errcode = 'MS002';
  end if;
  if new.source = 'member' then
    new.proposed_by := ctx_actor;
  end if;
  new.created_txid := txid_current();
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
revoke execute on function approval.stamp_draft() from public;

-- A draft leaves `proposed` once, and only as its decision or its edit says: executed under an approved decision made
-- in this transaction; rejected under a rejected decision; superseded by a draft naming it made in this transaction;
-- stale or failed while undecided. Every move is made by an active member who may approve the draft's command.
create function approval.draft_status() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  verdict text;
  decided_txid bigint;
begin
  if old.status <> 'proposed' then
    raise exception 'draft refused: status % is final', old.status using errcode = 'MS002';
  end if;
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m join ref.command_authority ca on ca.role = m.role and ca.command = old.command
        where m.tenant_id = old.tenant_id and m.id = ctx_actor and m.active) then
    raise exception 'draft refused: only an active member who may approve % moves its draft', old.command using errcode = 'MS002';
  end if;
  select d.verdict, d.created_txid into verdict, decided_txid from approval.decision d where d.tenant_id = new.tenant_id and d.draft_id = new.id;
  if new.status = 'executed' and (verdict is distinct from 'approved' or decided_txid is distinct from txid_current()) then
    raise exception 'draft refused: executed needs an approved decision made in this transaction' using errcode = 'MS002';
  elsif new.status = 'rejected' and verdict is distinct from 'rejected' then
    raise exception 'draft refused: rejected needs a rejected decision' using errcode = 'MS002';
  elsif new.status in ('stale', 'failed') and verdict is not null then
    raise exception 'draft refused: a decided draft is not marked %', new.status using errcode = 'MS002';
  elsif new.status = 'superseded' and (verdict is not null or not exists (
          select 1 from approval.draft d where d.tenant_id = new.tenant_id and d.supersedes_id = new.id
             and d.created_txid = txid_current() and d.proposed_by = ctx_actor)) then
    raise exception 'draft refused: superseded needs the acting member''s edit, made in this transaction' using errcode = 'MS002';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function approval.draft_status() from public;

-- Pins every snapshot the draft cites, so its figures stay traceable as long as it exists; a draft made for a finding
-- writes the finding's `drafted` event.
create function approval.draft_pin() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into snap.pin (tenant_id, snapshot_id, holder, holder_id)
  select distinct new.tenant_id, (r.v ->> 'snapshotId')::uuid, 'draft', new.id
    from (select v from jsonb_array_elements(new.based_on) a(v) union all select v from jsonb_each(new.payload_refs) p(k, v)) r
  on conflict do nothing;
  if new.finding_id is not null then
    insert into ai.finding_event (tenant_id, finding_id, kind, run_id, member_id)
    values (new.tenant_id, new.finding_id, 'drafted', new.run_id, nullif(current_setting('munshi.actor_id', true), '')::uuid);
  end if;
  return null;
end $$;
revoke execute on function approval.draft_pin() from public;

create trigger stamp before insert on approval.draft for each row execute function approval.stamp_draft();
create trigger status before update on approval.draft for each row execute function approval.draft_status();
create trigger pin after insert on approval.draft for each row execute function approval.draft_pin();

-- A person's verdict on a draft: one per draft, ever, by the acting member, who may approve its command, on a draft
-- proposed in an earlier transaction (so one transaction never both proposes and approves). created_txid is what the
-- book guard compares with txid_current(), so a decision admits book writes only inside the transaction that made it.
-- A rejection carries a reason code, never words.
create table approval.decision (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  draft_id uuid not null,
  verdict text not null check (verdict in ('approved', 'rejected')),
  decided_by uuid not null,
  reason text,
  reason_use text generated always as ('decision') stored,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, draft_id) references approval.draft,
  foreign key (tenant_id, decided_by) references ops.member,
  foreign key (reason, reason_use) references ref.reason_use,
  check (verdict = 'approved' or reason is not null)
);

create function approval.stamp_decision() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  draft_txid bigint;
begin
  if current_user <> 'munshi_app' then
    raise exception 'decision refused: a decision is made through the app' using errcode = 'MS002';
  end if;
  select dr.created_txid into draft_txid
    from approval.draft dr
    join ops.member m on m.tenant_id = dr.tenant_id and m.id = ctx_actor and m.active
    join ref.command_authority ca on ca.role = m.role and ca.command = dr.command
   where dr.tenant_id = new.tenant_id and dr.id = new.draft_id and dr.status = 'proposed';
  if not found then
    raise exception 'decision refused: the draft is not awaiting a decision, or the acting member may not approve it' using errcode = 'MS002';
  end if;
  if draft_txid = txid_current() then
    raise exception 'decision refused: the draft was proposed in this transaction' using errcode = 'MS002';
  end if;
  new.decided_by := ctx_actor;
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function approval.stamp_decision() from public;
create trigger stamp before insert on approval.decision for each row execute function approval.stamp_decision();

-- The per-tenant hash chain (§2.7), appended by audit.chain (02). A book row's entry holds the row's digest and no
-- payload; an ops entry holds a payload of ids, codes and flags only (no number, no words: a string is a lower-case
-- code or an id) and no digest.
create table audit.audit_log (
  tenant_id uuid not null references ops.tenant,
  seq bigint not null check (seq > 0),
  actor_id uuid not null,
  decision_id uuid,
  command text references ref.command,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$'),
  entity text not null check (entity ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id uuid,
  row_digest bytea check (octet_length(row_digest) = 32),
  payload jsonb check (jsonb_typeof(payload) = 'object' and not jsonb_path_exists(payload,
    'strict $.** ? (@.type() == "number" || @.type() == "null" || (@.type() == "string" && !(@ like_regex "^[a-z0-9_.-]{1,64}$")))')),
  created_at timestamptz not null,
  prev_hash bytea,
  hash bytea not null check (octet_length(hash) = 32),
  primary key (tenant_id, seq),
  foreign key (tenant_id, actor_id) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((entity like 'books.%') = (row_digest is not null)),
  check ((entity like 'books.%') = (payload is null)),
  check ((seq = 1) = (prev_hash is null))
);
create trigger chain before insert on audit.audit_log for each row execute function audit.chain();

-- The canonical entry text, as audit.chain writes it out: chr(31) between fields, NULL as '', created_at as epoch
-- seconds so the text never depends on the session's zone.
create function audit.entry_hash(prev bytea, e audit.audit_log) returns bytea language sql stable
  set search_path = pg_catalog, pg_temp
  return sha256(coalesce(prev, ''::bytea) || convert_to(concat_ws(chr(31),
    e.tenant_id::text, e.seq::text, e.actor_id::text, coalesce(e.decision_id::text, ''), coalesce(e.command, ''),
    e.action, e.entity, coalesce(e.entity_id::text, ''), coalesce(encode(e.row_digest, 'hex'), ''),
    coalesce(e.payload::text, ''), extract(epoch from e.created_at)::text), 'UTF8'));
revoke execute on function audit.entry_hash(bytea, audit.audit_log) from public;
grant execute on function audit.entry_hash(bytea, audit.audit_log) to munshi_app, munshi_jobs;

-- A nightly mark that the chain verified up to `seq` with head `hash`, written by the jobs role (no actor) after the
-- verification, with the last chunked verify_books count (R4 W6). It names a real entry and only moves forward.
create table audit.checkpoint (
  tenant_id uuid not null references ops.tenant,
  seq bigint not null,
  hash bytea not null check (octet_length(hash) = 32),
  made_at timestamptz not null default now(),
  books_problems int not null default 0 check (books_problems >= 0),
  primary key (tenant_id, seq),
  foreign key (tenant_id, seq) references audit.audit_log
);

create function audit.checkpoint_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user <> 'munshi_jobs' or nullif(current_setting('munshi.actor_id', true), '') is not null then
    raise exception 'checkpoint refused: the jobs role writes checkpoints, with no actor' using errcode = 'MS018';
  end if;
  if not exists (select 1 from audit.audit_log a where a.tenant_id = new.tenant_id and a.seq = new.seq and a.hash = new.hash)
     or exists (select 1 from audit.checkpoint c where c.tenant_id = new.tenant_id and c.seq >= new.seq) then
    raise exception 'checkpoint refused: a checkpoint names an entry''s own hash, past the last checkpoint' using errcode = 'MS005';
  end if;
  new.made_at := now();
  return new;
end $$;
revoke execute on function audit.checkpoint_guard() from public;
create trigger guard before insert on audit.checkpoint for each row execute function audit.checkpoint_guard();

-- Walks the chain from the last checkpoint (or from the start, with p_full) and returns the first seq that breaks it,
-- or NULL. Refuses any tenant but the current one: under RLS another tenant's chain would look empty and "verify".
create function audit.verify_chain(p_tenant uuid, p_full boolean default false) returns bigint language plpgsql stable
  set search_path = pg_catalog, pg_temp as $$
declare
  e audit.audit_log;
  cp audit.checkpoint;
  expected bigint := 1;
  prev bytea;
begin
  if p_tenant is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid then
    raise exception 'verify_chain: the tenant is not the current tenant' using errcode = 'MS003';
  end if;
  if not p_full then
    select * into cp from audit.checkpoint c where c.tenant_id = p_tenant order by c.seq desc limit 1;
    if found then
      if not exists (select 1 from audit.audit_log a where a.tenant_id = p_tenant and a.seq = cp.seq and a.hash = cp.hash) then
        return cp.seq;
      end if;
      expected := cp.seq + 1;
      prev := cp.hash;
    end if;
  end if;
  for e in select * from audit.audit_log a where a.tenant_id = p_tenant and a.seq >= expected order by a.seq loop
    if e.seq <> expected or e.prev_hash is distinct from prev or e.hash is distinct from audit.entry_hash(prev, e) then
      return expected;
    end if;
    prev := e.hash;
    expected := expected + 1;
  end loop;
  return null;
end $$;
revoke execute on function audit.verify_chain(uuid, boolean) from public;
grant execute on function audit.verify_chain(uuid, boolean) to munshi_app, munshi_jobs;

-- One chunk of one books table (a tenant, a table in ref.book_table, an id range): each row whose digest no longer
-- matches its entry (digest_mismatch), each row with no entry (no_entry), each entry whose row is gone (no_row). An owner
-- who disables the triggers and edits a sale is caught here (VB1). The zone and interval style are pinned as in
-- books.audit_row, so a digest written under UTC verifies under any session zone (VB1-TZ). The table name is checked
-- against ref.book_table before it is quoted into the query. The jobs checkpoint walks every table by id range; a page
-- never runs this.
create function audit.verify_books(p_tenant uuid, p_rel text, p_from uuid, p_to uuid)
  returns table (rel text, id uuid, problem text) language plpgsql stable
  set search_path = pg_catalog, pg_temp
  set timezone = 'UTC'
  set intervalstyle = 'postgres' as $$
begin
  if p_tenant is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid then
    raise exception 'verify_books: the tenant is not the current tenant' using errcode = 'MS003';
  end if;
  if not exists (select 1 from ref.book_table b where b.rel = p_rel) then
    raise exception 'verify_books: % is not a books table', p_rel using errcode = 'MS003';
  end if;
  return query execute format(
    'select %1$L::text, t.id, case when a.entity_id is null then ''no_entry'' else ''digest_mismatch'' end
       from %2$s t
       left join audit.audit_log a on a.tenant_id = t.tenant_id and a.entity = %1$L and a.entity like ''books.%%'' and a.entity_id = t.id
      where t.tenant_id = $1 and t.id between $2 and $3
        and (a.entity_id is null or a.row_digest is distinct from sha256(convert_to(to_jsonb(t)::text, ''UTF8'')))
     union all
     select %1$L::text, a.entity_id, ''no_row''
       from audit.audit_log a
      where a.tenant_id = $1 and a.entity = %1$L and a.entity like ''books.%%'' and a.entity_id between $2 and $3
        and not exists (select 1 from %2$s t where t.tenant_id = a.tenant_id and t.id = a.entity_id)',
    p_rel, p_rel::regclass) using p_tenant, p_from, p_to;
end $$;
revoke execute on function audit.verify_books(uuid, text, uuid, uuid) from public;
grant execute on function audit.verify_books(uuid, text, uuid, uuid) to munshi_app, munshi_jobs;

-- Indexes, one per statement, each asserted in pg_index (G10). audit_entity is partial, for ops entries only; a book
-- row's one entry is audit_book_row, which verify_books reads by repeating its `like` (R4 G3).
create index draft_status on approval.draft (tenant_id, status, created_at);
-- A run's drafts (the desks join runs to their drafts); run_id is NULL for a member's draft.
create index draft_run on approval.draft (tenant_id, run_id);
create unique index draft_open_per_finding on approval.draft (tenant_id, finding_id) where status = 'proposed';
create unique index decision_draft on approval.decision (tenant_id, draft_id);
create index audit_entity on audit.audit_log (tenant_id, entity, entity_id) where entity not like 'books.%';
create unique index audit_book_row on audit.audit_log (tenant_id, entity, entity_id) where entity like 'books.%';

-- RLS and the grants. Append-only: no runtime role updates or deletes an entry, a checkpoint or a decision.
alter table approval.draft enable row level security;
alter table approval.draft force row level security;
create policy tenant_isolation on approval.draft
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on approval.draft from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (status, updated_at) on approval.draft to munshi_app;

alter table approval.decision enable row level security;
alter table approval.decision force row level security;
create policy tenant_isolation on approval.decision
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on approval.decision from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on approval.decision to munshi_app;

alter table audit.audit_log enable row level security;
alter table audit.audit_log force row level security;
create policy tenant_isolation on audit.audit_log
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on audit.audit_log from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on audit.audit_log to munshi_app;
grant select on audit.audit_log to munshi_jobs;

alter table audit.checkpoint enable row level security;
alter table audit.checkpoint force row level security;
create policy tenant_isolation on audit.checkpoint
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on audit.checkpoint from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on audit.checkpoint to munshi_jobs;
grant select on audit.checkpoint to munshi_app;
