-- 03 · Tenancy, shops, members, sign-in, capability switches (BLUEPRINT §2.10.1). Every table here is ops (or global):
-- written by the role whose job it is, each transition role-shaped (§2.3) and checked by a trigger, refusals MS007 (who),
-- MS010 (fixed rows), MS018 (role shape), MS019 (switches). No column here names a table of a later file; the triggers
-- read and audit into 08's and 09's tables at run time, after the whole build.
--
-- The creation transaction: the tenant row stamps created_txid, and a few rows are admitted only inside it (the
-- directory row, the first member, the first-owner login, the pack's switches). It runs either as munshi_app with the
-- new owner as the actor (self-serve sign-up: the owner adds themself) or as munshi_owner with no actor (the operator's
-- provisioning and the populate script; the owner role is the operator, who can drop the database anyway).
--
-- One database holds sample shops and real ones (D-080): the class is the tenant's, not the deployment's. A sample shop
-- (synthetic or showcase, a sandbox always synthetic) takes demo and sandbox sessions and never delivers for real; a
-- real shop ('live') takes real sessions only. A real shop starts pending: until an approved platform change accepts it
-- (platform.tenant_acceptance, 09) it is "not open", and every write is refused (MS020) but those of its creation
-- transaction; only its owner signs in, to a waiting page. A pending sign-up expires 14 days after it was made: then
-- its owner signs in no more, it can no longer be accepted, and the jobs purge (ops.purge_pending_signups, 09) frees its
-- slug and erases its owner and login, leaving the tenant row as a tombstone. "Open" is read as: an acceptance row, or
-- a tenant this context sees that is not live, so a tenant the guard cannot see is never open.
set local role munshi_owner;

-- Global, one row each, written only as the owner: what kind of database this is (absent counts as demo), and which
-- build made it. Neither ever changes; the deployment row comes before any tenant (a table that ever held a row keeps
-- a page, so a database that held tenants cannot be relabelled). TRUNCATE skips row triggers, so a statement trigger
-- covers it. The sha256 is the build's 32 bytes (R4 K9).
create table ops.deployment (
  one boolean primary key default true check (one),
  kind text not null check (kind in ('demo', 'live')),
  hosted boolean not null,
  created_at timestamptz not null default now()
);

create table ops.schema_version (
  one boolean primary key default true check (one),
  source text not null check (source in ('schema', 'migrations')),
  sha256 bytea not null check (octet_length(sha256) = 32),
  built_at timestamptz not null default now()
);

create function ops.build_row() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception '%.% never changes', tg_table_schema, tg_table_name using errcode = 'MS010';
  end if;
  if current_user <> 'munshi_owner' then
    raise exception '%.% is written only as the owner, by the build', tg_table_schema, tg_table_name using errcode = 'MS010';
  end if;
  if tg_table_name = 'deployment' then
    if pg_relation_size('ops.tenant') > 0 then
      raise exception 'deployment refused: the deployment row comes before any tenant' using errcode = 'MS010';
    end if;
    new.created_at := now();
  else
    new.built_at := now();
  end if;
  return new;
end $$;
revoke execute on function ops.build_row() from public;
create trigger fixed before insert or update or delete on ops.deployment for each row execute function ops.build_row();
create trigger fixed_truncate before truncate on ops.deployment for each statement execute function ops.build_row();
create trigger fixed before insert or update or delete on ops.schema_version for each row execute function ops.build_row();
create trigger fixed_truncate before truncate on ops.schema_version for each statement execute function ops.build_row();

-- A shop owner's business. business_type names the pack it started from and never changes (§8.13); data_class is the
-- tenant's own (D-080): 'live' is a real shop, synthetic and showcase are samples, and a sandbox is synthetic (T1). On a
-- hosted or live deployment self-serve makes only a real shop or a sandbox: a sample shop listed for the demo is the
-- operator's (a laptop or test database, no row or hosted = false, keeps the app's synthetic sign-up).
-- Only an active owner of this tenant updates it, once it is open, and only name and count_max_age (R4 N12), audited; a
-- delete is the sandbox reset's alone (R4 K5).
create table ops.tenant (
  tenant_id uuid primary key default ops.uuidv7(),
  name text not null check (char_length(name) between 1 and 120),
  business_type text not null references ref.business_type,
  data_class text not null check (data_class in ('synthetic', 'showcase', 'live')),
  country char(2) not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'Asia/Kolkata' check (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' and char_length(time_zone) <= 64),
  count_max_age interval not null default '6 hours' check (count_max_age between interval '5 minutes' and interval '7 days'),
  sandbox boolean not null default false,
  created_txid bigint not null,
  created_at timestamptz not null default now()
);

create function ops.tenant_class() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  served boolean := coalesce((select d.kind = 'live' or d.hosted from ops.deployment d), false);
begin
  if current_user not in ('munshi_app', 'munshi_owner') then
    raise exception 'tenant refused: % does not create tenants', current_user using errcode = 'MS018';
  end if;
  if new.sandbox and new.data_class <> 'synthetic' then
    raise exception 'tenant refused: a sandbox is synthetic' using errcode = 'MS010';
  end if;
  if current_user = 'munshi_app' and served and not (new.data_class = 'live' or new.sandbox) then
    raise exception 'tenant refused: on a hosted or live deployment self-serve makes a real shop or a sandbox, not a % sample', new.data_class
      using errcode = 'MS010';
  end if;
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.tenant_class() from public;
create trigger tenant_class before insert on ops.tenant for each row execute function ops.tenant_class();

-- Whether a shop is open (D-080): accepted by the operator (platform.tenant_acceptance, 09), or a sample shop this
-- context sees. A tenant the caller cannot see is never open. And whether a real sign-up has lapsed: real, never
-- accepted, made more than 14 days ago (the one place the window is written, but the directory's own age in the purge's
-- and the one-pending-per-identity rule's list). Invoker functions, read under the caller's RLS; the guards that ask
-- run as these roles (an owner-role caller owns them).
create function ops.tenant_open(p_tenant uuid) returns boolean language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  return exists (select 1 from platform.tenant_acceptance a where a.tenant_id = p_tenant)
      or exists (select 1 from ops.tenant t where t.tenant_id = p_tenant and t.data_class <> 'live');
end $$;
revoke execute on function ops.tenant_open(uuid) from public;
grant execute on function ops.tenant_open(uuid) to munshi_app;

create function ops.tenant_lapsed(p_tenant uuid) returns boolean language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  return exists (select 1 from ops.tenant t where t.tenant_id = p_tenant and t.data_class = 'live' and t.created_at < now() - interval '14 days')
     and not exists (select 1 from platform.tenant_acceptance a where a.tenant_id = p_tenant);
end $$;
revoke execute on function ops.tenant_lapsed(uuid) from public;
grant execute on function ops.tenant_lapsed(uuid) to munshi_app, munshi_jobs, munshi_platform;

-- a_open, before insert on every tenant table the app writes but the creation transaction's own and those whose guard
-- asks itself (attached by 29_open.sql, asserted by the seal): a pending shop's app writes nothing else, so it stores no
-- contact, text, document, site, campaign, recipient or other person's data before the operator accepts it (MS020).
create function ops.open_write() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  -- Nested, so no other role (the public, the jobs role) ever calls tenant_open, which only the app may execute. A row for
  -- another tenant than this context's is left to the table's own guard and its tenant policy, which refuse it anyway.
  if current_user = 'munshi_app' and new.tenant_id = nullif(current_setting('munshi.tenant_id', true), '')::uuid then
    if not ops.tenant_open(new.tenant_id) then
      raise exception '%.% refused: the shop waits for the operator''s acceptance', tg_table_schema, tg_table_name using errcode = 'MS020';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.open_write() from public;

create function ops.tenant_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'munshi_owner' and old.sandbox then
      return old;
    end if;
    raise exception 'tenant refused: a tenant is deleted only by the sandbox reset, as the owner' using errcode = 'MS010';
  end if;
  -- The purge of a lapsed sign-up replaces the shop's name with a fixed placeholder (ops.purge_pending_signups, 09).
  if current_user = 'munshi_jobs' and nullif(current_setting('munshi.actor_id', true), '') is null and ops.tenant_lapsed(old.tenant_id) then
    if to_jsonb(new) - 'name' <> to_jsonb(old) - 'name' or new.name <> 'Lapsed sign-up' then
      raise exception 'tenant refused: the purge only sets a lapsed sign-up''s name to the placeholder' using errcode = 'MS010';
    end if;
    return new;
  end if;
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m
        where m.tenant_id = old.tenant_id and m.id = nullif(current_setting('munshi.actor_id', true), '')::uuid
          and m.role = 'owner' and m.active) then
    raise exception 'tenant refused: only an active owner of this tenant changes it' using errcode = 'MS007';
  end if;
  if not ops.tenant_open(old.tenant_id) then
    raise exception 'tenant refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
  end if;
  if to_jsonb(new) - 'name' - 'count_max_age' <> to_jsonb(old) - 'name' - 'count_max_age' then
    raise exception 'tenant refused: only name and count_max_age change' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ops.tenant_guard() from public;
create trigger guard before update or delete on ops.tenant for each row execute function ops.tenant_guard();

create function ops.tenant_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if nullif(current_setting('munshi.actor_id', true), '') is null then
    return null; -- the purge's placeholder: an entry always names a member
  end if;
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'tenant.update', 'ops.tenant',
          new.tenant_id, jsonb_build_object('tenant_id', new.tenant_id));
  return null;
