-- 26 · The per-shop data version and the members' push subscriptions (platform design §2, §3; D-080).
--
-- ops.tenant_version: one row per shop, made in the shop's creation transaction, whose version rises by exactly one in
-- every transaction that writes the shop's book or ops state, at commit (a deferred constraint trigger, `z_version`, on
-- every such table, attached below from the catalog), so a cached read keyed by (shop, …, version) is unreachable after
-- any write, and a read made in the same snapshot as the version can never pair new data with an old version. The
-- covered tables are every table with a tenant_id in ops, books, approval, ai and platform, but these, which hold no
-- state a screen reads from a stored snapshot:
--   ops.tenant_version       the counter itself
--   ops.login_session        a sign-in, not the shop's state
--   ops.idempotency          a command's key; the command's own rows bump
--   ai.run, ai.trace, ai.answer, ai.usage, ai.spend, ops.message_text
--                            what a model call or a read leaves behind: an Ask answer (its run, trace, usage, spend,
--                            words and answer row) reused "on the same data version" must not move the version it is
--                            keyed by. Every text a screen shows is named by a covered row (a message, a campaign's
--                            copy, an order line's note, a memory note, the brief's lines on ai.brief), which bumps
--                            when it is written; a text's own erasure (a purge or an owner's) does not bump, so a
--                            cached read may show erased words until its TTL, unless the erasure path deletes the
--                            shop's cache namespace (D-080: an erasure deletes the tenant's namespace)
--   platform.change          a proposal, not yet anything; its approved write lands in a covered platform table
-- and the snap and audit schemas, wholly: a snapshot is a read (a read never bumps), and an audit entry is written beside
-- a covered row. Global tables without a tenant_id (platform.model_allow, platform.default_config, …) bump no shop: a
-- deployment-wide change reaches cached reads by their TTL (under a day, D-080). 90_seal.sql holds this list too.
--
-- The counter is written only by its triggers (pg_trigger_depth, MS018), only upward by one, once per transaction: the
-- bump's UPDATE sets bumped_txid alone, and version_guard skips the row when this transaction already bumped it, else
-- sets version to the old one plus one. The bump runs as the writing role, under the row's own shop (it sets
-- munshi.tenant_id to the row's tenant for the one statement and puts the caller's back), so the console's platform
-- writes, made with no shop context, bump too. The bump reads no column (RLS picks the shop's one row), so the public
-- and platform roles hold only UPDATE(bumped_txid): no SELECT on the counter.
--
-- The cache rule (core's read-through cache, spec §3): read the version in the same statement as the data, or before
-- it in the same transaction, never after (under READ COMMITTED a write committing in between would file old data
-- under the new version). A read over an excluded table is never cached by version, because its own writes do not
-- move it: desks.summary and desks.trace (runs and traces), the AI usage and spend screens (ai.usage, ai.spend), and
-- an Ask answer's own words read back. Nor is anything over a global platform table (above).
--
-- Deadlocks: the bump takes the version row's lock at commit, in the order the writes fired. Every writer today writes
-- one shop per transaction. A future batch writer that writes several shops in one transaction must write them in a
-- fixed order (by tenant_id), or two such writers can deadlock at commit (40P01, which core maps to conflict).
--
-- ops.push_subscription: a member's Web Push subscription (a device). The endpoint and the keys are the app's opaque
-- sealed blobs (encrypted by the app before they reach the database; the endpoint's sha256 finds a duplicate). A member
-- adds only their own, from a real session (munshi.via = 'real': a demo or sandbox visitor never registers a device),
-- and revokes only their own; the jobs sender reads them and revokes one the push service has dropped. One device is
-- one live subscription in a shop: a newer one for the same endpoint (another member signing in on it, or the same
-- member again) revokes the older in its own insert, so a device never receives another member's notices. No figure,
-- word or amount is ever stored here (a notification says who and what kind, never a number: spec §2). A member's
-- deactivation revokes their subscriptions and a member's erasure erases them, in the same UPDATE (trigger `push` on
-- ops.member).
set local role munshi_owner;

create table ops.tenant_version (
  tenant_id uuid primary key references ops.tenant,
  version bigint not null default 0 check (version >= 0),
  bumped_txid bigint,
  bumped_at timestamptz not null default now()
);

create function ops.version_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'munshi_owner' and exists (select 1 from ops.tenant t where t.tenant_id = old.tenant_id and t.sandbox) then
      return old;
    end if;
    raise exception 'version refused: a version row goes only with its sandbox, as the owner' using errcode = 'MS010';
  end if;
  if pg_trigger_depth() < 2 then
    raise exception 'ops.tenant_version is written only by the version triggers' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if new.version <> 0 or not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current()) then
      raise exception 'version refused: a shop''s version starts at 0, in its creation transaction' using errcode = 'MS010';
    end if;
    new.bumped_txid := null;
    new.bumped_at := now();
    return new;
  end if;
  if new.tenant_id <> old.tenant_id or new.version <> old.version or new.bumped_txid is distinct from txid_current() then
    raise exception 'version refused: a bump sets bumped_txid to this transaction, and nothing else' using errcode = 'MS010';
  end if;
  if old.bumped_txid is not distinct from txid_current() then
    return null; -- bumped once already in this transaction
  end if;
  new.version := old.version + 1;
  new.bumped_at := now();
  return new;
end $$;
revoke execute on function ops.version_guard() from public;
create trigger guard before insert or update or delete on ops.tenant_version for each row execute function ops.version_guard();

-- The shop's row, after its tenant row, in the creation transaction (as the app's self-serve sign-up or the owner's
-- provisioning), under the new shop's context.
create function ops.version_row() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  was text := current_setting('munshi.tenant_id', true);
begin
  perform set_config('munshi.tenant_id', new.tenant_id::text, true);
  insert into ops.tenant_version (tenant_id) values (new.tenant_id);
  perform set_config('munshi.tenant_id', coalesce(was, ''), true);
  return null;
