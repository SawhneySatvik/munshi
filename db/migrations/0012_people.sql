-- 0012 · People (MS-19a; docs/MERCHANTS-DESIGN.md 0012, §2.0, §7): the erasable contact vault, customers and staff
-- without personal data on showcase and live tenants, and consent as an append-only book. Also the two shared trigger
-- functions every erasable row uses (§2.0): ops.only_erase and ops.fill_once.
-- Why a vault: books.audit_row hashes to_jsonb(new) into the permanent chain (0005), so a name or a phone written to a
-- book row could never be erased. A real person's name and phone live only in ops.contact, which books point at by id.
set local role munshi_owner;

-- ops.only_erase(col, …): the listed columns are a row's personal and identity columns. One may go to NULL only in the
-- UPDATE that moves erased_at from NULL to now(), and that UPDATE nulls every listed column; the row is then frozen, so
-- any later UPDATE of it is refused. A listed column never goes from NULL to a value, so an identity column cannot be
-- emptied and filled with another person's (a new phone means a new contact). Everything else is MS011.
create function ops.only_erase() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  col text;
  erasing boolean;
begin
  if tg_nargs = 0 or not (o ? 'erased_at') then
    raise exception 'only_erase: %.% needs its personal columns and an erased_at column', tg_table_schema, tg_table_name
      using errcode = 'MS011';
  end if;
  foreach col in array tg_argv loop
    if not (o ? col) then
      raise exception 'only_erase: %.% has no column %', tg_table_schema, tg_table_name, col using errcode = 'MS011';
    end if;
  end loop;
  if o ->> 'erased_at' is not null then
    raise exception 'erase refused: the %.% row is erased, and an erased row never changes', tg_table_schema, tg_table_name
      using errcode = 'MS011';
  end if;
  erasing := n ->> 'erased_at' is not null;
  if erasing and (n ->> 'erased_at')::timestamptz is distinct from now() then
    raise exception 'erase refused: erased_at is set to now()' using errcode = 'MS011';
  end if;
  foreach col in array tg_argv loop
    if erasing and n ->> col is not null then
      raise exception 'erase refused: an erasure of %.% nulls every personal column, % too', tg_table_schema, tg_table_name, col
        using errcode = 'MS011';
    elsif not erasing and (o -> col) is distinct from (n -> col) then
      raise exception 'erase refused: %.%.% changes only to NULL, in the UPDATE that sets erased_at', tg_table_schema, tg_table_name, col
        using errcode = 'MS011';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function ops.only_erase() from public;

