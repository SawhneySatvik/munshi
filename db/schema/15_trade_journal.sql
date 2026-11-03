-- 15 · Trade, stock, money and the journal. Books, through books.write; every one reverses, and a reversal of a header
-- reverses each of its children under the reversal header (z_reversal_complete).
-- Deferred header checks at commit: a sale's and a purchase's total against their lines (z_sale_total, z_purchase_total,
-- MS004) and each journal entry's balance per currency (z_balance). Amounts are positive unless a reversal
-- where another column says what the row is (a payment's direction), signed where the sign is the fact.
--
-- Columns naming a later file's table, declared here with no key (21_orders.sql adds them by alter table, so every
-- prefix of the files builds):
-- books.sale.order_id, books.sale_line.order_line_id, books.payment.order_id.
-- 16 redefines books.sale_total() to subtract a sale's discounts, which land there.
set local role munshi_owner;

create table books.sale (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid not null,
  sold_at timestamptz not null,
  customer_id uuid,
  total_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  booking_id uuid,
  reservation_id uuid,
  order_id uuid,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, booking_id) references ops.booking,
  foreign key (tenant_id, reservation_id) references ops.reservation,
  foreign key (tenant_id, reverses_id) references books.sale,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (num_nonnulls(booking_id, reservation_id, order_id) <= 1),
  check ((reverses_id is null) = (reason is null))
);

-- Its children key on (sale, currency) and (sale, customer), so a child can never carry another currency or customer.
create unique index sale_currency on books.sale (tenant_id, id, currency);
create unique index sale_customer_key on books.sale (tenant_id, id, customer_id);

-- A line names its item with its kind, and is priced by a price row or (from 21) an order line.
create table books.sale_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  sale_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  item_id uuid not null,
  item_kind text not null,
  price_id uuid,
  order_line_id uuid,
  staff_id uuid,
  qty_milli bigint not null check (qty_milli <> 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  gross_minor bigint not null,
  tax_class text check (tax_class ~ '^[a-z0-9_]{2,40}$'),
  tax_rate_bp int not null default 0 check (tax_rate_bp >= 0),
  tax_minor bigint not null default 0,
  currency char(3) not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, sale_id, currency) references books.sale (tenant_id, id, currency),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, price_id) references books.price,
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, reverses_id) references books.sale_line,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (num_nonnulls(price_id, order_line_id) >= 1),
  check ((reverses_id is null) = (reason is null))
);

create table books.purchase (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  supplier_id uuid not null,
  bill_no text check (char_length(bill_no) between 1 and 40),
  bill_date date,
  document_id uuid,
  bill_read_id uuid,
  total_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, supplier_id) references books.supplier,
  foreign key (tenant_id, document_id) references ops.document,
  foreign key (tenant_id, bill_read_id) references ops.bill_read,
  foreign key (tenant_id, reverses_id) references books.purchase,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

create unique index purchase_currency on books.purchase (tenant_id, id, currency);

-- Only goods are bought into stock: the kind is a constant in the item key.
create table books.purchase_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  purchase_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  item_id uuid not null,
  item_kind text generated always as ('good') stored,
  qty_milli bigint not null,
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  currency char(3) not null,
  expires_on date,
  bill_line_id uuid,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, purchase_id, currency) references books.purchase (tenant_id, id, currency),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, bill_line_id) references ops.bill_line,
  foreign key (tenant_id, reverses_id) references books.purchase_line,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (qty_milli > 0)),
  check ((reverses_id is null) = (reason is null))
);

-- A movement of stock. The item key carries the constant kind 'good', so a service or a package can never move stock
-- (the key is tenant-first, as every key). The row that caused it is named by its books table and id. `donated` is
-- stock given away instead of wasted: written only by surplus.give, from its listing (b_stock_kind, below).
create table books.stock_move (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  item_id uuid not null,
  item_kind text generated always as ('good') stored,
  qty_milli bigint not null check (qty_milli <> 0),
  kind text not null check (kind in ('opening', 'purchase', 'sale', 'count_adjust', 'waste', 'return', 'donated')),
  source_rel text references ref.book_table,
  source_id uuid,
  expires_on date,
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id, item_kind) references books.item (tenant_id, id, kind),
  foreign key (tenant_id, reverses_id) references books.stock_move,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((source_rel is null) = (source_id is null)),
  check ((reverses_id is null) = (reason is null))
);

