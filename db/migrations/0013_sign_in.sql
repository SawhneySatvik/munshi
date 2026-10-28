-- 0013 · Sign-in (MS-19a; docs/MERCHANTS-DESIGN.md 0013, §6): Google logins bound only through a single-use invite, the
-- sessions a cookie names, and deactivating and erasing a member. Members, logins, invites and sessions are ops rows
-- (the app writes them directly); each change of who may sign in is checked here as well as in core, and refusals are
-- MS007. The agent gets nothing.
set local role munshi_owner;

-- A member who has left: deactivated (one way, by an active owner, never the last active owner), then erased (name and
-- phone to NULL with erased_at, after which the row is frozen) on an active owner's request, or by the daily purge a
-- year after deactivation (§7.6). Re-activation is a new member.
alter table ops.member add column erased_at timestamptz;
alter table ops.member alter column name drop not null;
alter table ops.member add constraint member_named check (erased_at is not null or name is not null);

-- Takes ops.member_guard's per-tenant lock before reading anything, so additions and deactivations of one tenant's
-- members run one at a time: two owners deactivating each other at once leave one active owner (the second waits, then
-- reads the first's commit; a VOLATILE function takes a fresh snapshot per statement).
create function ops.member_deactivate() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended('munshi.member:' || new.tenant_id::text, 0));
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if new.active is distinct from old.active then
    if new.active or actor_role is distinct from 'owner' then
      raise exception 'member refused: an active owner deactivates a member, and a member is never re-activated' using errcode = 'MS007';
    end if;
    if old.role = 'owner' and not exists (
      select 1 from ops.member m where m.tenant_id = new.tenant_id and m.role = 'owner' and m.active and m.id <> new.id) then
      raise exception 'member refused: the last active owner cannot be deactivated' using errcode = 'MS007';
    end if;
  end if;
  -- The purge has no person behind it, so its condition is checked here: the chain's member.deactivate entry (created_at
  -- stamped by audit.chain) is over 365 days old, and no live Google binding remains.
  if old.erased_at is null and new.erased_at is not null then
    if old.active then
      raise exception 'member refused: a member is erased only once deactivated' using errcode = 'MS007';
    elsif ctx_actor is not null and actor_role is distinct from 'owner' then
      raise exception 'member refused: an active owner erases a member' using errcode = 'MS007';
    elsif ctx_actor is null and (
            not exists (select 1 from audit.audit_log a
                         where a.tenant_id = new.tenant_id and a.entity = 'ops.member' and a.entity_id = new.id
                           and a.action = 'member.deactivate' and a.created_at < now() - interval '365 days')
            or exists (select 1 from ops.member_login l
                        where l.tenant_id = new.tenant_id and l.member_id = new.id and l.revoked_at is null and l.erased_at is null)) then
      raise exception 'member refused: the purge erases a member only a year after deactivation, with no live login' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.member_deactivate() from public;

-- 0010's insert entry, plus deactivation and erasure. Ids and the role only, never a name or a phone. The purge's erasure
-- has no actor and leaves no entry: an entry names a person (actor_id is a member, NOT NULL), and a stand-in "system"
-- member would be a member row a session could name. The erased row and the year-old member.deactivate entry the
-- trigger above required are the record.
create or replace function ops.member_audit() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  act text;
  body jsonb := jsonb_build_object('member_id', new.id);
begin
  if tg_op = 'INSERT' then
    act := 'member.add';
    body := jsonb_build_object('member_id', new.id, 'role', new.role);
  elsif old.active and not new.active then
    act := 'member.deactivate';
  elsif old.erased_at is null and new.erased_at is not null and nullif(current_setting('munshi.actor_id', true), '') is not null then
    act := 'member.erase';
  else
    return null;
  end if;
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, act, 'ops.member', new.id, body);
  return null;
end $$;

create trigger erase before update on ops.member for each row execute function ops.only_erase('name', 'phone');
create trigger deactivate before update on ops.member for each row execute function ops.member_deactivate();
create trigger guard_audit_update after update on ops.member for each row execute function ops.member_audit();

