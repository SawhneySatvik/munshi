-- 09 · The password identity adapter's tables and the superadmin's platform (BLUEPRINT §2.10.15, §6.2, §6.5). Both
-- schemas are global (no tenant policy). idp is reachable only by munshi_idp; platform is written only by
-- munshi_platform, and only under an approved platform change decided in this transaction (Munim R24), or by the owner
-- role for the seeds (the reserved slugs below; the first operator, `pnpm platform:operator`). No column here names a
-- table of a later file.
set local role munshi_owner;

-- One person's password identity. No plaintext email anywhere: email_hmac is the HMAC of the folded email under
-- MUNSHI_IDENTITY_SECRET. The subject is random (it says nothing of when it was made). Created only from an invite link
-- (verified_at: the person held the owner's link, not proof of the mailbox) or by the operator's seed. A password changes
-- with a fresh salt and its stamp. Which path changed it (the person's own change with the old password, or a reset
-- after idp.reset_use) is the adapter's word: the database cannot tell either from any other munshi_idp write, and
-- holds the reset's freshness and single use at idp.reset_use. Erasure nulls the hash, salt, parameters and email HMAC
-- and freezes the row.
create table idp.identity (
  subject uuid primary key default gen_random_uuid(),
  email_hmac bytea check (octet_length(email_hmac) = 32),
  password_hash bytea check (octet_length(password_hash) between 32 and 128),
  salt bytea check (octet_length(salt) = 16),
  params jsonb check (jsonb_typeof(params) = 'object'),
  verified_at timestamptz not null,
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  check (case when erased_at is null then email_hmac is not null and password_hash is not null and salt is not null and params is not null
              else email_hmac is null and password_hash is null and salt is null and params is null end)
);

create function idp.identity_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user not in ('munshi_idp', 'munshi_owner') then
    raise exception 'identity refused: only the identity adapter writes identities' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if new.erased_at is not null then
      raise exception 'identity refused: a new identity is not erased' using errcode = 'MS010';
    end if;
    new.verified_at := now();
    new.password_changed_at := now();
    new.created_at := now();
    return new;
  end if;
  if old.erased_at is not null then
    raise exception 'identity refused: an erased identity never changes' using errcode = 'MS011';
  end if;
  if new.subject <> old.subject or new.verified_at <> old.verified_at or new.created_at <> old.created_at then
    raise exception 'identity refused: subject, verified_at and created_at never change' using errcode = 'MS010';
  end if;
  if new.erased_at is not null then
    if new.erased_at <> now() then
      raise exception 'identity refused: erased_at is set to now()' using errcode = 'MS011';
    end if;
    return new;
  end if;
  if new.email_hmac is distinct from old.email_hmac then
    raise exception 'identity refused: the email HMAC changes only to NULL, in the erasure' using errcode = 'MS011';
  end if;
  if new.password_hash is distinct from old.password_hash or new.salt is distinct from old.salt or new.params is distinct from old.params then
    if new.salt = old.salt or new.password_hash = old.password_hash then
      raise exception 'identity refused: a new password has a new hash and a fresh salt' using errcode = 'MS010';
    end if;
    new.password_changed_at := now();
  elsif new.password_changed_at is distinct from old.password_changed_at then
    raise exception 'identity refused: password_changed_at moves only with the password' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function idp.identity_guard() from public;
create trigger guard before insert or update on idp.identity for each row execute function idp.identity_guard();

-- Failed sign-ins per (identity, IP hash), so nobody can lock an owner or an operator out from elsewhere (review N2).
-- The adapter deletes a row a day after its last attempt unless it is still locked (R4 G4).
create table idp.attempt (
  email_hmac bytea not null check (octet_length(email_hmac) = 32),
  ip_hash bytea not null check (octet_length(ip_hash) = 32),
  failures int not null default 0 check (failures >= 0),
  locked_until timestamptz,
  last_at timestamptz not null default now(),
  primary key (email_hmac, ip_hash)
);

-- A reset grant sets a password at most once (the primary key), and only within 5 minutes of the grant's use on the
-- public route, for the grant's own identity. The grant is read under its tenant's context.
create table idp.reset_use (
  grant_id uuid primary key,
  tenant_id uuid not null references ops.tenant,
  subject text not null check (char_length(subject) between 1 and 128),
  used_at timestamptz not null default now(),
  used_txid bigint not null,
  foreign key (tenant_id, grant_id) references ops.reset_grant
);

create function idp.reset_use_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user <> 'munshi_idp' then
    raise exception 'reset refused: only the identity adapter uses a reset grant' using errcode = 'MS018';
  end if;
  if new.tenant_id is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid
     or not exists (select 1 from ops.reset_grant g
                     where g.tenant_id = new.tenant_id and g.id = new.grant_id and g.subject = new.subject
                       and g.used_at is not null and g.used_at > now() - interval '5 minutes') then
    raise exception 'reset refused: no grant of this identity was used on the reset link in the last 5 minutes' using errcode = 'MS007';
  end if;
  new.used_at := now();
  new.used_txid := txid_current();
  return new;
end $$;
revoke execute on function idp.reset_use_guard() from public;
create trigger guard before insert on idp.reset_use for each row execute function idp.reset_use_guard();

-- Platform operators (superadmins), each an identity with a TOTP second factor (review N4). The first is seeded by the
-- owner role while none exists; later ones only by an approved `operator` change with a fresh TOTP. An operator's
-- identity is never a shop member: refused for a subject with any shop membership, and marked in ops.subject_summary
-- so ops.login refuses to bind it.
create table platform.operator (
  id uuid primary key default ops.uuidv7(),
  subject uuid not null unique references idp.identity,
  display_name text not null check (char_length(display_name) between 1 and 40),
  totp_secret_enc bytea not null check (octet_length(totp_secret_enc) between 16 and 256),
  totp_last_step bigint not null default 0 check (totp_last_step >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The console's own session (cookie munshi_operator), 2 hours, opened only with a TOTP code verified in the last 5
-- minutes, at the identity's current epoch. Never a member session.
create table platform.operator_session (
  id uuid primary key default ops.uuidv7(),
  operator_id uuid not null references platform.operator,
  subject_epoch int not null check (subject_epoch >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);

-- The draft and decision of the platform: proposed, then decided in a later transaction by an active operator (with a
-- fresh TOTP for channel grants and operator changes). The payload is flat: ids, codes, short names, small numbers,
-- flags; no string but an id holds a run of seven digits, so no phone number can ride in a global, permanent row (CH1).
create table platform.change (
  id uuid primary key default ops.uuidv7(),
  kind text not null check (kind in ('shop_config', 'channel_grant', 'site_verify', 'reserved_slug', 'default_config', 'operator', 'model_allow')),
  tenant_id uuid references ops.tenant,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and not jsonb_path_exists(payload,
    'strict $.* ? (@.type() == "object" || @.type() == "array" || (@.type() == "number" && (@ < 0 || @ > 100000))
                   || (@.type() == "string" && !(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
                       && (!(@ like_regex "^[A-Za-z0-9 _.:-]{1,64}$") || @ like_regex "[0-9]{7}")))')),
  proposed_by uuid not null references platform.operator,
  proposed_at timestamptz not null default now(),
  proposed_txid bigint not null,
  decided_by uuid references platform.operator,
  decided_at timestamptz,
  verdict text check (verdict in ('approved', 'rejected')),
  decided_txid bigint,
  decided_totp_at timestamptz,
  check ((verdict is null) = (decided_by is null) and (verdict is null) = (decided_at is null) and (verdict is null) = (decided_txid is null)),
  check ((kind in ('shop_config', 'channel_grant', 'site_verify')) = (tenant_id is not null))
);

-- Per-shop AI and site settings: latest wins (`order by effective_from desc, id desc`, R4 K1). No row means AI off and
-- the site hidden, the state of every new self-serve shop (D-045).
create table platform.shop_config (
  id uuid primary key default ops.uuidv7(),
  tenant_id uuid not null references ops.tenant,
  ai_enabled boolean not null,
  ai_daily_calls int not null check (ai_daily_calls between 0 and 2000),
  media_daily_calls int not null check (media_daily_calls between 0 and 500),
  site_verified boolean not null,
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change
);

-- The demo's sample shops' defaults, and one daily media ceiling shared by every sandbox (the money note).
create table platform.default_config (
  id uuid primary key default ops.uuidv7(),
  scope text not null check (scope = 'demo_shops'),
  ai_enabled boolean not null,
  ai_daily_calls int not null check (ai_daily_calls between 0 and 2000),
  media_daily_calls int not null check (media_daily_calls between 0 and 500),
  sandbox_media_daily_calls_total int not null check (sandbox_media_daily_calls_total between 0 and 5000),
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change
);

-- No grant, no real send (review B1). Holds no phone number: recipients are the tenant's own ops.channel_recipient rows.
create table platform.channel_grant (
  id uuid primary key default ops.uuidv7(),
  tenant_id uuid not null references ops.tenant,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  granted boolean not null,
  max_test_recipients int not null check (max_test_recipients between 0 and 5),
  account_ref text check (account_ref ~ '^[a-z0-9_.-]{1,64}$'),
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change,
  check (channel = 'whatsapp' or max_test_recipients = 0),
  check (account_ref is null or channel = 'instagram')
);

-- Merchant names kept from self-serve sign-up (review B5); the skeleton is folded as in ops.directory_guard.
create table platform.reserved_slug (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{2,39}$'),
  skeleton text not null unique,
  note text check (char_length(note) <= 200),
  change_id uuid references platform.change
);

-- One global hash chain, built as the tenants' (§2.7): every proposal, decision and executed write is an entry, with
-- ids and codes only.
create table platform.audit_log (
  seq bigint primary key check (seq > 0),
  operator_id uuid references platform.operator,
  change_id uuid references platform.change,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)*$'),
  entity text not null check (entity ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and not jsonb_path_exists(payload,
    'strict $.** ? (@.type() == "number" || @.type() == "null" || (@.type() == "string" && !(@ like_regex "^[a-z0-9_.-]{1,64}$")))')),
  created_at timestamptz not null,
  prev_hash bytea,
  hash bytea not null check (octet_length(hash) = 32),
  check ((seq = 1) = (prev_hash is null))
);

-- A platform write's admission (MS017). As munshi_platform, munshi.platform_change_id must name a change approved in
-- this transaction, decided in a later transaction than its proposal, by the acting operator (munshi.operator_id,
-- active), of this table's kind and this row's tenant, with a TOTP verified within 5 minutes of the decision for a
-- channel grant or an operator change; and the row's settings equal the change's payload, key for key (the approver saw
-- exactly what is written). tg_argv: the kinds this table takes, then its payload columns. As the owner: the reserved
-- slug seeds, and the first operator while none exists. An operator's own sign-in only moves totp_last_step forward.
create function platform.platform_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_operator uuid := nullif(current_setting('munshi.operator_id', true), '')::uuid;
  ctx_change uuid := nullif(current_setting('munshi.platform_change_id', true), '')::uuid;
  ch platform.change;
  r jsonb := to_jsonb(new);
  cols text[] := tg_argv[1:];
begin
  if tg_op = 'UPDATE' then
    if current_user = 'munshi_platform' and new.id = ctx_operator and new.active = old.active
       and new.totp_last_step > old.totp_last_step and r - 'totp_last_step' = to_jsonb(old) - 'totp_last_step' then
      return new;
    end if;
    if r - 'active' <> to_jsonb(old) - 'active' or not (old.active and not new.active) then
      raise exception 'platform refused: an operator changes only by deactivation, or its own TOTP step moving forward' using errcode = 'MS017';
    end if;
    cols := array['id', 'active'];
  end if;
  if current_user = 'munshi_owner' and tg_op = 'INSERT' and ctx_change is null
     and (tg_table_name = 'reserved_slug' or (tg_table_name = 'operator' and not exists (select 1 from platform.operator))) then
    null;
  elsif current_user <> 'munshi_platform' then
    raise exception 'platform refused: % does not write platform.%', current_user, tg_table_name using errcode = 'MS017';
  else
    select * into ch from platform.change c where c.id = ctx_change;
    if ch.id is null or ch.verdict is distinct from 'approved' or ch.decided_txid is distinct from txid_current()
       or ch.proposed_txid = ch.decided_txid or ch.decided_by is distinct from ctx_operator
       or not exists (select 1 from platform.operator o where o.id = ctx_operator and o.active)
       or not ch.kind = any (string_to_array(tg_argv[0], '|'))
       or (r ? 'tenant_id' and (r ->> 'tenant_id')::uuid is distinct from ch.tenant_id)
       or (ch.kind in ('channel_grant', 'operator') and (ch.decided_totp_at is null or ch.decided_totp_at < ch.decided_at - interval '5 minutes'))
       or (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(ch.payload) k)
          <> (select coalesce(array_agg(c order by c), '{}') from unnest(cols) c)
       or exists (select 1 from unnest(cols) c where r -> c is distinct from ch.payload -> c) then
      raise exception 'platform refused: no approved change of this transaction, by this operator, for exactly this write' using errcode = 'MS017';
    end if;
    if tg_op = 'UPDATE' then
      return new;
    end if;
    if r ? 'change_id' then
      new := jsonb_populate_record(new, jsonb_build_object('change_id', ch.id));
    end if;
  end if;
  if tg_table_name = 'reserved_slug' then
    new := jsonb_populate_record(new, jsonb_build_object('skeleton',
      replace(replace(translate(replace(lower(r ->> 'slug'), '-', ''), '015l', 'oisi'), 'rn', 'm'), 'vv', 'w')));
  elsif tg_table_name = 'operator' then
    if exists (select 1 from ops.subject_summary s where s.provider = 'password' and s.subject = r ->> 'subject' and s.memberships > 0) then
      raise exception 'platform refused: an identity with a shop membership is never an operator' using errcode = 'MS007';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('created_at', now()));
  elsif r ? 'effective_from' then
    new := jsonb_populate_record(new, jsonb_build_object('effective_from', now()));
  end if;
  return new;
end $$;
revoke execute on function platform.platform_guard() from public;
create trigger guard before insert or update on platform.operator for each row
  execute function platform.platform_guard('operator', 'subject', 'display_name');
create trigger guard before insert on platform.shop_config for each row
  execute function platform.platform_guard('shop_config|site_verify', 'ai_enabled', 'ai_daily_calls', 'media_daily_calls', 'site_verified');
create trigger guard before insert on platform.default_config for each row
  execute function platform.platform_guard('default_config', 'scope', 'ai_enabled', 'ai_daily_calls', 'media_daily_calls',
                                           'sandbox_media_daily_calls_total', 'deployment_daily_calls', 'sandbox_ai_enabled');
create trigger guard before insert on platform.channel_grant for each row
  execute function platform.platform_guard('channel_grant', 'channel', 'granted', 'max_test_recipients', 'account_ref');
create trigger guard before insert on platform.reserved_slug for each row
  execute function platform.platform_guard('reserved_slug', 'slug', 'note');

-- A change is proposed by the acting operator, then decided once, in a later transaction, by an active operator.
create function platform.change_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_operator uuid := nullif(current_setting('munshi.operator_id', true), '')::uuid;
  totp_at timestamptz := nullif(current_setting('munshi.totp_at', true), '')::timestamptz;
begin
  if current_user <> 'munshi_platform' or not exists (select 1 from platform.operator o where o.id = ctx_operator and o.active) then
    raise exception 'change refused: an active operator proposes and decides, as munshi_platform' using errcode = 'MS017';
  end if;
  if tg_op = 'INSERT' then
    if new.verdict is not null or new.decided_by is not null then
      raise exception 'change refused: a new change is undecided' using errcode = 'MS017';
    end if;
    new.proposed_by := ctx_operator;
    new.proposed_at := now();
    new.proposed_txid := txid_current();
    return new;
  end if;
  if old.verdict is not null or new.verdict is null
     or to_jsonb(new) - array['decided_by', 'decided_at', 'verdict', 'decided_txid', 'decided_totp_at']
        <> to_jsonb(old) - array['decided_by', 'decided_at', 'verdict', 'decided_txid', 'decided_totp_at'] then
    raise exception 'change refused: a change is decided once, and nothing else of it changes' using errcode = 'MS017';
  end if;
  if old.proposed_txid = txid_current() then
    raise exception 'change refused: a change is decided in a later transaction than its proposal' using errcode = 'MS017';
  end if;
  if new.kind in ('channel_grant', 'operator') and new.verdict = 'approved'
     and (totp_at is null or totp_at < now() - interval '5 minutes' or totp_at > now()) then
    raise exception 'change refused: approving a channel grant or an operator change needs a TOTP code from the last 5 minutes'
      using errcode = 'MS017';
  end if;
  new.decided_by := ctx_operator;
  new.decided_at := now();
  new.decided_txid := txid_current();
  new.decided_totp_at := case when new.kind in ('channel_grant', 'operator') then totp_at end;
  return new;
end $$;
revoke execute on function platform.change_guard() from public;
create trigger guard before insert or update on platform.change for each row execute function platform.change_guard();

create function platform.session_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_operator uuid := nullif(current_setting('munshi.operator_id', true), '')::uuid;
  totp_at timestamptz := nullif(current_setting('munshi.totp_at', true), '')::timestamptz;
begin
  if current_user <> 'munshi_platform' then
    raise exception 'operator session refused: the console opens its sessions as munshi_platform' using errcode = 'MS017';
  end if;
  if tg_op = 'INSERT' then
    if new.operator_id is distinct from ctx_operator or new.revoked_at is not null
       or not exists (select 1 from platform.operator o where o.id = new.operator_id and o.active)
       or totp_at is null or totp_at < now() - interval '5 minutes' or totp_at > now()
       or new.subject_epoch is distinct from coalesce((select s.epoch from platform.operator o
                                                         join ops.subject_summary s on s.provider = 'password' and s.subject = o.subject::text
                                                        where o.id = new.operator_id), 0) then
      raise exception 'operator session refused: an active operator, with a fresh TOTP code, at the identity''s epoch' using errcode = 'MS017';
    end if;
    new.created_at := now();
    return new;
  end if;
  if to_jsonb(new) - 'revoked_at' <> to_jsonb(old) - 'revoked_at' or old.revoked_at is not null or new.revoked_at is distinct from now() then
    raise exception 'operator session refused: a session is revoked once, at now()' using errcode = 'MS017';
  end if;
  return new;
end $$;
revoke execute on function platform.session_guard() from public;
create trigger guard before insert or update on platform.operator_session for each row execute function platform.session_guard();

-- The platform chain: seq, prev_hash, created_at and hash set here under the platform chain lock (class 10); an entry
-- names the acting operator (none for an owner seed).
create function platform.chain() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  last_seq bigint;
  last_hash bytea;
begin
  if current_user = 'munshi_platform'
     and new.operator_id is distinct from nullif(current_setting('munshi.operator_id', true), '')::uuid then
    raise exception 'platform audit refused: an entry names the acting operator' using errcode = 'MS017';
  elsif current_user not in ('munshi_platform', 'munshi_owner') then
    raise exception 'platform audit refused: % does not write the platform chain', current_user using errcode = 'MS017';
  end if;
  perform pg_advisory_xact_lock(10, 0);
  select a.seq, a.hash into last_seq, last_hash from platform.audit_log a order by a.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := sha256(coalesce(new.prev_hash, ''::bytea) || convert_to(concat_ws(chr(31),
    new.seq::text, coalesce(new.operator_id::text, ''), coalesce(new.change_id::text, ''), new.action, new.entity,
    coalesce(new.entity_id::text, ''), new.payload::text, extract(epoch from new.created_at)::text), 'UTF8'));
  return new;
end $$;
revoke execute on function platform.chain() from public;
create trigger chain before insert on platform.audit_log for each row execute function platform.chain();

-- Every proposal, decision and executed write into the chain, and an operator's mark on its identity.
create function platform.audit_write() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_operator uuid := nullif(current_setting('munshi.operator_id', true), '')::uuid;
  act text;
  ch uuid;
  body jsonb;
begin
  if tg_table_name = 'change' then
    act := case when tg_op = 'INSERT' then 'change.propose' when new.verdict = 'approved' then 'change.approve' else 'change.reject' end;
    ch := new.id;
    body := jsonb_build_object('kind', new.kind) || case when new.tenant_id is null then '{}'::jsonb else jsonb_build_object('tenant_id', new.tenant_id) end;
  else
    ch := (to_jsonb(new) ->> 'change_id')::uuid;
    act := tg_table_name || case when ch is null then '.seed' when tg_op = 'UPDATE' then '.update' else '.insert' end;
    body := case when ch is null then '{}'::jsonb else jsonb_build_object('change_id', ch) end;
    -- An operator row is labelled by what changed: the seed is the insert with no change, a later insert is an add, a
    -- deactivation is active going true to false (under its change), and the one other update the guard admits is the
    -- operator's own TOTP step moving forward at sign-in, chained with no change id whatever the session carries.
    if tg_table_name = 'operator' then
      ch := nullif(current_setting('munshi.platform_change_id', true), '')::uuid;
      body := '{}'::jsonb;
      if tg_op = 'INSERT' then
        act := case when ch is null then 'operator.seed' else 'operator.add' end;
        insert into ops.subject_summary as s (provider, subject, is_operator, updated_at)
        values ('password', new.subject::text, true, now())
        on conflict (provider, subject) do update set is_operator = true, updated_at = now();
      elsif old.active and not new.active then
        act := 'operator.deactivate';
      else
        act := 'operator.sign_in';
        ch := null;
      end if;
    end if;
  end if;
  insert into platform.audit_log (operator_id, change_id, action, entity, entity_id, payload)
  values (case when current_user = 'munshi_platform' then ctx_operator
               when tg_table_name = 'operator' then (to_jsonb(new) ->> 'id')::uuid end,
          ch, act, 'platform.' || tg_table_name,
          case when tg_table_name = 'reserved_slug' then null else (to_jsonb(new) ->> 'id')::uuid end, body);
  return null;
end $$;
revoke execute on function platform.audit_write() from public;
create trigger audit after insert or update on platform.change for each row execute function platform.audit_write();
create trigger audit after insert or update on platform.operator for each row execute function platform.audit_write();
create trigger audit after insert on platform.shop_config for each row execute function platform.audit_write();
create trigger audit after insert on platform.default_config for each row execute function platform.audit_write();
create trigger audit after insert on platform.channel_grant for each row execute function platform.audit_write();
create trigger audit after insert on platform.reserved_slug for each row execute function platform.audit_write();

-- The console verifies the platform chain (§6.5): the first seq that breaks it, or NULL.
create function platform.verify_chain() returns bigint language plpgsql stable
  set search_path = pg_catalog, pg_temp as $$
declare
  e platform.audit_log;
  expected bigint := 1;
  prev bytea;
begin
  for e in select * from platform.audit_log a order by a.seq loop
    if e.seq <> expected or e.prev_hash is distinct from prev
       or e.hash is distinct from sha256(coalesce(prev, ''::bytea) || convert_to(concat_ws(chr(31),
            e.seq::text, coalesce(e.operator_id::text, ''), coalesce(e.change_id::text, ''), e.action, e.entity,
            coalesce(e.entity_id::text, ''), e.payload::text, extract(epoch from e.created_at)::text), 'UTF8')) then
      return expected;
    end if;
    prev := e.hash;
    expected := expected + 1;
  end loop;
  return null;
end $$;
revoke execute on function platform.verify_chain() from public;
grant execute on function platform.verify_chain() to munshi_platform;

insert into platform.reserved_slug (slug, note) values ('elite', 'Elite Unisex Salon & Academy'), ('prabhave', 'Prabhave');

-- Indexes, one per statement, each asserted in pg_index (G10).
create unique index identity_email on idp.identity (email_hmac);
create index operator_session_operator on platform.operator_session (operator_id);
create index shop_config_latest on platform.shop_config (tenant_id, effective_from desc, id desc);
create index channel_grant_latest on platform.channel_grant (tenant_id, channel, effective_from desc, id desc);

-- RLS and the grants: forced on every table with one permissive policy (the grants decide), plus the idp role's
-- restrictive delete rule for old attempts.
alter table idp.identity enable row level security;
alter table idp.identity force row level security;
create policy global_rows on idp.identity using (true) with check (true);
revoke all on idp.identity from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (email_hmac, password_hash, salt, params, password_changed_at, erased_at) on idp.identity to munshi_idp;

alter table idp.attempt enable row level security;
alter table idp.attempt force row level security;
create policy global_rows on idp.attempt using (true) with check (true);
create policy attempt_sweep on idp.attempt as restrictive for delete to munshi_idp
  using (last_at < now() - interval '1 day' and (locked_until is null or locked_until < now()));
revoke all on idp.attempt from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (failures, locked_until, last_at), delete on idp.attempt to munshi_idp;

alter table idp.reset_use enable row level security;
alter table idp.reset_use force row level security;
create policy global_rows on idp.reset_use using (true) with check (true);
revoke all on idp.reset_use from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on idp.reset_use to munshi_idp;

alter table platform.operator enable row level security;
alter table platform.operator force row level security;
create policy global_rows on platform.operator using (true) with check (true);
revoke all on platform.operator from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (totp_last_step, active) on platform.operator to munshi_platform;

alter table platform.operator_session enable row level security;
alter table platform.operator_session force row level security;
create policy global_rows on platform.operator_session using (true) with check (true);
revoke all on platform.operator_session from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (revoked_at) on platform.operator_session to munshi_platform;

alter table platform.change enable row level security;
alter table platform.change force row level security;
create policy global_rows on platform.change using (true) with check (true);
revoke all on platform.change from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (decided_by, decided_at, verdict, decided_txid, decided_totp_at) on platform.change to munshi_platform;

alter table platform.shop_config enable row level security;
alter table platform.shop_config force row level security;
create policy global_rows on platform.shop_config using (true) with check (true);
revoke all on platform.shop_config from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.shop_config to munshi_platform;
grant select on platform.shop_config to munshi_app, munshi_jobs;
grant select (id, tenant_id, site_verified, effective_from) on platform.shop_config to munshi_public;

alter table platform.default_config enable row level security;
alter table platform.default_config force row level security;
create policy global_rows on platform.default_config using (true) with check (true);
revoke all on platform.default_config from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.default_config to munshi_platform;
grant select on platform.default_config to munshi_app, munshi_jobs;

alter table platform.channel_grant enable row level security;
alter table platform.channel_grant force row level security;
create policy global_rows on platform.channel_grant using (true) with check (true);
revoke all on platform.channel_grant from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.channel_grant to munshi_platform;
grant select on platform.channel_grant to munshi_app, munshi_jobs;

alter table platform.reserved_slug enable row level security;
alter table platform.reserved_slug force row level security;
create policy global_rows on platform.reserved_slug using (true) with check (true);
revoke all on platform.reserved_slug from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.reserved_slug to munshi_platform;
grant select on platform.reserved_slug to munshi_app, munshi_jobs, munshi_public;

alter table platform.audit_log enable row level security;
alter table platform.audit_log force row level security;
create policy global_rows on platform.audit_log using (true) with check (true);
revoke all on platform.audit_log from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.audit_log to munshi_platform;
