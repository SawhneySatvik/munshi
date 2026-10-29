-- 21 · Orders: goods, stitching and alteration (BLUEPRINT §2.10.16, §8.12, decision 18). A confirmed order is a promise
-- to a person, so it is a book (R4 O1); intake is ops. An order request comes from any channel and holds no personal
-- data (a contact id at most); it becomes an order only in the transaction of the books.order naming it, written by
-- order.confirm (a person's own command or an approved draft). Each status change is an append-only step whose move is
-- in ref.order_flow, numbered latest + 1 under a unique key so two taps make one step (b_order_flow, ORD2); the order's
-- current step is derived into ops.order_state by z_order_state, and nothing else writes it. Measurements are body data
-- about a person, on the vault side, erased with their contact (M1). Then the keys earlier files left to this one
-- (R4 B1), the erasure holds of §2.6 (a contact is never erased while a balance of theirs is open), and the taint list.
-- No column here names a table of a later file.
set local role munshi_owner;

-- The steps an order may take, per kind, and the moves between them (non-negotiable 10, in Munim's form).
create table ref.order_step (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  kinds text[] not null check (cardinality(kinds) > 0 and kinds <@ array['goods', 'stitching', 'alteration']),
  terminal boolean not null,
  template_code text check (template_code ~ '^[a-z_]{2,40}$'),
  label_key text not null check (label_key ~ '^[a-z_.]{2,80}$')
);

create table ref.order_flow (
  kind text not null check (kind in ('goods', 'stitching', 'alteration')),
  from_step text not null references ref.order_step,
  to_step text not null references ref.order_step,
  primary key (kind, from_step, to_step)
);

create table ref.measure_point (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  label_key text not null check (label_key ~ '^[a-z_.]{2,80}$')
);

-- Seeds. A reschedule may come from any open step and leaves the order where it was: the next move is read from the
-- latest step that is not a reschedule (b_order_flow). An alteration may skip cutting; a stitched piece may go back
-- from its trial; goods may be picked up when ready.
insert into ref.order_step (code, kinds, terminal, template_code, label_key) values
  ('confirmed', '{goods,stitching,alteration}', false, 'order_confirmed', 'order.step.confirmed'),
  ('packed', '{goods}', false, null, 'order.step.packed'),
  ('cutting', '{stitching,alteration}', false, null, 'order.step.cutting'),
  ('stitching', '{stitching,alteration}', false, null, 'order.step.stitching'),
  ('trial', '{stitching,alteration}', false, 'order_trial', 'order.step.trial'),
  ('ready', '{goods,stitching,alteration}', false, 'order_ready', 'order.step.ready'),
  ('out_for_delivery', '{goods}', false, 'order_out_for_delivery', 'order.step.out_for_delivery'),
  ('delivered', '{goods,stitching,alteration}', true, 'order_delivered', 'order.step.delivered'),
  ('cancelled', '{goods,stitching,alteration}', true, 'order_cancelled', 'order.step.cancelled'),
  ('rescheduled', '{goods,stitching,alteration}', false, 'order_rescheduled', 'order.step.rescheduled');
insert into ref.order_flow (kind, from_step, to_step) values
  ('goods', 'confirmed', 'packed'), ('goods', 'confirmed', 'ready'), ('goods', 'packed', 'ready'),
  ('goods', 'ready', 'out_for_delivery'), ('goods', 'ready', 'delivered'), ('goods', 'out_for_delivery', 'delivered'),
  ('stitching', 'confirmed', 'cutting'), ('stitching', 'cutting', 'stitching'), ('stitching', 'stitching', 'trial'),
  ('stitching', 'stitching', 'ready'), ('stitching', 'trial', 'stitching'), ('stitching', 'trial', 'ready'),
  ('stitching', 'ready', 'delivered'),
  ('alteration', 'confirmed', 'cutting'), ('alteration', 'confirmed', 'stitching'), ('alteration', 'cutting', 'stitching'),
  ('alteration', 'stitching', 'trial'), ('alteration', 'stitching', 'ready'), ('alteration', 'trial', 'stitching'),
  ('alteration', 'trial', 'ready'), ('alteration', 'ready', 'delivered');
insert into ref.order_flow (kind, from_step, to_step)
select k, s.code, t from unnest(array['goods', 'stitching', 'alteration']) k
  join ref.order_step s on k = any (s.kinds) and not s.terminal and s.code <> 'rescheduled',
       unnest(array['cancelled', 'rescheduled']) t;
insert into ref.measure_point (code, label_key)
select p, 'measure.' || p from unnest(array['chest', 'waist', 'hip', 'shoulder', 'sleeve', 'length', 'bottom_length',
                                            'bottom_waist', 'neck']) p;

-- Intake from every channel. The site and widget channels carry the release they read and its lines; a message
-- channel names its inbox message. No name, phone or note: a contact id at most.
create table ops.order_request (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid not null,
  code text not null check (code ~ '^ORD-[A-Z0-9]{4,6}$'),
  channel text not null check (channel in ('site', 'widget', 'whatsapp', 'instagram', 'voice', 'photo')),
  kind text not null check (kind in ('goods', 'stitching', 'alteration')),
  release_id uuid,
  lines jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20
                     and not jsonb_path_exists(lines, 'strict $[*] ? (@.type() != "object")')
                     and not jsonb_path_exists(lines, 'strict $[*].keyvalue() ? (@.key != "itemId" && @.key != "qtyMilli")')
                     and not jsonb_path_exists(lines, 'strict $[*] ? (!exists(@.itemId) || !exists(@.qtyMilli))')
                     and not jsonb_path_exists(lines, 'strict $[*] ? (@.itemId.type() != "string" || !(@.itemId like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')
                     and not jsonb_path_exists(lines, 'strict $[*] ? (@.qtyMilli.type() != "number" || @.qtyMilli <= 0 || @.qtyMilli > 1000000000 || @.qtyMilli.floor() != @.qtyMilli)')),
  inbound_message_id uuid,
  contact_id uuid,
  state text not null default 'new' check (state in ('new', 'drafted', 'confirmed', 'declined', 'expired')),
  draft_id uuid,
  order_id uuid,
  handled_by uuid,
  handled_at timestamptz,
  reason text,
  reason_use text generated always as ('decline') stored,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, release_id) references ops.site_release,
  foreign key (tenant_id, inbound_message_id) references ops.inbound_message,
  foreign key (tenant_id, contact_id) references ops.contact,
  foreign key (tenant_id, draft_id) references approval.draft,
  foreign key (tenant_id, handled_by) references ops.member,
  foreign key (reason, reason_use) references ref.reason_use,
  check ((channel in ('site', 'widget')) = (release_id is not null)),
  check ((release_id is null) = (lines is null)),
  check (inbound_message_id is null or channel not in ('site', 'widget')),
  check ((state = 'declined') = (reason is not null))
);