end $$;
revoke execute on function ops.tenant_audit() from public;
create trigger audit after update on ops.tenant for each row execute function ops.tenant_audit();

-- Global: slug → tenant, read before any tenant context exists (sign-in, a site key, the demo picker). Written once, in
-- the tenant's creation transaction (SIGNUP1). The skeleton folds look-alikes (lower case, hyphens dropped, 0→o, 1 and
-- l→i, 5→s, rn→m, vv→w) and must not equal a route word's, another slug's or a reserved slug's; a reserved slug itself
-- is taken only by an insert as the owner role (the operator's provisioning), never by self-serve sign-up (SLUG1).
-- `live` (stamped) marks a real shop's slug, so the purge and the one-pending-sign-up rule find pending real shops
-- without a tenant context. A pending real shop holds its slug only until it expires: the purge removes the row (D-080).
create table ops.tenant_directory (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{2,39}$'),
  skeleton text not null unique,
  tenant_id uuid not null unique references ops.tenant,
  live boolean not null default false,
  created_txid bigint not null,
  created_at timestamptz not null default now()
);

create function ops.directory_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  skel text;
  reserved text;
begin
  if tg_op = 'DELETE' then
    if current_user = 'munshi_owner' and exists (select 1 from ops.tenant t where t.tenant_id = old.tenant_id and t.sandbox) then
      return old;
    end if;
    -- The purge frees an expired pending sign-up's slug (ops.purge_pending_signups, 09).
    if current_user = 'munshi_jobs' and old.live and ops.tenant_lapsed(old.tenant_id) then
      return old;
    end if;
    raise exception 'directory refused: a slug is removed only with its sandbox, as the owner, or by the purge of an expired sign-up'
      using errcode = 'MS010';
  elsif tg_op = 'UPDATE' then
    raise exception 'directory refused: a slug never changes' using errcode = 'MS010';
  end if;
  if current_user not in ('munshi_app', 'munshi_owner') then
    raise exception 'directory refused: % does not create tenants', current_user using errcode = 'MS018';
  end if;
  if new.tenant_id is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid
     or not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current()) then
    raise exception 'directory refused: a slug is taken only in the transaction that created its tenant' using errcode = 'MS007';
  end if;
  skel := replace(replace(translate(replace(lower(new.slug), '-', ''), '015l', 'oisi'), 'rn', 'm'), 'vv', 'w');
  if skel = any (select replace(replace(translate(replace(w, '-', ''), '015l', 'oisi'), 'rn', 'm'), 'vv', 'w')
                   from unnest(array['app', 'api', 'developers', 'platform', 'sign-in', 'sign-up', 'log-in', 'log-out', 'sign-out',
                                     'login', 'logout', 'signup', 'invite', 'privacy', 'terms', 'demo', 'live', 'www', 'munshi',
                                     'admin', 'choose-shop', 'reset', 'settings', 'help', 'docs', 'status', 'support', 'sites',
                                     'widgets', 'about', 'pricing', 'blog', 'static', 'assets']) w) then
    raise exception 'directory refused: % is a route word' , new.slug using errcode = 'MS007';
  end if;
  if exists (select 1 from ops.tenant_directory d where d.skeleton = skel) then
    raise exception 'directory refused: % looks like a slug already taken', new.slug using errcode = 'MS007';
  end if;
  select r.slug into reserved from platform.reserved_slug r where r.skeleton = skel;
  if reserved is not null and not (current_user = 'munshi_owner' and reserved = new.slug) then
    raise exception 'directory refused: % is reserved, or looks like a reserved name', new.slug using errcode = 'MS007';
  end if;
  new.skeleton := skel;
  new.live := exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.data_class = 'live');
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.directory_guard() from public;
create trigger guard before insert or update or delete on ops.tenant_directory for each row execute function ops.directory_guard();

