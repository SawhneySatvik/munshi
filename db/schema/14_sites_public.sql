-- 14 · Sites and the public (BLUEPRINT §2.10.8, §8.4, §8.8): a shop's site, its keys, looks and releases, opted-in
-- staff profiles, public requests, live bookings with their contact rows, and piece holds; and the public role's read of
-- published documents (ops.document, 04). All ops: a hold or a request blocks the calendar or a piece but changes no
-- book; a person confirms, and that is a command. Every transition is role-shaped (§2.3): the public inserts and moves
-- its own holds (its token checked here), a member handles, the jobs role expires and purges.
--
-- On a demo deployment every public request's name, phone and note are the samples ('Sample customer',
-- '+910000000000', NULL): the name and note are pinned here and any other phone is refused (S10). Versions must be the
-- site's current ones. No column here names a table of a later file (a sale names a booking or reservation from 15).
--
-- Locks (R4 W2): the chain lock (class 1) first, then an IP's holds (8) or a stylist's day (9).
set local role munshi_owner;

-- One site per tenant, serving every branch.
create table ops.site (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  intake text not null default 'open' check (intake in ('open', 'paused')),
  booking_mode text not null default 'none' check (booking_mode in ('none', 'request', 'slots')),
  origins text[] not null default '{}' check (cardinality(origins) <= 10),
  privacy_version text not null check (privacy_version ~ '^[a-z0-9_.-]{1,40}$'),
  consent_version text not null check (consent_version ~ '^[a-z0-9_.-]{1,40}$'),
  hold_minutes int not null default 10 check (hold_minutes between 2 and 30),
  reservation_hours int not null default 48 check (reservation_hours between 1 and 168),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member
);

-- An active owner sets the site. A booking mode other than none needs the bookings capability on (R4 C1); an origin is
-- https://host[:port], or http://localhost:<port> off live. Audited.
create function ops.site_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  live boolean := coalesce((select d.kind from ops.deployment d), 'demo') = 'live';
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
    raise exception 'site refused: an active owner sets the site' using errcode = 'MS007';
  end if;
  if exists (select 1 from unnest(new.origins) o
              where not (o ~ '^https://[a-z0-9.-]{1,200}(:[0-9]{1,5})?$' or (not live and o ~ '^http://localhost:[0-9]{1,5}$'))) then
    raise exception 'site refused: an origin is https://host[:port], or http://localhost:<port> off live' using errcode = 'MS007';
  end if;
  if new.booking_mode <> 'none' and not coalesce((
       select s.is_on from ops.capability_switch s where s.tenant_id = new.tenant_id and s.capability = 'bookings'
        order by s.at desc, s.id desc limit 1), false) then
    raise exception 'site refused: a booking mode needs the bookings capability on' using errcode = 'MS019';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := ctx_actor;
    new.created_at := now();
  elsif new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'site refused: created_by and created_at never change' using errcode = 'MS010';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ops.site_guard() from public;
create trigger guard before insert or update on ops.site for each row execute function ops.site_guard();

-- Publishable keys, kept as their sha256; revoked once by an active owner, never restored.
create table ops.site_key (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid not null,
  key_sha256 bytea not null check (octet_length(key_sha256) = 32),
  prefix text not null check (prefix ~ '^mpk_[a-z0-9-]{3,40}_[A-Za-z0-9]{4}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, revoked_by) references ops.member,
  check ((revoked_at is null) = (revoked_by is null))
);

create function ops.site_key_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
    raise exception 'site key refused: an active owner makes and revokes keys' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    if new.revoked_at is not null then
      raise exception 'site key refused: a new key is live' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
    return new;
  end if;
  if old.revoked_at is not null or new.revoked_at is null
     or to_jsonb(new) - 'revoked_at' - 'revoked_by' <> to_jsonb(old) - 'revoked_at' - 'revoked_by' then
    raise exception 'site key refused: a key is revoked once, and never restored' using errcode = 'MS010';
  end if;
  new.revoked_at := now();
  new.revoked_by := ctx_actor;
  return new;
end $$;
revoke execute on function ops.site_key_guard() from public;
create trigger guard before insert or update on ops.site_key for each row execute function ops.site_key_guard();

-- The look as data, append-only revisions (§5.5, §9). look_check holds the shape in the database too: only the fixed
-- token names (one set, or a light and a dark set), colours as #rrggbb, every other value a plain string with no quote,
-- bracket, colon or semicolon (so no url() or other CSS reaches a page); a bounded profile; art naming the tenant's own
-- art documents. A font pair is a palette code.
create table ops.site_look (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid not null,
  tokens jsonb not null check (jsonb_typeof(tokens) = 'object' and octet_length(tokens::text) <= 16384),
  font_pair text not null check (font_pair ~ '^[a-z0-9_]{2,40}$'),
  profile jsonb not null default '{}' check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 32768),
  art jsonb not null default '{}' check (jsonb_typeof(art) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, created_by) references ops.member
);

