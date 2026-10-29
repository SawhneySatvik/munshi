-- 19 · Messages (BLUEPRINT §2.10.7, §2.6, §8.6): campaigns, the inbox and its extracts, outbound messages and their
-- deliveries, the shop's test recipients and their phone routes. An outbound message is a book (every send is a person's
-- command or an approved draft); its body is an erasable ops.message_text whose hash the book keeps (b_outbound_derive),
-- and its one delivery is derived by the database in the message's transaction (z_outbound_delivery): the address from
-- the recipient's contact, and `recorded` unless a live deployment, a real session, a real recipient, an operator's live
-- channel grant and, for WhatsApp, a recipient the owner listed all agree (CH1, review B1). A delivery moves forward
-- only, is claimed once and so sent at most once, each move checked against current_user (W6). A STOP is handled only
-- beside its withdrawal and never erased before it (§2.6). An extract's span lies inside its live message and a digit
-- span is re-parsed here (MS006). ai.answer.inbound_message_id gets its key here (R4 B1), and ops.message_text_guard
-- gains the reply, copy and inbound purge rules (create or replace; 05 holds the pointer). The cart is gone (21).
--
-- Column naming a later file's table, declared here with no key (21_orders.sql adds it by alter table, R4 B1):
-- books.outbound_message.order_id.
set local role munshi_owner;

-- The composer's working object; the send is the campaign.send or campaign.post draft (§8.6).
create table ops.campaign (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  name text not null check (char_length(name) between 1 and 80),
  channel text not null check (channel in ('whatsapp', 'instagram')),
  offer_id uuid,
  copy_text_id uuid,
  card_document_id uuid,
  segment text not null check (segment in ('bought_within_days', 'lapsed_regulars', 'package_expiring')),
  segment_days int check (segment_days between 1 and 365),
  status text not null default 'composing' check (status in ('composing', 'proposed', 'approved', 'rejected', 'sent')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, offer_id) references books.offer,
  foreign key (tenant_id, copy_text_id) references ops.message_text,
  foreign key (tenant_id, card_document_id) references ops.document,
  foreign key (tenant_id, created_by) references ops.member
);

-- An active owner or manager composes; a campaign moves composing → proposed → approved or rejected (or back to
-- composing for an edit), approved → sent; its copy and card change only while composing; a card is a card document.
create function ops.campaign_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
    raise exception 'campaign refused: an active owner or manager composes a campaign' using errcode = 'MS007';
  end if;
  if new.card_document_id is not null and not exists (
       select 1 from ops.document d where d.tenant_id = new.tenant_id and d.id = new.card_document_id and d.kind = 'card' and d.erased_at is null) then
    raise exception 'campaign refused: a campaign''s card is a card document' using errcode = 'MS007';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'composing' then
      raise exception 'campaign refused: a new campaign is composing' using errcode = 'MS010';
    end if;
    new.created_by := ctx_actor;
    new.created_at := now();
  else
    if new.status is distinct from old.status and not (
         (old.status = 'composing' and new.status = 'proposed')
         or (old.status = 'proposed' and new.status in ('approved', 'rejected', 'composing'))
         or (old.status = 'approved' and new.status = 'sent')) then
      raise exception 'campaign refused: a campaign moves % → %', old.status, new.status using errcode = 'MS010';
    end if;
    if (new.copy_text_id is distinct from old.copy_text_id or new.card_document_id is distinct from old.card_document_id)
       and old.status <> 'composing' then
      raise exception 'campaign refused: the copy and card change only while composing' using errcode = 'MS010';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ops.campaign_guard() from public;
create trigger guard before insert or update on ops.campaign for each row execute function ops.campaign_guard();

-- The inbox: what the webhook stores (no actor), handled by a member. text and from_address are erased with the row;
-- the transcript and the media document are each filled once and nulled by the erasure (fill_once, 02).
create table ops.inbound_message (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 128),
  from_address text check (char_length(from_address) between 1 and 32),
  kind text not null check (kind in ('text', 'audio', 'image', 'other')),
  text text check (char_length(text) <= 4096),
  media_document_id uuid,
  media_at timestamptz,
  transcript text check (char_length(transcript) <= 4096),
  transcribed_at timestamptz,
  opt_out boolean not null default false,
  received_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'handled', 'ignored')),
  handled_by uuid,
  handled_at timestamptz,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, media_document_id) references ops.document,
  foreign key (tenant_id, handled_by) references ops.member,
  check (erased_at is not null or from_address is not null)
);