end $$;
revoke execute on function ops.version_row() from public;
create trigger version after insert on ops.tenant for each row execute function ops.version_row();

-- z_version: at commit, once per transaction and shop (version_guard skips a second bump). The UPDATE names no column
-- in a condition: under the row's shop the tenant policy leaves exactly that shop's row. A shop that no longer exists
-- (the sandbox reset's deletes) has no row, and nothing is bumped. Every shop gets its row in its creation transaction
-- (version_row) and a copy carries the rows (hosted-copy copies every table), so none is missing.
create function ops.version_bump() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  t uuid;
  was text := current_setting('munshi.tenant_id', true);
begin
  if tg_op = 'DELETE' then
    t := old.tenant_id;
  else
    t := new.tenant_id;
  end if;
  if t is null then
    return null;
  end if;
  perform set_config('munshi.tenant_id', t::text, true);
  update ops.tenant_version set bumped_txid = txid_current();
  perform set_config('munshi.tenant_id', coalesce(was, ''), true);
  return null;
end $$;
revoke execute on function ops.version_bump() from public;

create table ops.push_subscription (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  endpoint_hash bytea not null check (octet_length(endpoint_hash) = 32),
  endpoint_enc bytea check (octet_length(endpoint_enc) between 16 and 2048),
  keys_enc bytea check (octet_length(keys_enc) between 16 and 512),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  check ((erased_at is null) = (endpoint_enc is not null and keys_enc is not null)),
  check (erased_at is null or revoked_at is not null)
);

-- An active member adds their own, as the app; it is revoked once, at now(), by its member (the app), by the jobs sender
-- (no actor) or with its member's deactivation; it is erased (the blobs go, only_erase) only with its member's erasure.
-- Nothing else of it ever changes.
create function ops.push_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or new.member_id is distinct from ctx_actor
       or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'push refused: an active member subscribes their own device, as the app' using errcode = 'MS007';
    end if;
    if nullif(current_setting('munshi.via', true), '') is distinct from 'real' then
      raise exception 'push refused: a device is registered from a real session' using errcode = 'MS007';
    end if;
    if new.revoked_at is not null or new.erased_at is not null then
      raise exception 'push refused: a new subscription is live' using errcode = 'MS010';
    end if;
    -- The device's older subscription in this shop, whoever's, ends here (the revoke rule below admits it).
    perform set_config('munshi.push_replacing', encode(new.endpoint_hash, 'hex'), true);
    update ops.push_subscription p set revoked_at = now()
     where p.tenant_id = new.tenant_id and p.endpoint_hash = new.endpoint_hash and p.revoked_at is null;
    perform set_config('munshi.push_replacing', '', true);
    new.created_at := now();
    return new;
  end if;
  if to_jsonb(new) - array['revoked_at', 'endpoint_enc', 'keys_enc', 'erased_at'] <> to_jsonb(old) - array['revoked_at', 'endpoint_enc', 'keys_enc', 'erased_at'] then
    raise exception 'push refused: only the revocation and the erasure change a subscription' using errcode = 'MS010';
  end if;
  if old.erased_at is null and new.erased_at is not null
     and not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.erased_at is not null) then
    raise exception 'push refused: a subscription is erased only with its member' using errcode = 'MS007';
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    if old.revoked_at is not null or new.revoked_at is distinct from now() then
      raise exception 'push refused: a subscription is revoked once, at now()' using errcode = 'MS010';
    end if;
    if not ((current_user = 'munshi_app' and ctx_actor = old.member_id)
            or (current_user = 'munshi_jobs' and ctx_actor is null)
            or (pg_trigger_depth() > 1 and exists (
                  select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and not m.active))
            -- the device's newer subscription, from inside its own insert (above)
            or (pg_trigger_depth() > 1 and current_user = 'munshi_app'
                and nullif(current_setting('munshi.push_replacing', true), '') = encode(old.endpoint_hash, 'hex'))) then
      raise exception 'push refused: a subscription is revoked by its member, the sender, its member''s deactivation or the device''s newer subscription'
        using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.push_guard() from public;
