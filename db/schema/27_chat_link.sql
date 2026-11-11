-- 27 · A member's chat account: how a message in a shop's staff group is known to come from that member.
--
-- A signed-in member asks for a one-time code, and posts it from their chat account. That ties the account the chat
-- bridge names to the session that asked for the code. The row then stands for that account until it expires, is
-- revoked, or the member is deactivated.
--
-- A row is opened by the member themselves (actor = member_id) as munshi_app, with no account yet. The code is stored
-- only as its sha256, lives 30 minutes, and goes the moment it is used. Linking fills the account once, from a live
-- unused row, and starts the link's 14 days; a linked account never moves to another. One chat account stands for one
-- member of a shop at a time.
--
-- The link carries the via and the identity epoch of the session that asked for it, so a sample shop's link stays a
-- sample session, and a reset of a real identity ends it (core's chatSession, which checks them as resumeSession does).
-- Nothing here decides what the member may do: a decision made from chat still runs as that member, and the database
-- still refuses a member who may not approve the draft's command.
set local role munshi_owner;

create table ops.chat_link (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid not null,
  via text not null check (via in ('demo', 'sandbox', 'real')),
  subject_epoch int check (subject_epoch >= 0),
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  channel text check (channel ~ '^[a-z0-9_-]{1,32}$'),
  sender_ref text check (char_length(sender_ref) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  linked_at timestamptz,
  revoked_at timestamptz,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  check ((via = 'real') = (subject_epoch is not null)),
  check (expires_at > created_at),
  check (linked_at is null or code_hash is null),
  check ((linked_at is null and sender_ref is null) or (linked_at is not null and (sender_ref is not null or erased_at is not null)))
);

create function ops.chat_link_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or new.member_id is distinct from ctx_actor
       or new.code_hash is null or new.sender_ref is not null or new.channel is not null or new.linked_at is not null
       or new.revoked_at is not null or new.erased_at is not null
       or new.expires_at > now() + interval '30 minutes'
       or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = new.member_id and m.active) then
      raise exception 'chat link refused: an active member opens their own, with a code and no account yet' using errcode = 'MS007';
    end if;
    return new;
  end if;
  -- A member's erasure (ops.member_chat_link) is the one change that may empty an account.
  if new.erased_at is not null and old.erased_at is null then
    if pg_trigger_depth() < 2 then
      raise exception 'chat link refused: an account is erased only with its member' using errcode = 'MS007';
    end if;
    return new;
  end if;
  if new.sender_ref is distinct from old.sender_ref or new.channel is distinct from old.channel then
    if old.sender_ref is not null or old.linked_at is not null or old.revoked_at is not null or old.expires_at <= now()
       or new.sender_ref is null or new.channel is null then
      raise exception 'chat link refused: an account is linked once, from a live unused code' using errcode = 'MS007';
    end if;
    new.code_hash := null;
    new.linked_at := now();
    new.expires_at := now() + interval '14 days';
    return new;
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    if old.revoked_at is not null or new.revoked_at is null then
      raise exception 'chat link refused: a link is revoked once' using errcode = 'MS007';
    end if;
    -- The member, an active owner, the member's own deactivation, or anyone once the link has lapsed.
    if old.expires_at > now() and pg_trigger_depth() < 2 and ctx_actor is distinct from old.member_id
       and not exists (select 1 from ops.member m where m.tenant_id = old.tenant_id and m.id = ctx_actor and m.active and m.role = 'owner') then
      raise exception 'chat link refused: a member revokes their own, or an owner does' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.chat_link_guard() from public;
create trigger guard before insert or update on ops.chat_link for each row execute function ops.chat_link_guard();

-- A deactivated member's links end with them, and an erased member's account goes with them, in the same UPDATE.
create function ops.member_chat_link() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if old.active and not new.active then
    update ops.chat_link l set revoked_at = now()
     where l.tenant_id = new.tenant_id and l.member_id = new.id and l.revoked_at is null;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    update ops.chat_link l set sender_ref = null, erased_at = now(), revoked_at = coalesce(l.revoked_at, now())
     where l.tenant_id = new.tenant_id and l.member_id = new.id and l.erased_at is null;
  end if;
  return null;
end $$;
revoke execute on function ops.member_chat_link() from public;
create trigger chat_link after update on ops.member for each row execute function ops.member_chat_link();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create unique index chat_link_account on ops.chat_link (tenant_id, channel, sender_ref) where revoked_at is null and sender_ref is not null;
create unique index chat_link_code on ops.chat_link (tenant_id, code_hash) where code_hash is not null;
create index chat_link_member on ops.chat_link (tenant_id, member_id);

alter table ops.chat_link enable row level security;
alter table ops.chat_link force row level security;
create policy tenant_isolation on ops.chat_link
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.chat_link from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (channel, sender_ref, revoked_at, erased_at) on ops.chat_link to munshi_app;
-- The purge of a lapsed sign-up deactivates and erases its members, and the jobs role runs it.
grant select, update (sender_ref, revoked_at, erased_at) on ops.chat_link to munshi_jobs;

-- 26's loop ran before this table existed, so it attaches its own z_version; 29 reaches it for a_open.
create constraint trigger z_version after insert or update or delete on ops.chat_link deferrable initially deferred
  for each row execute function ops.version_bump();
