-- 05 · Agent runs, their traces, and the erasable message text. ops.message_text
-- is created here, right after ai.run (its run_id names a run), because ai.answer (07) and the messages (19) both name
-- it. No column here names a table of a later file.
set local role munshi_owner;

-- One agent run: who or what started it, how it ended, whether it read untrusted text. A member's run is the app's,
-- with that member as the actor; a watcher's or the brief's is the jobs role's, with no actor. A read-aloud is its
-- own run (trigger `speak`), started by the member who asked to hear the text: the run whose text it reads has ended.
-- So a speak run has a starter (run_flow stamps started_by from the app's active member; the jobs role has none).
create table ai.run (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  trigger text not null check (trigger in ('question', 'voice', 'watcher', 'brief', 'photo', 'inbox', 'campaign', 'recipe', 'speak')),
  desk text not null check (desk ~ '^[a-z_]{2,40}$'),
  started_by uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text check (outcome in ('answered', 'abstained', 'proposed', 'raised', 'failed', 'budget', 'off')),
  tainted boolean not null default false,
  model_calls int not null default 0 check (model_calls >= 0),
  primary key (tenant_id, id),
  foreign key (tenant_id, started_by) references ops.member,
  check ((ended_at is null) = (outcome is null)),
  check (trigger <> 'speak' or started_by is not null)
);

-- `tainted` only goes false → true (a run that read untrusted text stays tainted); a run ends once; model calls only
-- rise; an ended run never changes.
create function ai.run_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user = 'munshi_app' then
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'run refused: the app''s run is an active member''s' using errcode = 'MS018';
    end if;
  elsif current_user <> 'munshi_jobs' or ctx_actor is not null then
    raise exception 'run refused: a run is the app''s, as a member, or the jobs role''s, with no actor' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if new.ended_at is not null or new.tainted or new.model_calls <> 0 then
      raise exception 'run refused: a new run is open, untainted and has made no model call' using errcode = 'MS010';
    end if;
    new.started_by := ctx_actor;
    new.started_at := now();
    return new;
  end if;
  if old.ended_at is not null or (old.tainted and not new.tainted) or new.model_calls < old.model_calls
     or (new.ended_at is not null and new.ended_at <> now()) then
    raise exception 'run refused: an ended run never changes; tainted stays; model calls only rise; a run ends at now()' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ai.run_flow() from public;
create trigger flow before insert or update on ai.run for each row execute function ai.run_flow();

-- What a run did, step by step: ids and labels only, never text (a label is a code from core's fixed list, else
-- `unlisted`; ids is a list of at most 16 uuids). Purged after 90 days by the jobs role, while the small ai.run row
-- stays for the run log.
create table ai.trace (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  seq int not null check (seq > 0),
  kind text not null check (kind in ('route', 'model', 'read', 'budget', 'validate', 'answer', 'abstain', 'propose', 'evidence',
                                     'watch', 'recipe')),
  label text not null check (label ~ '^[a-z0-9_.:-]{1,64}$'),
  ids jsonb not null default '[]' check (jsonb_typeof(ids) = 'array' and jsonb_array_length(ids) <= 16 and not jsonb_path_exists(ids,
    'strict $[*] ? (!(@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')),
  ms int not null default 0 check (ms >= 0),
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ai.run
);

-- Every body Munshi keeps for a message, an answer or campaign copy: erasable, while the books keep only its hash
-- (b_outbound_derive, 19). body_sha256 is stamped here from the body and kept after erasure. Written by the app as a
-- member, or by the jobs role with no actor (a run's or a template's text). Erased by an active owner (a contact's
-- erasure), or by the jobs purge: here, an Ask answer's text 30 days after the answer.
-- 19_messaging.sql redefines ops.message_text_guard() (create or replace) to add the reply, copy and inbound rules.
create table ops.message_text (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  body text check (char_length(body) between 1 and 4096),
  body_sha256 bytea not null check (octet_length(body_sha256) = 32),
  author text not null check (author in ('member', 'run', 'template')),
  created_by uuid,
  run_id uuid,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, run_id) references ai.run,
  check (erased_at is not null or body is not null),
  check (body is null or body_sha256 = sha256(convert_to(body, 'UTF8'))),
  check (author <> 'member' or created_by is not null),
  check ((author = 'run') = (run_id is not null))
);

create function ops.message_text_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'message text refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    if current_user = 'munshi_app' then
      if actor_role is null then
        raise exception 'message text refused: the app writes a text as an active member' using errcode = 'MS018';
      end if;
    elsif current_user <> 'munshi_jobs' or new.author = 'member' then
      raise exception 'message text refused: the jobs role writes only a run''s or a template''s text' using errcode = 'MS018';
    end if;
    if new.erased_at is not null then
      raise exception 'message text refused: a new text is not erased' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.body_sha256 := sha256(convert_to(new.body, 'UTF8'));
    new.created_at := now();
    return new;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if actor_role is distinct from 'owner' then
        raise exception 'message text refused: a person''s erasure of a text is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'message text refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif not exists (select 1 from ai.answer a
                       where a.tenant_id = new.tenant_id and a.text_id = new.id and a.kind = 'ask'
                         and a.created_at < now() - interval '30 days') then
      raise exception 'message text refused: the purge erases an Ask answer''s text 30 days after the answer' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.message_text_guard() from public;
create trigger erase before update on ops.message_text for each row execute function ops.only_erase('body');
create trigger guard before insert or update on ops.message_text for each row execute function ops.message_text_guard();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create index run_started on ai.run (tenant_id, started_at);
create unique index trace_seq on ai.trace (tenant_id, run_id, seq);
create index trace_age on ai.trace (tenant_id, at);
create index message_text_live on ops.message_text (tenant_id, created_at) where erased_at is null;

-- RLS and the grants.
alter table ai.run enable row level security;
alter table ai.run force row level security;
create policy tenant_isolation on ai.run
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.run from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (ended_at, outcome, tainted, model_calls) on ai.run to munshi_app, munshi_jobs;

alter table ai.trace enable row level security;
alter table ai.trace force row level security;
create policy tenant_isolation on ai.trace
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy trace_purge on ai.trace as restrictive for delete to munshi_jobs
  using (at < now() - interval '90 days');
revoke all on ai.trace from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.trace to munshi_app;
grant select, insert, delete on ai.trace to munshi_jobs;

alter table ops.message_text enable row level security;
alter table ops.message_text force row level security;
create policy tenant_isolation on ops.message_text
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.message_text from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (body, erased_at) on ops.message_text to munshi_app, munshi_jobs;