-- inbound_flow. The webhook (the public role, no actor) inserts a new, unhandled message, received now; a bare STOP is
-- an opt-out whatever the webhook said. A member handles a message once, as handled or ignored, and an opt-out only as
-- handled, in the transaction that records its withdrawal (consent.record, granted false, naming this message). The
-- jobs purge erases a message 30 days after it arrived; neither it nor an owner erases an opt-out still unhandled.
create function ops.inbound_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_public' or ctx_actor is not null then
      raise exception 'inbound refused: the webhook stores a message, with no actor' using errcode = 'MS018';
    end if;
    if new.status <> 'new' or new.handled_by is not null or new.handled_at is not null or new.erased_at is not null
       or new.transcript is not null or new.transcribed_at is not null or new.media_document_id is not null or new.media_at is not null then
      raise exception 'inbound refused: a message arrives new, untranscribed and with no media' using errcode = 'MS007';
    end if;
    new.opt_out := new.opt_out or upper(btrim(coalesce(new.text, ''))) = 'STOP';
    new.received_at := now();
    return new;
  end if;
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'inbound refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if new.provider_message_id is distinct from old.provider_message_id or new.kind is distinct from old.kind
     or new.opt_out is distinct from old.opt_out or new.received_at is distinct from old.received_at then
    raise exception 'inbound refused: a message''s identity and arrival never change' using errcode = 'MS010';
  end if;
  if new.status is distinct from old.status then
    if current_user <> 'munshi_app' or old.status <> 'new' or not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'inbound refused: an active member handles a new message once' using errcode = 'MS007';
    end if;
    if new.opt_out and (new.status <> 'handled' or not exists (
         select 1 from books.customer_consent k
          where k.tenant_id = new.tenant_id and k.evidence_rel = 'ops.inbound_message' and k.evidence_id = new.id
            and not k.granted and k.created_txid = txid_current())) then
      raise exception 'inbound refused: a STOP is handled only beside its withdrawal' using errcode = 'MS007';
    end if;
    new.handled_by := ctx_actor;
    new.handled_at := now();
  elsif new.handled_by is distinct from old.handled_by or new.handled_at is distinct from old.handled_at then
    raise exception 'inbound refused: who handled it and when are set by the handling' using errcode = 'MS010';
  end if;
  if (new.media_document_id is distinct from old.media_document_id and new.erased_at is null and current_user <> 'munshi_public')
     or (new.transcript is distinct from old.transcript and new.erased_at is null and (current_user <> 'munshi_app' or ctx_actor is null)) then
    raise exception 'inbound refused: the webhook fetches the media, a member''s run the transcript' using errcode = 'MS018';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if old.opt_out and old.status <> 'handled' then
      raise exception 'inbound refused: a STOP is never erased before its withdrawal' using errcode = 'MS007';
    elsif ctx_actor is not null then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
        raise exception 'inbound refused: a person''s erasure of a message is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'inbound refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif old.received_at > now() - interval '30 days' then
      raise exception 'inbound refused: the purge erases a message 30 days after it arrived' using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function ops.inbound_flow() from public;
create trigger erase before update on ops.inbound_message for each row execute function ops.only_erase('text', 'from_address');
create trigger fill_media before update on ops.inbound_message for each row execute function ops.fill_once('media_document_id', 'media_at');
create trigger fill_transcript before update on ops.inbound_message for each row execute function ops.fill_once('transcript', 'transcribed_at');
create trigger flow before insert or update on ops.inbound_message for each row execute function ops.inbound_flow();

-- A message to a person or a public post: a book written by its command (or the approved draft), never edited. Its body
-- is the text it names, whose sha256 it keeps; its delivery is derived after it.
create table books.outbound_message (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  channel text not null check (channel in ('whatsapp', 'sms', 'instagram')),
  recipient_kind text not null check (recipient_kind in ('customer', 'supplier', 'staff', 'public')),
  recipient_id uuid not null,
  template_code text check (template_code ~ '^[a-z_]{2,40}$'),
  text_id uuid not null,
  body_sha256 bytea not null check (octet_length(body_sha256) = 32),
  campaign_id uuid,
  reply_to_id uuid,
  booking_id uuid,
  order_id uuid,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, text_id) references ops.message_text,
  foreign key (tenant_id, campaign_id) references ops.campaign,
  foreign key (tenant_id, reply_to_id) references ops.inbound_message,
  foreign key (tenant_id, booking_id) references ops.booking,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((channel = 'instagram') = (recipient_kind = 'public'))
);