-- ops.fill_once(col, stamp): a column filled after insert (an inbound message's transcript, 0016). It goes from NULL to a
-- value only in the UPDATE that moves its stamp from NULL to now(); the stamp is never cleared, so a second fill, even
-- after a NULL, is refused. Otherwise it changes only to NULL, in an erasure, and an erasure must null it. A fill-once
-- column is listed here and not in ops.only_erase (which would refuse its fill); only_erase, on the same table, still
-- checks the erasure's other columns and freezes the row.
create function ops.fill_once() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  col text := tg_argv[0];
  stamp text := tg_argv[1];
begin
  if tg_nargs <> 2 or not (o ? col and o ? stamp and o ? 'erased_at') then
    raise exception 'fill_once: %.% needs a column, its stamp and an erased_at column', tg_table_schema, tg_table_name
      using errcode = 'MS011';
  end if;
  if (o -> stamp) is distinct from (n -> stamp) then
    if o ->> stamp is not null or (n ->> stamp)::timestamptz is distinct from now() or o ->> col is not null or n ->> col is null
       or n ->> 'erased_at' is not null then
      raise exception 'fill refused: %.%.% is filled once, in the UPDATE that sets % to now()', tg_table_schema, tg_table_name, col, stamp
        using errcode = 'MS011';
    end if;
  elsif (o -> col) is distinct from (n -> col) then
    if n ->> col is not null or o ->> 'erased_at' is not null or n ->> 'erased_at' is null then
      raise exception 'fill refused: %.%.% is filled once, with %, and otherwise changes only to NULL in an erasure',
        tg_table_schema, tg_table_name, col, stamp using errcode = 'MS011';
    end if;
  elsif o ->> 'erased_at' is null and n ->> 'erased_at' is not null and n ->> col is not null then
    raise exception 'erase refused: an erasure of %.% nulls %', tg_table_schema, tg_table_name, col using errcode = 'MS011';
  end if;
  return new;
end $$;
revoke execute on function ops.fill_once() from public;

-- A person's name and phone (a customer's; on showcase and live tenants a staff member's too, through books.staff).
-- Always added by a person: a public request is not a contact until someone confirms it. Phones are E.164.
create table ops.contact (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text check (char_length(name) between 1 and 80),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null default 'hi' check (language in ('hi', 'en')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  erased_by uuid,
  erase_reason text check (erase_reason in ('request', 'retention')),
  -- the owner asked for erasure while a credit or package balance held it; the daily purge completes it (§7.3)
  erase_requested_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, erased_by) references ops.member,
  constraint contact_named check (erased_at is not null or name is not null),
  constraint contact_erased check (erased_at is null or (name is null and phone_e164 is null)),
  constraint contact_erase_reason check ((erased_at is null) = (erase_reason is null)),
  constraint contact_erased_by check (erased_by is null or erased_at is not null)
);

-- Who adds and who erases. An erasure is one of two shapes only: an active owner's own request (erased_by = the owner,
-- reason request), or the daily purge in a system scope (no actor, no erased_by, reason retention; a held request it
-- completes keeps its erase_requested_at). Erasure is requested once, by an active owner. MS007 for who, MS011 (only_erase)
-- for which columns.
-- The purge has no person behind it, so the database checks its condition instead of trusting the caller (§7.3): never
-- while the person's credit balance is open, and only for a request the owner made that a balance was holding, or for a
-- contact idle for a year (no sale, credit entry, message, attendance or purchase of a book row naming it, and the
-- contact and those rows themselves older than a year; a staff contact also needs its member deactivated). Times are
-- created_at, which the database stamps. Later tables add their activity and balances here (create or replace):
-- 0014 loyalty entries, 0015 package entries and unexpired package balances, 0017 booking requests.
create function ops.contact_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'contact refused: the row is not for the current tenant' using errcode = 'MS007';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    if actor_role is null then
      raise exception 'contact refused: a contact is added by an active member' using errcode = 'MS007';
    end if;
    if new.erased_at is not null or new.erased_by is not null or new.erase_reason is not null or new.erase_requested_at is not null then
      raise exception 'contact refused: a new contact is not erased' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
    return new;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    -- coalesce: with no actor, actor_role is NULL, and so is the owner's shape.
    if coalesce(actor_role = 'owner' and new.erased_by = ctx_actor and new.erase_reason = 'request', false) then
      null;
    elsif ctx_actor is null and new.erased_by is null and new.erase_reason = 'retention' then
      if exists (select 1 from books.customer c
                   join books.credit_entry ce on ce.tenant_id = c.tenant_id and ce.customer_id = c.id
                  where c.tenant_id = new.tenant_id and c.contact_id = new.id
                  group by ce.customer_id, ce.currency having sum(ce.amount_minor) <> 0) then
        raise exception 'contact refused: the retention purge never erases a person a balance holds' using errcode = 'MS007';
      end if;
      if old.erase_requested_at is null and (
           exists (select 1 from books.staff st join ops.member m on m.tenant_id = st.tenant_id and m.id = st.member_id
                    where st.tenant_id = new.tenant_id and st.contact_id = new.id and m.active)
           or (select max(seen.at) from (
                 select old.created_at as at
                 union all select c.created_at from books.customer c where c.tenant_id = new.tenant_id and c.contact_id = new.id
                 union all select x.created_at from books.customer c join books.sale x on x.tenant_id = c.tenant_id and x.customer_id = c.id
                            where c.tenant_id = new.tenant_id and c.contact_id = new.id
                 union all select x.created_at from books.customer c join books.credit_entry x on x.tenant_id = c.tenant_id and x.customer_id = c.id
                            where c.tenant_id = new.tenant_id and c.contact_id = new.id
                 union all select x.created_at from books.customer c
                             join books.outbound_message x on x.tenant_id = c.tenant_id and x.recipient_kind = 'customer' and x.recipient_id = c.id
                            where c.tenant_id = new.tenant_id and c.contact_id = new.id
                 union all select st.created_at from books.staff st where st.tenant_id = new.tenant_id and st.contact_id = new.id
                 union all select x.created_at from books.staff st join books.attendance x on x.tenant_id = st.tenant_id and x.staff_id = st.id
                            where st.tenant_id = new.tenant_id and st.contact_id = new.id
                 union all select x.created_at from books.staff st
                             join books.outbound_message x on x.tenant_id = st.tenant_id and x.recipient_kind = 'staff' and x.recipient_id = st.id
                            where st.tenant_id = new.tenant_id and st.contact_id = new.id
                 union all select su.created_at from books.supplier su where su.tenant_id = new.tenant_id and su.contact_id = new.id
                 union all select x.created_at from books.supplier su join books.purchase x on x.tenant_id = su.tenant_id and x.supplier_id = su.id
                            where su.tenant_id = new.tenant_id and su.contact_id = new.id
                 union all select x.created_at from books.supplier su
                             join books.outbound_message x on x.tenant_id = su.tenant_id and x.recipient_kind = 'supplier' and x.recipient_id = su.id
                            where su.tenant_id = new.tenant_id and su.contact_id = new.id) seen) > now() - interval '1 year') then
        raise exception 'contact refused: the retention purge erases only a contact idle for a year, or one whose erasure was requested'
          using errcode = 'MS007';
      end if;
    else
      raise exception 'contact refused: an erasure is an active owner''s request or the retention purge' using errcode = 'MS007';
    end if;
  end if;
  if new.erase_requested_at is distinct from old.erase_requested_at
     and (old.erase_requested_at is not null or new.erase_requested_at is distinct from now() or actor_role is distinct from 'owner') then
    raise exception 'contact refused: erasure is requested once, by an active owner' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.contact_guard() from public;