-- The people who sign in to a shop. The first is the owner adding themself in the creation transaction (or the
-- operator's provisioning); then owners add owners and managers, owners or managers add staff (G12). Deactivation is
-- one way, by an active owner, never of the last active owner (F5); a member is erased only once deactivated, by an
-- active owner or by the jobs purge a year after the member.deactivate entry with no live login. Every change is
-- serialised per tenant under the tenant's chain lock itself, so this lock and the chain's are never taken in opposite
-- orders (R4 W2). Audited with ids and the role only. A pending real shop adds no member but its first owner (MS020);
-- the purge of an expired sign-up deactivates its members at now(), then erases them, with no entry.
create table ops.member (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  display_name text check (char_length(display_name) between 1 and 80),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role text not null check (role in ('owner', 'manager', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  erased_at timestamptz,
  primary key (tenant_id, id),
  check (active = (deactivated_at is null)),
  check (erased_at is not null or display_name is not null),
  check (erased_at is null or not active)
);

create function ops.member_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    if not new.active or new.deactivated_at is not null or new.erased_at is not null then
      raise exception 'member refused: a new member is active' using errcode = 'MS007';
    end if;
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id) then
      if new.role <> 'owner' or not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current())
         or not ((current_user = 'munshi_app' and new.id = ctx_actor) or (current_user = 'munshi_owner' and ctx_actor is null)) then
        raise exception 'member refused: the first member is the owner adding themself, in the tenant''s creation transaction'
          using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_app'
          or not coalesce(actor_role = 'owner' or (actor_role = 'manager' and new.role = 'staff'), false) then
      raise exception 'member refused: an active owner adds a member, or an active manager adds staff' using errcode = 'MS007';
    elsif not ops.tenant_open(new.tenant_id) then
      raise exception 'member refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    end if;
    new.created_at := now();
    return new;
  end if;

  if current_user = 'munshi_jobs' and ctx_actor is null and ops.tenant_lapsed(new.tenant_id) then
    if new.active or (old.active and new.deactivated_at is distinct from now())
       or (not old.active and new.deactivated_at is distinct from old.deactivated_at) or (old.active and new.erased_at is not null) then
      raise exception 'member refused: the purge deactivates an expired sign-up''s member at now(), then erases it' using errcode = 'MS007';
    end if;
    return new;
  end if;

  if new.active is distinct from old.active or new.deactivated_at is distinct from old.deactivated_at then
    if current_user <> 'munshi_app' or new.active or actor_role is distinct from 'owner' or new.deactivated_at is distinct from now() then
      raise exception 'member refused: an active owner deactivates a member, once, at now(); a member is never re-activated'
        using errcode = 'MS007';
    end if;
    if old.role = 'owner' and not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.role = 'owner' and m.active and m.id <> new.id) then
      raise exception 'member refused: the last active owner is never deactivated' using errcode = 'MS007';
    end if;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if old.active then
      raise exception 'member refused: a member is erased only once deactivated' using errcode = 'MS007';
    elsif ctx_actor is not null then
      if current_user <> 'munshi_app' or actor_role is distinct from 'owner' then
        raise exception 'member refused: an active owner erases a member, as munshi_app' using errcode = 'MS018';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'member refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif not exists (select 1 from audit.audit_log a
                       where a.tenant_id = new.tenant_id and a.entity = 'ops.member' and a.entity_id = new.id
                         and a.action = 'member.deactivate' and a.created_at < now() - interval '365 days')
          or exists (select 1 from ops.login l
                      where l.tenant_id = new.tenant_id and l.member_id = new.id and l.revoked_at is null and l.erased_at is null) then
      raise exception 'member refused: the purge erases a member a year after deactivation, with no live login' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.member_guard() from public;