-- A delivery: one per message (or a member's test send of a text to themself), every field derived by delivery_derive,
-- then moved forward by delivery_status. to_address is erased with the row.
create table ops.delivery (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  message_id uuid,
  test_member_id uuid,
  test_text_id uuid,
  channel text not null check (channel in ('whatsapp', 'sms', 'instagram')),
  to_address text check (char_length(to_address) <= 128),
  mode text not null check (mode in ('recorded', 'pending', 'cloud_api', 'manual_link', 'instagram')),
  status text not null check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'needs_window', 'blocked',
                                          'handed_off', 'expired')),
  claimed_at timestamptz,
  attempts int not null default 0 check (attempts between 0 and 1),
  provider_message_id text check (char_length(provider_message_id) between 1 and 128),
  error_code text check (error_code ~ '^[0-9]{1,8}$'),
  not_after timestamptz not null,
  sent_at timestamptz,
  final_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, message_id) references books.outbound_message,
  foreign key (tenant_id, test_member_id) references ops.member,
  foreign key (tenant_id, test_text_id) references ops.message_text,
  check ((message_id is null) = (test_member_id is not null)),
  check ((test_member_id is null) = (test_text_id is null))
);

-- The shop's own test recipients (a consenting customer's contact, or a member for test sends), listed by an active
-- owner of a shop an operator granted WhatsApp, at most the grant's max_test_recipients; removed once.
create table ops.channel_recipient (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  contact_id uuid,
  member_id uuid,
  added_by uuid not null,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, contact_id) references ops.contact,
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, added_by) references ops.member,
  check (num_nonnulls(contact_id, member_id) = 1)
);

-- A number routed to one shop: the keyed HMAC of the E.164 number only (the key is its own secret, never the identity
-- key), written with its recipient, first-come across shops, erased with it. Global: the webhook reads it to find the
-- shop; the app and the jobs role see their own tenant's rows.
create table ops.phone_route (
  id uuid primary key default ops.uuidv7(),
  phone_hmac bytea check (octet_length(phone_hmac) = 32),
  tenant_id uuid not null references ops.tenant,
  recipient_id uuid not null,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  foreign key (tenant_id, recipient_id) references ops.channel_recipient,
  check (erased_at is not null or phone_hmac is not null)
);

-- A figure the extractor pointed at: its span in the live message (the transcript, or the text of a text message), the
-- span's sha256 and how core read it; never the quote. A digit span is re-parsed here: amounts are in paise and
-- quantities in thousandths, so "५००" for an amount is num 50000.
create table ops.inbound_extract (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  message_id uuid not null,
  run_id uuid not null,
  field text not null check (field in ('amount', 'date', 'service', 'quantity', 'item')),
  num bigint,
  day date,
  item_id uuid,
  span_start int not null check (span_start >= 0),
  span_end int not null,
  span_sha256 bytea not null check (octet_length(span_sha256) = 32),
  parsed_as text not null check (parsed_as in ('digits', 'words')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, message_id) references ops.inbound_message,
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, item_id) references books.item,
  check (span_end > span_start),
  check ((field in ('amount', 'quantity')) = (num is not null)),
  check ((field = 'date') = (day is not null)),
  check (field in ('service', 'item') or item_id is null),
  check (parsed_as = 'words' or field in ('amount', 'quantity'))
);