-- After the row, like ops.member_audit: the contact's id only, never a name or a phone (the chain is permanent). The
-- purge has no actor, and an audit entry always names one, so a retention erasure leaves no entry: its erased_at and
-- erase_reason are the record.
create function ops.contact_audit() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
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
create trigger guard_audit after insert or update on ops.contact for each row execute function ops.contact_audit();

-- Customers, staff and suppliers point at the vault (a sole trader's name and mobile are a person's). A book row holds a
-- name (an invented person or firm on the synthetic kirana, as today) or a contact, never both, and no phone beside a
-- contact. Relaxing NOT NULL on name is for vault-backed rows.
alter table books.customer add column contact_id uuid;
alter table books.customer add constraint customer_contact_fkey foreign key (tenant_id, contact_id) references ops.contact;
alter table books.customer alter column name drop not null;
alter table books.customer add constraint customer_identity check ((contact_id is null) = (name is not null));
alter table books.customer add constraint customer_no_phone check (contact_id is null or phone is null);

alter table books.staff add column contact_id uuid;
alter table books.staff add constraint staff_contact_fkey foreign key (tenant_id, contact_id) references ops.contact;
alter table books.staff alter column name drop not null;
alter table books.staff add constraint staff_identity check ((contact_id is null) = (name is not null));
alter table books.staff add constraint staff_no_phone check (contact_id is null or phone is null);

