-- 25 · Surplus for good (W2-B, M4): stock near its expiry given to a recipient instead of wasted, only as an approved
-- surplus.give draft. Executing it is one insert into ops.surplus_listing, under the approver, in the decision's own
-- transaction: the listing's trigger writes the stock leaving (books.stock_move, kind `donated`) through the books guard,
-- with its audit entry, and the listing's own audit entry. So the gift and its listing land together or not at all
-- (b_stock_kind, 15, refuses a donated move written any other way). Recipients are simulated and labelled so; no schema
-- file lists any: the builder adds each demo shop's through the app, as its owner. Number 24 is held for the PayPal
-- file. No column here names a table of a later file.
set local role munshi_owner;

-- A shop's recipients: simulated, every one (`simulated` is true and stays true; a screen that names one says so). Listed
-- by an active owner or manager of the shop, through the app. Append-only.
create table ops.surplus_recipient (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('food_bank', 'shelter', 'community_kitchen', 'animal_shelter', 'other')),
  area text not null check (char_length(area) between 1 and 80),
  simulated boolean not null default true check (simulated),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member
);

create function ops.surplus_recipient_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
    raise exception 'surplus refused: an active owner or manager lists a recipient' using errcode = 'MS007';
  end if;
  new.created_by := ctx_actor;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.surplus_recipient_guard() from public;
create trigger guard before insert on ops.surplus_recipient for each row execute function ops.surplus_recipient_guard();

create function ops.surplus_recipient_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, new.created_by, 'surplus.recipient', 'ops.surplus_recipient', new.id, jsonb_build_object('kind', new.kind));
  return null;
end $$;
revoke execute on function ops.surplus_recipient_audit() from public;
create trigger audit after insert on ops.surplus_recipient for each row execute function ops.surplus_recipient_audit();