-- b_outbound_derive: the text exists, is unerased and has the book's sha256; the recipient is the tenant's of its kind
-- (a public post's is its campaign); a campaign or a reminder reaches a customer only with that purpose's consent given
-- through the customer's current, unerased contact (K2, K6; marketing for campaign.send, service for customer.remind).
create function books.outbound_derive() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  by_command text;
  purpose text;
  contact uuid;
begin
  if not exists (select 1 from ops.message_text t where t.tenant_id = new.tenant_id and t.id = new.text_id and t.erased_at is null
                    and t.body_sha256 = new.body_sha256) then
    raise exception 'message refused: its text is unerased and has its sha256' using errcode = 'MS006';
  end if;
  if not (case new.recipient_kind
           when 'customer' then exists (select 1 from books.customer x where x.tenant_id = new.tenant_id and x.id = new.recipient_id)
           when 'supplier' then exists (select 1 from books.supplier x where x.tenant_id = new.tenant_id and x.id = new.recipient_id)
           when 'staff' then exists (select 1 from books.staff x where x.tenant_id = new.tenant_id and x.id = new.recipient_id)
           else new.campaign_id is not distinct from new.recipient_id
                and exists (select 1 from ops.campaign x where x.tenant_id = new.tenant_id and x.id = new.recipient_id)
         end) then
    raise exception 'message refused: the recipient is this shop''s %', new.recipient_kind using errcode = 'MS007';
  end if;
  by_command := coalesce((select dr.command from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                           where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                         nullif(current_setting('munshi.command', true), ''));
  purpose := case by_command when 'campaign.send' then 'marketing' when 'customer.remind' then 'service' end;
  if purpose is not null and new.recipient_kind = 'customer' then
    contact := (select p.contact_id from books.party_contact p
                 where p.tenant_id = new.tenant_id and p.customer_id = new.recipient_id and p.effective_from <= now()
                 order by p.effective_from desc, p.created_at desc, p.id desc limit 1);
    if not exists (select 1 from ops.contact c where c.tenant_id = new.tenant_id and c.id = contact and c.erased_at is null)
       or not coalesce((select k.granted from books.customer_consent k
                         where k.tenant_id = new.tenant_id and k.customer_id = new.recipient_id and k.contact_id = contact
                           and k.channel = new.channel and k.purpose = purpose
                         order by k.created_at desc, k.id desc limit 1), false) then
      raise exception 'message refused: % reaches a customer only with % consent from their current contact', by_command, purpose
        using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;
revoke execute on function books.outbound_derive() from public;

-- z_outbound_delivery: the message's delivery, derived in its transaction (every field is delivery_derive's).
create function books.outbound_delivery() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into ops.delivery (tenant_id, message_id, channel, mode, status, not_after) values (new.tenant_id, new.id, new.channel, 'recorded', 'queued', now());
  return null;
end $$;
revoke execute on function books.outbound_delivery() from public;

-- delivery_derive: a delivery is the app's, for a message of this transaction or a member's test send of a text to
-- themself; every field is derived, whatever the caller sent. The address is the recipient's current, unerased contact
-- (a member's own phone for a test); with none the delivery is blocked at once. The mode is `recorded` unless the
-- deployment is live, the session real, the recipient no simulated supplier, the tenant holds a live grant for the
-- channel and, on WhatsApp, the recipient's contact or member is a listed test recipient: then `pending`, for the sender.
-- A reply must go within the 24 hours after the message it answers; anything else within a day.
create function ops.delivery_derive() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  msg books.outbound_message;
  contact uuid;
  member uuid;
  simulated boolean := false;
  real boolean;
  answered timestamptz;
begin
  if current_user <> 'munshi_app' then
    raise exception 'delivery refused: a delivery is derived by the app' using errcode = 'MS018';
  end if;
  if new.message_id is not null then
    select * into msg from books.outbound_message m where m.tenant_id = new.tenant_id and m.id = new.message_id;
    if msg.created_txid is distinct from txid_current() then
      raise exception 'delivery refused: a delivery is derived in its message''s transaction' using errcode = 'MS006';
    end if;
    new.channel := msg.channel;
    if msg.recipient_kind <> 'public' then
      contact := (select p.contact_id from books.party_contact p
                   where p.tenant_id = new.tenant_id and p.effective_from <= now()
                     and msg.recipient_id = case msg.recipient_kind when 'customer' then p.customer_id when 'supplier' then p.supplier_id else p.staff_id end
                   order by p.effective_from desc, p.created_at desc, p.id desc limit 1);
      new.to_address := (select c.phone_e164 from ops.contact c where c.tenant_id = new.tenant_id and c.id = contact and c.erased_at is null);
    else
      new.to_address := null;
    end if;
    simulated := msg.recipient_kind = 'supplier'
                 and coalesce((select s.is_simulated from books.supplier s where s.tenant_id = new.tenant_id and s.id = msg.recipient_id), true);
    answered := (select i.received_at from ops.inbound_message i where i.tenant_id = new.tenant_id and i.id = msg.reply_to_id);
  else
    if new.test_member_id is distinct from ctx_actor or not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active)
       or not exists (select 1 from ops.message_text t where t.tenant_id = new.tenant_id and t.id = new.test_text_id and t.erased_at is null) then
      raise exception 'delivery refused: a test send is an active member''s own, of a live text' using errcode = 'MS007';
    end if;
    member := ctx_actor;
    new.to_address := (select m.phone_e164 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor);
  end if;
  real := coalesce((select d.kind from ops.deployment d), 'demo') = 'live'
          and nullif(current_setting('munshi.via', true), '') is not distinct from 'real'
          and not simulated
          and coalesce((select g.granted from platform.channel_grant g
                          where g.tenant_id = new.tenant_id and g.channel = case new.channel when 'instagram' then 'instagram' else 'whatsapp' end
                          order by g.effective_from desc, g.id desc limit 1), false)
          and new.channel <> 'sms'
          and (new.channel = 'instagram' or exists (
                 select 1 from ops.channel_recipient r where r.tenant_id = new.tenant_id and r.removed_at is null
                    and (r.contact_id = contact or r.member_id = member)));
  new.mode := case when real then 'pending' else 'recorded' end;
  new.status := case when new.to_address is null and new.channel <> 'instagram' then 'blocked' else 'queued' end;
  new.claimed_at := null;
  new.attempts := 0;
  new.provider_message_id := null;
  new.error_code := null;
  new.sent_at := null;
  new.final_at := case when new.status = 'blocked' then now() end;
  new.not_after := least(coalesce(answered + interval '24 hours', 'infinity'), now() + interval '1 day');
  new.created_at := now();
  new.updated_at := now();
  new.erased_at := null;
  return new;
end $$;
revoke execute on function ops.delivery_derive() from public;

-- delivery_status: forward only. The jobs role (no actor) claims a queued delivery once (sending, one attempt), sends it
-- at most once (sent only from sending), and ends it; it may choose the adapter for a pending delivery as it claims it,
-- and a recorded one stays recorded. The webhook (the public role, no actor) records the provider's later statuses.
-- Nothing returns to queued. The address is erased by the jobs purge 30 days after the final status, or by an owner's
-- erasure of the contact.
create function ops.delivery_status() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  move text := old.status || '>' || new.status;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'delivery refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if new.message_id is distinct from old.message_id or new.test_member_id is distinct from old.test_member_id
     or new.test_text_id is distinct from old.test_text_id or new.channel is distinct from old.channel
     or new.not_after is distinct from old.not_after or new.created_at is distinct from old.created_at then
    raise exception 'delivery refused: a delivery''s message, channel and window never change' using errcode = 'MS010';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if new.status is distinct from old.status or new.mode is distinct from old.mode then
      raise exception 'delivery refused: an erasure changes only the address' using errcode = 'MS010';
    elsif ctx_actor is not null then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
        raise exception 'delivery refused: a person''s erasure of an address is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'delivery refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif old.final_at is null or old.final_at > now() - interval '30 days' then
      raise exception 'delivery refused: the purge erases an address 30 days after the final status' using errcode = 'MS007';
    end if;
    return new;
  end if;
  if current_user = 'munshi_jobs' then
    if not (move in ('queued>sending', 'queued>blocked', 'queued>needs_window', 'queued>expired', 'sending>sent', 'sending>failed',
                     'sending>needs_window', 'sending>blocked', 'sending>handed_off', 'sending>expired', 'sent>delivered', 'sent>read',
                     'sent>failed', 'delivered>read')) then
      raise exception 'delivery refused: the sender moves a delivery %', replace(move, '>', ' → ') using errcode = 'MS010';
    end if;
    if move = 'queued>sending' then
      if old.attempts <> 0 then
        raise exception 'delivery refused: a delivery is claimed once' using errcode = 'MS010';
      end if;
      new.claimed_at := now();
      new.attempts := 1;
    elsif new.claimed_at is distinct from old.claimed_at or new.attempts is distinct from old.attempts then
      raise exception 'delivery refused: the claim is set by the claim' using errcode = 'MS010';
    end if;
    if new.mode is distinct from old.mode and not (move = 'queued>sending' and old.mode = 'pending'
                                                    and new.mode in ('cloud_api', 'manual_link', 'instagram')) then
      raise exception 'delivery refused: only a pending delivery takes its adapter, as it is claimed' using errcode = 'MS010';
    end if;
  elsif current_user = 'munshi_public' then
    if not (move in ('sent>delivered', 'sent>read', 'sent>failed', 'delivered>read', 'delivered>failed')) then
      raise exception 'delivery refused: a provider status moves a delivery %', replace(move, '>', ' → ') using errcode = 'MS010';
    end if;
  else
    raise exception 'delivery refused: % does not move deliveries', current_user using errcode = 'MS018';
  end if;
  new.sent_at := case when move = 'sending>sent' then now() else old.sent_at end;
  new.final_at := case when old.final_at is not null then old.final_at
                       when new.status in ('delivered', 'read', 'failed', 'needs_window', 'blocked', 'handed_off', 'expired')
                         or (new.status = 'sent' and new.mode = 'recorded') then now() end;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function ops.delivery_status() from public;
create trigger derive before insert on ops.delivery for each row execute function ops.delivery_derive();
create trigger erase before update on ops.delivery for each row execute function ops.only_erase('to_address');
create trigger status before update on ops.delivery for each row execute function ops.delivery_status();

create function ops.recipient_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  cap int;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active) then
      raise exception 'recipient refused: an active owner lists the shop''s test recipients' using errcode = 'MS007';
    end if;
    perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
    cap := (select g.max_test_recipients from platform.channel_grant g where g.tenant_id = new.tenant_id and g.channel = 'whatsapp' and g.granted
             and g.effective_from = (select max(x.effective_from) from platform.channel_grant x where x.tenant_id = new.tenant_id and x.channel = 'whatsapp')
             order by g.id desc limit 1);
    if coalesce(cap, 0) <= (select count(*) from ops.channel_recipient r where r.tenant_id = new.tenant_id and r.removed_at is null) then
      raise exception 'recipient refused: the shop''s WhatsApp grant allows % test recipients', coalesce(cap, 0) using errcode = 'MS007';
    end if;
    if new.removed_at is not null then
      raise exception 'recipient refused: a new recipient is listed' using errcode = 'MS010';
    end if;
    new.added_by := ctx_actor;
    new.created_txid := txid_current();
    new.created_at := now();
    return new;
  end if;
  if old.removed_at is not null or new.removed_at is null or to_jsonb(new) - 'removed_at' <> to_jsonb(old) - 'removed_at' then
    raise exception 'recipient refused: a recipient is removed once, and otherwise never changes' using errcode = 'MS010';
  end if;
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active))
          or (current_user = 'munshi_jobs' and ctx_actor is null)) then
    raise exception 'recipient refused: an active owner or the jobs role removes a recipient' using errcode = 'MS007';
  end if;
  new.removed_at := now();
  return new;