-- No actor (the operator's provisioning, the jobs purge), no entry: an entry always names a member.
create function ops.member_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  act text;
  body jsonb := jsonb_build_object('member_id', new.id);
begin
  if tg_op = 'INSERT' then
    act := 'member.add';
    body := body || jsonb_build_object('role', new.role);
  elsif old.active and not new.active then
    act := 'member.deactivate';
  elsif old.erased_at is null and new.erased_at is not null then
    act := 'member.erase';
  end if;
  if act is not null and ctx_actor is not null then
    insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
    values (new.tenant_id, ctx_actor, act, 'ops.member', new.id, body);
  end if;
  return null;
end $$;
revoke execute on function ops.member_audit() from public;

create trigger erase before update on ops.member for each row execute function ops.only_erase('display_name', 'phone_e164');
create trigger guard before insert or update on ops.member for each row execute function ops.member_guard();
create trigger audit after insert or update on ops.member for each row execute function ops.member_audit();

-- A branch. Only an active owner adds or changes one (or the operator's provisioning, in the creation transaction),
-- audited. 18_gst.sql adds the rule that state_code and invoice_series, tax facts, never change after the first invoice.
create table ops.shop (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  name text not null check (char_length(name) between 1 and 80),
  area text check (char_length(area) <= 80),
  address text check (char_length(address) <= 300),
  state_code text check (state_code ~ '^[0-9]{2}$'),
  invoice_series text check (invoice_series ~ '^[A-Z0-9]{1,8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create function ops.shop_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  -- The purge of a lapsed sign-up: the name becomes a fixed placeholder, the area and address go (09).
  if tg_op = 'UPDATE' and current_user = 'munshi_jobs' and nullif(current_setting('munshi.actor_id', true), '') is null
     and ops.tenant_lapsed(new.tenant_id) then
    if new.name <> 'Lapsed' or new.area is not null or new.address is not null
       or to_jsonb(new) - array['name', 'area', 'address', 'updated_at'] <> to_jsonb(old) - array['name', 'area', 'address', 'updated_at'] then
      raise exception 'shop refused: the purge only blanks a lapsed sign-up''s shop' using errcode = 'MS010';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m
              where m.tenant_id = new.tenant_id and m.id = nullif(current_setting('munshi.actor_id', true), '')::uuid
                and m.role = 'owner' and m.active))
          or (tg_op = 'INSERT' and current_user = 'munshi_owner' and nullif(current_setting('munshi.actor_id', true), '') is null
              and exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current()))) then
    raise exception 'shop refused: an active owner adds or changes a shop' using errcode = 'MS007';
  end if;
  if not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current())
     and not ops.tenant_open(new.tenant_id) then
    raise exception 'shop refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif new.created_at is distinct from old.created_at then
    raise exception 'shop refused: created_at never changes' using errcode = 'MS010';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ops.shop_guard() from public;
create trigger guard before insert or update on ops.shop for each row execute function ops.shop_guard();

create function ops.shop_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if nullif(current_setting('munshi.actor_id', true), '') is null then
    return null; -- the purge's blanking: an entry always names a member
  end if;
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'shop.update', 'ops.shop', new.id,
          jsonb_build_object('shop_id', new.id));
  return null;
end $$;
revoke execute on function ops.shop_audit() from public;
create trigger audit after update on ops.shop for each row execute function ops.shop_audit();

-- Opening hours, append-only: the latest in effect per shop and weekday wins (`order by effective_from desc, created_at
-- desc, id desc`, R4 K1). No hours cross midnight, a stated limit for a late restaurant (R4 K10).
create table ops.shop_hours (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens time,
  closes time,
  closed boolean not null,
  effective_from date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, created_by) references ops.member,
  check (case when closed then opens is null and closes is null else opens is not null and closes > opens end)
);

create function ops.hours_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
    raise exception 'hours refused: an active owner or manager sets opening hours' using errcode = 'MS007';
  end if;
  if not ops.tenant_open(new.tenant_id) then
    raise exception 'hours refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
  end if;
  new.created_by := ctx_actor;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.hours_guard() from public;
create trigger guard before insert on ops.shop_hours for each row execute function ops.hours_guard();

-- An invite for one member: only the token's sha256 is kept. An active owner invites anyone, an active manager invites
-- staff (the operator's provisioning invites the first owner, with no creator). Using it is one UPDATE by the invited
-- member before it expires that stamps used_at and used_txid and erases the email; the jobs purge erases an expired
-- one's email. Either way the row then freezes, so an invite binds once and no copy of the address lasts (F4, F7).
create table ops.member_invite (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  email text check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  token_sha256 bytea not null check (octet_length(token_sha256) = 32),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_txid bigint,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, created_by) references ops.member,
  check ((used_at is null) = (used_txid is null)),
  check (erased_at is not null or email is not null),
  check (expires_at = created_at + interval '24 hours')
);

create function ops.invite_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
  invited_role text;
begin
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    select m.role into invited_role from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active;
    if invited_role is null then
      raise exception 'invite refused: the invited member is not an active member' using errcode = 'MS007';
    end if;
    if not ((current_user = 'munshi_app' and coalesce(actor_role = 'owner' or (actor_role = 'manager' and invited_role = 'staff'), false))
            or (current_user = 'munshi_owner' and ctx_actor is null and invited_role = 'owner'
                and exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current()))) then
      raise exception 'invite refused: an active owner invites, or an active manager invites staff' using errcode = 'MS007';
    end if;
    if current_user = 'munshi_app' and not ops.tenant_open(new.tenant_id) then
      raise exception 'invite refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    end if;
    if new.used_at is not null or new.used_txid is not null or new.erased_at is not null then
      raise exception 'invite refused: a new invite is unused' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
    new.expires_at := now() + interval '24 hours';
    return new;
  end if;
  if new.used_at is distinct from old.used_at or new.used_txid is distinct from old.used_txid then
    if current_user <> 'munshi_app' or ctx_actor is distinct from old.member_id then
      raise exception 'invite refused: only the invited member uses an invite, as munshi_app' using errcode = 'MS018';
    elsif old.used_at is not null or now() >= old.expires_at then
      raise exception 'invite refused: the invite is used or expired' using errcode = 'MS007';
    elsif new.erased_at is null then
      raise exception 'invite refused: using an invite erases its email' using errcode = 'MS007';
    end if;
    new.used_at := now();
    new.used_txid := txid_current();
  elsif old.erased_at is null and new.erased_at is not null then
    if current_user <> 'munshi_jobs' or ctx_actor is not null then
      raise exception 'invite refused: an unused invite is erased by the jobs purge' using errcode = 'MS018';
    elsif now() < old.expires_at then
      raise exception 'invite refused: an unused invite is erased once it has expired' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.invite_guard() from public;