-- One gift: one lot (a purchase line, the expiry watcher's lot_id), part of it, to one recipient, under one decision. The
-- writer's contract: the app, in the transaction that made an approved decision on a surplus.give draft, as its approver
-- (munshi.actor_id = decided_by, munshi.decision_id = the decision, as for any book row), inserts
--   (tenant_id, lot_id, qty_milli, recipient_id)
-- and they must be exactly the draft's payload `lotId`, `qtyMilli` (a JSON number) and `recipientId`. Everything else is
-- stamped here, whatever the caller sent:
--   item_id        the lot's item
--   stock_move_id  the gift's stock row, written here: -qty_milli of the item, kind `donated`, the lot's expires_on, at
--                  now(), its source the lot (source_rel books.purchase_line, source_id lot_id)
--   value_minor, currency
--                  the gift at the lot's cost: (qty_milli × unit_cost_minor + 500) / 1000, the expiry watcher's own
--                  rounding (watch.expiry's at_risk_value), in the lot's currency. Traces to the purchase line and the
--                  stock row; never a caller's figure
--   decision_id, created_by, created_at
--                  the stock row's decision and approver (books.write stamped them), and now()
-- Refused: a lot of another shop, of a reversed purchase, or with no expiry; a gift larger than what is left of its lot,
-- read as watch.expiry reads it (the lot's quantity, at most the item's stock on hand less the lots of the item that
-- expire after it, earliest expiry sold first; every move counts, earlier gifts included; the watcher's as-of day is
-- here all moves and lots so far); a second gift under the same decision, by any statement (a decision gives once:
-- checked before the stock row is written, so `on conflict do nothing` on the unique decision index cannot repeat a
-- gift's stock row, nor can a multi-row insert). Concurrent gifts of one item are core's to serialise (lockStock).
create table ops.surplus_listing (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  lot_id uuid not null,
  item_id uuid not null,
  qty_milli bigint not null check (qty_milli > 0),
  recipient_id uuid not null,
  stock_move_id uuid not null,
  value_minor bigint not null check (value_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  decision_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, lot_id) references books.purchase_line,
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, recipient_id) references ops.surplus_recipient,
  foreign key (tenant_id, stock_move_id) references books.stock_move,
  foreign key (tenant_id, decision_id) references approval.decision,
  foreign key (tenant_id, created_by) references ops.member
);

create function ops.surplus_give() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_decision uuid := nullif(current_setting('munshi.decision_id', true), '')::uuid;
  give jsonb;
  lot_item uuid;
  lot_qty bigint;
  lot_cost bigint;
  lot_currency char(3);
  lot_expires date;
  lot_left bigint;
  move_id uuid;
  move_by uuid;
  move_decision uuid;
begin
  if current_user <> 'munshi_app' then
    raise exception 'surplus refused: a gift is executed through the app' using errcode = 'MS001';
  end if;
  select dr.payload into give
    from approval.decision d
    join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
   where d.tenant_id = new.tenant_id and d.id = ctx_decision and d.verdict = 'approved'
     and d.created_txid = txid_current() and d.decided_by = ctx_actor and dr.command = 'surplus.give';
  if give is null then
    raise exception 'surplus refused: a gift is an approved surplus.give decision of this transaction, executed by its approver'
      using errcode = 'MS001';
  end if;
  if give -> 'lotId' is distinct from to_jsonb(new.lot_id::text) or give -> 'qtyMilli' is distinct from to_jsonb(new.qty_milli)
     or give -> 'recipientId' is distinct from to_jsonb(new.recipient_id::text) then
    raise exception 'surplus refused: a gift gives exactly the lot, quantity and recipient approved' using errcode = 'MS001';
  end if;
  -- A live lot: a line of an unreversed purchase (a purchase's reversal reverses every line, so this is watch.expiry's
  -- test), with an expiry.
  select pl.item_id, pl.qty_milli, pl.unit_cost_minor, pl.currency, pl.expires_on
    into lot_item, lot_qty, lot_cost, lot_currency, lot_expires
    from books.purchase_line pl
    join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
   where pl.tenant_id = new.tenant_id and pl.id = new.lot_id and pl.expires_on is not null and p.reverses_id is null
     and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id);
  if lot_item is null then
    raise exception 'surplus refused: a gift is from a live lot of this shop, with an expiry' using errcode = 'MS001';
  end if;
  if exists (select 1 from books.stock_move m
              where m.tenant_id = new.tenant_id and m.item_id = lot_item and m.decision_id = ctx_decision) then
    raise exception 'surplus refused: a decision gives once' using errcode = 'MS001';
  end if;
  select greatest(0, least(lot_qty,
           coalesce((select sum(m.qty_milli) from books.stock_move m where m.tenant_id = new.tenant_id and m.item_id = lot_item), 0)
           - coalesce((select sum(o.qty_milli) from books.purchase_line o
                         join books.purchase p on p.tenant_id = o.tenant_id and p.id = o.purchase_id
                        where o.tenant_id = new.tenant_id and o.item_id = lot_item and o.expires_on is not null
                          and (o.expires_on, o.id) > (lot_expires, new.lot_id) and p.reverses_id is null
                          and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id)), 0)))
    into lot_left;
  if new.qty_milli > lot_left then
    raise exception 'surplus refused: a gift is at most what is left of its lot' using errcode = 'MS001';
  end if;
  perform set_config('munshi.surplus_move', new.id::text, true);
  insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at)
  values (new.tenant_id, lot_item, -new.qty_milli, 'donated', 'books.purchase_line', new.lot_id, lot_expires, now())
  returning id, created_by, decision_id into move_id, move_by, move_decision;
  perform set_config('munshi.surplus_move', '', true);
  new.item_id := lot_item;
  new.stock_move_id := move_id;
  new.value_minor := (new.qty_milli * lot_cost + 500) / 1000;
  new.currency := lot_currency;
  new.decision_id := move_decision;
  new.created_by := move_by;
  new.created_at := now();
  return new;
end $$;
revoke execute on function ops.surplus_give() from public;
create trigger give before insert on ops.surplus_listing for each row execute function ops.surplus_give();