-- An invite for one member, to the Google address the owner typed (it must equal the verified email at acceptance, in
-- core). Only the token's sha256 is kept. Using it is one UPDATE, by the invited member before it expires, that stamps
-- used_at and used_txid, nulls the email and sets erased_at; the daily purge nulls an expired one's email the same way.
-- Either way the row then freezes (ops.only_erase), so an invite is used once and no copy of the address lasts.
create table ops.member_invite (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  email text check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  token_sha256 bytea not null check (octet_length(token_sha256) = 32),
  expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_txid bigint,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, created_by) references ops.member,
  constraint invite_email check (erased_at is not null or email is not null),
  constraint invite_used check ((used_at is null) = (used_txid is null)),
  constraint invite_window check (expires_at = created_at + interval '24 hours')
);

-- The caller chooses neither the times nor the transaction: created_at, expires_at, used_at and used_txid are stamped here
-- (a caller-supplied used_txid could name a later transaction and bind a login there).
create function ops.invite_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
  invited_role text;
begin
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'invite refused: the row is not for the current tenant' using errcode = 'MS007';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    select m.role into invited_role from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active;
    if invited_role is null then
      raise exception 'invite refused: the invited member is not an active member' using errcode = 'MS007';
    end if;
    -- As ops.member_guard adds them: an active owner invites anyone, an active manager invites staff.
    if not coalesce(actor_role = 'owner' or (actor_role = 'manager' and invited_role = 'staff'), false) then
      raise exception 'invite refused: an active owner invites, or an active manager invites staff' using errcode = 'MS007';
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
    if ctx_actor is distinct from old.member_id then
      raise exception 'invite refused: only the invited member uses an invite' using errcode = 'MS007';
    elsif now() >= old.expires_at then
      raise exception 'invite refused: the invite has expired' using errcode = 'MS007';
    elsif new.erased_at is null then
      raise exception 'invite refused: using an invite erases its email' using errcode = 'MS007';
    end if;
    new.used_at := now();
    new.used_txid := txid_current();
  elsif old.erased_at is null and new.erased_at is not null and now() < old.expires_at then
    raise exception 'invite refused: an unused invite is erased once it has expired' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.invite_guard() from public;

create trigger erase before update on ops.member_invite for each row execute function ops.only_erase('email');
create trigger guard before insert or update on ops.member_invite for each row execute function ops.invite_guard();

-- Global, because a Google subject names no tenant: the memberships lookup reads it before any tenant context exists.
-- It holds nothing personal beyond the provider's opaque subject (no email: a global table has no RLS). A binding is
-- revoked (revoked_at) or erased (subject to NULL with erased_at, then frozen); the subject is never refilled, so a member
-- is bound to another account only by a new row, with a new invite: each binding names the invite it used, and an
-- invite binds once (no bind, revoke and bind again in one transaction). One live binding per member and provider, and
-- one live member per subject in a tenant (a revoked binding frees its subject: binding it again still takes an invite).
create table ops.member_login (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google')),
  subject text check (char_length(subject) between 1 and 255),
  tenant_id uuid not null,
  member_id uuid not null,
  invite_id uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  erased_at timestamptz,
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, invite_id) references ops.member_invite,
  constraint login_subject check (erased_at is not null or subject is not null)
);

-- No RLS here, so the tenant is checked on every write: a binding is made by the member themself, in the transaction
-- that used the invite it names (an invite of theirs), and revoked or erased within its own tenant by that member or an
-- active owner.
create function ops.login_bind() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if new.tenant_id is distinct from ctx_tenant or (tg_op = 'UPDATE' and old.tenant_id is distinct from ctx_tenant) then
    raise exception 'login refused: the binding is not for the current tenant' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    if new.member_id is distinct from ctx_actor then
      raise exception 'login refused: a member binds their own login' using errcode = 'MS007';
    end if;
    if new.revoked_at is not null or new.erased_at is not null then
      raise exception 'login refused: a new binding is live' using errcode = 'MS007';
    end if;
    perform 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active;
    if not found then
      raise exception 'login refused: the member is not an active member' using errcode = 'MS007';
    end if;
    perform 1 from ops.member_invite i
     where i.tenant_id = new.tenant_id and i.id = new.invite_id and i.member_id = new.member_id and i.used_txid = txid_current();
    if not found then
      raise exception 'login refused: no invite for this member was used in this transaction' using errcode = 'MS007';
    end if;
    new.created_at := now();
    return new;
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if ctx_actor is distinct from old.member_id and actor_role is distinct from 'owner' then
    raise exception 'login refused: the member or an active owner revokes or erases a binding' using errcode = 'MS007';
  end if;
  if new.revoked_at is distinct from old.revoked_at and (old.revoked_at is not null or new.revoked_at is distinct from now()) then
    raise exception 'login refused: a binding is revoked once' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.login_bind() from public;