create trigger erase before update on ops.member_invite for each row execute function ops.only_erase('email');
create trigger guard before insert or update on ops.member_invite for each row execute function ops.invite_guard();

-- Global, because a subject names no tenant: the memberships lookup reads it before any tenant context exists. No email.
-- The jobs role reads it too: the member purge needs "no live login" (§2.2: jobs reads ops).
-- A binding is made by the member themself, as munshi_app, either through an invite of theirs used in this transaction
-- or, for the first owner, in the tenant's creation transaction (self-serve sign-up, no SECURITY DEFINER). An operator's
-- subject is never bound to a shop. That a password subject exists and is verified in idp.identity is core's check,
-- through the adapter (the app cannot read idp). Revoked once; the subject is erased, never refilled. While a shop is
-- pending no invite binds (MS020), and one identity has at most one real sign-up pending at a time (it holds no second
-- slug); the purge of an expired sign-up revokes and erases its logins, with no actor.
create table ops.login (
  id uuid primary key default ops.uuidv7(),
  provider text not null check (provider in ('password', 'supabase')),
  subject text check (char_length(subject) between 1 and 128),
  tenant_id uuid not null references ops.tenant,
  member_id uuid not null,
  invite_id uuid,
  first_owner boolean not null default false,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  erased_at timestamptz,
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, invite_id) references ops.member_invite,
  check (first_owner = (invite_id is null)),
  check (erased_at is not null or subject is not null)
);

-- Global: per identity, how many live shop logins it has, the highest role it has held, whether it is an operator, and
-- its epoch (a reset bumps it, ending every session opened under an older one). Written only from the triggers on
-- ops.login, ops.reset_grant and platform.operator. highest_role never falls, so a revoked owner login still refuses an
-- in-app reset of that identity: conservative, never more permissive.
create table ops.subject_summary (
  provider text not null check (provider in ('password', 'supabase')),
  subject text not null check (char_length(subject) between 1 and 128),
  memberships int not null default 0 check (memberships >= 0),
  highest_role text check (highest_role in ('owner', 'manager', 'staff')),
  is_operator boolean not null default false,
  epoch int not null default 0 check (epoch >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider, subject)
);

create function ops.summary_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'ops.subject_summary is written only by the login, reset and operator triggers' using errcode = 'MS018';
  end if;
  if tg_op = 'UPDATE' and (new.epoch not between old.epoch and old.epoch + 1 or (old.is_operator and not new.is_operator)
                           or new.provider <> old.provider or new.subject <> old.subject) then
    raise exception 'subject summary refused: the epoch only rises by one, and an operator stays one' using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ops.summary_guard() from public;
create trigger guard before insert or update on ops.subject_summary for each row execute function ops.summary_guard();

create function ops.login_bind() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if tg_op = 'UPDATE' and current_user = 'munshi_jobs' and ctx_actor is null and old.tenant_id = ctx_tenant and ops.tenant_lapsed(old.tenant_id) then
    if new.revoked_at is distinct from old.revoked_at and (old.revoked_at is not null or new.revoked_at is distinct from now()) then
      raise exception 'login refused: the purge revokes a binding once, at now()' using errcode = 'MS007';
    end if;
    return new;
  end if;
  if current_user <> 'munshi_app' or ctx_actor is null then
    raise exception 'login refused: a binding is a member''s own action, as munshi_app' using errcode = 'MS018';
  end if;
  if new.tenant_id is distinct from ctx_tenant or (tg_op = 'UPDATE' and old.tenant_id is distinct from ctx_tenant) then
    raise exception 'login refused: the binding is not for the current tenant' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    if new.member_id is distinct from ctx_actor or new.revoked_at is not null or new.erased_at is not null
       or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active) then
      raise exception 'login refused: an active member binds their own live login' using errcode = 'MS007';
    end if;
    if new.first_owner then
      if not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current())
         or (select count(*) from ops.member m where m.tenant_id = new.tenant_id) <> 1
         or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.role = 'owner') then
        raise exception 'login refused: a first-owner login is bound in the tenant''s creation transaction, by its one owner'
          using errcode = 'MS007';
      end if;
      -- Two sign-ups of one identity are serialised here (class 11), so neither passes against the other's absence.
      perform pg_advisory_xact_lock(11, hashtext(new.provider || ':' || new.subject));
      if exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.data_class = 'live')
         and exists (select 1 from ops.login l join ops.tenant_directory d on d.tenant_id = l.tenant_id
                      where l.provider = new.provider and l.subject = new.subject and l.first_owner and l.tenant_id <> new.tenant_id
                        and l.revoked_at is null and l.erased_at is null and d.live and d.created_at > now() - interval '14 days'
                        and not exists (select 1 from platform.tenant_acceptance a where a.tenant_id = l.tenant_id)) then
        raise exception 'login refused: this identity already has a real shop waiting for acceptance' using errcode = 'MS020';
      end if;
    elsif not ops.tenant_open(new.tenant_id) then
      raise exception 'login refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    elsif not exists (select 1 from ops.member_invite i
                       where i.tenant_id = new.tenant_id and i.id = new.invite_id and i.member_id = new.member_id
                         and i.used_txid = txid_current()) then
      raise exception 'login refused: no invite for this member was used in this transaction' using errcode = 'MS007';
    end if;
    if exists (select 1 from ops.subject_summary s where s.provider = new.provider and s.subject = new.subject and s.is_operator) then
      raise exception 'login refused: an operator identity is never bound to a shop' using errcode = 'MS007';
    end if;
    new.created_txid := txid_current();
    new.created_at := now();
    return new;
  end if;
  if old.first_owner and not ops.tenant_open(old.tenant_id) then
    raise exception 'login refused: a pending shop''s first-owner login holds its identity''s one sign-up until acceptance or expiry'
      using errcode = 'MS020';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if ctx_actor is distinct from old.member_id and actor_role is distinct from 'owner' then
    raise exception 'login refused: the member or an active owner revokes or erases a binding' using errcode = 'MS007';
  end if;
  if new.revoked_at is distinct from old.revoked_at and (old.revoked_at is not null or new.revoked_at is distinct from now()) then
    raise exception 'login refused: a binding is revoked once, at now()' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.login_bind() from public;