-- Ids and codes only (the chain is permanent); the stock row has its own entry, with its digest.
create function ops.surplus_listing_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, payload)
  values (new.tenant_id, new.created_by, new.decision_id, 'surplus.give', 'surplus.give', 'ops.surplus_listing', new.id,
          jsonb_build_object('recipient_id', new.recipient_id, 'stock_move_id', new.stock_move_id));
  return null;
end $$;
revoke execute on function ops.surplus_listing_audit() from public;
create trigger audit after insert on ops.surplus_listing for each row execute function ops.surplus_listing_audit();

-- The impact tally, for a snapshot (core's named read: `select * from ops.surplus_impact($1, $2)`), one row for the shop
-- the transaction names (no row with none): gifts made from p_from up to, not including, p_to (all time by default)
-- whose stock row is not reversed (a gift corrected by stock.reverse came back, so it counts for nothing). Per shop is
-- per tenant: stock is not kept per ops.shop. The schema converts no currency, so only gifts in the shop's currency are
-- summed; others are counted apart, for the screen to show "Cannot verify".
--   gifts                 listings counted
--   items                 distinct items among them
--   value_minor, currency their value at cost, not wasted, in the shop's currency (0 with none)
--   other_currency_gifts  gifts valued in another currency, not summed
-- Invoker: RLS on ops.tenant, ops.surplus_listing and books.stock_move keeps it to the transaction's shop.
create function ops.surplus_impact(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
  returns table (gifts int, items int, value_minor bigint, currency char(3), other_currency_gifts int)
  language sql stable
  set search_path = pg_catalog, pg_temp as $$
  select (count(l.id) filter (where l.currency = t.currency))::int,
         (count(distinct l.item_id) filter (where l.currency = t.currency))::int,
         coalesce(sum(l.value_minor) filter (where l.currency = t.currency), 0)::bigint,
         t.currency,
         (count(l.id) filter (where l.currency <> t.currency))::int
    from ops.tenant t
    left join ops.surplus_listing l
      on l.tenant_id = t.tenant_id and l.created_at >= p_from and l.created_at < p_to
     and not exists (select 1 from books.stock_move r where r.tenant_id = l.tenant_id and r.reverses_id = l.stock_move_id)
   where t.tenant_id = nullif(current_setting('munshi.tenant_id', true), '')::uuid
   group by t.currency
$$;
revoke execute on function ops.surplus_impact(timestamptz, timestamptz) from public;
grant execute on function ops.surplus_impact(timestamptz, timestamptz) to munshi_app, munshi_jobs;

-- The command: a draft only, approved by an owner or a manager, writing the stock row (G3); started under stock.
insert into ref.command (command, draft_only) values ('surplus.give', true);
insert into ref.command_authority (command, role) values ('surplus.give', 'owner'), ('surplus.give', 'manager');
insert into ref.command_table (command, rel) values ('surplus.give', 'books.stock_move');
insert into ref.command_capability (command, capability, use) values ('surplus.give', 'stock', 'start');

-- Indexes, one per statement, each asserted in pg_index (G10).
create unique index surplus_recipient_name on ops.surplus_recipient (tenant_id, name);
create unique index surplus_listing_move on ops.surplus_listing (tenant_id, stock_move_id);
create unique index surplus_listing_decision on ops.surplus_listing (tenant_id, decision_id);
create index surplus_listing_at on ops.surplus_listing (tenant_id, created_at);

-- RLS and the grants. Append-only: no role updates or deletes a recipient or a listing; the agent has no grant.
alter table ops.surplus_recipient enable row level security;
alter table ops.surplus_recipient force row level security;
create policy tenant_isolation on ops.surplus_recipient
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.surplus_recipient from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.surplus_recipient to munshi_app;
grant select on ops.surplus_recipient to munshi_jobs;

alter table ops.surplus_listing enable row level security;
alter table ops.surplus_listing force row level security;
create policy tenant_isolation on ops.surplus_listing
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.surplus_listing from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.surplus_listing to munshi_app;
grant select on ops.surplus_listing to munshi_jobs;
