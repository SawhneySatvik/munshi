-- 07 · Findings and their events, answers, the daily brief, usage (BLUEPRINT §2.10.12, §7.4; no ai.policy, R4 I10), and
-- snap.pin's pin_release policy, which names ai.finding. Columns naming a later file's table, declared here with no key:
-- ai.answer.inbound_message_id (19_messaging.sql adds its key to ops.inbound_message, R4 B1).
--
-- A ref, wherever a row cites a cell, is {"snapshotId": uuid, "row": n, "col": name} (core's CellRef); col `_count` is
-- the snapshot's row count, so an empty read is citable (§2.8).
set local role munshi_owner;

-- One open finding per key (finding_one_open); dismissed and resolved are final; a key dismissed in the last 30 days is
-- not raised again (MS012). The finding cites one row of a snapshot and stores the sha256 of that row's cells, stamped
-- here from the snapshot itself (R4 S1). A watcher run (the jobs role, no actor) raises, re-sees, wakes and resolves; an
-- active owner or manager (the app; staff are refused, MS007) snoozes, wakes early and dismisses with a dismiss code. A
-- re-see whose row has the same cells changes only last_seen_at and last_run_id, even if it names a new snapshot (that
-- move is undone here); one with different cells
-- moves the snapshot, row and hash together, never to an older snapshot, pins the new snapshot and writes `seen`
-- (R4 G2). The jobs role then releases the old pin (pin_release, below).
create table ai.finding (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid,
  desk text not null check (desk ~ '^[a-z_]{2,40}$'),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'snoozed', 'dismissed', 'resolved')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  snapshot_id uuid not null,
  snapshot_row int not null check (snapshot_row >= 0),
  row_sha256 bytea not null check (octet_length(row_sha256) = 32),
  impact_col text check (impact_col ~ '^[a-z_][a-z0-9_]{0,62}$'),
  first_run_id uuid not null,
  last_run_id uuid not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  snoozed_until timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  close_reason text,
  close_reason_use text generated always as ('dismiss') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, snapshot_id) references snap.snapshot,
  foreign key (tenant_id, first_run_id) references ai.run,
  foreign key (tenant_id, last_run_id) references ai.run,
  foreign key (tenant_id, closed_by) references ops.member,
  foreign key (close_reason, close_reason_use) references ref.reason_use,
  check ((status = 'snoozed') = (snoozed_until is not null)),
  check ((status in ('dismissed', 'resolved')) = (closed_at is not null)),
  check ((status = 'dismissed') = (close_reason is not null)),
  check ((status = 'dismissed') = (closed_by is not null))
);

create function ai.finding_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  snap_row jsonb;
  snap_columns jsonb;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'finding refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if tg_op = 'UPDATE' and old.status in ('dismissed', 'resolved') then
    raise exception 'finding refused: a % finding is final', old.status using errcode = 'MS012';
  end if;
  if tg_op = 'INSERT' or new.snapshot_id is distinct from old.snapshot_id or new.snapshot_row is distinct from old.snapshot_row then
    select s.rows -> new.snapshot_row, s.columns into snap_row, snap_columns
      from snap.snapshot s where s.tenant_id = new.tenant_id and s.id = new.snapshot_id;
    if snap_row is null or (new.impact_col is not null and not exists (
          select 1 from jsonb_array_elements(snap_columns) c(v) where c.v ->> 'n' = new.impact_col and c.v ->> 'k' = 'money')) then
      raise exception 'finding refused: it cites a row of its snapshot, and impact_col is a money column there' using errcode = 'MS006';
    end if;
    new.row_sha256 := sha256(convert_to(snap_row::text, 'UTF8'));
  end if;

  if tg_op = 'INSERT' then
    if current_user <> 'munshi_jobs' or ctx_actor is not null then
      raise exception 'finding refused: a finding is raised by a watcher run, the jobs role with no actor' using errcode = 'MS018';
    end if;
    if new.status <> 'open' or new.closed_at is not null or new.snoozed_until is not null or new.first_run_id <> new.last_run_id then
      raise exception 'finding refused: a new finding is open, from one run' using errcode = 'MS012';
    end if;
    if exists (select 1 from ai.finding f where f.tenant_id = new.tenant_id and f.dedupe_key = new.dedupe_key
                and f.status = 'dismissed' and f.closed_at > now() - interval '30 days') then
      raise exception 'finding refused: this key was dismissed in the last 30 days' using errcode = 'MS012';
    end if;
    new.first_seen_at := now();
    new.last_seen_at := now();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if current_user = 'munshi_app' then
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'finding refused: an active member snoozes or dismisses' using errcode = 'MS018';
    end if;
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active and m.role in ('owner', 'manager')) then
      raise exception 'finding refused: quieting a finding is an owner''s or a manager''s call' using errcode = 'MS007';
    end if;
    if new.status = 'snoozed' and old.status in ('open', 'snoozed') then
      if new.snoozed_until <= now() then
        raise exception 'finding refused: a snooze ends in the future' using errcode = 'MS012';
      end if;
    elsif new.status = 'open' and old.status = 'snoozed' then
      new.snoozed_until := null;
    elsif new.status = 'dismissed' then
      new.closed_by := ctx_actor;
      new.closed_at := now();
      new.snoozed_until := null;
    else
      raise exception 'finding refused: a member moves a finding % → %', old.status, new.status using errcode = 'MS012';
    end if;
  elsif current_user = 'munshi_jobs' then
    if new.status = old.status then
      if new.last_run_id is distinct from old.last_run_id then
        new.last_seen_at := now();
      end if;
      if new.snapshot_id is distinct from old.snapshot_id or new.snapshot_row is distinct from old.snapshot_row then
        if new.row_sha256 = old.row_sha256 then
          new.snapshot_id := old.snapshot_id;
          new.snapshot_row := old.snapshot_row;
        elsif (select s.created_at from snap.snapshot s where s.tenant_id = new.tenant_id and s.id = new.snapshot_id)
              < (select s.created_at from snap.snapshot s where s.tenant_id = old.tenant_id and s.id = old.snapshot_id) then
          raise exception 'finding refused: a finding never moves back to an older snapshot' using errcode = 'MS012';
        end if;
      end if;
    elsif new.status = 'open' and old.status = 'snoozed' then
      if old.snoozed_until > now() then
        raise exception 'finding refused: a snoozed finding wakes at snoozed_until' using errcode = 'MS012';
      end if;
      new.snoozed_until := null;
    elsif new.status = 'resolved' then
      new.closed_at := now();
      new.snoozed_until := null;
    else
      raise exception 'finding refused: a watcher run moves a finding % → %', old.status, new.status using errcode = 'MS012';
    end if;
  else
    raise exception 'finding refused: % does not change findings', current_user using errcode = 'MS018';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ai.finding_flow() from public;