create function ops.look_check() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  names text[] := array['--ground', '--surface', '--ink', '--ink-muted', '--hairline', '--accent', '--accent-ink', '--signal', '--ok',
                        '--warn', '--danger', '--radius-card', '--radius-chip', '--space-1', '--space-2', '--space-3', '--space-4',
                        '--space-5', '--space-6', '--space-7', '--space-8', '--figure-xl', '--figure-l', '--figure-m',
                        '--font-display', '--font-text', '--font-figures', '--font-deva-display', '--font-deva-text',
                        '--motion-quick', '--motion-sheet'];
  colours text[] := array['--ground', '--surface', '--ink', '--ink-muted', '--hairline', '--accent', '--accent-ink', '--signal', '--ok',
                          '--warn', '--danger'];
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
    raise exception 'look refused: an active owner or manager sets the look' using errcode = 'MS007';
  end if;
  -- One set of tokens, or {light, dark} sets; every key a fixed name, colours #rrggbb, other values plain strings.
  if exists (
       with sets as (
         select new.tokens as v where not (new.tokens ?| array['light', 'dark'])
         union all
         select e.value from jsonb_each(new.tokens) e where new.tokens ?| array['light', 'dark'])
       select 1 from sets s
        where jsonb_typeof(s.v) <> 'object'
           or exists (select 1 from jsonb_each(s.v) t
                       where not (t.key = any (names)) or jsonb_typeof(t.value) <> 'string'
                          or (t.key = any (colours) and (t.value #>> '{}') !~ '^#[0-9a-f]{6}$')
                          or (t.value #>> '{}') !~ '^[A-Za-z0-9 #.,%_-]{1,40}$'))
     or (new.tokens ?| array['light', 'dark'] and exists (select 1 from jsonb_object_keys(new.tokens) k where k not in ('light', 'dark'))) then
    raise exception 'look refused: tokens are the fixed names, colours #rrggbb, other values plain strings' using errcode = 'MS007';
  end if;
  if exists (select 1 from jsonb_each(new.art) a
              where a.key !~ '^[a-z_]{2,40}$' or jsonb_typeof(a.value) <> 'string'
                 or (a.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 or not exists (select 1 from ops.document d
                                 where d.tenant_id = new.tenant_id and d.id = (a.value #>> '{}')::uuid and d.kind = 'art' and d.erased_at is null)) then
    raise exception 'look refused: art names this tenant''s own art documents' using errcode = 'MS007';
  end if;
  new.created_by := ctx_actor;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.look_check() from public;
create trigger look_check before insert on ops.site_look for each row execute function ops.look_check();

-- A published release: the look and the release snapshots of its reads, minted in this transaction (B8). Off the live
-- deployment only the owner role publishes (the reset); on live, an active owner from a real session (never a demo or
-- sandbox one, S9). Each snapshot is pinned by the release.
create table ops.site_release (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid not null,
  look_id uuid not null,
  snapshots jsonb not null check (jsonb_typeof(snapshots) = 'object'),
  published_by uuid,
  published_at timestamptz not null default now(),
  created_txid bigint not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, look_id) references ops.site_look,
  foreign key (tenant_id, published_by) references ops.member
);

create function ops.release_check() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  live boolean := coalesce((select d.kind from ops.deployment d), 'demo') = 'live';
begin
  if coalesce(nullif(current_setting('munshi.via', true), ''), 'none') in ('demo', 'sandbox') then
    raise exception 'release refused: a demo or sandbox session never publishes' using errcode = 'MS010';
  end if;
  if live then
    if current_user <> 'munshi_app' or nullif(current_setting('munshi.via', true), '') is distinct from 'real' or not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
      raise exception 'release refused: on live an active owner publishes from a real session' using errcode = 'MS007';
    end if;
  elsif current_user <> 'munshi_owner' then
    raise exception 'release refused: off live only the owner role publishes' using errcode = 'MS010';
  end if;
  if not exists (select 1 from ops.site_look l where l.tenant_id = new.tenant_id and l.id = new.look_id and l.site_id = new.site_id) then
    raise exception 'release refused: the look is this site''s' using errcode = 'MS007';
  end if;
  if exists (select 1 from jsonb_each(new.snapshots) e
              where jsonb_typeof(e.value) <> 'string'
                 or (e.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 or not exists (select 1 from snap.snapshot s
                                 where s.tenant_id = new.tenant_id and s.id = (e.value #>> '{}')::uuid and s.purpose = 'release'
                                   and s.query_name = e.key and s.query_name like 'site.%' and s.created_txid = txid_current())) then
    raise exception 'release refused: each snapshot is a site.* release read of this tenant, minted in this transaction' using errcode = 'MS006';
  end if;
  new.published_by := case when current_user = 'munshi_app' then ctx_actor end;
  new.published_at := now();
  new.created_txid := txid_current();
  return new;
end $$;
revoke execute on function ops.release_check() from public;
create trigger release_check before insert on ops.site_release for each row execute function ops.release_check();

create function ops.release_pin() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into snap.pin (tenant_id, snapshot_id, holder, holder_id)
  select distinct new.tenant_id, (e.value #>> '{}')::uuid, 'release', new.id from jsonb_each(new.snapshots) e
  on conflict do nothing;
  if new.published_by is not null then
    insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
    values (new.tenant_id, new.published_by, 'site.publish', 'ops.site_release', new.id, jsonb_build_object('release_id', new.id));
  end if;
  return null;
end $$;
revoke execute on function ops.release_pin() from public;
create trigger pin after insert on ops.site_release for each row execute function ops.release_pin();

-- The only personal data a public page shows, opt-in per person (the owner attests the person agreed); erasable.
create table ops.staff_public (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  shop_id uuid not null,
  display_name text check (char_length(display_name) between 1 and 40),
  blurb text check (char_length(blurb) <= 200),
  art_document_id uuid,
  shown boolean not null default true,
  consent_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, art_document_id) references ops.document,
  foreign key (tenant_id, created_by) references ops.member,
  check (erased_at is not null or display_name is not null),
  check (erased_at is null or not shown)
);

create function ops.staff_public_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
    raise exception 'staff profile refused: an active owner shows a staff member, with their agreement' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    if new.consent_at > now() or new.erased_at is not null then
      raise exception 'staff profile refused: the agreement is past, and a new profile is not erased' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
  end if;
  return new;
end $$;
revoke execute on function ops.staff_public_guard() from public;
create trigger erase before update on ops.staff_public for each row execute function ops.only_erase('display_name', 'blurb');
create trigger guard before insert or update on ops.staff_public for each row execute function ops.staff_public_guard();

-- An enquiry or a booking request from the site or WhatsApp. Inserted by the public as `new`, with no actor, while
-- intake is open and the versions are current; handled once by an active member; closed by the jobs role after 30 days
-- open and erased 90 days after it closed (7 on a demo).
create table ops.site_request (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid not null,
  shop_id uuid not null,
  kind text not null check (kind in ('enquiry', 'booking_request')),
  source text not null check (source in ('site', 'whatsapp')),
  contact_name text check (char_length(contact_name) between 1 and 80),
  contact_phone_e164 text check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  item_ids uuid[] not null default '{}' check (cardinality(item_ids) <= 3),
  preferred_on date,
  time_window text check (time_window in ('morning', 'afternoon', 'evening')),
  note text check (char_length(note) <= 500),
  wa_updates boolean not null default false,
  notice_version text not null,
  consent_version text not null,
  ip_hash bytea check (octet_length(ip_hash) = 32),
  status text not null default 'new' check (status in ('new', 'confirmed', 'declined', 'spam', 'closed')),
  handled_by uuid,
  handled_at timestamptz,
  customer_id uuid,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, handled_by) references ops.member,
  foreign key (tenant_id, customer_id) references books.customer,
  check (erased_at is not null or (contact_name is not null and contact_phone_e164 is not null)),
  check ((status = 'new') = (handled_at is null))
);

-- The shared rules of a public insert: the site takes requests, the versions are its current ones, and on a demo the
-- name and note are the samples and no other phone is stored. tg_argv[0] names the request kind for the message.
create function ops.public_intake() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  r jsonb := to_jsonb(new);
  s ops.site;
begin
  if current_user <> 'munshi_public' or nullif(current_setting('munshi.actor_id', true), '') is not null then
    raise exception '% refused: the public inserts it, with no actor', tg_argv[0] using errcode = 'MS018';
  end if;
  select * into s from ops.site x where x.tenant_id = new.tenant_id and x.id = (r ->> 'site_id')::uuid;
  if s.id is null or s.intake <> 'open' then
    raise exception '% refused: the site takes no requests now', tg_argv[0] using errcode = 'MS007';
  end if;
  if r ->> 'notice_version' is distinct from s.privacy_version or r ->> 'consent_version' is distinct from s.consent_version then
    raise exception '% refused: the notice and consent versions are not the site''s current ones', tg_argv[0] using errcode = 'MS007';
  end if;
  if coalesce((select d.kind from ops.deployment d), 'demo') <> 'live' then
    if r ->> 'contact_phone_e164' is distinct from '+910000000000' then
      raise exception '% refused: a demo stores only the sample phone', tg_argv[0] using errcode = 'MS010';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('contact_name', 'Sample customer', 'note', null));
  end if;
  return new;
end $$;
revoke execute on function ops.public_intake() from public;

create function ops.request_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  keep interval := case when coalesce((select d.kind from ops.deployment d), 'demo') = 'live' then interval '90 days' else interval '7 days' end;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'new' or new.handled_by is not null or new.customer_id is not null or new.erased_at is not null then
      raise exception 'request refused: a new request is new and unhandled' using errcode = 'MS007';
    end if;
    new.created_at := now();
    return new;
  end if;
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'request refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if new.status is distinct from old.status then
    if current_user = 'munshi_app' then
      if old.status <> 'new' or new.status not in ('confirmed', 'declined', 'spam') or not exists (
           select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
        raise exception 'request refused: an active member handles a new request once' using errcode = 'MS007';
      end if;
      new.handled_by := ctx_actor;
    elsif current_user = 'munshi_jobs' then
      if old.status <> 'new' or new.status <> 'closed' or old.created_at > now() - interval '30 days' then
        raise exception 'request refused: the jobs role closes a request left open 30 days' using errcode = 'MS007';
      end if;
      new.handled_by := null;
    else
      raise exception 'request refused: % does not handle requests', current_user using errcode = 'MS018';
    end if;
    new.handled_at := now();
  elsif new.handled_by is distinct from old.handled_by or new.handled_at is distinct from old.handled_at
        or (new.customer_id is distinct from old.customer_id and old.status <> 'new') then
    raise exception 'request refused: who handled it and when are set by the handling' using errcode = 'MS010';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
        raise exception 'request refused: a person''s erasure of a request is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'request refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif old.status = 'new' or old.handled_at > now() - keep then
      raise exception 'request refused: the purge erases a request 90 days after it closed (7 on a demo)' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.request_flow() from public;
create trigger erase before update on ops.site_request for each row execute function ops.only_erase('contact_name', 'contact_phone_e164', 'note', 'ip_hash');
create trigger flow before insert or update on ops.site_request for each row execute function ops.request_flow();
create trigger intake before insert on ops.site_request for each row execute function ops.public_intake('request');

-- A slot on a stylist's calendar: a public hold, a request, a confirmed booking. No personal column; the contact is
-- ops.booking_contact. The exclusion (BK1) and the calendar check (BK2: the named roster row in effect that day at that
-- shop, no leave, no holiday, inside the shop's hours, the service's duration) are the database's; holds are capped
-- (HOLD1: one live per device, three per IP hash, two per stylist and day) and move only with their token.
create table ops.booking (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid,
  shop_id uuid not null,
  staff_id uuid not null,
  service_item_id uuid not null,
  service_kind text generated always as ('service') stored,
  during tstzrange not null check (not lower_inf(during) and not upper_inf(during) and lower_inc(during) and not upper_inc(during)
                                   and upper(during) - lower(during) <= interval '8 hours'),
  state text not null check (state in ('held', 'requested', 'confirmed', 'declined', 'cancelled', 'expired', 'done', 'no_show')),
  source text not null check (source in ('site', 'app', 'whatsapp')),
  expires_at timestamptz,
  hold_token_sha256 bytea check (octet_length(hold_token_sha256) = 32),
  ip_hash bytea check (octet_length(ip_hash) = 32),
  device_hash bytea check (octet_length(device_hash) = 32),
  shift_pattern_id uuid,
  shift_change_id uuid,
  customer_id uuid,
  handled_by uuid,
  handled_at timestamptz,
  reason text,
  reason_use text generated always as ('decline') stored,
  requested_txid bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, service_item_id, service_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, shift_pattern_id) references books.shift_pattern,
  foreign key (tenant_id, shift_change_id) references books.shift_change,
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, handled_by) references ops.member,
  foreign key (reason, reason_use) references ref.reason_use,
  check (num_nonnulls(shift_pattern_id, shift_change_id) = 1),
  check ((source = 'app') = (hold_token_sha256 is null)),
  constraint booking_no_overlap exclude using gist (tenant_id with =, staff_id with =, during with &&)
    where (state in ('held', 'requested', 'confirmed'))
);

create function ops.booking_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  tz text;
  local_start timestamp;
  local_end timestamp;
  the_day date;
  fits boolean;
  st ops.site;
  hours ops.shop_hours;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'booking refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if current_user = 'munshi_public' then
      select * into st from ops.site s where s.tenant_id = new.tenant_id and s.id = new.site_id;
      if new.state <> 'held' or new.source = 'app' or new.customer_id is not null or new.hold_token_sha256 is null
         or new.ip_hash is null or new.device_hash is null then
        raise exception 'booking refused: the public places a hold, with its token, IP and device hashes' using errcode = 'MS018';
      end if;
      if st.id is null or st.intake <> 'open' or st.booking_mode <> 'slots' then
        raise exception 'booking refused: the site takes no live bookings now' using errcode = 'MS007';
      end if;
      perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
      perform pg_advisory_xact_lock(8, hashtext(new.tenant_id::text || encode(new.ip_hash, 'hex')));
      if (select count(*) from ops.booking b where b.tenant_id = new.tenant_id and b.ip_hash = new.ip_hash
            and b.state = 'held' and b.expires_at > now()) >= 3 then
        raise exception 'booking refused: this network already holds three slots' using errcode = 'MS015';
      end if;
      new.expires_at := now() + make_interval(mins => st.hold_minutes);
    elsif current_user = 'munshi_app' then
      if not exists (select 1 from ops.member m
                      where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active)
         or new.source <> 'app' or new.state <> 'confirmed' then
        raise exception 'booking refused: an active owner or manager makes a confirmed booking in the app' using errcode = 'MS007';
      end if;
      new.handled_by := ctx_actor;
      new.handled_at := now();
      new.expires_at := null;
    else
      raise exception 'booking refused: % does not make bookings', current_user using errcode = 'MS018';
    end if;

    -- The calendar, in the tenant's zone: one local day, the named roster row being the one in effect.
    tz := (select t.time_zone from ops.tenant t where t.tenant_id = new.tenant_id);
    local_start := lower(new.during) at time zone tz;
    local_end := upper(new.during) at time zone tz;
    the_day := local_start::date;
    if current_user = 'munshi_public' then
      perform pg_advisory_xact_lock(9, hashtext(new.tenant_id::text || new.staff_id::text || the_day::text));
      if (select count(*) from ops.booking b where b.tenant_id = new.tenant_id and b.staff_id = new.staff_id and b.state = 'held'
            and b.expires_at > now() and (lower(b.during) at time zone tz)::date = the_day) >= 2 then
        raise exception 'booking refused: this stylist''s day already has two holds' using errcode = 'MS015';
      end if;
    end if;
    if new.shift_change_id is not null then
      fits := exists (
        select 1 from books.shift_change c
         where c.tenant_id = new.tenant_id and c.id = new.shift_change_id and c.staff_id = new.staff_id and c.day = the_day
           and c.shop_id = new.shop_id and not c.off and c.starts <= local_start::time and c.ends >= local_end::time
           and c.id = (select x.id from books.shift_change x where x.tenant_id = new.tenant_id and x.staff_id = new.staff_id
                        and x.day = the_day order by x.created_at desc, x.id desc limit 1));
    else
      fits := not exists (select 1 from books.shift_change x where x.tenant_id = new.tenant_id and x.staff_id = new.staff_id and x.day = the_day)
        and exists (
          select 1 from books.shift_pattern p
           where p.tenant_id = new.tenant_id and p.id = new.shift_pattern_id and p.staff_id = new.staff_id and p.shop_id = new.shop_id
             and not p.off and p.starts <= local_start::time and p.ends >= local_end::time
             and p.id = (select x.id from books.shift_pattern x
                          where x.tenant_id = new.tenant_id and x.staff_id = new.staff_id and x.weekday = extract(isodow from the_day)
                            and x.effective_from <= the_day
                          order by x.effective_from desc, x.created_at desc, x.id desc limit 1));
    end if;
    select * into hours from ops.shop_hours h
     where h.tenant_id = new.tenant_id and h.shop_id = new.shop_id and h.weekday = extract(isodow from the_day) and h.effective_from <= the_day
     order by h.effective_from desc, h.created_at desc, h.id desc limit 1;
    fits := fits and local_end::date = the_day
      and hours.id is not null and not hours.closed and hours.opens <= local_start::time and hours.closes >= local_end::time
      and not exists (select 1 from books.leave l
                       where l.tenant_id = new.tenant_id and l.staff_id = new.staff_id and l.reverses_id is null
                         and the_day between l.first_day and l.last_day
                         and not exists (select 1 from books.leave r where r.tenant_id = l.tenant_id and r.reverses_id = l.id))
      and not exists (select 1 from books.holiday h
                       where h.tenant_id = new.tenant_id and h.day = the_day and h.reverses_id is null
                         and (h.shop_id is null or h.shop_id = new.shop_id)
                         and not exists (select 1 from books.holiday r where r.tenant_id = h.tenant_id and r.reverses_id = h.id))
      and exists (select 1 from (select v.duration_min, v.sellable from books.item_revision v
                                  where v.tenant_id = new.tenant_id and v.item_id = new.service_item_id and v.effective_from <= now()
                                  order by v.effective_from desc, v.created_at desc, v.id desc limit 1) cur
                   where cur.sellable and upper(new.during) - lower(new.during) = make_interval(mins => cur.duration_min));
    if not fits then
      raise exception 'booking refused: the slot is outside the calendar (roster, leave, holiday, shop hours or the service''s length)'
        using errcode = 'MS015';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if old.state in ('declined', 'cancelled', 'expired', 'done', 'no_show') then
    raise exception 'booking refused: a % booking is final', old.state using errcode = 'MS010';
  end if;
  if new.state is not distinct from old.state then
    raise exception 'booking refused: a booking changes only its state' using errcode = 'MS010';
  end if;
  if current_user = 'munshi_public' then
    if old.state <> 'held' then
      raise exception 'booking refused: the public moves only its own hold' using errcode = 'MS018';
    elsif new.state = 'expired' then
      if old.expires_at > now() then
        raise exception 'booking refused: a hold expires only after expires_at' using errcode = 'MS015';
      end if;
    elsif new.state in ('requested', 'cancelled') then
      if sha256(convert_to(coalesce(nullif(current_setting('munshi.hold_token', true), ''), ''), 'UTF8')) <> old.hold_token_sha256 then
        raise exception 'booking refused: the hold token does not match' using errcode = 'MS018';
      end if;
      if new.state = 'requested' then
        if old.expires_at <= now() then
          raise exception 'booking refused: the hold has expired' using errcode = 'MS015';
        end if;
        new.requested_txid := txid_current();
      end if;
    else
      raise exception 'booking refused: the public moves a hold to requested, cancelled or expired' using errcode = 'MS018';
    end if;
  elsif current_user = 'munshi_jobs' then
    if old.state <> 'held' or new.state <> 'expired' or old.expires_at > now() then
      raise exception 'booking refused: the jobs role expires a hold after expires_at' using errcode = 'MS015';
    end if;
  elsif current_user = 'munshi_app' then
    if not exists (select 1 from ops.member m
                    where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
      raise exception 'booking refused: an active owner or manager handles a booking' using errcode = 'MS007';
    end if;
    if not ((old.state = 'requested' and new.state in ('confirmed', 'declined', 'cancelled'))
            or (old.state = 'confirmed' and new.state in ('done', 'no_show', 'cancelled'))) then
      raise exception 'booking refused: a member moves a booking % → %', old.state, new.state using errcode = 'MS010';
    end if;
    if new.state = 'confirmed' and (nullif(current_setting('munshi.command', true), '') is distinct from 'booking.confirm' or not exists (
         select 1 from ops.member m join ref.command_authority ca on ca.role = m.role and ca.command = 'booking.confirm'
          where m.tenant_id = new.tenant_id and m.id = ctx_actor)) then
      raise exception 'booking refused: a request is confirmed only inside booking.confirm' using errcode = 'MS007';
    end if;
    if new.state = 'declined' and new.reason is null then
      raise exception 'booking refused: a decline carries a reason code' using errcode = 'MS007';
    end if;
    if new.state = 'done' and not exists (
         select 1 from books.sale s where s.tenant_id = new.tenant_id and s.booking_id = new.id and s.created_txid = txid_current()) then
      raise exception 'booking refused: a booking is done only with the sale that names it' using errcode = 'MS007';
    end if;
    new.handled_by := ctx_actor;
    new.handled_at := now();
  else
    raise exception 'booking refused: % does not move bookings', current_user using errcode = 'MS018';
  end if;
  -- A booking that ends keeps no IP hash (§2.6): the caps count live holds only, and a final booking is never erased.
  if new.state in ('done', 'cancelled', 'expired', 'declined', 'no_show') then
    new.ip_hash := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ops.booking_flow() from public;
create trigger flow before insert or update on ops.booking for each row execute function ops.booking_flow();

-- The customer's details for a live booking: inserted by the public only in the transaction that moved its hold to
-- requested; demo samples pinned; erased by an active owner, or by the jobs purge 90 days after the booking ended (7 on
-- a demo).
create table ops.booking_contact (
  tenant_id uuid not null references ops.tenant,
  booking_id uuid not null,
  site_id uuid not null,
  contact_name text check (char_length(contact_name) between 1 and 80),
  contact_phone_e164 text check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  note text check (char_length(note) <= 500),
  wa_updates boolean not null default false,
  notice_version text not null,
  consent_version text not null,
  ip_hash bytea check (octet_length(ip_hash) = 32),
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, booking_id),
  foreign key (tenant_id, booking_id) references ops.booking,
  foreign key (tenant_id, site_id) references ops.site,
  check (erased_at is not null or (contact_name is not null and contact_phone_e164 is not null))
);

create function ops.booking_contact_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  keep interval := case when coalesce((select d.kind from ops.deployment d), 'demo') = 'live' then interval '90 days' else interval '7 days' end;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from ops.booking b
                    where b.tenant_id = new.tenant_id and b.id = new.booking_id and b.site_id = new.site_id
                      and b.state = 'requested' and b.requested_txid = txid_current()) then
      raise exception 'booking contact refused: it comes with its hold''s move to requested, in that transaction' using errcode = 'MS007';
    end if;
    if new.erased_at is not null then
      raise exception 'booking contact refused: a new contact row is not erased' using errcode = 'MS007';
    end if;
    new.created_at := now();
    return new;
  end if;
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'booking contact refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
        raise exception 'booking contact refused: a person''s erasure is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'booking contact refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif not exists (select 1 from ops.booking b
                       where b.tenant_id = new.tenant_id and b.id = new.booking_id
                         and b.state in ('declined', 'cancelled', 'expired', 'done', 'no_show') and b.updated_at < now() - keep) then
      raise exception 'booking contact refused: the purge erases it 90 days after the booking ended (7 on a demo)' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.booking_contact_guard() from public;
create trigger erase before update on ops.booking_contact for each row execute function ops.only_erase('contact_name', 'contact_phone_e164', 'note', 'ip_hash');
create trigger guard before insert or update on ops.booking_contact for each row execute function ops.booking_contact_guard();
create trigger intake before insert on ops.booking_contact for each row execute function ops.public_intake('booking contact');

-- A hold on a piece (a good). The public asks; a member holds it (held_until from the site's reservation hours), declines
-- it, releases it, or sells it, the last only in the transaction of a sale naming the reservation and selling the item;
-- the jobs role expires it and purges its details 90 days after it ended (7 on a demo). Stock never moves here.
create table ops.reservation (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  site_id uuid not null,
  item_id uuid not null,
  item_kind text generated always as ('good') stored,
  qty_milli bigint not null check (qty_milli > 0),
  state text not null default 'requested' check (state in ('requested', 'held', 'declined', 'released', 'expired', 'sold')),
  contact_name text check (char_length(contact_name) between 1 and 80),
  contact_phone_e164 text check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  note text check (char_length(note) <= 500),
  notice_version text not null,
  consent_version text not null,
  ip_hash bytea check (octet_length(ip_hash) = 32),
  held_until timestamptz,
  handled_by uuid,
  handled_at timestamptz,
  reason text,
  reason_use text generated always as ('decline') stored,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, site_id) references ops.site,
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, handled_by) references ops.member,
  foreign key (reason, reason_use) references ref.reason_use,
  check (erased_at is not null or (contact_name is not null and contact_phone_e164 is not null))
);

create function ops.reservation_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  keep interval := case when coalesce((select d.kind from ops.deployment d), 'demo') = 'live' then interval '90 days' else interval '7 days' end;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'requested' or new.held_until is not null or new.handled_by is not null or new.erased_at is not null
       or new.reason is not null then
      raise exception 'reservation refused: a new reservation is a request' using errcode = 'MS007';
    end if;
    -- D-055: at most three live pieces (requested or held) per IP hash, under the IP's lock (class 8, as a booking's
    -- holds; the chain lock first). The public names its IP hash; RLS keeps the count to this tenant.
    if new.ip_hash is null then
      raise exception 'reservation refused: the public names its IP hash' using errcode = 'MS018';
    end if;
    perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
    perform pg_advisory_xact_lock(8, hashtext(new.tenant_id::text || encode(new.ip_hash, 'hex')));
    if (select count(*) from ops.reservation r where r.ip_hash = new.ip_hash and r.state in ('requested', 'held')) >= 3 then
      raise exception 'reservation refused: this network already has three pieces asked for or held' using errcode = 'MS015';
    end if;
    new.created_at := now();
    return new;
  end if;
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'reservation refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  -- A decided reservation's reason is never rewritten: it is set only by the move to declined.
  if new.reason is distinct from old.reason and not (new.state = 'declined' and old.state is distinct from 'declined') then
    raise exception 'reservation refused: the reason is set by the decline alone' using errcode = 'MS010';
  end if;
  if new.state is distinct from old.state then
    if old.state in ('declined', 'released', 'expired', 'sold') then
      raise exception 'reservation refused: a % reservation is final', old.state using errcode = 'MS010';
    end if;
    if current_user = 'munshi_app' then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active)
         or not ((old.state = 'requested' and new.state in ('held', 'declined')) or (old.state = 'held' and new.state in ('sold', 'released'))) then
        raise exception 'reservation refused: an active member holds, declines, sells or releases' using errcode = 'MS007';
      end if;
      if new.state = 'held' then
        new.held_until := now() + make_interval(hours => (select s.reservation_hours from ops.site s where s.tenant_id = new.tenant_id and s.id = new.site_id));
      elsif new.state = 'declined' and new.reason is null then
        raise exception 'reservation refused: a decline carries a reason code' using errcode = 'MS007';
      elsif new.state = 'sold' and not exists (
              select 1 from books.sale s join books.sale_line l on l.tenant_id = s.tenant_id and l.sale_id = s.id
               where s.tenant_id = new.tenant_id and s.reservation_id = new.id and s.created_txid = txid_current() and l.item_id = new.item_id) then
        raise exception 'reservation refused: a piece is sold only with the sale that names the reservation and sells it' using errcode = 'MS007';
      end if;
      new.handled_by := ctx_actor;
    elsif current_user = 'munshi_jobs' then
      if old.state <> 'held' or new.state <> 'expired' or old.held_until > now() then
        raise exception 'reservation refused: the jobs role expires a hold after held_until' using errcode = 'MS007';
      end if;
    else
      raise exception 'reservation refused: % does not move reservations', current_user using errcode = 'MS018';
    end if;
    new.handled_at := now();
  elsif not (old.erased_at is null and new.erased_at is not null) then
    raise exception 'reservation refused: a reservation changes only by a move or its erasure' using errcode = 'MS010';
  elsif new.held_until is distinct from old.held_until or new.handled_by is distinct from old.handled_by
        or new.handled_at is distinct from old.handled_at then
    raise exception 'reservation refused: held_until and the handling are set by a move' using errcode = 'MS010';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
        raise exception 'reservation refused: a person''s erasure is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'reservation refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif old.state in ('requested', 'held') or old.handled_at > now() - keep then
      raise exception 'reservation refused: the purge erases it 90 days after it ended (7 on a demo)' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.reservation_flow() from public;
create trigger erase before update on ops.reservation for each row execute function ops.only_erase('contact_name', 'contact_phone_e164', 'note', 'ip_hash');
create trigger flow before insert or update on ops.reservation for each row execute function ops.reservation_flow();
create trigger intake before insert on ops.reservation for each row execute function ops.public_intake('reservation');

-- booking.confirm writes the customer through the vault (and, from 19, the confirmation message) (§2.10.14).
insert into ref.command (command, draft_only) values ('booking.confirm', false);
insert into ref.command_authority (command, role) values ('booking.confirm', 'owner'), ('booking.confirm', 'manager');
insert into ref.command_table (command, rel) values
  ('booking.confirm', 'books.customer'), ('booking.confirm', 'books.customer_terms'), ('booking.confirm', 'books.party_contact');
insert into ref.command_capability (command, capability, use) values ('booking.confirm', 'bookings', 'start');

-- Indexes, one per statement, each asserted in pg_index (G10). The exclusion's own index is the constraint's.
create unique index site_one on ops.site (tenant_id);
create unique index site_key_hash on ops.site_key (tenant_id, key_sha256);
create index site_look_site on ops.site_look (tenant_id, site_id, created_at);
create index site_release_latest on ops.site_release (tenant_id, site_id, published_at);
create index site_release_look on ops.site_release (tenant_id, look_id);
create index staff_public_shop on ops.staff_public (tenant_id, shop_id);
create index site_request_open on ops.site_request (tenant_id, status, created_at);
create index site_request_phone on ops.site_request (tenant_id, contact_phone_e164) where erased_at is null;
create unique index one_hold_per_device on ops.booking (tenant_id, device_hash) where state = 'held';
create index booking_shop_state on ops.booking (tenant_id, shop_id, state);
create index booking_ip_held on ops.booking (tenant_id, ip_hash) where state = 'held';
create index booking_held_due on ops.booking (tenant_id, expires_at) where state = 'held';
create index booking_customer on ops.booking (tenant_id, customer_id) where customer_id is not null;
create index booking_contact_phone on ops.booking_contact (tenant_id, contact_phone_e164) where erased_at is null;
create index reservation_item on ops.reservation (tenant_id, item_id, state);
create index reservation_held_due on ops.reservation (tenant_id, held_until) where state = 'held';
create index reservation_ip_live on ops.reservation (tenant_id, ip_hash) where state in ('requested', 'held');
create index reservation_phone on ops.reservation (tenant_id, contact_phone_e164) where erased_at is null;

-- RLS and the grants. The public role sees ids and times of bookings and pieces, never a name or an amount, plus the
-- IP and device hashes its own hold caps count (§2.3); looks, documents and staff profiles only as a release shows them.
alter table ops.site enable row level security;
alter table ops.site force row level security;
create policy tenant_isolation on ops.site
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.site from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (intake, booking_mode, origins, privacy_version, consent_version, hold_minutes, reservation_hours, updated_at)
  on ops.site to munshi_app;
grant select on ops.site to munshi_public;

alter table ops.site_key enable row level security;
alter table ops.site_key force row level security;
create policy tenant_isolation on ops.site_key
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.site_key from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (revoked_at, revoked_by) on ops.site_key to munshi_app;
grant select (id, site_id, key_sha256, revoked_at) on ops.site_key to munshi_public;

alter table ops.site_look enable row level security;
alter table ops.site_look force row level security;
create policy tenant_isolation on ops.site_look
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy look_public on ops.site_look as restrictive for select to munshi_public
  using (exists (select 1 from ops.site_release r where r.tenant_id = site_look.tenant_id and r.look_id = site_look.id));
revoke all on ops.site_look from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.site_look to munshi_app;
grant select on ops.site_look to munshi_public;

alter table ops.site_release enable row level security;
alter table ops.site_release force row level security;
create policy tenant_isolation on ops.site_release
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.site_release from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.site_release to munshi_app;
grant select on ops.site_release to munshi_public;

alter table ops.staff_public enable row level security;
alter table ops.staff_public force row level security;
create policy tenant_isolation on ops.staff_public
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy staff_shown on ops.staff_public as restrictive for select to munshi_public using (shown and erased_at is null);
revoke all on ops.staff_public from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (shown, display_name, blurb, erased_at) on ops.staff_public to munshi_app;
grant select on ops.staff_public to munshi_public;

alter table ops.site_request enable row level security;
alter table ops.site_request force row level security;
create policy tenant_isolation on ops.site_request
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.site_request from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant insert on ops.site_request to munshi_public;
grant select, update (status, handled_by, handled_at, customer_id, contact_name, contact_phone_e164, note, ip_hash, erased_at)
  on ops.site_request to munshi_app;
grant select, update (status, contact_name, contact_phone_e164, note, ip_hash, erased_at) on ops.site_request to munshi_jobs;

alter table ops.booking enable row level security;
alter table ops.booking force row level security;
create policy tenant_isolation on ops.booking
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.booking from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
-- Past §2.10's cell: the public's triggers read ip_hash (the IP cap) and requested_txid (the contact row), and no
-- function may be SECURITY DEFINER (G9), so the public role reads them; the device cap is the unique index alone.
grant select (tenant_id, id, site_id, shop_id, staff_id, service_item_id, during, state, expires_at, ip_hash, requested_txid),
  insert, update (state, updated_at) on ops.booking to munshi_public;
grant select, insert, update (state, customer_id, handled_by, handled_at, reason, updated_at) on ops.booking to munshi_app;
grant select, update (state, updated_at) on ops.booking to munshi_jobs;

alter table ops.booking_contact enable row level security;
alter table ops.booking_contact force row level security;
create policy tenant_isolation on ops.booking_contact
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.booking_contact from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant insert on ops.booking_contact to munshi_public;
grant select, update (contact_name, contact_phone_e164, note, ip_hash, erased_at) on ops.booking_contact to munshi_app, munshi_jobs;

alter table ops.reservation enable row level security;
alter table ops.reservation force row level security;
create policy tenant_isolation on ops.reservation
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.reservation from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
-- The public reads ip_hash for the per-IP cap in reservation_flow (D-055), as for a booking's holds.
grant select (item_id, state, held_until, ip_hash), insert on ops.reservation to munshi_public;
grant select, update (state, held_until, handled_by, handled_at, reason, contact_name, contact_phone_e164, note, ip_hash, erased_at)
  on ops.reservation to munshi_app;
grant select, update (state, contact_name, contact_phone_e164, note, ip_hash, erased_at) on ops.reservation to munshi_jobs;

-- The public role's read of documents (deferred from 04): only an unerased card or art document that a published
-- release's look names. A card named by a campaign is 19's to add.
create policy document_public on ops.document as restrictive for select to munshi_public
  using (kind in ('card', 'art') and erased_at is null and exists (
    select 1 from ops.site_release r join ops.site_look l on l.tenant_id = r.tenant_id and l.id = r.look_id
     where r.tenant_id = document.tenant_id and exists (select 1 from jsonb_each_text(l.art) a where a.value = document.id::text)));
grant select on ops.document to munshi_public;

-- The public's booking guard reads the shop's time zone by tenant id.
grant select (tenant_id) on ops.tenant to munshi_public;
