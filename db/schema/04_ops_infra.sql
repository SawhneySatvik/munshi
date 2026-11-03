-- 04 · People, files, idempotency, jobs, limits, typed inputs. No column here names a table of a later file. Rules that
-- depend on later files are added by those files as their own triggers on these tables (a balance or recent activity
-- that holds a contact's erasure, a voice note's transcription): each such trigger can only refuse more, never admit
-- what these refuse.
set local role munshi_owner;

-- The contact vault: every person a shop knows, on every tenant. Books point at a contact by id only, so no name or
-- phone ever enters a book row, an audit payload, a draft, a decision or a snapshot. A changed phone is a new
-- contact. Erasure is one of two shapes: an active owner's own request (as munshi_app), or the jobs purge with no
-- actor, admitted only for a contact the owner asked to erase or one with no activity for a year (here, the contact's
-- own age; the books files add their balances and activity). Erasure is requested once, by an active owner.
create table ops.contact (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  name text check (char_length(name) between 1 and 80),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null default 'hi' check (language in ('hi', 'en')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  erased_by uuid,
  erase_reason text check (erase_reason in ('request', 'retention')),
  erase_requested_at timestamptz,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, erased_by) references ops.member,
  check (erased_at is not null or name is not null),
  check ((erased_at is null) = (erase_reason is null)),
  check ((erased_by is not null) = (erase_reason is not distinct from 'request'))
);

create function ops.contact_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'contact refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or actor_role is null then
      raise exception 'contact refused: an active member adds a contact' using errcode = 'MS007';
    end if;
    if new.erased_at is not null or new.erased_by is not null or new.erase_reason is not null or new.erase_requested_at is not null then
      raise exception 'contact refused: a new contact is not erased' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
    return new;
  end if;
  if new.erase_requested_at is distinct from old.erase_requested_at
     and (old.erase_requested_at is not null or new.erase_requested_at is distinct from now() or actor_role is distinct from 'owner') then
    raise exception 'contact refused: erasure is requested once, by an active owner' using errcode = 'MS007';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if actor_role is distinct from 'owner' or new.erased_by is distinct from ctx_actor or new.erase_reason is distinct from 'request' then
        raise exception 'contact refused: an erasure by a person is an active owner''s own request' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'contact refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif new.erased_by is not null or new.erase_reason is distinct from 'retention' then
      raise exception 'contact refused: the purge erases for retention, with no person named' using errcode = 'MS007';
    elsif old.erase_requested_at is null and old.created_at > now() - interval '1 year' then
      raise exception 'contact refused: the purge erases a contact the owner asked to erase, or one idle for a year' using errcode = 'MS007';
    end if;
  elsif new.erased_by is distinct from old.erased_by or new.erase_reason is distinct from old.erase_reason then
    raise exception 'contact refused: erased_by and erase_reason are set by the erasure alone' using errcode = 'MS011';
  end if;
  return new;
end $$;
revoke execute on function ops.contact_guard() from public;

-- Ids only, never a name or a phone (the chain is permanent). The purge has no actor and leaves no entry: the erased
-- row and its erase_reason are the record.
create function ops.contact_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  act text;
begin
  if tg_op = 'INSERT' then
    act := 'contact.add';
  elsif old.erased_at is null and new.erased_at is not null then
    act := 'contact.erase';
  elsif old.erase_requested_at is null and new.erase_requested_at is not null then
    act := 'contact.erase_request';
  end if;
  if act is not null and ctx_actor is not null then
    insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
    values (new.tenant_id, ctx_actor, act, 'ops.contact', new.id, jsonb_build_object('contact_id', new.id));
  end if;
  return null;
end $$;
revoke execute on function ops.contact_audit() from public;
create trigger erase before update on ops.contact for each row execute function ops.only_erase('name', 'phone_e164');
create trigger guard before insert or update on ops.contact for each row execute function ops.contact_guard();
create trigger audit after insert or update on ops.contact for each row execute function ops.contact_audit();