-- Money recorded, never processed. The direction says what the row is, so the amount is positive unless a reversal;
-- it names at most one party, and a purchase's payment goes out. b_payment_kind: a payment naming a staff
-- member is written only by wages.pay or advance.give, never by payment.record, which staff hold, so a command staff
-- may run never pays staff.
create table books.payment (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  direction text not null check (direction in ('in', 'out')),
  method text not null check (method in ('cash', 'upi', 'card', 'bank', 'paypal')),
  amount_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  customer_id uuid,
  supplier_id uuid,
  staff_id uuid,
  sale_id uuid,
  purchase_id uuid,
  order_id uuid,
  reference text check (reference ~ '^[A-Za-z0-9-]{1,64}$'),
  paid_at timestamptz not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, supplier_id) references books.supplier,
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, sale_id) references books.sale,
  foreign key (tenant_id, purchase_id) references books.purchase,
  foreign key (tenant_id, reverses_id) references books.payment,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (amount_minor > 0)),
  check (num_nonnulls(customer_id, supplier_id, staff_id) <= 1),
  check (purchase_id is null or direction = 'out'),
  check ((reverses_id is null) = (reason is null))
);

-- Udhaar: + given, − repaid; the balance is the sum per customer. A credit entry raised by a sale is that sale's
-- customer's (by the composite key on the sale).
create table books.credit_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  sale_id uuid,
  payment_id uuid,
  due_on date,
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, sale_id, customer_id) references books.sale (tenant_id, id, customer_id),
  foreign key (tenant_id, payment_id) references books.payment,
  foreign key (tenant_id, reverses_id) references books.credit_entry,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- A UPI or card settlement received for a business day: one live per channel and day (b_one_live); a reversed one may
-- be recorded again.
create table books.settlement (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  channel text not null check (channel in ('upi', 'card')),
  business_date date not null,
  amount_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text check (reference ~ '^[A-Za-z0-9-]{1,64}$'),
  utr text check (utr is null or utr ~ '^[A-Za-z0-9-]{1,64}$'),
  received_on date not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, reverses_id) references books.settlement,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (amount_minor > 0)),
  check ((reverses_id is null) = (reason is null))
);

-- The journal the reports and GST read: a header naming the row that caused it, and its lines against ref.account
-- (debit +, credit −), balanced per currency at commit (z_balance, books.check_balanced in 02).
create table books.journal_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  entry_date date not null,
  memo_code text not null check (memo_code ~ '^[a-z_]{2,40}$'),
  source_rel text references ref.book_table,
  source_id uuid,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, reverses_id) references books.journal_entry,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((source_rel is null) = (source_id is null)),
  check ((reverses_id is null) = (reason is null))
);

create table books.journal_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  entry_id uuid not null,
  account text not null references ref.account,
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, entry_id) references books.journal_entry,
  foreign key (tenant_id, reverses_id) references books.journal_line,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- b_one_live: one live (unreversed, not itself a reversal) purchase per supplier and bill number, and one live
-- settlement per channel and business day. The header is the transaction's first insert and its BEFORE trigger runs
-- before the chain lock exists, so it takes the chain lock and then the key's lock first (never the opposite order):
-- two concurrent writers record one row and refuse the other.
create function books.one_live() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  r jsonb := to_jsonb(new);
  live boolean;
begin
  if r ->> 'reverses_id' is not null or (tg_table_name = 'purchase' and r ->> 'bill_no' is null) then
    return new;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  if tg_table_name = 'purchase' then
    perform pg_advisory_xact_lock(7, hashtext(new.tenant_id::text || 'purchase' || (r ->> 'supplier_id') || (r ->> 'bill_no')));
    live := exists (select 1 from books.purchase p
                     where p.tenant_id = new.tenant_id and p.supplier_id = (r ->> 'supplier_id')::uuid and p.bill_no = r ->> 'bill_no'
                       and p.reverses_id is null
                       and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id));
  else
    perform pg_advisory_xact_lock(7, hashtext(new.tenant_id::text || 'settlement' || (r ->> 'channel') || (r ->> 'business_date')));
    live := exists (select 1 from books.settlement s
                     where s.tenant_id = new.tenant_id and s.channel = r ->> 'channel' and s.business_date = (r ->> 'business_date')::date
                       and s.reverses_id is null
                       and not exists (select 1 from books.settlement x where x.tenant_id = s.tenant_id and x.reverses_id = s.id));
  end if;
  if live then
    raise exception 'book write refused: a live % already exists for this key', tg_table_name using errcode = 'unique_violation';
  end if;
  return new;