-- order_request_flow, role-shaped (§2.3). The public (a site, a widget or the webhook) inserts a new request with no
-- actor; an active member may too. An active member moves new → drafted (naming its order.confirm draft), new or drafted
-- → confirmed (only in the transaction of the books.order naming this request, which the request then names) or
-- declined (with a decline reason); the jobs role moves new or drafted → expired once expires_at has passed.
create function ops.order_request_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  confirmed_by uuid;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'order request refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    -- Two branches, not one OR: the public role may not read ops.member, and a query's tables are checked as it starts.
    if current_user = 'munshi_app' then
      if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
        raise exception 'order request refused: a request comes from the public, or an active member' using errcode = 'MS018';
      end if;
    elsif current_user <> 'munshi_public' then
      raise exception 'order request refused: a request comes from the public, or an active member' using errcode = 'MS018';
    end if;
    if new.state <> 'new' or new.draft_id is not null or new.order_id is not null or new.handled_by is not null
       or new.handled_at is not null or new.reason is not null then
      raise exception 'order request refused: a request arrives new and unhandled' using errcode = 'MS007';
    end if;
    -- Each line names a good of this shop that is for sale (its revision in effect sellable): the site's cart offers
    -- nothing else, and a forged id stops here, not at the order.
    if new.lines is not null and exists (
         select 1 from jsonb_array_elements(new.lines) l(v)
          where not exists (
                  select 1 from books.item i
                   where i.tenant_id = new.tenant_id and i.id = (l.v ->> 'itemId')::uuid and i.kind = 'good'
                     and coalesce((select r.sellable from books.item_revision r
                                    where r.tenant_id = i.tenant_id and r.item_id = i.id and r.effective_from <= now()
                                    order by r.effective_from desc, r.created_at desc, r.id desc limit 1), false))) then
      raise exception 'order request refused: each line names a good this shop sells' using errcode = 'MS007';
    end if;
    new.created_at := now();
    new.expires_at := now() + interval '7 days';
    return new;
  end if;
  -- reason_use is generated, so a BEFORE trigger sees it NULL in NEW.
  if to_jsonb(new) - array['state', 'draft_id', 'order_id', 'handled_by', 'handled_at', 'reason', 'reason_use']
     <> to_jsonb(old) - array['state', 'draft_id', 'order_id', 'handled_by', 'handled_at', 'reason', 'reason_use'] then
    raise exception 'order request refused: a request changes only by its handling' using errcode = 'MS010';
  end if;
  if new.state is not distinct from old.state then
    raise exception 'order request refused: a request changes only its state' using errcode = 'MS010';
  end if;
  if current_user = 'munshi_app' then
    if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'order request refused: an active member handles a request' using errcode = 'MS007';
    end if;
    if new.state = 'drafted' and old.state = 'new' then
      if not exists (select 1 from approval.draft d where d.tenant_id = new.tenant_id and d.id = new.draft_id and d.command = 'order.confirm') then
        raise exception 'order request refused: a drafted request names its order.confirm draft' using errcode = 'MS007';
      end if;
    elsif new.state = 'confirmed' and old.state in ('new', 'drafted') then
      new.order_id := (select o.id from books.order o where o.tenant_id = new.tenant_id and o.request_id = new.id
                        and o.reverses_id is null and o.created_txid = txid_current());
      if new.order_id is null then
        raise exception 'order request refused: a request is confirmed only with the order that names it' using errcode = 'MS007';
      end if;
    elsif not (new.state = 'declined' and old.state in ('new', 'drafted')) then
      raise exception 'order request refused: a member moves a request % → %', old.state, new.state using errcode = 'MS010';
    end if;
    if new.state <> 'drafted' and new.draft_id is distinct from old.draft_id then
      raise exception 'order request refused: the draft is named by drafting' using errcode = 'MS010';
    end if;
    new.handled_by := ctx_actor;
    new.handled_at := now();
  elsif current_user = 'munshi_jobs' then
    if not (old.state in ('new', 'drafted') and new.state = 'expired' and old.expires_at <= now())
       or new.draft_id is distinct from old.draft_id or new.order_id is distinct from old.order_id then
      raise exception 'order request refused: the jobs role expires a request after expires_at' using errcode = 'MS007';
    end if;
  else
    raise exception 'order request refused: % does not move requests', current_user using errcode = 'MS018';
  end if;
  return new;