-- A file's record; the bytes live in the tenant's own bucket (a local folder on a laptop, Supabase Storage when
-- hosted). A storage_key must start with the tenant's bucket, `t-<tenant_id>/`, so no row can point at another shop's
-- file. An art document is SVG of at most 200 KB, a card a JPEG. The app uploads as a member; the public role
-- stores an inbound voice note or image (no actor). Erasure nulls the key: an active owner's (a contact's erasure), or
-- the jobs purge once purge_after has passed. 14_sites_public.sql grants the public role its read of published cards and
-- art, with the restrictive policy that limits it to those a release names.
create table ops.document (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  kind text not null check (kind in ('photo', 'bill', 'voice', 'image', 'card', 'art', 'import')),
  source text not null check (source in ('upload', 'inbound', 'seed')),
  storage_key text check (char_length(storage_key) <= 300),
  sha256 bytea not null check (octet_length(sha256) = 32),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'audio/ogg', 'audio/wav', 'text/csv',
                                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  bytes int not null check (bytes between 1 and 4000000),
  uploaded_by uuid,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, uploaded_by) references ops.member,
  check ((source = 'upload') = (uploaded_by is not null)),
  check (erased_at is not null or storage_key is not null),
  check ((mime = 'image/svg+xml') = (kind = 'art')),
  check (kind <> 'art' or bytes <= 204800),
  check (kind <> 'card' or mime = 'image/jpeg')
);

create function ops.document_check() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'document refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  -- Only the app's own shapes name a member (the public role cannot read ops.member).
  if current_user = 'munshi_app' then
    select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  end if;
  if tg_op = 'INSERT' then
    if left(new.storage_key, 39) is distinct from 't-' || new.tenant_id::text || '/' or char_length(new.storage_key) < 40 then
      raise exception 'document refused: the storage key names the tenant''s own bucket, t-<tenant_id>/' using errcode = 'MS007';
    end if;
    if current_user = 'munshi_app' then
      if actor_role is null or new.source not in ('upload', 'seed') then
        raise exception 'document refused: the app stores an upload or a seed as an active member' using errcode = 'MS018';
      end if;
      new.uploaded_by := case when new.source = 'upload' then ctx_actor end;
    elsif current_user = 'munshi_public' then
      if new.source <> 'inbound' or new.kind not in ('voice', 'image') or new.uploaded_by is not null then
        raise exception 'document refused: the public role stores only an inbound voice note or image' using errcode = 'MS018';
      end if;
    else
      raise exception 'document refused: % does not store documents', current_user using errcode = 'MS018';
    end if;
    if new.erased_at is not null then
      raise exception 'document refused: a new document is not erased' using errcode = 'MS007';
    end if;
    new.created_at := now();
    return new;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if actor_role is distinct from 'owner' then
        raise exception 'document refused: a person''s erasure of a file is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'document refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif old.purge_after is null or old.purge_after > now() then
      raise exception 'document refused: the purge erases a file only after its purge_after' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.document_check() from public;
create trigger erase before update on ops.document for each row execute function ops.only_erase('storage_key');
create trigger guard before insert or update on ops.document for each row execute function ops.document_check();

-- One row per (scope, key), inside the command's own transaction: a fresh key proceeds; a duplicate waits
-- on the primary key until the first commits, then reads its stored ids, or gets 409 when the request differs. The key
-- is inserted first and its result (ids only, no numbers, no words) filled once, in that same transaction.
create table ops.idempotency (
  tenant_id uuid not null references ops.tenant,
  scope text not null check (scope ~ '^(member|site|webhook):[0-9a-f-]{36}$'),
  key text not null check (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  command text not null check (command ~ '^[a-z]+(\.[a-z_]+)+$'),
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  result jsonb check (jsonb_typeof(result) = 'object' and not jsonb_path_exists(result,
    'strict $.** ? (@.type() != "object" && @.type() != "array" && !(@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')),
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);

create function ops.idempotency_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_txid := txid_current();
    new.created_at := now();
    return new;
  end if;
  if old.result is not null or new.result is null or old.created_txid <> txid_current()
     or to_jsonb(new) - 'result' <> to_jsonb(old) - 'result' then
    raise exception 'idempotency refused: the result is filled once, in the key''s own transaction' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ops.idempotency_guard() from public;
create trigger guard before insert or update on ops.idempotency for each row execute function ops.idempotency_guard();

-- Global: one claim per (job, slot), so a slot's work runs once however often the jobs are triggered. A claim
-- unfinished after 5 minutes may be taken over by moving claimed_at (a run that died never strands its slot); a
-- finished claim never changes, and the sweep deletes it after 7 days.
create table ops.job_claim (
  job text not null check (job ~ '^[a-z_]{2,40}$'),
  slot text not null check (char_length(slot) between 1 and 200),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('ok', 'skipped', 'failed')),
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  primary key (job, slot),
  check ((finished_at is null) = (outcome is null)),
  check (error_code is null or outcome = 'failed')
);