create function ops.login_audit() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'member.login_bound', 'ops.member_login', new.id,
          jsonb_build_object('member_id', new.member_id, 'provider', new.provider));
  return null;
end $$;
revoke execute on function ops.login_audit() from public;

create trigger erase before update on ops.member_login for each row execute function ops.only_erase('subject');
create trigger bind before insert or update on ops.member_login for each row execute function ops.login_bind();
create trigger guard_audit after insert on ops.member_login for each row execute function ops.login_audit();

-- The session a cookie names (§6.3): how it was minted, until when, and whether it was signed out. A demo-minted session
-- never exists for a live tenant: the database holds the fence as well as core (#12).
create table ops.login_session (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  via text not null check (via in ('demo', 'google')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  -- 14 days, absolute, for a Google session (a shop phone should not sign in daily); 12 hours for a demo one
  constraint session_window check (expires_at > created_at
    and expires_at <= created_at + case via when 'google' then interval '14 days' else interval '12 hours' end)
);

-- A member opens their own session; the member or an active owner signs it out, once. A tenant that cannot be read
-- counts as live. A Google session exists only on the live deployment, for a member with a live Google binding, so on
-- the demo database every session is a demo one. (0017: a site release is refused whenever ops.deployment is not live.)
create function ops.login_session_via() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  cls text;
  actor_role text;
begin
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'session refused: the row is not for the current tenant' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    select t.data_class into cls from ops.tenant t where t.tenant_id = new.tenant_id;
    if new.via = 'demo' and cls is distinct from 'synthetic' and cls is distinct from 'showcase' then
      raise exception 'session refused: a demo sign-in opens no session on a live tenant' using errcode = 'MS007';
    end if;
    if new.via = 'google' and ((select d.kind from ops.deployment d) is distinct from 'live'
         or not exists (select 1 from ops.member_login l
                         where l.tenant_id = new.tenant_id and l.member_id = new.member_id and l.revoked_at is null and l.erased_at is null)) then
      raise exception 'session refused: a Google session needs the live deployment and a live binding' using errcode = 'MS007';
    end if;
    if new.member_id is distinct from ctx_actor or new.revoked_at is not null then
      raise exception 'session refused: a member opens their own session' using errcode = 'MS007';
    end if;
    perform 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active;
    if not found then
      raise exception 'session refused: the member is not an active member' using errcode = 'MS007';
    end if;
    new.created_at := now();
    return new;
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
    if old.revoked_at is not null or new.revoked_at is distinct from now()
       or (ctx_actor is distinct from old.member_id and actor_role is distinct from 'owner') then
      raise exception 'session refused: the member or an active owner signs a session out, once' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.login_session_via() from public;

create trigger via before insert or update on ops.login_session for each row execute function ops.login_session_via();

alter table ops.member_invite enable row level security;
alter table ops.member_invite force row level security;
create policy tenant_isolation on ops.member_invite
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.login_session enable row level security;
alter table ops.login_session force row level security;
create policy tenant_isolation on ops.login_session
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- ops.member gains column UPDATEs (0002 granted none): deactivation and erasure, as the triggers above allow. The whole
-- block is restated so the table's privileges read in one place.
revoke all on ops.member from public, munshi_app, munshi_agent;
grant select, insert, update (active, name, phone, erased_at) on ops.member to munshi_app;

revoke all on ops.member_invite from public, munshi_app, munshi_agent;
grant select, insert, update (used_at, used_txid, email, erased_at) on ops.member_invite to munshi_app;

revoke all on ops.member_login from public, munshi_app, munshi_agent;
grant select, insert, update (revoked_at, subject, erased_at) on ops.member_login to munshi_app;

revoke all on ops.login_session from public, munshi_app, munshi_agent;
grant select, insert, update (revoked_at) on ops.login_session to munshi_app;

create unique index member_invite_token on ops.member_invite (tenant_id, token_sha256);
create unique index member_login_subject on ops.member_login (provider, subject, tenant_id) where subject is not null and revoked_at is null;
create unique index member_login_invite on ops.member_login (tenant_id, invite_id);
create unique index member_login_member on ops.member_login (tenant_id, member_id, provider) where revoked_at is null and erased_at is null;
create index login_session_member on ops.login_session (tenant_id, member_id);