create trigger flow before insert or update on ai.finding for each row execute function ai.finding_flow();

-- The finding's history and its pin: `raised` with its pin, `seen` with the new pin only when the cells changed, then
-- snoozed, woke, dismissed (with the member and the reason), resolved.
create function ai.finding_history() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ev text;
begin
  if tg_op = 'INSERT' or new.snapshot_id is distinct from old.snapshot_id then
    insert into snap.pin (tenant_id, snapshot_id, holder, holder_id) values (new.tenant_id, new.snapshot_id, 'finding', new.id)
      on conflict do nothing;
  end if;
  if tg_op = 'INSERT' then
    ev := 'raised';
  elsif new.status <> old.status then
    ev := case new.status when 'snoozed' then 'snoozed' when 'open' then 'woke' else new.status end;
  elsif new.snapshot_id is distinct from old.snapshot_id or new.row_sha256 is distinct from old.row_sha256 then
    ev := 'seen';
  end if;
  if ev is not null then
    insert into ai.finding_event (tenant_id, finding_id, kind, run_id, member_id, reason)
    values (new.tenant_id, new.id, ev, case when current_user = 'munshi_jobs' then new.last_run_id end,
            nullif(current_setting('munshi.actor_id', true), '')::uuid, case when ev = 'dismissed' then new.close_reason end);
  end if;
  return null;
end $$;
revoke execute on function ai.finding_history() from public;
create trigger history after insert or update on ai.finding for each row execute function ai.finding_history();

create table ai.finding_event (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  finding_id uuid not null,
  kind text not null check (kind in ('raised', 'seen', 'snoozed', 'woke', 'dismissed', 'resolved', 'drafted')),
  run_id uuid,
  member_id uuid,
  reason text,
  reason_use text generated always as ('dismiss') stored,
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, finding_id) references ai.finding,
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (reason, reason_use) references ref.reason_use,
  check ((kind = 'dismissed') = (reason is not null))
);
create trigger from_holder before insert on ai.finding_event for each row execute function ops.only_from_trigger();