end $$;
revoke execute on function ops.order_request_flow() from public;
create trigger flow before insert or update on ops.order_request for each row execute function ops.order_request_flow();

-- The vault side: a person's measurements (any active member takes them, an ops action, not a command), one value per
-- point, inserted only in the measurement's transaction; the note and every value are erased with the contact (M1).
create table ops.measurement (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  contact_id uuid not null,
  taken_by uuid not null,
  taken_at timestamptz not null default now(),
  note text check (char_length(note) <= 200),
  created_txid bigint not null,
  erased_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, contact_id) references ops.contact,
  foreign key (tenant_id, taken_by) references ops.member
);

create table ops.measurement_value (
  tenant_id uuid not null references ops.tenant,
  measurement_id uuid not null,
  point text not null references ref.measure_point,
  mm int check (mm between 1 and 3000),
  erased_at timestamptz,
  primary key (tenant_id, measurement_id, point),
  foreign key (tenant_id, measurement_id) references ops.measurement,
  check (erased_at is not null or mm is not null)
);

-- measurement_guard: an active member takes a measurement, stamped; it is erased only once its contact is erased (by an
-- active owner with the contact, or the jobs purge after it). value_guard: a value only in its measurement's
-- transaction (MS006), erased only once its measurement is.
create function ops.measurement_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'measurement refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or not exists (
         select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active) then
      raise exception 'measurement refused: an active member takes a measurement' using errcode = 'MS007';
    end if;
    if new.erased_at is not null then
      raise exception 'measurement refused: a new measurement is not erased' using errcode = 'MS007';
    end if;
    new.taken_by := ctx_actor;
    new.taken_at := now();
    new.created_txid := txid_current();
    return new;
  end if;
  if to_jsonb(new) - array['note', 'erased_at'] <> to_jsonb(old) - array['note', 'erased_at'] then
    raise exception 'measurement refused: a measurement changes only by erasure' using errcode = 'MS010';
  end if;
  if old.erased_at is null and new.erased_at is not null and not (
       exists (select 1 from ops.contact c where c.tenant_id = new.tenant_id and c.id = new.contact_id and c.erased_at is not null)
       and ((current_user = 'munshi_app' and exists (
               select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active))
            or (current_user = 'munshi_jobs' and ctx_actor is null))) then
    raise exception 'measurement refused: a measurement is erased with its contact, by an active owner or the jobs purge' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.measurement_guard() from public;
create trigger erase before update on ops.measurement for each row execute function ops.only_erase('note');
create trigger guard before insert or update on ops.measurement for each row execute function ops.measurement_guard();

create function ops.measurement_value_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if current_user <> 'munshi_app' or not exists (
         select 1 from ops.measurement x where x.tenant_id = new.tenant_id and x.id = new.measurement_id
            and x.created_txid = txid_current() and x.taken_by = nullif(current_setting('munshi.actor_id', true), '')::uuid) then
      raise exception 'measurement refused: a value is taken in its measurement''s transaction, by its taker' using errcode = 'MS006';
    end if;
    if new.erased_at is not null then
      raise exception 'measurement refused: a new value is not erased' using errcode = 'MS007';
    end if;
    return new;
  end if;
  if new.point is distinct from old.point or new.measurement_id is distinct from old.measurement_id
     or (old.erased_at is null and new.erased_at is not null and not exists (
           select 1 from ops.measurement x where x.tenant_id = new.tenant_id and x.id = new.measurement_id and x.erased_at is not null)) then
    raise exception 'measurement refused: a value is erased with its measurement' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.measurement_value_guard() from public;