create function ops.job_claim_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.finished_at is not null then
      raise exception 'claim refused: a new claim is unfinished' using errcode = 'MS010';
    end if;
    new.claimed_at := now();
    return new;
  end if;
  if old.finished_at is not null then
    raise exception 'claim refused: a finished claim never changes' using errcode = 'MS010';
  end if;
  if new.claimed_at is distinct from old.claimed_at and (old.claimed_at >= now() - interval '5 minutes' or new.claimed_at <> now()) then
    raise exception 'claim refused: a claim is taken over only after 5 minutes, at now()' using errcode = 'MS010';
  end if;
  if new.finished_at is not null and new.finished_at <> now() then
    raise exception 'claim refused: a claim finishes at now()' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ops.job_claim_guard() from public;
create trigger guard before insert or update on ops.job_claim for each row execute function ops.job_claim_guard();

-- Global: hits per keyed 16-byte bucket (an IP, key or phone hashed with the route class) and window. Nothing personal.
create table ops.rate_counter (
  bucket bytea not null check (octet_length(bucket) = 16),
  window_start timestamptz not null,
  hits int not null default 1 check (hits >= 1),
  primary key (bucket, window_start)
);

-- A number a person typed into an edited draft, or a stitching quote on an order line: minted as a cell by the
-- input.values read and labelled as theirs. The member is the actor, stamped here.
create table ops.member_input (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  path text not null check (path ~ '^[A-Za-z0-9_.\[\]-]{1,200}$'),
  kind text not null check (kind in ('money', 'quantity', 'integer', 'date')),
  num bigint,
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  unit text check (unit ~ '^[a-z]{1,16}$'),
  day date,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  check ((num is not null) = (kind in ('money', 'quantity', 'integer'))),
  check ((currency is not null) = (kind = 'money')),
  check ((unit is not null) = (kind = 'quantity')),
  check ((day is not null) = (kind = 'date'))
);

create function ops.input_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
    raise exception 'input refused: a typed number is an active member''s own' using errcode = 'MS007';
  end if;
  new.member_id := ctx_actor;
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.input_guard() from public;
create trigger guard before insert on ops.member_input for each row execute function ops.input_guard();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create unique index contact_phone on ops.contact (tenant_id, phone_e164) where erased_at is null;
create unique index document_sha on ops.document (tenant_id, sha256);
create index idempotency_age on ops.idempotency (tenant_id, created_at);
create index job_claim_done on ops.job_claim (finished_at) where finished_at is not null;
create index rate_counter_age on ops.rate_counter (window_start);
create index member_input_member on ops.member_input (tenant_id, member_id, created_at);

-- RLS and the grants.
alter table ops.contact enable row level security;
alter table ops.contact force row level security;
create policy tenant_isolation on ops.contact
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.contact from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (name, phone_e164, erased_at, erased_by, erase_reason, erase_requested_at) on ops.contact to munshi_app;
grant select, update (name, phone_e164, erased_at, erased_by, erase_reason, erase_requested_at) on ops.contact to munshi_jobs;

alter table ops.document enable row level security;
alter table ops.document force row level security;
create policy tenant_isolation on ops.document
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.document from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (storage_key, erased_at) on ops.document to munshi_app;
grant insert on ops.document to munshi_public;
grant select, update (storage_key, erased_at) on ops.document to munshi_jobs;

alter table ops.idempotency enable row level security;
alter table ops.idempotency force row level security;
create policy tenant_isolation on ops.idempotency
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy idempotency_purge on ops.idempotency as restrictive for delete to munshi_jobs
  using (created_at < now() - interval '7 days');
revoke all on ops.idempotency from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (result) on ops.idempotency to munshi_app, munshi_public;
grant delete on ops.idempotency to munshi_jobs;

alter table ops.job_claim enable row level security;
alter table ops.job_claim force row level security;
create policy global_rows on ops.job_claim using (true) with check (true);
create policy job_claim_purge on ops.job_claim as restrictive for delete to munshi_jobs
  using (finished_at < now() - interval '7 days');
revoke all on ops.job_claim from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (claimed_at, finished_at, outcome, error_code), delete on ops.job_claim to munshi_jobs;

alter table ops.rate_counter enable row level security;
alter table ops.rate_counter force row level security;
create policy global_rows on ops.rate_counter using (true) with check (true);
create policy rate_counter_purge on ops.rate_counter as restrictive for delete to munshi_jobs
  using (window_start < now() - interval '1 day');
revoke all on ops.rate_counter from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (hits) on ops.rate_counter to munshi_public;
grant delete on ops.rate_counter to munshi_jobs;

alter table ops.member_input enable row level security;
alter table ops.member_input force row level security;
create policy tenant_isolation on ops.member_input
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.member_input from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.member_input to munshi_app;