-- An answer's words live in ops.message_text (erasable, review B2); this row keeps only the refs each segment cites
-- (ids and columns, no words) and pins every snapshot they name. The pins stay after the words go.
create table ai.answer (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  kind text not null check (kind in ('ask', 'explain', 'brief_line', 'copy', 'gloss')),
  text_id uuid,
  refs jsonb not null default '[]',
  inbound_message_id uuid,
  verdict text not null check (verdict in ('answered', 'abstained')),
  rules text[] not null default '{}' check (array_to_string(rules, ',') ~ '^([a-z_]{2,40}(,[a-z_]{2,40})*)?$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, text_id) references ops.message_text,
  check ((verdict = 'abstained') = (text_id is null))
);

create function ai.answer_check() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active))
          or (current_user = 'munshi_jobs' and ctx_actor is null)) then
    raise exception 'answer refused: an answer is the app''s, as a member, or the jobs role''s, with no actor' using errcode = 'MS018';
  end if;
  if jsonb_typeof(new.refs) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(new.refs) seg(v) where jsonb_typeof(seg.v) <> 'array')
     or exists (select 1 from jsonb_array_elements(new.refs) seg(v), jsonb_array_elements(seg.v) r(v)
                 where jsonb_typeof(r.v) <> 'object' or r.v - array['snapshotId', 'row', 'col'] <> '{}'::jsonb
                    or jsonb_typeof(r.v -> 'snapshotId') is distinct from 'string'
                    or (r.v ->> 'snapshotId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    or jsonb_typeof(r.v -> 'row') is distinct from 'number' or (r.v ->> 'row') !~ '^[0-9]{1,3}$'
                    or jsonb_typeof(r.v -> 'col') is distinct from 'string' or (r.v ->> 'col') !~ '^[a-z_][a-z0-9_]{0,62}$') then
    raise exception 'answer refused: refs is a list of segments, each a list of {snapshotId, row, col}' using errcode = 'MS006';
  end if;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ai.answer_check() from public;
create trigger check_refs before insert on ai.answer for each row execute function ai.answer_check();

create function ai.answer_pin() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into snap.pin (tenant_id, snapshot_id, holder, holder_id)
  select distinct new.tenant_id, (r.v ->> 'snapshotId')::uuid, 'answer', new.id
    from jsonb_array_elements(new.refs) seg(v), jsonb_array_elements(seg.v) r(v)
  on conflict do nothing;
  return null;
end $$;
revoke execute on function ai.answer_pin() from public;
create trigger pin after insert on ai.answer for each row execute function ai.answer_pin();

-- One brief a day per shop (R4 N4), written by the jobs role. Its order is the ranked snapshot's cells, pinned, never a
-- second copy (R4 N8).
create table ai.brief (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid not null,
  business_date date not null,
  run_id uuid not null,
  ranked_snapshot_id uuid not null,
  answer_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, ranked_snapshot_id) references snap.snapshot,
  foreign key (tenant_id, answer_id) references ai.answer
);

create function ai.brief_pin() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into snap.pin (tenant_id, snapshot_id, holder, holder_id) values (new.tenant_id, new.ranked_snapshot_id, 'brief', new.id)
    on conflict do nothing;
  return null;
end $$;
revoke execute on function ai.brief_pin() from public;
create trigger pin after insert on ai.brief for each row execute function ai.brief_pin();

-- Model calls per shop, day and role; core's allow() increments it only under the shop's caps (§4.6). A count only rises.
create table ai.usage (
  tenant_id uuid not null references ops.tenant,
  day date not null,
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video')),
  calls int not null default 0 check (calls >= 0),
  primary key (tenant_id, day, role)
);

create function ai.usage_rises() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.calls < old.calls or new.day <> old.day or new.role <> old.role then
    raise exception 'usage refused: a count only rises' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ai.usage_rises() from public;
create trigger rises before update on ai.usage for each row execute function ai.usage_rises();

-- Indexes, one per statement, each asserted in pg_index (G10).
create unique index finding_one_open on ai.finding (tenant_id, dedupe_key) where status in ('open', 'snoozed');
create index finding_status on ai.finding (tenant_id, status, severity);
create index finding_open_kind on ai.finding (tenant_id, kind, shop_id) where status in ('open', 'snoozed');
create index finding_snapshot on ai.finding (tenant_id, snapshot_id);
create index finding_dismissed on ai.finding (tenant_id, dedupe_key, closed_at) where status = 'dismissed';
create index finding_event_finding on ai.finding_event (tenant_id, finding_id, at);
create index answer_run on ai.answer (tenant_id, run_id);
create index answer_inbound_message on ai.answer (tenant_id, inbound_message_id);
create unique index brief_day on ai.brief (tenant_id, shop_id, business_date);

-- RLS and the grants. The jobs role may delete a finding's pin only on a snapshot that finding no longer names (R4 S1);
-- draft, answer, brief, release and grid pins are never deleted.
create policy pin_release on snap.pin as restrictive for delete to munshi_jobs
  using (holder = 'finding' and not exists (select 1 from ai.finding f
          where f.tenant_id = pin.tenant_id and f.id = pin.holder_id and f.snapshot_id = pin.snapshot_id));

alter table ai.finding enable row level security;
alter table ai.finding force row level security;
create policy tenant_isolation on ai.finding
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.finding from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, update (status, snoozed_until, closed_at, closed_by, close_reason, updated_at) on ai.finding to munshi_app;
grant select, insert, update (status, snapshot_id, snapshot_row, row_sha256, last_run_id, last_seen_at, closed_at, updated_at)
  on ai.finding to munshi_jobs;

alter table ai.finding_event enable row level security;
alter table ai.finding_event force row level security;
create policy tenant_isolation on ai.finding_event
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.finding_event from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.finding_event to munshi_app, munshi_jobs;

alter table ai.answer enable row level security;
alter table ai.answer force row level security;
create policy tenant_isolation on ai.answer
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.answer from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.answer to munshi_app, munshi_jobs;

alter table ai.brief enable row level security;
alter table ai.brief force row level security;
create policy tenant_isolation on ai.brief
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.brief from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ai.brief to munshi_app;
grant select, insert on ai.brief to munshi_jobs;

alter table ai.usage enable row level security;
alter table ai.usage force row level security;
create policy tenant_isolation on ai.usage
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.usage from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (calls) on ai.usage to munshi_app, munshi_jobs;
grant select on ai.usage to munshi_platform;