alter table books.supplier add column contact_id uuid;
alter table books.supplier add constraint supplier_contact_fkey foreign key (tenant_id, contact_id) references ops.contact;
alter table books.supplier alter column name drop not null;
alter table books.supplier add constraint supplier_identity check ((contact_id is null) = (name is not null));
alter table books.supplier add constraint supplier_no_phone check (contact_id is null or phone is null);

-- On a showcase or live tenant every customer, staff and supplier row goes through the vault, so no real name or phone is ever
-- chained (MS008). Showcase too: its seeds write their invented people through the vault, the path a real test phone
-- takes. A tenant that cannot be read counts as not synthetic. Named pii so it fires after guard (name order).
create function books.pii() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  cls text;
begin
  select t.data_class into cls from ops.tenant t where t.tenant_id = new.tenant_id;
  if cls is distinct from 'synthetic' and new.contact_id is null then
    raise exception 'book write refused: on a % tenant, %.% names a person only through ops.contact',
      coalesce(cls, 'unreadable'), tg_table_schema, tg_table_name using errcode = 'MS008';
  end if;
  return new;
end $$;
revoke execute on function books.pii() from public;

create trigger pii before insert on books.customer for each row execute function books.pii();
create trigger pii before insert on books.staff for each row execute function books.pii();
create trigger pii before insert on books.supplier for each row execute function books.pii();

-- A customer's consent, per channel and purpose; the latest row by created_at wins (stamped by the guard, never by the
-- caller: a consent dated ahead would outrank every later withdrawal and STOP), and a withdrawal is a new row (granted
-- false). `at` is when the person answered, never after the row was written. 0016's audience read orders by created_at.
-- Written only by consent.record, when the phone's owner answered (a YES on WhatsApp, attested in chat, or in person):
-- a ticked web-form box alone writes nothing (§7.2). Evidence names the row the answer arrived in, both or neither.
create table books.customer_consent (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'sms')),
  purpose text not null check (purpose in ('marketing', 'service')),
  granted boolean not null,
  source text not null check (source in ('in_person', 'whatsapp_reply', 'in_chat_attested', 'import')),
  evidence_table text check (evidence_table ~ '^[a-z_]+\.[a-z_]+$'),
  evidence_id uuid,
  notice_version text check (notice_version <> ''),
  at timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  constraint consent_evidence check ((evidence_table is null) = (evidence_id is null)),
  constraint consent_reply_evidence check (source <> 'whatsapp_reply' or evidence_id is not null),
  constraint consent_notice check (not granted or notice_version is not null),
  constraint consent_not_future check (at <= created_at)
);

create trigger guard before insert or update or delete on books.customer_consent for each row execute function books.guard();
create trigger guard_audit after insert on books.customer_consent for each row execute function books.audit_row();

insert into ops.command_authority (command, role) values
  ('consent.record', 'owner'), ('consent.record', 'manager'), ('consent.record', 'staff'),
  ('booking.confirm', 'owner'), ('booking.confirm', 'manager');
insert into ops.command_table (command, rel) values
  ('consent.record', 'books.customer_consent'),
  ('booking.confirm', 'books.customer'), ('booking.confirm', 'books.outbound_message');

alter table ops.contact enable row level security;
alter table ops.contact force row level security;
create policy tenant_isolation on ops.contact
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.customer_consent enable row level security;
alter table books.customer_consent force row level security;
create policy tenant_isolation on books.customer_consent
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- The vault: the app inserts, and updates only toward erasure (the triggers above decide how). The agent gets nothing:
-- it sees people as ids in snapshot cells only.
revoke all on ops.contact from public, munshi_app, munshi_agent;
grant select, insert, update (name, phone_e164, erased_at, erased_by, erase_reason, erase_requested_at) on ops.contact to munshi_app;

revoke all on books.customer_consent from public, munshi_app, munshi_agent;
grant select, insert on books.customer_consent to munshi_app;

-- One live contact per phone.
create unique index contact_phone on ops.contact (tenant_id, phone_e164) where erased_at is null;
create index consent_latest on books.customer_consent (tenant_id, customer_id, channel, purpose, created_at);