-- After the row: the identity's live memberships recounted from ops.login (global, so every tenant's), its highest role
-- raised to this member's, and the binding audited with ids only.
create function ops.login_summary() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  subj text := coalesce(new.subject, old.subject);
  member_role text;
begin
  select m.role into member_role from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id;
  insert into ops.subject_summary as s (provider, subject, memberships, highest_role, updated_at)
  values (new.provider, subj,
          (select count(*) from ops.login l where l.provider = new.provider and l.subject = subj and l.revoked_at is null and l.erased_at is null),
          member_role, now())
  on conflict (provider, subject) do update
    set memberships = excluded.memberships,
        highest_role = case when 'owner' in (s.highest_role, excluded.highest_role) then 'owner'
                            when 'manager' in (s.highest_role, excluded.highest_role) then 'manager'
                            else 'staff' end,
        updated_at = now();
  if tg_op = 'INSERT' then
    insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
    values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'member.login_bound', 'ops.login', new.id,
            jsonb_build_object('member_id', new.member_id, 'provider', new.provider));
  end if;
  return null;
end $$;
revoke execute on function ops.login_summary() from public;
create trigger erase before update on ops.login for each row execute function ops.only_erase('subject');
create trigger guard before insert or update on ops.login for each row execute function ops.login_bind();
create trigger summary after insert or update on ops.login for each row execute function ops.login_summary();

-- An in-app password reset, only downward and only for a one-shop identity (review N1): an active owner resets a
-- manager or staff member, an active manager resets staff, of this shop, and only when the identity has exactly one
-- membership, has never been an owner and is not an operator. Using it is a public shape: once, before expiry, admitted
-- only when the sha256 of munshi.reset_token equals the row's hash; it bumps the identity's epoch in the same
-- transaction. The idp role then accepts a new password only for a grant used in the last 5 minutes (idp.reset_use, 09).
create table ops.reset_grant (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  subject text not null check (char_length(subject) between 1 and 128),
  token_sha256 bytea not null check (octet_length(token_sha256) = 32),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_txid bigint,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, issued_by) references ops.member,
  check (expires_at = issued_at + interval '24 hours'),
  check ((used_at is null) = (used_txid is null))
);

create function ops.reset_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  issuer_role text;
  target_role text;
  login_provider text;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or ctx_actor is null then
      raise exception 'reset refused: a reset is issued by a member, as munshi_app' using errcode = 'MS018';
    end if;
    select m.role into issuer_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
    select m.role into target_role from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active;
    if not coalesce((issuer_role = 'owner' and target_role in ('manager', 'staff')) or (issuer_role = 'manager' and target_role = 'staff'), false) then
      raise exception 'reset refused: an active owner resets a manager or staff member, an active manager resets staff' using errcode = 'MS007';
    end if;
    if not ops.tenant_open(new.tenant_id) then
      raise exception 'reset refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    end if;
    select l.provider into login_provider from ops.login l
     where l.tenant_id = new.tenant_id and l.member_id = new.member_id and l.subject = new.subject
       and l.revoked_at is null and l.erased_at is null;
    if login_provider is null or not exists (
         select 1 from ops.subject_summary s
          where s.provider = login_provider and s.subject = new.subject
            and s.memberships = 1 and s.highest_role is distinct from 'owner' and not s.is_operator) then
      raise exception 'reset refused: an in-app reset is for an identity with one membership, never an owner or an operator'
        using errcode = 'MS007';
    end if;
    if new.used_at is not null or new.used_txid is not null then
      raise exception 'reset refused: a new grant is unused' using errcode = 'MS007';
    end if;
    new.issued_by := ctx_actor;
    new.issued_at := now();
    new.expires_at := now() + interval '24 hours';
    return new;
  end if;
  if current_user <> 'munshi_public' or ctx_actor is not null then
    raise exception 'reset refused: a reset link is used on the public route, with no actor' using errcode = 'MS018';
  end if;
  if old.used_at is not null or now() >= old.expires_at
     or sha256(convert_to(coalesce(nullif(current_setting('munshi.reset_token', true), ''), ''), 'UTF8')) <> old.token_sha256
     or to_jsonb(new) - 'used_at' - 'used_txid' <> to_jsonb(old) - 'used_at' - 'used_txid' then
    raise exception 'reset refused: the link is used, expired or not this grant''s' using errcode = 'MS018';
  end if;
  new.used_at := now();
  new.used_txid := txid_current();
  return new;
end $$;
revoke execute on function ops.reset_guard() from public;
create trigger guard before insert or update on ops.reset_grant for each row execute function ops.reset_guard();

create function ops.reset_epoch() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  update ops.subject_summary s set epoch = s.epoch + 1, updated_at = now()
   where s.provider = 'password' and s.subject = new.subject;
  return null;
end $$;
revoke execute on function ops.reset_epoch() from public;
create trigger epoch after update on ops.reset_grant for each row execute function ops.reset_epoch();

-- The session a cookie names (§6.7). A member opens their own, as munshi_app, by the tenant's class (D-080), on any
-- deployment: `demo` only on a non-sandbox synthetic or showcase tenant, `sandbox` only on a sandbox, `real` only on a
-- real ('live') tenant with a live login, at the identity's current epoch. While a real shop is pending only its owner
-- opens one (the waiting page), and once the sign-up has expired nobody does (MS020). The member or an active owner
-- signs it out, once. The jobs sweep deletes one 30 days after it expired (R4 G4).
create table ops.login_session (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  via text not null check (via in ('demo', 'sandbox', 'real')),
  subject_epoch int check (subject_epoch >= 0),
  reset_grant_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, reset_grant_id) references ops.reset_grant,
  check ((via = 'real') = (subject_epoch is not null)),
  check (reset_grant_id is null or via = 'real'),
  check (expires_at > created_at and expires_at <= created_at
         + case via when 'demo' then interval '12 hours' when 'sandbox' then interval '7 days' else interval '14 days' end)
);