end $$;
revoke execute on function ops.recipient_guard() from public;
create trigger guard before insert or update on ops.channel_recipient for each row execute function ops.recipient_guard();

-- route_guard: a route is written by the app for the current tenant, with its recipient in the recipient's
-- transaction; erased (and only erased) by an active owner or the jobs role once its recipient is removed.
create function ops.route_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or new.tenant_id is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid
       or not exists (select 1 from ops.channel_recipient r where r.tenant_id = new.tenant_id and r.id = new.recipient_id
                         and r.created_txid = txid_current() and r.removed_at is null) then
      raise exception 'route refused: a route is written with its recipient, for the current shop' using errcode = 'MS007';
    end if;
    new.created_at := now();
    new.erased_at := null;
    return new;
  end if;
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active))
          or (current_user = 'munshi_jobs' and ctx_actor is null))
     or not exists (select 1 from ops.channel_recipient r where r.tenant_id = new.tenant_id and r.id = new.recipient_id and r.removed_at is not null) then
    raise exception 'route refused: a route is erased with its removed recipient, by an active owner or the jobs role' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.route_guard() from public;
create trigger erase before update on ops.phone_route for each row execute function ops.only_erase('phone_hmac');
create trigger guard before insert or update on ops.phone_route for each row execute function ops.route_guard();

