-- 24 · PayPal payment links (PayPal's sandbox): the outbox of approved links, PayPal ids routed to their shop, and the
-- provider notifications the webhook stores. None is a book: PayPal holds and moves the money; a payment is recorded only
-- by an approved "record this payment" draft (payment.record, method paypal, into paypal_clearing; 01 and 15 carry the
-- account and the tender in place). A link asks for what a customer owes on credit, what an invoice's sale still owes, or
-- what a confirmed order still needs beyond its advance. The two commands write no books table: their effect is the ops.paypal_link row, so
-- 90_seal exempts them from command totality. No column here names a table of a later file.
set local role munshi_owner;

-- A PayPal payment link, an outbox row: queued only as an approved paypal.request's effect, in its decision's
-- transaction, under the approver, for exactly what the draft's payload says (the guard binds them). No PayPal call
-- happens in that transaction: the jobs role's sweep asks PayPal with the draft's id as the request id, and records
-- PayPal's id, the payer page and sent (or failed after its attempts). An approved paypal.cancel moves a queued link to
-- cancelled, or a sent one to cancel_queued, which the sweep cancels at PayPal. PayPal holds and moves the money; this
-- row keeps what was asked. Never a book row.
create table ops.paypal_link (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  draft_id uuid not null,
  decision_id uuid not null,
  purpose text not null check (purpose in ('credit', 'invoice', 'order')),
  customer_id uuid not null,
  invoice_id uuid,
  order_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  figure text not null check (length(figure) between 1 and 200),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancel_queued', 'cancelled')),
  mode text check (mode in ('sandbox', 'recorded')),
  paypal_id text check (paypal_id ~ '^[A-Za-z0-9-]{1,64}$'),
  payer_url text check (char_length(payer_url) <= 490 and payer_url ~ '^https://[^\s]+$'), -- a bound over 255 is no regex
  attempts int not null default 0 check (attempts between 0 and 10),
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  sent_at timestamptz,
  cancel_draft_id uuid,
  cancel_decision_id uuid,
  cancelled_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, draft_id) references approval.draft,
  foreign key (tenant_id, decision_id) references approval.decision,
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, invoice_id) references books.invoice,
  foreign key (tenant_id, order_id) references books.order,
  foreign key (tenant_id, cancel_draft_id) references approval.draft,
  foreign key (tenant_id, cancel_decision_id) references approval.decision,
  foreign key (tenant_id, created_by) references ops.member,
  check ((purpose = 'invoice') = (invoice_id is not null)),
  check ((purpose = 'order') = (order_id is not null)),
  check ((paypal_id is null) = (sent_at is null) and (paypal_id is null) = (mode is null)),
  check (status not in ('sent', 'cancel_queued') or paypal_id is not null),
  check ((cancel_draft_id is null) = (cancel_decision_id is null)),
  check (status not in ('cancel_queued', 'cancelled') or cancel_draft_id is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index paypal_link_draft on ops.paypal_link (tenant_id, draft_id);
create unique index paypal_link_paypal_id on ops.paypal_link (tenant_id, paypal_id) where paypal_id is not null;
create index paypal_link_customer on ops.paypal_link (tenant_id, customer_id);
create index paypal_link_invoice on ops.paypal_link (tenant_id, invoice_id) where invoice_id is not null;
create index paypal_link_order on ops.paypal_link (tenant_id, order_id) where order_id is not null;
create index paypal_link_due on ops.paypal_link (tenant_id, created_at) where status in ('queued', 'cancel_queued');

-- Insert: only munshi_app, queued and blank, under an approved paypal.request decision made in this transaction by the
-- acting member (active, holding the command), for that very draft, with the purpose, customer, invoice, order and figure its
-- payload names, and for exactly the amount and currency of the money cell that figure cites (read from its stored
-- snapshot here, so the ask is the cell's, not core's word); created_by and decision_id are stamped from it.
-- Update: what was asked never changes and attempts never decreases. munshi_jobs moves queued to sent (once) or failed,
-- and cancel_queued to cancelled (or back to sent when PayPal would not cancel); munshi_app moves only a queued link to
-- cancelled or a sent one to cancel_queued, under an approved paypal.cancel decision of this transaction for this link.
create function ops.paypal_link_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_decision uuid := nullif(current_setting('munshi.decision_id', true), '')::uuid;
  decided_draft uuid;
  cited text[];
  cell jsonb;
begin
  if tg_op = 'INSERT' then
    cited := regexp_match(new.figure, '^⟨snap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})·([0-9]{1,3})·([a-z_][a-z0-9_]{0,62})⟩$');
    if cited is not null then
      select s.rows -> (cited[2])::int -> (k.i - 1)::int into cell
        from snap.snapshot s, jsonb_array_elements(s.columns) with ordinality k(c, i)
       where s.tenant_id = new.tenant_id and s.id = cited[1]::uuid and k.c ->> 'n' = cited[3];
    end if;
    if cell is null or cell ->> 'k' is distinct from 'money' or (cell ->> 'n')::bigint is distinct from new.amount_minor
       or cell ->> 'c' is distinct from new.currency then
      raise exception 'paypal link refused: the amount is the cited cell''s, in its currency' using errcode = 'MS007';
    end if;
    if current_user <> 'munshi_app' or new.status <> 'queued' or new.attempts <> 0
       or num_nonnulls(new.mode, new.paypal_id, new.payer_url, new.sent_at, new.error_code, new.cancel_draft_id, new.cancel_decision_id, new.cancelled_at) > 0
       or not exists (
         select 1 from approval.decision d
           join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
           join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by and m.active
           join ref.command_authority ca on ca.command = dr.command and ca.role = m.role
          where d.tenant_id = new.tenant_id and d.id = ctx_decision and d.verdict = 'approved' and d.created_txid = txid_current()
            and d.decided_by = ctx_actor and dr.command = 'paypal.request' and dr.id = new.draft_id
            and dr.payload ->> 'purpose' = new.purpose and dr.payload ->> 'customerId' = new.customer_id::text
            and (dr.payload ->> 'invoiceId') is not distinct from new.invoice_id::text
            and (dr.payload ->> 'orderId') is not distinct from new.order_id::text and dr.payload ->> 'figure' = new.figure) then
      raise exception 'paypal link refused: only an approved paypal.request queues a link, as its payload says, in its decision''s transaction'
        using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.decision_id := ctx_decision;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    return new;
  end if;
  if (new.tenant_id, new.id, new.draft_id, new.decision_id, new.purpose, new.customer_id, new.invoice_id, new.order_id, new.amount_minor,
      new.currency, new.figure, new.created_by, new.created_at)
     is distinct from
     (old.tenant_id, old.id, old.draft_id, old.decision_id, old.purpose, old.customer_id, old.invoice_id, old.order_id, old.amount_minor,
      old.currency, old.figure, old.created_by, old.created_at)
     or new.attempts < old.attempts then
    raise exception 'paypal link refused: what was asked never changes, and attempts never go back' using errcode = 'MS007';
  end if;
  if current_user = 'munshi_jobs' then
    if (new.cancel_draft_id, new.cancel_decision_id) is distinct from (old.cancel_draft_id, old.cancel_decision_id)
       or (old.paypal_id is not null and (new.paypal_id, new.mode, new.payer_url, new.sent_at) is distinct from (old.paypal_id, old.mode, old.payer_url, old.sent_at))
       or not ((old.status = 'queued' and new.status in ('queued', 'sent', 'failed'))
               or (old.status = 'cancel_queued' and new.status in ('cancel_queued', 'cancelled', 'sent'))) then
      raise exception 'paypal link refused: the sweep moves a queued link or a cancel only' using errcode = 'MS007';
    end if;
  elsif current_user = 'munshi_app' then
    select dr.id into decided_draft
      from approval.decision d
      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
      join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by and m.active
      join ref.command_authority ca on ca.command = dr.command and ca.role = m.role
     where d.tenant_id = new.tenant_id and d.id = ctx_decision and d.verdict = 'approved' and d.created_txid = txid_current()
       and d.decided_by = ctx_actor and dr.command = 'paypal.cancel' and dr.payload ->> 'linkId' = old.id::text;
    if decided_draft is null or old.cancel_draft_id is not null
       or not ((old.status = 'queued' and new.status = 'cancelled') or (old.status = 'sent' and new.status = 'cancel_queued'))
       or (new.mode, new.paypal_id, new.payer_url, new.sent_at, new.error_code, new.attempts)
          is distinct from (old.mode, old.paypal_id, old.payer_url, old.sent_at, old.error_code, old.attempts) then
      raise exception 'paypal link refused: only an approved paypal.request''s cancel closes a link, in its decision''s transaction'
        using errcode = 'MS007';
    end if;
    new.cancel_draft_id := decided_draft;
    new.cancel_decision_id := ctx_decision;
    new.cancelled_at := case when new.status = 'cancelled' then clock_timestamp() end;
  else
    raise exception 'paypal link refused: only the app and the sweep move a link' using errcode = 'MS007';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke execute on function ops.paypal_link_guard() from public;
create trigger guard before insert or update on ops.paypal_link for each row execute function ops.paypal_link_guard();

-- PayPal's id routed to one shop (global, as ops.phone_route): the webhook reads it to find the shop and link before it
-- knows the tenant; the sweep writes it beside the link once PayPal answers; the app and the jobs role see their own
-- tenant's rows. Insert-only.
create table ops.paypal_route (
  id uuid primary key default ops.uuidv7(),
  paypal_id text not null check (paypal_id ~ '^[A-Za-z0-9-]{1,64}$'),
  tenant_id uuid not null references ops.tenant,
  link_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, link_id) references ops.paypal_link
);
create unique index paypal_route_id on ops.paypal_route (paypal_id);
create index paypal_route_link on ops.paypal_route (tenant_id, link_id);