create function ops.session_via() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  t ops.tenant;
  live_login ops.login;
begin
  if current_user <> 'munshi_app' or ctx_actor is null then
    raise exception 'session refused: a session is a member''s own, as munshi_app' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if new.member_id is distinct from ctx_actor or new.revoked_at is not null
       or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active) then
      raise exception 'session refused: an active member opens their own session' using errcode = 'MS007';
    end if;
    select * into t from ops.tenant x where x.tenant_id = new.tenant_id;
    if new.via = 'demo' and (t.sandbox or t.data_class is null or t.data_class not in ('synthetic', 'showcase')) then
      raise exception 'session refused: a demo session is for a sample shop' using errcode = 'MS007';
    elsif new.via = 'sandbox' and not coalesce(t.sandbox, false) then
      raise exception 'session refused: a sandbox session is for a sandbox' using errcode = 'MS007';
    elsif new.via = 'real' then
      select * into live_login from ops.login l
       where l.tenant_id = new.tenant_id and l.member_id = new.member_id and l.revoked_at is null and l.erased_at is null;
      if t.data_class is distinct from 'live' or live_login.id is null
         or new.subject_epoch is distinct from (select s.epoch from ops.subject_summary s
                                                  where s.provider = live_login.provider and s.subject = live_login.subject)
         or (new.reset_grant_id is not null and not exists (
               select 1 from ops.reset_grant g where g.tenant_id = new.tenant_id and g.id = new.reset_grant_id
                  and g.member_id = new.member_id and g.used_at is not null)) then
        raise exception 'session refused: a real session needs a real shop, a live login and the identity''s epoch' using errcode = 'MS007';
      end if;
      if not ops.tenant_open(new.tenant_id) and (ops.tenant_lapsed(new.tenant_id) or not exists (
               select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.role = 'owner')) then
        raise exception 'session refused: a pending shop signs in only its owner, until the sign-up expires' using errcode = 'MS020';
      end if;
    end if;
    new.created_at := now();
    return new;
  end if;
  if to_jsonb(new) - 'revoked_at' <> to_jsonb(old) - 'revoked_at' or old.revoked_at is not null or new.revoked_at is distinct from now()
     or (ctx_actor is distinct from old.member_id and not exists (
           select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active)) then
    raise exception 'session refused: the member or an active owner signs a session out, once' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.session_via() from public;
create trigger via before insert or update on ops.login_session for each row execute function ops.session_via();

-- Capabilities a shop has switched on or off (decision 17, R4 C1): append-only, the latest row per capability wins
-- (`order by at desc, id desc`). Only an active owner switches, as munshi_app; the pack's rows are written in the creation
-- transaction, where no actor is needed. Switching on needs every capability it requires on; switching off is refused
-- while a capability that requires it is on (MS019, CAP4). Two switches of one tenant are serialised under the chain
-- lock, and `at` is the clock after the lock, so two transactions can never both pass against each other's old state.
-- A switch never touches a book row: core reads it, the book guard never does.
create table ops.capability_switch (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  capability text not null references ref.capability,
  is_on boolean not null,
  by uuid,
  at timestamptz not null default now(),
  created_txid bigint not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, by) references ops.member
);

create function ops.capability_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  creating boolean;
  blocker text;
begin
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  creating := exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current());
  if current_user = 'munshi_app' and ctx_actor is not null then
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
      raise exception 'switch refused: only an active owner switches a capability' using errcode = 'MS007';
    end if;
    if not creating and not ops.tenant_open(new.tenant_id) then
      raise exception 'switch refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    end if;
  elsif not (creating and ctx_actor is null and current_user in ('munshi_app', 'munshi_owner')) then
    raise exception 'switch refused: a switch with no actor is written only in the tenant''s creation transaction' using errcode = 'MS018';
  end if;
  if new.is_on then
    select r.requires into blocker from ref.capability_requires r
     where r.capability = new.capability
       and not coalesce((select s.is_on from ops.capability_switch s where s.tenant_id = new.tenant_id and s.capability = r.requires
                          order by s.at desc, s.id desc limit 1), false)
     limit 1;
    if blocker is not null then
      raise exception 'switch refused: % requires %, which is off', new.capability, blocker using errcode = 'MS019';
    end if;
  else
    select r.capability into blocker from ref.capability_requires r
     where r.requires = new.capability
       and coalesce((select s.is_on from ops.capability_switch s where s.tenant_id = new.tenant_id and s.capability = r.capability
                      order by s.at desc, s.id desc limit 1), false)
     limit 1;
    if blocker is not null then
      raise exception 'switch refused: % requires %, so % stays on', blocker, new.capability, new.capability using errcode = 'MS019';
    end if;
  end if;
  new."by" := ctx_actor;
  new.at := clock_timestamp();
  new.created_txid := txid_current();
  return new;
end $$;
revoke execute on function ops.capability_guard() from public;
create trigger guard before insert on ops.capability_switch for each row execute function ops.capability_guard();

create function ops.capability_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new."by" is not null then
    insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
    values (new.tenant_id, new."by", 'capability.switch', 'ops.capability_switch', new.id,
            jsonb_build_object('capability', new.capability, 'is_on', new.is_on));
  end if;
  return null;
end $$;
revoke execute on function ops.capability_audit() from public;
create trigger audit after insert on ops.capability_switch for each row execute function ops.capability_audit();