-- extract_span: an active member's run's figure, on a live message: the span lies inside its transcript (or a text
-- message's text) and hashes to span_sha256; a digit span, with digits in any script read as 0–9 and grouping commas
-- dropped, re-parses to num (paise for an amount, thousandths for a quantity), else MS006.
create function ops.extract_span() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  source text;
  span text;
  digits text;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
    raise exception 'extract refused: an extract is an active member''s run''s' using errcode = 'MS007';
  end if;
  source := (select coalesce(i.transcript, i.text) from ops.inbound_message i
              where i.tenant_id = new.tenant_id and i.id = new.message_id and i.erased_at is null);
  if source is null or new.span_end > char_length(source) then
    raise exception 'extract refused: the span lies inside the live message' using errcode = 'MS006';
  end if;
  span := substr(source, new.span_start + 1, new.span_end - new.span_start);
  if sha256(convert_to(span, 'UTF8')) <> new.span_sha256 then
    raise exception 'extract refused: the span does not hash to span_sha256' using errcode = 'MS006';
  end if;
  if new.parsed_as = 'digits' then
    digits := replace(translate(btrim(span),
      '०१२३४५६७८९০১২৩৪৫৬৭৮৯੦੧੨੩੪੫੬੭੮੯૦૧૨૩૪૫૬૭૮૯୦୧୨୩୪୫୬୭୮୯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯೦೧೨೩೪೫೬೭೮೯൦൧൨൩൪൫൬൭൮൯٠١٢٣٤٥٦٧٨٩０１２３４５６７８９',
      '01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789'), ',', '');
    if digits !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$'
       or digits::numeric * (case new.field when 'amount' then 100 else 1000 end) is distinct from new.num then
      raise exception 'extract refused: the digit span does not read as its number' using errcode = 'MS006';
    end if;
  end if;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.extract_span() from public;
create trigger span before insert on ops.inbound_extract for each row execute function ops.extract_span();

-- A booking is confirmed (booking.confirm) only with the customer's message naming it, written in the same
-- transaction (ruling, BP-DB-2): checked at commit, so the message may come before or after the state change.
create function ops.booking_message() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if old.state is distinct from 'confirmed' and new.state = 'confirmed' and not exists (
       select 1 from books.outbound_message m
        where m.tenant_id = new.tenant_id and m.booking_id = new.id and m.recipient_kind = 'customer' and m.recipient_id = new.customer_id
          and m.created_txid = txid_current()) then
    raise exception 'booking refused: a booking is confirmed with the customer''s message naming it' using errcode = 'MS007';
  end if;
  return null;
end $$;
revoke execute on function ops.booking_message() from public;
create constraint trigger z_booking_message after update on ops.booking deferrable initially deferred for each row
  execute function ops.booking_message();

-- 05's text guard, with 19's purge rules: the jobs purge erases a text 30 days after its Ask answer, 30 days after every
-- delivery of it reached its final status, or with the message it was made from (an answer or gloss of an erased
-- inbound message, review B2).
create or replace function ops.message_text_guard() returns trigger language plpgsql
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
    elsif not (
           exists (select 1 from ai.answer a
                    where a.tenant_id = new.tenant_id and a.text_id = new.id and a.kind = 'ask'
                      and a.created_at < now() - interval '30 days')
        or (exists (select 1 from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
                     where d.tenant_id = new.tenant_id and new.id in (m.text_id, d.test_text_id))
            and not exists (select 1 from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
                             where d.tenant_id = new.tenant_id and new.id in (m.text_id, d.test_text_id)
                               and (d.final_at is null or d.final_at > now() - interval '30 days')))
        or exists (select 1 from ai.answer a join ops.inbound_message i on i.tenant_id = a.tenant_id and i.id = a.inbound_message_id
                    where a.tenant_id = new.tenant_id and a.text_id = new.id and i.erased_at is not null)) then
      raise exception 'message text refused: the purge erases a text 30 days after its Ask answer or its last final delivery, or with its source message'
        using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;

-- ai.answer.inbound_message_id names the inbox message it was made from (07 declared the column, R4 B1).
alter table ai.answer add foreign key (tenant_id, inbound_message_id) references ops.inbound_message;

create trigger a_write before insert or update or delete on books.outbound_message for each row execute function books.write();
create trigger b_outbound_derive before insert on books.outbound_message for each row execute function books.outbound_derive();
create trigger z_audit after insert on books.outbound_message for each row execute function books.audit_row();
create trigger z_outbound_delivery after insert on books.outbound_message for each row execute function books.outbound_delivery();

-- Indexes, one per statement, each asserted in pg_index (G10).
create index campaign_status on ops.campaign (tenant_id, status);
create unique index inbound_provider on ops.inbound_message (tenant_id, provider_message_id);
create index inbound_from on ops.inbound_message (tenant_id, from_address, received_at);
create index inbound_status on ops.inbound_message (tenant_id, status, received_at);
create index inbound_live on ops.inbound_message (tenant_id, received_at) where erased_at is null;
create index outbound_recipient on books.outbound_message (tenant_id, recipient_kind, recipient_id);
create index outbound_campaign on books.outbound_message (tenant_id, campaign_id);
create index outbound_booking on books.outbound_message (tenant_id, booking_id) where booking_id is not null;
create index outbound_text on books.outbound_message (tenant_id, text_id);
create unique index delivery_message on ops.delivery (tenant_id, message_id) where message_id is not null;
create index delivery_due on ops.delivery (tenant_id, status, not_after);
create unique index delivery_provider on ops.delivery (tenant_id, provider_message_id) where provider_message_id is not null;
create index delivery_final_live on ops.delivery (tenant_id, final_at) where to_address is not null;
create index delivery_to on ops.delivery (tenant_id, to_address) where to_address is not null;
create index channel_recipient_channel on ops.channel_recipient (tenant_id, channel);
create unique index phone_route_hmac on ops.phone_route (phone_hmac) where erased_at is null;
create index phone_route_recipient on ops.phone_route (tenant_id, recipient_id);
create index inbound_extract_message on ops.inbound_extract (tenant_id, message_id);

-- The book table manifest and the commands (§2.4, §2.10.14). booking.confirm and sale.record (an order's delivered
-- update) gain the message.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.outbound_message', null, null, false, '{}', '{}', '{b_outbound_derive}');
insert into ref.command (command, draft_only) values
  ('reorder.place', false), ('campaign.send', true), ('campaign.post', true), ('message.reply', true), ('customer.remind', true);
insert into ref.command_authority (command, role) values
  ('reorder.place', 'owner'), ('reorder.place', 'manager'), ('campaign.send', 'owner'), ('campaign.post', 'owner'),
  ('message.reply', 'owner'), ('message.reply', 'manager'), ('customer.remind', 'owner'), ('customer.remind', 'manager');
insert into ref.command_table (command, rel)
select c, 'books.outbound_message' from unnest(array['reorder.place', 'campaign.send', 'campaign.post', 'message.reply', 'customer.remind',
                                                      'booking.confirm', 'sale.record']) c;
insert into ref.command_capability (command, capability, use) values
  ('reorder.place', 'buying', 'start'), ('campaign.send', 'campaigns', 'start'), ('campaign.post', 'campaigns', 'start'),
  ('message.reply', 'messaging', 'start'), ('customer.remind', 'messaging', 'start');

-- RLS and the grants (BLUEPRINT §2.10.7; the column grants past its cells are in the manifest notes).
alter table ops.campaign enable row level security;
alter table ops.campaign force row level security;
create policy tenant_isolation on ops.campaign
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.campaign from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (status, copy_text_id, card_document_id, updated_at) on ops.campaign to munshi_app;

alter table ops.inbound_message enable row level security;
alter table ops.inbound_message force row level security;
create policy tenant_isolation on ops.inbound_message
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.inbound_message from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
-- The webhook reads ids to update the media it fetched; an owner's contact erasure erases the inbox too (§2.6).
grant select (tenant_id, id, provider_message_id), insert, update (media_document_id, media_at) on ops.inbound_message to munshi_public;
grant select, update (status, handled_by, handled_at, transcript, transcribed_at, text, from_address, media_document_id, erased_at)
  on ops.inbound_message to munshi_app;
grant select, update (text, from_address, transcript, media_document_id, erased_at) on ops.inbound_message to munshi_jobs;

alter table books.outbound_message enable row level security;
alter table books.outbound_message force row level security;
create policy tenant_isolation on books.outbound_message
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.outbound_message from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.outbound_message to munshi_app;
grant select on books.outbound_message to munshi_jobs;

alter table ops.delivery enable row level security;
alter table ops.delivery force row level security;
create policy tenant_isolation on ops.delivery
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.delivery from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
-- The app inserts through the derive and erases an address with its contact; the webhook finds a delivery by its id.
grant select, insert, update (to_address, erased_at) on ops.delivery to munshi_app;
grant select, update (status, mode, claimed_at, attempts, provider_message_id, error_code, sent_at, final_at, updated_at, to_address, erased_at)
  on ops.delivery to munshi_jobs;
grant select (tenant_id, id, provider_message_id, status), update (status, error_code, final_at, updated_at) on ops.delivery to munshi_public;

alter table ops.channel_recipient enable row level security;
alter table ops.channel_recipient force row level security;
create policy tenant_isolation on ops.channel_recipient
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.channel_recipient from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (removed_at) on ops.channel_recipient to munshi_app;
grant select, update (removed_at) on ops.channel_recipient to munshi_jobs;

alter table ops.phone_route enable row level security;
alter table ops.phone_route force row level security;
create policy route_own on ops.phone_route to munshi_app, munshi_jobs
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy route_lookup on ops.phone_route for select to munshi_public using (erased_at is null);
revoke all on ops.phone_route from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (phone_hmac, erased_at) on ops.phone_route to munshi_app;
grant select on ops.phone_route to munshi_public;
grant select, update (phone_hmac, erased_at) on ops.phone_route to munshi_jobs;

alter table ops.inbound_extract enable row level security;
alter table ops.inbound_extract force row level security;
create policy tenant_isolation on ops.inbound_extract
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.inbound_extract from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.inbound_extract to munshi_app;