create trigger erase before update on ops.measurement_value for each row execute function ops.only_erase('mm');
create trigger guard before insert or update on ops.measurement_value for each row execute function ops.measurement_value_guard();

-- The order: an immutable header; a reversal voids an order entered in error (§2.9). Its customer is a person, always.
create table books.order (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid not null,
  request_id uuid,
  customer_id uuid not null,
  kind text not null check (kind in ('goods', 'stitching', 'alteration')),
  code text not null check (code ~ '^ORD-[A-Z0-9]{4,6}$'),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, request_id) references ops.order_request,
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, reverses_id) references books.order,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- Its lines key on (order, currency) (R4 N11).
create unique index order_currency on books.order (tenant_id, id, currency);

-- A line: an item of its kind, priced by a books.price row or by the person's own typed quote (a money member input),
-- exactly one; its unit price is the cited row's (b_order_price); its gross the counter's line function's (ORD1, core).
create table books.order_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  order_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  item_id uuid not null,
  item_kind text not null,
  price_id uuid,
  quote_input_id uuid,
  qty_milli bigint not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  gross_minor bigint not null,
  currency char(3) not null,
  measurement_id uuid,
  note_text_id uuid,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id, currency) references books.order (tenant_id, id, currency),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, price_id) references books.price,
  foreign key (tenant_id, quote_input_id) references ops.member_input,
  foreign key (tenant_id, measurement_id) references ops.measurement,
  foreign key (tenant_id, note_text_id) references ops.message_text,
  foreign key (tenant_id, reverses_id) references books.order_line,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (num_nonnulls(price_id, quote_input_id) = 1),
  check ((reverses_id is null) = (qty_milli > 0)),
  check (reverses_id is not null or gross_minor >= 0),
  check ((reverses_id is null) = (reason is null))
);

-- A step: not a child (steps arrive in later transactions), never edited; numbered and judged by b_order_flow.
create table books.order_step (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  order_id uuid not null,
  step_no int not null check (step_no > 0),
  step text not null references ref.order_step,
  due_on date,
  trial_on date,
  message_id uuid,
  reason text,
  reason_use text generated always as ('cancel') stored,
  at timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references books.order,
  foreign key (tenant_id, message_id) references books.outbound_message,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((due_on is null and trial_on is null) or step in ('confirmed', 'rescheduled')),
  check (reason is null or step in ('cancelled', 'rescheduled')),
  check (step <> 'cancelled' or reason is not null)
);

-- The derived projection: the order's current step, due date and trial date, written only by z_order_state.
create table ops.order_state (
  tenant_id uuid not null references ops.tenant,
  order_id uuid not null,
  step text not null references ref.order_step,
  step_no int not null check (step_no > 0),
  due_on date,
  trial_on date,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, order_id),
  foreign key (tenant_id, order_id) references books.order
);

-- b_order_price: an original line's unit price is its cited row's: the books.price row's amount (in the line's
-- currency), or the member input's number, a money input in that currency typed by the member writing the order (the
-- quote labelled "typed by <name>").
create function books.order_price() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.reverses_id is not null then
    return new;
  end if;
  if (new.price_id is not null and not exists (
        select 1 from books.price p where p.tenant_id = new.tenant_id and p.id = new.price_id and p.item_id = new.item_id
           and p.amount_minor = new.unit_price_minor and p.currency = new.currency))
     or (new.quote_input_id is not null and not exists (
        select 1 from ops.member_input i where i.tenant_id = new.tenant_id and i.id = new.quote_input_id and i.kind = 'money'
           and i.num = new.unit_price_minor and i.currency = new.currency and i.member_id = new.created_by)) then
    raise exception 'order refused: a line''s unit price is its price row''s, or its taker''s own typed quote' using errcode = 'MS006';
  end if;
  return new;
end $$;
revoke execute on function books.order_price() from public;

-- b_order_flow (§2.10.16, ORD2): step_no is the latest + 1, so two taps at once race on the unique key and one gets
-- 23505; the first step is confirmed and only the first; a reschedule may follow any open step, and any other step
-- must be a move in ref.order_flow, for the order's kind, from the latest step that is not a reschedule (the flow has no
-- move out of a terminal step, so nothing follows one); a voided order takes none; each step is its command's (confirmed by order.confirm, rescheduled by order.reschedule, cancelled
-- by order.cancel, delivered by sale.record inside the transaction of the sale naming the order, the rest by
-- order.step); a trial date only for stitching and alteration; the customer's update is a message of this order's,
-- written in this transaction. Else MS019.
create function books.order_flow() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  o books.order;
  latest text;
  standing text;
  by_command text;
  wants text;