create function ops.paypal_route_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user <> 'munshi_jobs' or not exists (
       select 1 from ops.paypal_link l where l.tenant_id = new.tenant_id and l.id = new.link_id and l.paypal_id = new.paypal_id) then
    raise exception 'paypal route refused: the sweep routes a sent link''s PayPal id, once' using errcode = 'MS007';
  end if;
  new.created_at := clock_timestamp();
  return new;
end $$;
revoke execute on function ops.paypal_route_guard() from public;
create trigger guard before insert on ops.paypal_route for each row execute function ops.paypal_route_guard();

-- A provider's payment notification (a verified, deduplicated webhook event), stored by the public role and nothing
-- more: no book row, no draft. The provider's event id is unique per shop (a replay stores nothing); the reference is
-- PayPal's invoice id, which must be a link of this shop that reached PayPal; the amount and currency are PayPal's, as
-- received, and matches_link (stamped here) says whether they are the link's own. A named read of this row
-- (paypal.event) is the cell a "record this payment" draft cites. raw_sha256 is the body's hash; the body is not kept.
-- Insert-only.
create table ops.payment_event (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  provider text not null check (provider = 'paypal'),
  provider_event_id text not null check (provider_event_id ~ '^[A-Za-z0-9-]{1,64}$'),
  kind text not null check (kind in ('invoice_paid')),
  reference text not null check (reference ~ '^[A-Za-z0-9-]{1,64}$'),
  link_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  matches_link boolean not null default false,
  raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, link_id) references ops.paypal_link
);
create unique index payment_event_provider_id on ops.payment_event (tenant_id, provider, provider_event_id);
create index payment_event_link on ops.payment_event (tenant_id, link_id);