create trigger erase before update on ops.push_subscription for each row execute function ops.only_erase('endpoint_enc', 'keys_enc');
create trigger guard before insert or update on ops.push_subscription for each row execute function ops.push_guard();

-- A member's deactivation revokes their live subscriptions; their erasure erases every one, in the same UPDATE, as the
-- role making it (an active owner, or the jobs purge).
create function ops.member_push() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if old.active and not new.active then
    update ops.push_subscription p set revoked_at = now()
     where p.tenant_id = new.tenant_id and p.member_id = new.id and p.revoked_at is null;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    update ops.push_subscription p set endpoint_enc = null, keys_enc = null, erased_at = now(), revoked_at = coalesce(p.revoked_at, now())
     where p.tenant_id = new.tenant_id and p.member_id = new.id and p.erased_at is null;
  end if;
  return null;
end $$;
revoke execute on function ops.member_push() from public;
create trigger push after update on ops.member for each row execute function ops.member_push();

-- Indexes, one per statement, each asserted in pg_index (G10).
create unique index push_live on ops.push_subscription (tenant_id, endpoint_hash) where revoked_at is null;
create index push_member on ops.push_subscription (tenant_id, member_id);

-- RLS and the grants. Every role that writes a covered table bumps its shop's version as itself, so each may update
-- bumped_txid (the guard sets the rest); only the app and the jobs role read the counter.
alter table ops.tenant_version enable row level security;
alter table ops.tenant_version force row level security;
create policy tenant_isolation on ops.tenant_version
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.tenant_version from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert (tenant_id), update (bumped_txid) on ops.tenant_version to munshi_app;
grant select, update (bumped_txid) on ops.tenant_version to munshi_jobs;
grant update (bumped_txid) on ops.tenant_version to munshi_public, munshi_platform;

alter table ops.push_subscription enable row level security;
alter table ops.push_subscription force row level security;
create policy tenant_isolation on ops.push_subscription
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.push_subscription from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
-- The app never reads the sealed blobs back: it writes them, and the sender reads them.
grant select (tenant_id, id, member_id, endpoint_hash, created_at, revoked_at, erased_at), insert,
  update (revoked_at, endpoint_enc, keys_enc, erased_at) on ops.push_subscription to munshi_app;
grant select, update (revoked_at, endpoint_enc, keys_enc, erased_at) on ops.push_subscription to munshi_jobs;

-- z_version on every covered table that exists by now, read from the catalog by the build's own connection (as 29
-- attaches a_open). A table a later file adds is not reached by this loop: that file attaches z_version itself, and
-- 90_seal.sql fails the build until it does.
do $$
declare
  rel regclass;
begin
  for rel in
    select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('ops', 'books', 'approval', 'ai', 'platform') and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
       and c.oid::regclass::text not in ('ops.tenant_version', 'ops.login_session', 'ops.idempotency', 'ai.run', 'ai.trace', 'ai.answer',
                                         'ai.usage', 'ai.spend', 'platform.change', 'ops.message_text')
     order by 1
  loop
    execute format('create constraint trigger z_version after insert or update or delete on %s deferrable initially deferred '
                   'for each row execute function ops.version_bump()', rel);
  end loop;
end $$;