begin
  select * into o from books.order x where x.tenant_id = new.tenant_id and x.id = new.order_id;
  new.step_no := coalesce((select max(s.step_no) from books.order_step s where s.tenant_id = new.tenant_id and s.order_id = new.order_id), 0) + 1;
  latest := (select s.step from books.order_step s where s.tenant_id = new.tenant_id and s.order_id = new.order_id
              order by s.step_no desc limit 1);
  standing := (select s.step from books.order_step s where s.tenant_id = new.tenant_id and s.order_id = new.order_id
                and s.step <> 'rescheduled' order by s.step_no desc limit 1);
  by_command := coalesce((select dr.command from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                           where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                         nullif(current_setting('munshi.command', true), ''));
  wants := case new.step when 'confirmed' then 'order.confirm' when 'rescheduled' then 'order.reschedule' when 'cancelled' then 'order.cancel'
                         when 'delivered' then 'sale.record' else 'order.step' end;
  if o.reverses_id is not null or exists (select 1 from books.order v where v.tenant_id = new.tenant_id and v.reverses_id = o.id) then
    raise exception 'order step refused: a voided order takes no step' using errcode = 'MS019';
  end if;
  if by_command is distinct from wants then
    raise exception 'order step refused: a % step is written by %, not %', new.step, wants, by_command using errcode = 'MS019';
  end if;
  if (latest is null) <> (new.step = 'confirmed') then
    raise exception 'order step refused: an order''s first step, and only its first, is confirmed' using errcode = 'MS019';
  end if;
  if latest is not null and not exists (select 1 from ref.order_flow f where f.kind = o.kind and f.from_step = standing and f.to_step = new.step) then
    raise exception 'order step refused: % does not follow % for a % order', new.step, latest, o.kind using errcode = 'MS019';
  end if;
  if new.step = 'delivered' and not exists (
       select 1 from books.sale s where s.tenant_id = new.tenant_id and s.order_id = new.order_id and s.reverses_id is null
          and s.created_txid = txid_current()) then
    raise exception 'order step refused: an order is delivered only by the sale that names it' using errcode = 'MS019';
  end if;
  if new.trial_on is not null and o.kind = 'goods' then
    raise exception 'order step refused: a trial date is for stitching and alteration' using errcode = 'MS019';
  end if;
  if new.message_id is not null and not exists (
       select 1 from books.outbound_message m where m.tenant_id = new.tenant_id and m.id = new.message_id and m.order_id = new.order_id
          and m.created_txid = txid_current()) then
    raise exception 'order step refused: a step''s update is this order''s message, written with it' using errcode = 'MS019';
  end if;
  return new;
end $$;
revoke execute on function books.order_flow() from public;

-- z_order_confirmed: at commit an order (not a reversal) has its confirmed step, written by order.confirm with it, so
-- every order has its projection, shows on the board and holds its customer's erasure while open (MS019).
create function books.order_confirmed() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.reverses_id is null and not exists (
       select 1 from books.order_step s where s.tenant_id = new.tenant_id and s.order_id = new.id and s.step = 'confirmed') then
    raise exception 'order refused: an order is confirmed with its first step, in its own transaction' using errcode = 'MS019';
  end if;
  return null;
end $$;
revoke execute on function books.order_confirmed() from public;

-- z_order_state: the order's projection, inserted with its first step and moved with each later one; the due and trial
-- dates carry over from the latest step that set them.
create function books.order_state() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into ops.order_state as s (tenant_id, order_id, step, step_no, due_on, trial_on, updated_at)
  values (new.tenant_id, new.order_id, new.step, new.step_no, new.due_on, new.trial_on, now())
  on conflict (tenant_id, order_id) do update
    set step = excluded.step, step_no = excluded.step_no, due_on = coalesce(excluded.due_on, s.due_on),
        trial_on = coalesce(excluded.trial_on, s.trial_on), updated_at = now();
  return null;
end $$;
revoke execute on function books.order_state() from public;

create trigger a_write before insert or update or delete on books.order for each row execute function books.write();
create trigger z_audit after insert on books.order for each row execute function books.audit_row();
create constraint trigger z_order_confirmed after insert on books.order deferrable initially deferred for each row
  execute function books.order_confirmed();
create constraint trigger z_reversal_complete after insert on books.order deferrable initially deferred for each row
  execute function books.check_reversal();
create trigger a_write before insert or update or delete on books.order_line for each row execute function books.write();
create trigger b_order_price before insert on books.order_line for each row execute function books.order_price();
create trigger z_audit after insert on books.order_line for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.order_step for each row execute function books.write();
create trigger b_order_flow before insert on books.order_step for each row execute function books.order_flow();
create trigger z_audit after insert on books.order_step for each row execute function books.audit_row();
create trigger z_order_state after insert on books.order_step for each row execute function books.order_state();
-- order_state_guard: no direct write; only z_order_state's, inside the step's trigger (pg_trigger_depth() > 1).
create trigger order_state_guard before insert or update on ops.order_state for each row execute function ops.only_from_trigger();

-- The erasure holds (§2.6, M1): a contact is erased (by an active owner's request or the jobs purge) only when no
-- balance of a customer, staff member or supplier linked to it is open: credit, an unexpired package holding with value
-- or sessions left, loyalty points, an unrecovered staff advance, a booking still ahead, an open order (its current step
-- not terminal) or an unapplied advance (§8.12: its payments in less refunds out, less the delivery sales' debits to
-- customer_advance, plus the credit entries naming its payments, which are negative: what was kept as the customer's
-- credit); and the purge, unless the owner asked, only when every
-- linked row has been idle for a year. A contact is erased with its measurements and their values, in one transaction
-- (z_contact_measurements, M1).
create function ops.contact_hold() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  today date := (now() at time zone (select t.time_zone from ops.tenant t where t.tenant_id = new.tenant_id))::date;
  customers uuid[];
  people uuid[];
begin
  if not (old.erased_at is null and new.erased_at is not null) then
    return new;
  end if;
  customers := array(select p.customer_id from books.party_contact p where p.tenant_id = new.tenant_id and p.contact_id = new.id and p.customer_id is not null);
  people := array(select coalesce(p.customer_id, p.staff_id, p.supplier_id) from books.party_contact p where p.tenant_id = new.tenant_id and p.contact_id = new.id);
  if coalesce((select sum(e.amount_minor) from books.credit_entry e where e.tenant_id = new.tenant_id and e.customer_id = any (customers)), 0) <> 0
     or exists (select 1 from books.package_holding h
                 where h.tenant_id = new.tenant_id and h.customer_id = any (customers) and h.expires_on >= today
                   and exists (select 1 from books.package_entry e where e.tenant_id = h.tenant_id and e.holding_id = h.id
                                  and e.seq = (select max(x.seq) from books.package_entry x where x.tenant_id = h.tenant_id and x.holding_id = h.id)
                                  and (e.value_after > 0 or e.sessions_after > 0)))
     or exists (select 1 from books.loyalty_entry l
                 where l.tenant_id = new.tenant_id and l.customer_id = any (customers) and l.balance_after > 0
                   and l.seq = (select max(x.seq) from books.loyalty_entry x where x.tenant_id = l.tenant_id and x.customer_id = l.customer_id))
     or exists (select 1 from books.staff s
                 where s.tenant_id = new.tenant_id and s.id = any (people)
                   and coalesce((select sum(a.amount_minor) from books.advance a where a.tenant_id = s.tenant_id and a.staff_id = s.id), 0)
                       > coalesce((select sum(l.advance_recovered_minor) from books.salary_line l where l.tenant_id = s.tenant_id and l.staff_id = s.id), 0))
     or exists (select 1 from ops.booking b where b.tenant_id = new.tenant_id and b.customer_id = any (customers)
                   and b.state in ('requested', 'confirmed') and upper(b.during) > now())
     or exists (select 1 from books.order o join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id
                  join ref.order_step r on r.code = st.step
                 where o.tenant_id = new.tenant_id and o.customer_id = any (customers) and o.reverses_id is null and not r.terminal
                   and not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id))
     or exists (select 1 from books.order o
                 where o.tenant_id = new.tenant_id and o.customer_id = any (customers)
                   and coalesce((select sum(case p.direction when 'in' then p.amount_minor else -p.amount_minor end) from books.payment p
                                  where p.tenant_id = o.tenant_id and p.order_id = o.id), 0)
                       - coalesce((select sum(l.amount_minor) from books.journal_line l join books.journal_entry j on j.tenant_id = l.tenant_id and j.id = l.entry_id
                                    join books.sale s on s.tenant_id = j.tenant_id and s.id = j.source_id
                                   where l.tenant_id = o.tenant_id and s.order_id = o.id and l.account = 'customer_advance'), 0)
                       + coalesce((select sum(e.amount_minor) from books.credit_entry e join books.payment p on p.tenant_id = e.tenant_id and p.id = e.payment_id
                                   where e.tenant_id = o.tenant_id and p.order_id = o.id), 0) <> 0) then
    raise exception 'contact refused: a contact is not erased while a balance of theirs is open' using errcode = 'MS007';
  end if;
  if current_user = 'munshi_jobs' and old.erase_requested_at is null and (
       exists (select 1 from books.sale x where x.tenant_id = new.tenant_id and x.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.credit_entry x where x.tenant_id = new.tenant_id and x.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.package_entry x join books.package_holding h on h.tenant_id = x.tenant_id and h.id = x.holding_id
                   where x.tenant_id = new.tenant_id and h.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.loyalty_entry x where x.tenant_id = new.tenant_id and x.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.outbound_message x where x.tenant_id = new.tenant_id and x.recipient_id = any (people) and x.created_at > now() - interval '1 year')
       or exists (select 1 from ops.booking x where x.tenant_id = new.tenant_id and x.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.order x where x.tenant_id = new.tenant_id and x.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.order_step x join books.order o on o.tenant_id = x.tenant_id and o.id = x.order_id
                   where x.tenant_id = new.tenant_id and o.customer_id = any (customers) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.attendance x where x.tenant_id = new.tenant_id and x.staff_id = any (people) and x.created_at > now() - interval '1 year')
       or exists (select 1 from books.purchase x where x.tenant_id = new.tenant_id and x.supplier_id = any (people) and x.created_at > now() - interval '1 year')) then
    raise exception 'contact refused: the purge erases a contact whose every linked row has been idle for a year' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.contact_hold() from public;
create trigger hold before update on ops.contact for each row execute function ops.contact_hold();

create function ops.contact_measurements() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if old.erased_at is null and new.erased_at is not null and (
       exists (select 1 from ops.measurement m where m.tenant_id = new.tenant_id and m.contact_id = new.id and m.erased_at is null)
       or exists (select 1 from ops.measurement_value v join ops.measurement m on m.tenant_id = v.tenant_id and m.id = v.measurement_id
                   where v.tenant_id = new.tenant_id and m.contact_id = new.id and v.erased_at is null)) then
    raise exception 'contact refused: a contact is erased with its measurements and every value, in one transaction' using errcode = 'MS007';
  end if;
  return null;
end $$;
revoke execute on function ops.contact_measurements() from public;
create constraint trigger z_contact_measurements after update on ops.contact deferrable initially deferred for each row
  execute function ops.contact_measurements();

-- The taint list (§7.8, R4 O1): a draft from a run that read untrusted text is only one of the recipes a person's tap
-- starts, order.confirm among them. Core's port refuses first; this is the database's fence.
create function approval.taint_recipe() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.source = 'run' and exists (select 1 from ai.run r where r.tenant_id = new.tenant_id and r.id = new.run_id and r.tainted)
     and new.command not in ('booking.confirm', 'message.reply', 'credit.record', 'purchase.record', 'order.confirm') then
    raise exception 'draft refused: a tainted run proposes only its tapped recipe, not %', new.command using errcode = 'MS002';
  end if;
  return new;
end $$;
revoke execute on function approval.taint_recipe() from public;
create trigger taint before insert on approval.draft for each row execute function approval.taint_recipe();

-- The keys earlier files left to this one (R4 B1): each order column declared in 15, 19 and here.
alter table books.sale add foreign key (tenant_id, order_id) references books.order;
alter table books.sale_line add foreign key (tenant_id, order_line_id) references books.order_line;
alter table books.payment add foreign key (tenant_id, order_id) references books.order;
alter table books.outbound_message add foreign key (tenant_id, order_id) references books.order;
alter table ops.order_request add foreign key (tenant_id, order_id) references books.order;

-- Indexes, one per statement, each asserted in pg_index (G10). credit_payment serves the unapplied advance (§8.12).
create unique index order_request_code on ops.order_request (tenant_id, code);
create index order_request_open on ops.order_request (tenant_id, state, created_at);
create index order_request_inbound on ops.order_request (tenant_id, inbound_message_id) where inbound_message_id is not null;
create index order_customer on books.order (tenant_id, customer_id);
create unique index order_code on books.order (tenant_id, code) where reverses_id is null;
create unique index order_reverses on books.order (tenant_id, reverses_id) where reverses_id is not null;
create index order_request_order on books.order (tenant_id, request_id) where request_id is not null;
create unique index order_line_no on books.order_line (tenant_id, order_id, line_no);
create unique index order_line_reverses on books.order_line (tenant_id, reverses_id) where reverses_id is not null;
create unique index order_step_no on books.order_step (tenant_id, order_id, step_no);
create index order_step_latest on books.order_step (tenant_id, order_id, step_no desc);
create index order_state_board on ops.order_state (tenant_id, step, due_on);
create index order_state_late on ops.order_state (tenant_id, due_on) where step not in ('ready', 'cancelled', 'delivered');
create index measurement_contact on ops.measurement (tenant_id, contact_id, taken_at desc);
create index outbound_order on books.outbound_message (tenant_id, order_id) where order_id is not null;
create index credit_payment on books.credit_entry (tenant_id, payment_id) where payment_id is not null;

-- The book table manifest and the commands (§2.4, §2.9, §2.10.14, §8.12).
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.order', null, null, true, '{}', '{shop_id,request_id,customer_id,kind,code,currency}', '{}'),
  ('books.order_line', 'books.order', 'order_id', true, '{qty_milli,gross_minor}',
   '{line_no,item_id,item_kind,price_id,quote_input_id,unit_price_minor,currency,measurement_id,note_text_id}', '{b_order_price}'),
  ('books.order_step', null, null, false, '{}', '{}', '{b_order_flow}');
insert into ref.command (command, draft_only) values
  ('order.confirm', false), ('order.step', false), ('order.reschedule', false), ('order.cancel', false), ('order.reverse', false);
insert into ref.command_authority (command, role)
select c, r from unnest(array['order.confirm', 'order.step', 'order.reschedule']) c, unnest(array['owner', 'manager', 'staff']) r
union all
select c, r from unnest(array['order.cancel', 'order.reverse']) c, unnest(array['owner', 'manager']) r;
insert into ref.command_table (command, rel)
select 'order.confirm', t from unnest(array['books.order', 'books.order_line', 'books.order_step', 'books.outbound_message', 'books.customer',
                                            'books.customer_terms', 'books.party_contact']) t
union all
select c, t from unnest(array['order.step', 'order.reschedule', 'order.cancel']) c, unnest(array['books.order_step', 'books.outbound_message']) t
union all
select 'order.reverse', t from unnest(array['books.order', 'books.order_line']) t
union all
select 'sale.record', 'books.order_step';
insert into ref.command_capability (command, capability, use) values
  ('order.confirm', 'orders', 'start'), ('order.confirm', 'stitching', 'start'), ('order.step', 'orders', 'finish'),
  ('order.reschedule', 'orders', 'finish'), ('order.cancel', 'orders', 'finish'), ('order.reverse', 'orders', 'finish');

-- RLS and the grants.
alter table ref.order_step enable row level security;
alter table ref.order_step force row level security;
create policy global_rows on ref.order_step using (true) with check (true);
revoke all on ref.order_step from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.order_step to munshi_app, munshi_jobs;

alter table ref.order_flow enable row level security;
alter table ref.order_flow force row level security;
create policy global_rows on ref.order_flow using (true) with check (true);
revoke all on ref.order_flow from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.order_flow to munshi_app, munshi_jobs;

alter table ref.measure_point enable row level security;
alter table ref.measure_point force row level security;
create policy global_rows on ref.measure_point using (true) with check (true);
revoke all on ref.measure_point from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.measure_point to munshi_app, munshi_jobs;

alter table ops.order_request enable row level security;
alter table ops.order_request force row level security;
create policy tenant_isolation on ops.order_request
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.order_request from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select (code, state), insert on ops.order_request to munshi_public;
-- The order status page (GET /sites/{slug}/orders/{code}): the code is the capability. The public role reads a request,
-- an order or its steps only under the code the route was given (munshi.order_code, SET LOCAL in its transaction), so it
-- can read the one it holds and never list the others.
create policy order_code_public on ops.order_request as restrictive for select to munshi_public
  using (code = nullif(current_setting('munshi.order_code', true), ''));
grant select, insert, update (state, draft_id, order_id, handled_by, handled_at, reason) on ops.order_request to munshi_app;
grant select, update (state) on ops.order_request to munshi_jobs;

alter table ops.measurement enable row level security;
alter table ops.measurement force row level security;
create policy tenant_isolation on ops.measurement
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.measurement from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (note, erased_at) on ops.measurement to munshi_app;
grant select, update (note, erased_at) on ops.measurement to munshi_jobs;

alter table ops.measurement_value enable row level security;
alter table ops.measurement_value force row level security;
create policy tenant_isolation on ops.measurement_value
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.measurement_value from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (mm, erased_at) on ops.measurement_value to munshi_app;
-- The purge's UPDATE needs SELECT to find its rows.
grant select, update (mm, erased_at) on ops.measurement_value to munshi_jobs;

alter table books.order enable row level security;
alter table books.order force row level security;
create policy tenant_isolation on books.order
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.order from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.order to munshi_app;
grant select on books.order to munshi_jobs;
grant select (tenant_id, id, code, reverses_id) on books.order to munshi_public;
create policy order_code_public on books.order as restrictive for select to munshi_public
  using (code = nullif(current_setting('munshi.order_code', true), ''));

alter table books.order_line enable row level security;
alter table books.order_line force row level security;
create policy tenant_isolation on books.order_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.order_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.order_line to munshi_app;
grant select on books.order_line to munshi_jobs;

alter table books.order_step enable row level security;
alter table books.order_step force row level security;
create policy tenant_isolation on books.order_step
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.order_step from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.order_step to munshi_app;
grant select on books.order_step to munshi_jobs;
grant select (tenant_id, order_id, step, step_no, at) on books.order_step to munshi_public;
-- Only the steps of an order the public can read, which is the one whose code the route set.
create policy order_code_public on books.order_step as restrictive for select to munshi_public
  using (exists (select 1 from books.order o where o.tenant_id = order_step.tenant_id and o.id = order_step.order_id));

alter table ops.order_state enable row level security;
alter table ops.order_state force row level security;
create policy tenant_isolation on ops.order_state
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.order_state from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (step, step_no, due_on, trial_on, updated_at) on ops.order_state to munshi_app;
grant select on ops.order_state to munshi_jobs;