create function ops.payment_event_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  asked record;
begin
  select l.amount_minor, l.currency into asked from ops.paypal_link l
   where l.tenant_id = new.tenant_id and l.id = new.link_id and l.paypal_id = new.reference;
  if current_user <> 'munshi_public' or not found then
    raise exception 'payment event refused: a provider notification is stored by the webhook, for a link of this shop that reached PayPal'
      using errcode = 'MS007';
  end if;
  new.matches_link := (new.amount_minor = asked.amount_minor and new.currency = asked.currency);
  new.received_at := clock_timestamp();
  return new;
end $$;
revoke execute on function ops.payment_event_guard() from public;
create trigger guard before insert on ops.payment_event for each row execute function ops.payment_event_guard();

alter table ops.paypal_link enable row level security;
alter table ops.paypal_link force row level security;
create policy tenant_isolation on ops.paypal_link
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.paypal_link from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert, update (status, cancel_draft_id, cancel_decision_id, cancelled_at, updated_at) on ops.paypal_link to munshi_app;
grant select, update (status, mode, paypal_id, payer_url, attempts, error_code, sent_at, cancelled_at, updated_at) on ops.paypal_link to munshi_jobs;
-- The event's guard reads the link it pays, under the shop's context the webhook set.
grant select (tenant_id, id, paypal_id, amount_minor, currency) on ops.paypal_link to munshi_public;

alter table ops.paypal_route enable row level security;
alter table ops.paypal_route force row level security;
create policy route_own on ops.paypal_route to munshi_app, munshi_jobs
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
create policy route_lookup on ops.paypal_route for select to munshi_public using (true);
revoke all on ops.paypal_route from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ops.paypal_route to munshi_app, munshi_public;
grant select, insert on ops.paypal_route to munshi_jobs;

alter table ops.payment_event enable row level security;
alter table ops.payment_event force row level security;
create policy tenant_isolation on ops.payment_event
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.payment_event from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ops.payment_event to munshi_app, munshi_jobs;
-- ON CONFLICT names the key's columns, which needs SELECT on them; RETURNING needs the id.
grant insert, select (tenant_id, id, provider, provider_event_id) on ops.payment_event to munshi_public;

insert into ref.command (command, draft_only) values ('paypal.request', true), ('paypal.cancel', true);
insert into ref.command_authority (command, role) values
  ('paypal.request', 'owner'), ('paypal.request', 'manager'), ('paypal.cancel', 'owner'), ('paypal.cancel', 'manager');
insert into ref.command_capability (command, capability, use) values ('paypal.request', 'credit', 'start'), ('paypal.cancel', 'credit', 'finish');