-- Indexes, one per statement, each asserted in pg_index (G10).
create index shop_hours_latest on ops.shop_hours (tenant_id, shop_id, weekday, effective_from desc, created_at desc);
create index member_active on ops.member (tenant_id, active);
create unique index member_invite_token on ops.member_invite (tenant_id, token_sha256);
create unique index login_subject_tenant on ops.login (provider, subject, tenant_id) where subject is not null and revoked_at is null;
create unique index login_member on ops.login (tenant_id, member_id, provider) where revoked_at is null and erased_at is null;
create unique index login_invite on ops.login (tenant_id, invite_id) where invite_id is not null;
create index login_subject on ops.login (provider, subject);
create unique index reset_grant_token on ops.reset_grant (tenant_id, token_sha256);
create index login_session_member on ops.login_session (tenant_id, member_id);
create index login_session_expired on ops.login_session (tenant_id, expires_at);
create index switch_latest on ops.capability_switch (tenant_id, capability, at desc);

-- RLS and the grants. Global tables carry one permissive policy (the grants decide); tenant tables one tenant policy,
-- plus the jobs role's restrictive delete rule where it may delete.
alter table ops.deployment enable row level security;
alter table ops.deployment force row level security;
create policy global_rows on ops.deployment using (true) with check (true);
revoke all on ops.deployment from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ops.deployment to munshi_app, munshi_public, munshi_jobs;

alter table ops.schema_version enable row level security;
alter table ops.schema_version force row level security;
create policy global_rows on ops.schema_version using (true) with check (true);
revoke all on ops.schema_version from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ops.schema_version to munshi_app, munshi_public, munshi_jobs;

alter table ops.tenant enable row level security;
alter table ops.tenant force row level security;
create policy tenant_isolation on ops.tenant
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.tenant from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (name, count_max_age) on ops.tenant to munshi_app;
grant select (name, business_type, data_class, currency, time_zone) on ops.tenant to munshi_public;
grant select on ops.tenant to munshi_platform;
grant select, update (name) on ops.tenant to munshi_jobs; -- the purge's placeholder name, its guard admits nothing else

alter table ops.tenant_directory enable row level security;
alter table ops.tenant_directory force row level security;
create policy global_rows on ops.tenant_directory using (true) with check (true);
revoke all on ops.tenant_directory from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.tenant_directory to munshi_app;
grant select on ops.tenant_directory to munshi_platform;
grant select (slug, tenant_id) on ops.tenant_directory to munshi_public;
-- The purge of an expired sign-up frees its slug: the guard admits only such a row.
grant select, delete on ops.tenant_directory to munshi_jobs;

alter table ops.member enable row level security;
alter table ops.member force row level security;
create policy tenant_isolation on ops.member
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.member from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (active, deactivated_at, display_name, phone_e164, erased_at) on ops.member to munshi_app;
grant select, update (active, deactivated_at, display_name, phone_e164, erased_at) on ops.member to munshi_jobs;

alter table ops.shop enable row level security;
alter table ops.shop force row level security;
create policy tenant_isolation on ops.shop
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.shop from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (name, area, address, state_code, invoice_series, updated_at) on ops.shop to munshi_app;
grant select (id, name, area) on ops.shop to munshi_public;
grant select, update (name, area, address, updated_at) on ops.shop to munshi_jobs; -- the purge's blanking only

alter table ops.shop_hours enable row level security;
alter table ops.shop_hours force row level security;
create policy tenant_isolation on ops.shop_hours
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.shop_hours from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.shop_hours to munshi_app;
grant select on ops.shop_hours to munshi_public, munshi_jobs;

alter table ops.member_invite enable row level security;
alter table ops.member_invite force row level security;
create policy tenant_isolation on ops.member_invite
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.member_invite from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (used_at, used_txid, email, erased_at) on ops.member_invite to munshi_app;
grant select, update (email, erased_at) on ops.member_invite to munshi_jobs;

alter table ops.login enable row level security;
alter table ops.login force row level security;
create policy global_rows on ops.login using (true) with check (true);
revoke all on ops.login from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (revoked_at, subject, erased_at) on ops.login to munshi_app;
grant select, update (revoked_at, subject, erased_at) on ops.login to munshi_jobs;
grant select (provider, subject) on ops.login to munshi_idp;

alter table ops.subject_summary enable row level security;
alter table ops.subject_summary force row level security;
create policy global_rows on ops.subject_summary using (true) with check (true);
revoke all on ops.subject_summary from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (memberships, highest_role, updated_at) on ops.subject_summary to munshi_app;
grant select (provider, subject, epoch), update (epoch, updated_at) on ops.subject_summary to munshi_public;
grant select, insert, update (is_operator, updated_at) on ops.subject_summary to munshi_platform;
grant select on ops.subject_summary to munshi_idp;
-- The login trigger recounts an identity when the purge revokes its login (as the jobs role).
grant select (provider, subject, memberships, highest_role), insert (provider, subject, memberships, highest_role, updated_at),
  update (memberships, highest_role, updated_at) on ops.subject_summary to munshi_jobs;

alter table ops.reset_grant enable row level security;
alter table ops.reset_grant force row level security;
create policy tenant_isolation on ops.reset_grant
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.reset_grant from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.reset_grant to munshi_app;
grant select, update (used_at, used_txid) on ops.reset_grant to munshi_public;
grant select on ops.reset_grant to munshi_idp;

alter table ops.login_session enable row level security;
alter table ops.login_session force row level security;
create policy tenant_isolation on ops.login_session
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy session_sweep on ops.login_session as restrictive for delete to munshi_jobs
  using (expires_at < now() - interval '30 days' or ops.tenant_lapsed(tenant_id));
revoke all on ops.login_session from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (revoked_at) on ops.login_session to munshi_app;
grant delete on ops.login_session to munshi_jobs;

alter table ops.capability_switch enable row level security;
alter table ops.capability_switch force row level security;
create policy tenant_isolation on ops.capability_switch
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.capability_switch from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.capability_switch to munshi_app;
grant select on ops.capability_switch to munshi_jobs;