end $$;
revoke execute on function books.one_live() from public;

create function books.payment_kind() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  by_command text;
begin
  if new.staff_id is null or new.reverses_id is not null then
    return new;
  end if;
  by_command := coalesce((select dr.command from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                           where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                         nullif(current_setting('munshi.command', true), ''));
  if by_command is distinct from 'wages.pay' and by_command is distinct from 'advance.give' then
    raise exception 'payment refused: a payment to a staff member is wages.pay or advance.give, not %', by_command using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.payment_kind() from public;

-- b_stock_kind: a gift of stock is surplus.give's alone, and surplus.give writes nothing else. A move of kind
-- `donated` that reverses nothing is stock leaving (qty < 0) from a lot (source books.purchase_line) under an approved
-- surplus.give decision, inserted by its ops.surplus_listing's own trigger (25_surplus.sql) and never directly, so a gift
-- never lands without its listing. That trigger names the listing it is writing in munshi.surplus_move just before the
-- insert and clears it just after; a direct insert runs at trigger depth 1. Both are required: any role can set a
-- setting, so the marker alone would admit a direct insert that set it, and depth alone would admit another trigger
-- chain. Every move surplus.give writes is such a gift. A gift is corrected by stock.reverse alone. The command is the
-- decision's draft's, else the direct one, as b_payment_kind reads it (a_write has already checked both).
create function books.stock_kind() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  by_command text;
begin
  by_command := coalesce((select dr.command from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                           where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                         nullif(current_setting('munshi.command', true), ''));
  if new.reverses_id is not null then
    if by_command = 'surplus.give' or (new.kind = 'donated' and by_command is distinct from 'stock.reverse') then
      raise exception 'stock refused: a gift is corrected by stock.reverse, and surplus.give reverses nothing' using errcode = 'MS001';
    end if;
  elsif (new.kind = 'donated') is distinct from (by_command = 'surplus.give') then
    raise exception 'stock refused: a donated move is surplus.give''s, and surplus.give writes only donated moves' using errcode = 'MS001';
  elsif new.kind = 'donated' and (new.qty_milli >= 0 or new.source_rel is distinct from 'books.purchase_line'
                                  or nullif(current_setting('munshi.surplus_move', true), '') is null or pg_trigger_depth() < 2) then
    raise exception 'stock refused: a gift is stock leaving a lot, written by its listing' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.stock_kind() from public;

-- z_sale_total: a sale's total equals its lines' gross (16 subtracts its discounts too). z_purchase_total: a purchase's
-- total equals its lines' cost, each qty × unit cost ÷ 1000 rounded half away from zero, as the counter rounds. Both at
-- commit, on the header (MS004).
create function books.sale_total() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.total_minor is distinct from coalesce(
       (select sum(l.gross_minor) from books.sale_line l where l.tenant_id = new.tenant_id and l.sale_id = new.id), 0) then
    raise exception 'sale refused: its total is not its lines'' gross' using errcode = 'MS004';
  end if;
  return null;
end $$;
revoke execute on function books.sale_total() from public;

create function books.purchase_total() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.total_minor is distinct from coalesce(
       (select sum(round(l.qty_milli::numeric * l.unit_cost_minor / 1000)) from books.purchase_line l
         where l.tenant_id = new.tenant_id and l.purchase_id = new.id), 0) then
    raise exception 'purchase refused: its total is not its lines'' cost' using errcode = 'MS004';
  end if;
  return null;
end $$;
revoke execute on function books.purchase_total() from public;

create trigger a_write before insert or update or delete on books.sale for each row execute function books.write();
create trigger z_audit after insert on books.sale for each row execute function books.audit_row();
create constraint trigger z_reversal_complete after insert on books.sale deferrable initially deferred for each row
  execute function books.check_reversal();
create constraint trigger z_sale_total after insert on books.sale deferrable initially deferred for each row
  execute function books.sale_total();
create trigger a_write before insert or update or delete on books.sale_line for each row execute function books.write();
create trigger z_audit after insert on books.sale_line for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.purchase for each row execute function books.write();
create trigger b_one_live before insert on books.purchase for each row execute function books.one_live();
create trigger z_audit after insert on books.purchase for each row execute function books.audit_row();
create constraint trigger z_purchase_total after insert on books.purchase deferrable initially deferred for each row
  execute function books.purchase_total();
create constraint trigger z_reversal_complete after insert on books.purchase deferrable initially deferred for each row
  execute function books.check_reversal();
create trigger a_write before insert or update or delete on books.purchase_line for each row execute function books.write();
create trigger z_audit after insert on books.purchase_line for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.stock_move for each row execute function books.write();
create trigger b_stock_kind before insert on books.stock_move for each row execute function books.stock_kind();
create trigger z_audit after insert on books.stock_move for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.payment for each row execute function books.write();
create trigger b_payment_kind before insert on books.payment for each row execute function books.payment_kind();
create trigger z_audit after insert on books.payment for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.credit_entry for each row execute function books.write();
create trigger z_audit after insert on books.credit_entry for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.settlement for each row execute function books.write();
create trigger b_one_live before insert on books.settlement for each row execute function books.one_live();
create trigger z_audit after insert on books.settlement for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.journal_entry for each row execute function books.write();
create trigger z_audit after insert on books.journal_entry for each row execute function books.audit_row();
create constraint trigger z_balance after insert on books.journal_entry deferrable initially deferred for each row
  execute function books.check_balanced();
create constraint trigger z_reversal_complete after insert on books.journal_entry deferrable initially deferred for each row
  execute function books.check_reversal();
create trigger a_write before insert or update or delete on books.journal_line for each row execute function books.write();
create trigger z_audit after insert on books.journal_line for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests; the composite-key targets are above, by
-- their tables.
create index sale_shop_day on books.sale (tenant_id, shop_id, sold_at);
create index sale_customer on books.sale (tenant_id, customer_id, sold_at) where customer_id is not null;
create index sale_booking on books.sale (tenant_id, booking_id) where booking_id is not null;
create index sale_reservation on books.sale (tenant_id, reservation_id) where reservation_id is not null;
create index sale_order on books.sale (tenant_id, order_id) where order_id is not null;
create unique index sale_reverses on books.sale (tenant_id, reverses_id) where reverses_id is not null;
create unique index sale_line_no on books.sale_line (tenant_id, sale_id, line_no);
create index sale_line_item on books.sale_line (tenant_id, item_id, created_at);
create index sale_line_staff on books.sale_line (tenant_id, staff_id, created_at) where staff_id is not null;
create unique index sale_line_reverses on books.sale_line (tenant_id, reverses_id) where reverses_id is not null;
create index purchase_supplier on books.purchase (tenant_id, supplier_id, bill_date);
create index purchase_day on books.purchase (tenant_id, bill_date);
create unique index purchase_reverses on books.purchase (tenant_id, reverses_id) where reverses_id is not null;
create unique index purchase_line_no on books.purchase_line (tenant_id, purchase_id, line_no);
create index purchase_line_item on books.purchase_line (tenant_id, item_id, created_at);
create index purchase_line_expiry on books.purchase_line (tenant_id, expires_on) where expires_on is not null;
create unique index purchase_line_reverses on books.purchase_line (tenant_id, reverses_id) where reverses_id is not null;
create index stock_item on books.stock_move (tenant_id, item_id, at) include (qty_milli);
create index stock_source on books.stock_move (tenant_id, source_id);
create unique index stock_move_reverses on books.stock_move (tenant_id, reverses_id) where reverses_id is not null;
create index payment_sale on books.payment (tenant_id, sale_id) where sale_id is not null;
create index payment_order on books.payment (tenant_id, order_id) where order_id is not null;
create index payment_day on books.payment (tenant_id, paid_at);
create unique index payment_reverses on books.payment (tenant_id, reverses_id) where reverses_id is not null;
create index credit_customer on books.credit_entry (tenant_id, customer_id, at) include (amount_minor, due_on);
create index credit_sale on books.credit_entry (tenant_id, sale_id) where sale_id is not null;
create unique index credit_entry_reverses on books.credit_entry (tenant_id, reverses_id) where reverses_id is not null;
create index settlement_day on books.settlement (tenant_id, channel, business_date);
create unique index settlement_reverses on books.settlement (tenant_id, reverses_id) where reverses_id is not null;
create unique index settlement_utr on books.settlement (tenant_id, utr) where utr is not null;
create index journal_day on books.journal_entry (tenant_id, entry_date);
create index journal_source on books.journal_entry (tenant_id, source_id);
create unique index journal_entry_reverses on books.journal_entry (tenant_id, reverses_id) where reverses_id is not null;
create index journal_line_entry on books.journal_line (tenant_id, entry_id);
create index journal_account on books.journal_line (tenant_id, account) include (amount_minor, currency);
create unique index journal_line_reverses on books.journal_line (tenant_id, reverses_id) where reverses_id is not null;

-- The book table manifest and the commands. advance.give, advance.reverse and salary.run (12)
-- gain their payment and journal tables here.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.sale', null, null, true, '{total_minor}', '{shop_id,customer_id,currency}', '{}'),
  ('books.sale_line', 'books.sale', 'sale_id', true, '{qty_milli,gross_minor,tax_minor}',
   '{line_no,item_id,item_kind,price_id,order_line_id,staff_id,unit_price_minor,tax_class,tax_rate_bp,currency}', '{}'),
  ('books.purchase', null, null, true, '{total_minor}', '{supplier_id,bill_no,bill_date,currency}', '{b_one_live}'),
  ('books.purchase_line', 'books.purchase', 'purchase_id', true, '{qty_milli}',
   '{line_no,item_id,unit_cost_minor,currency,expires_on,bill_line_id}', '{}'),
  ('books.stock_move', null, null, true, '{qty_milli}', '{item_id,kind,expires_on}', '{b_stock_kind}'),
  ('books.payment', null, null, true, '{amount_minor}', '{direction,method,currency,customer_id,supplier_id,staff_id,purchase_id,order_id}',
   '{b_payment_kind}'),
  ('books.credit_entry', null, null, true, '{amount_minor}', '{customer_id,currency,due_on}', '{}'),
  ('books.settlement', null, null, true, '{amount_minor}', '{channel,business_date,currency}', '{b_one_live}'),
  ('books.journal_entry', null, null, true, '{}', '{}', '{}'),
  ('books.journal_line', 'books.journal_entry', 'entry_id', true, '{amount_minor}', '{account,currency}', '{}');
insert into ref.command (command, draft_only) values
  ('sale.record', false), ('sale.reverse', false), ('purchase.record', false), ('purchase.reverse', false),
  ('stock.count', false), ('stock.waste', false), ('stock.reverse', false), ('credit.record', false), ('credit.reverse', false),
  ('payment.record', false), ('payment.reverse', false), ('settlement.record', false), ('settlement.reverse', false),
  ('wages.pay', false);
insert into ref.command_authority (command, role) values
  ('sale.record', 'owner'), ('sale.record', 'manager'), ('sale.record', 'staff'), ('sale.reverse', 'owner'),
  ('purchase.record', 'owner'), ('purchase.record', 'manager'), ('purchase.reverse', 'owner'),
  ('stock.count', 'owner'), ('stock.count', 'manager'), ('stock.waste', 'owner'), ('stock.waste', 'manager'), ('stock.waste', 'staff'),
  ('stock.reverse', 'owner'), ('stock.reverse', 'manager'),
  ('credit.record', 'owner'), ('credit.record', 'manager'), ('credit.reverse', 'owner'),
  ('payment.record', 'owner'), ('payment.record', 'manager'), ('payment.record', 'staff'), ('payment.reverse', 'owner'),
  ('settlement.record', 'owner'), ('settlement.record', 'manager'), ('settlement.reverse', 'owner'),
  ('wages.pay', 'owner'), ('wages.pay', 'manager');
insert into ref.command_table (command, rel)
select c, t from unnest(array['sale.record', 'sale.reverse']) c,
                 unnest(array['books.sale', 'books.sale_line', 'books.stock_move', 'books.payment', 'books.credit_entry',
                              'books.journal_entry', 'books.journal_line']) t
union all
select c, t from unnest(array['purchase.record', 'purchase.reverse']) c,
                 unnest(array['books.purchase', 'books.purchase_line', 'books.stock_move', 'books.journal_entry', 'books.journal_line']) t
union all
select c, 'books.stock_move' from unnest(array['stock.count', 'stock.waste', 'stock.reverse']) c
union all
select c, t from unnest(array['credit.record', 'credit.reverse']) c,
                 unnest(array['books.credit_entry', 'books.journal_entry', 'books.journal_line']) t
union all
select c, t from unnest(array['payment.record', 'payment.reverse']) c,
                 unnest(array['books.payment', 'books.credit_entry', 'books.journal_entry', 'books.journal_line']) t
union all
select c, t from unnest(array['settlement.record', 'settlement.reverse']) c,
                 unnest(array['books.settlement', 'books.journal_entry', 'books.journal_line']) t
union all
select c, t from unnest(array['wages.pay', 'advance.give', 'advance.reverse']) c,
                 unnest(array['books.payment', 'books.journal_entry', 'books.journal_line']) t
union all
select 'salary.run', t from unnest(array['books.journal_entry', 'books.journal_line']) t;
insert into ref.command_capability (command, capability, use) values
  ('sale.record', 'counter', 'start'), ('sale.record', 'credit', 'start'), ('sale.record', 'offers', 'start'),
  ('sale.record', 'loyalty', 'start'), ('sale.record', 'packages', 'start'), ('sale.record', 'orders', 'finish'),
  ('sale.record', 'holds', 'finish'), ('sale.record', 'bookings', 'finish'),
  ('sale.reverse', 'counter', 'finish'), ('purchase.record', 'buying', 'start'), ('purchase.reverse', 'buying', 'finish'),
  ('stock.count', 'stock', 'start'), ('stock.waste', 'stock', 'start'), ('stock.reverse', 'stock', 'finish'),
  ('credit.record', 'credit', 'start'), ('credit.record', 'orders', 'finish'), ('credit.reverse', 'credit', 'finish'),
  ('payment.record', 'counter', 'start'), ('payment.record', 'credit', 'finish'), ('payment.record', 'buying', 'finish'),
  ('payment.record', 'orders', 'finish'), ('payment.reverse', 'counter', 'finish'),
  ('settlement.record', 'counter', 'start'), ('settlement.reverse', 'counter', 'finish'), ('wages.pay', 'salary', 'finish');

-- RLS and the grants: books are the app's (S I) and the jobs role's (S) only.
alter table books.sale enable row level security;
alter table books.sale force row level security;
create policy tenant_isolation on books.sale
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.sale from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.sale to munshi_app;
grant select on books.sale to munshi_jobs;

alter table books.sale_line enable row level security;
alter table books.sale_line force row level security;
create policy tenant_isolation on books.sale_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.sale_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.sale_line to munshi_app;
grant select on books.sale_line to munshi_jobs;

alter table books.purchase enable row level security;
alter table books.purchase force row level security;
create policy tenant_isolation on books.purchase
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.purchase from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.purchase to munshi_app;
grant select on books.purchase to munshi_jobs;

alter table books.purchase_line enable row level security;
alter table books.purchase_line force row level security;
create policy tenant_isolation on books.purchase_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.purchase_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.purchase_line to munshi_app;
grant select on books.purchase_line to munshi_jobs;

alter table books.stock_move enable row level security;
alter table books.stock_move force row level security;
create policy tenant_isolation on books.stock_move
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.stock_move from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.stock_move to munshi_app;
grant select on books.stock_move to munshi_jobs;

alter table books.payment enable row level security;
alter table books.payment force row level security;
create policy tenant_isolation on books.payment
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.payment from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.payment to munshi_app;
grant select on books.payment to munshi_jobs;

alter table books.credit_entry enable row level security;
alter table books.credit_entry force row level security;
create policy tenant_isolation on books.credit_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.credit_entry from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.credit_entry to munshi_app;
grant select on books.credit_entry to munshi_jobs;

alter table books.settlement enable row level security;
alter table books.settlement force row level security;
create policy tenant_isolation on books.settlement
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.settlement from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.settlement to munshi_app;
grant select on books.settlement to munshi_jobs;

alter table books.journal_entry enable row level security;
alter table books.journal_entry force row level security;
create policy tenant_isolation on books.journal_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.journal_entry from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.journal_entry to munshi_app;
grant select on books.journal_entry to munshi_jobs;

alter table books.journal_line enable row level security;
alter table books.journal_line force row level security;
create policy tenant_isolation on books.journal_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.journal_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.journal_line to munshi_app;
grant select on books.journal_line to munshi_jobs;
