-- 0005 · The books, the book guard and the journal balance check.
--
-- Every books table: tenant_id leads every key; RLS enabled and forced; munshi_app may SELECT and INSERT only (append
-- only: corrections are reversal rows carrying reverses_id and a reason; core writes the opposite amounts, the database
-- does not check them); and the trigger books.guard() admits an INSERT only when one of these holds in the current
-- transaction:
--   (a) munshi.decision_id names an approved decision of this tenant, created in this transaction
--       (created_txid = txid_current()), by an active member whose role holds the draft's command; or
--   (b) munshi.command is a direct command that the acting member's role (munshi.actor_id, active, same tenant) holds
--       in ops.command_authority;
-- and the admitting command (the draft's, or the direct one) writes this table (ops.command_table).
-- Any role can set any setting. The decision and command settings are checked against rows; the actor setting is
-- trusted: the app sets it in one place, from the session (the agent's role cannot write at all).
-- The guard stamps created_by (the commanding or approving member), decision_id and created_at; books.audit_row then
-- appends the written row to the tenant's audit chain in the same statement, so no book row exists without its entry.
set local role munshi_owner;

create function books.guard() returns trigger language plpgsql as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_decision uuid := nullif(current_setting('munshi.decision_id', true), '')::uuid;
  ctx_command text := nullif(current_setting('munshi.command', true), '');
  by_member uuid;
  by_command text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'book write refused: %.% is append-only', tg_table_schema, tg_table_name using errcode = 'MS001';
  end if;
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'book write refused: the row is not for the current tenant' using errcode = 'MS001';
  end if;

  if ctx_decision is not null then
    select d.decided_by, dr.command_type into by_member, by_command
      from approval.decision d
      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
      join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by and m.active
      join ops.command_authority ca on ca.role = m.role and ca.command = dr.command_type
     where d.tenant_id = new.tenant_id and d.id = ctx_decision
       and d.verdict = 'approved'
       and d.created_txid = txid_current();
    if by_member is null then
      raise exception 'book write refused: no approved decision of this tenant, made in this transaction by a member allowed to approve it'
        using errcode = 'MS001';
    end if;
  elsif ctx_command is not null and ctx_actor is not null then
    select m.id, ca.command into by_member, by_command
      from ops.member m
      join ops.command_authority ca on ca.role = m.role and ca.command = ctx_command
     where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
    if by_member is null then
      raise exception 'book write refused: the acting member may not run this command' using errcode = 'MS001';
    end if;
  else
    raise exception 'book write refused: no approved decision and no direct command' using errcode = 'MS001';
  end if;
  -- Both branches: a command admits only its own tables (holding sale.record admits a sale, not a price).
  perform 1 from ops.command_table ct where ct.command = by_command and ct.rel = tg_table_schema || '.' || tg_table_name;
  if not found then
    raise exception 'book write refused: % does not write %.%', by_command, tg_table_schema, tg_table_name using errcode = 'MS001';
  end if;

  new := jsonb_populate_record(new, jsonb_build_object(
    'created_by', by_member, 'decision_id', ctx_decision, 'created_at', now()));
  return new;
end $$;
revoke execute on function books.guard() from public;

-- After the row is written, its audit entry (in a BEFORE trigger, an insert that ON CONFLICT DO NOTHING then skips would
-- still be logged). Actor and decision are the stamped ones; the command is the decision's draft's, else the direct one.
create function books.audit_row() returns trigger language plpgsql as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, payload)
  values (new.tenant_id, new.created_by, new.decision_id,
          coalesce((select dr.command_type from approval.decision d
                      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                     where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                   nullif(current_setting('munshi.command', true), '')),
          'insert', tg_table_schema || '.' || tg_table_name, new.id, to_jsonb(new));
  return null;
end $$;
revoke execute on function books.audit_row() from public;

-- A journal entry closes when its transaction commits: created_txid is stamped here (a caller-supplied value could name
-- a later transaction), and a line is accepted only in the transaction that created its entry (else a later
-- transaction could append a balanced pair to a committed entry).
create function books.entry_txn() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'journal_entry' then
    new.created_txid := txid_current();
    return new;
  end if;
  perform 1 from books.journal_entry e
   where e.tenant_id = new.tenant_id and e.id = new.entry_id and e.created_txid = txid_current();
  if not found then
    raise exception 'journal line refused: its entry was not created in this transaction' using errcode = 'MS006';
  end if;
  return new;
end $$;
revoke execute on function books.entry_txn() from public;

-- Every journal entry balances per currency at commit (deferred), and has at least one line.
create function books.check_balanced() returns trigger language plpgsql as $$
declare
  entry uuid;
begin
  if tg_table_name = 'journal_entry' then
    entry := new.id;
  else
    entry := new.entry_id;
  end if;
  if not exists (select 1 from books.journal_line l where l.tenant_id = new.tenant_id and l.entry_id = entry)
     or exists (select 1 from books.journal_line l where l.tenant_id = new.tenant_id and l.entry_id = entry
                 group by l.currency having sum(l.amount_minor) <> 0) then
    raise exception 'journal entry does not balance per currency' using errcode = 'MS004';
  end if;
  return null;
end $$;
revoke execute on function books.check_balanced() from public;

-- Columns every books table carries; the guard sets them, whatever the caller sent:
--   created_by uuid not null, decision_id uuid, created_at timestamptz not null
-- with foreign keys to the member and the decision.

create table books.item (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  unit text not null check (unit in ('piece', 'pack', 'kg', 'g', 'l', 'ml')),
  barcode text,
  category text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- Selling price from effective_from on; the latest row in effect wins.
create table books.price (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.supplier (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text,
  is_simulated boolean not null default true,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.customer (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text,
  credit_limit_minor bigint check (credit_limit_minor >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((credit_limit_minor is null) = (currency is null))
);

create table books.staff (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  name text not null,
  phone text,
  member_id uuid,
  daily_wage_minor bigint check (daily_wage_minor >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  joined_on date,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((daily_wage_minor is null) = (currency is null))
);

-- A supplier's bill as recorded (document_id: the photo of the bill).
create table books.purchase (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  bill_no text not null,
  bill_date date not null,
  document_id uuid,
  total_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, supplier_id) references books.supplier,
  foreign key (tenant_id, document_id) references ops.document,
  foreign key (tenant_id, reverses_id) references books.purchase,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

create table books.purchase_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  purchase_id uuid not null,
  line_no integer not null check (line_no > 0),
  item_id uuid not null,
  qty_milli bigint not null check (qty_milli <> 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  expires_on date,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, purchase_id, line_no),
  foreign key (tenant_id, purchase_id) references books.purchase,
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.sale (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  shop_id uuid not null,
  sold_at timestamptz not null,
  customer_id uuid,
  total_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, reverses_id) references books.sale,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

create table books.sale_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  line_no integer not null check (line_no > 0),
  item_id uuid not null,
  qty_milli bigint not null check (qty_milli <> 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, sale_id, line_no),
  foreign key (tenant_id, sale_id) references books.sale,
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- On hand = sum of qty_milli per item. source_* names the book row that caused the move.
create table books.stock_move (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  qty_milli bigint not null check (qty_milli <> 0),
  kind text not null check (kind in ('opening', 'purchase', 'sale', 'count_adjust', 'waste', 'return')),
  source_table text,
  source_id uuid,
  expires_on date,
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, reverses_id) references books.stock_move,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null)),
  check ((source_table is null) = (source_id is null))
);

-- A payment as recorded (cash counted, a UPI reference seen). Munshi never moves money.
create table books.payment (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  direction text not null check (direction in ('in', 'out')),
  method text not null check (method in ('cash', 'upi', 'card', 'bank')),
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  customer_id uuid,
  supplier_id uuid,
  sale_id uuid,
  purchase_id uuid,
  reference text,
  paid_at timestamptz not null,
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, supplier_id) references books.supplier,
  foreign key (tenant_id, sale_id) references books.sale,
  foreign key (tenant_id, purchase_id) references books.purchase,
  foreign key (tenant_id, reverses_id) references books.payment,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- Customer credit (udhaar): positive = credit given, negative = repaid. Balance = sum per customer.
create table books.credit_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  sale_id uuid,
  payment_id uuid,
  due_on date,
  at timestamptz not null,
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, sale_id) references books.sale,
  foreign key (tenant_id, payment_id) references books.payment,
  foreign key (tenant_id, reverses_id) references books.credit_entry,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

create table books.journal_entry (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  entry_date date not null,
  memo text,
  source_table text,
  source_id uuid,
  reverses_id uuid,
  reason text,
  created_txid bigint not null,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, reverses_id) references books.journal_entry,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null)),
  check ((source_table is null) = (source_id is null))
);

-- Signed amounts: debit positive, credit negative; account is a code from the chart (core defines the codes).
create table books.journal_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  entry_id uuid not null,
  account text not null,
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, entry_id) references books.journal_entry,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.attendance (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  staff_id uuid not null,
  day date not null,
  status text not null check (status in ('present', 'absent', 'half_day', 'leave')),
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, reverses_id) references books.attendance,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- A message to a customer, supplier or staff member, approved to go out (delivery is simulated in the demo).
create table books.outbound_message (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'sms')),
  recipient_kind text not null check (recipient_kind in ('customer', 'supplier', 'staff')),
  recipient_id uuid not null,
  body text not null,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create trigger guard before insert or update or delete on books.item for each row execute function books.guard();
create trigger guard before insert or update or delete on books.price for each row execute function books.guard();
create trigger guard before insert or update or delete on books.supplier for each row execute function books.guard();
create trigger guard before insert or update or delete on books.customer for each row execute function books.guard();
create trigger guard before insert or update or delete on books.staff for each row execute function books.guard();
create trigger guard before insert or update or delete on books.purchase for each row execute function books.guard();
create trigger guard before insert or update or delete on books.purchase_line for each row execute function books.guard();
create trigger guard before insert or update or delete on books.sale for each row execute function books.guard();
create trigger guard before insert or update or delete on books.sale_line for each row execute function books.guard();
create trigger guard before insert or update or delete on books.stock_move for each row execute function books.guard();
create trigger guard before insert or update or delete on books.payment for each row execute function books.guard();
create trigger guard before insert or update or delete on books.credit_entry for each row execute function books.guard();
create trigger guard before insert or update or delete on books.journal_entry for each row execute function books.guard();
create trigger guard before insert or update or delete on books.journal_line for each row execute function books.guard();
create trigger guard before insert or update or delete on books.attendance for each row execute function books.guard();
create trigger guard before insert or update or delete on books.outbound_message for each row execute function books.guard();

-- Same-timing triggers fire in name order: on the journal tables guard runs before txn.
create trigger guard_audit after insert on books.item for each row execute function books.audit_row();
create trigger guard_audit after insert on books.price for each row execute function books.audit_row();
create trigger guard_audit after insert on books.supplier for each row execute function books.audit_row();
create trigger guard_audit after insert on books.customer for each row execute function books.audit_row();
create trigger guard_audit after insert on books.staff for each row execute function books.audit_row();
create trigger guard_audit after insert on books.purchase for each row execute function books.audit_row();
create trigger guard_audit after insert on books.purchase_line for each row execute function books.audit_row();
create trigger guard_audit after insert on books.sale for each row execute function books.audit_row();
create trigger guard_audit after insert on books.sale_line for each row execute function books.audit_row();
create trigger guard_audit after insert on books.stock_move for each row execute function books.audit_row();
create trigger guard_audit after insert on books.payment for each row execute function books.audit_row();
create trigger guard_audit after insert on books.credit_entry for each row execute function books.audit_row();
create trigger guard_audit after insert on books.journal_entry for each row execute function books.audit_row();
create trigger guard_audit after insert on books.journal_line for each row execute function books.audit_row();
create trigger guard_audit after insert on books.attendance for each row execute function books.audit_row();
create trigger guard_audit after insert on books.outbound_message for each row execute function books.audit_row();
create trigger txn before insert on books.journal_entry for each row execute function books.entry_txn();
create trigger txn before insert on books.journal_line for each row execute function books.entry_txn();

create constraint trigger balanced after insert on books.journal_entry
  deferrable initially deferred for each row execute function books.check_balanced();
create constraint trigger balanced after insert on books.journal_line
  deferrable initially deferred for each row execute function books.check_balanced();

alter table books.item enable row level security;
alter table books.item force row level security;
create policy tenant_isolation on books.item
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.price enable row level security;
alter table books.price force row level security;
create policy tenant_isolation on books.price
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.supplier enable row level security;
alter table books.supplier force row level security;
create policy tenant_isolation on books.supplier
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.customer enable row level security;
alter table books.customer force row level security;
create policy tenant_isolation on books.customer
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.staff enable row level security;
alter table books.staff force row level security;
create policy tenant_isolation on books.staff
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.purchase enable row level security;
alter table books.purchase force row level security;
create policy tenant_isolation on books.purchase
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.purchase_line enable row level security;
alter table books.purchase_line force row level security;
create policy tenant_isolation on books.purchase_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.sale enable row level security;
alter table books.sale force row level security;
create policy tenant_isolation on books.sale
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.sale_line enable row level security;
alter table books.sale_line force row level security;
create policy tenant_isolation on books.sale_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.stock_move enable row level security;
alter table books.stock_move force row level security;
create policy tenant_isolation on books.stock_move
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.payment enable row level security;
alter table books.payment force row level security;
create policy tenant_isolation on books.payment
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.credit_entry enable row level security;
alter table books.credit_entry force row level security;
create policy tenant_isolation on books.credit_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.journal_entry enable row level security;
alter table books.journal_entry force row level security;
create policy tenant_isolation on books.journal_entry
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.journal_line enable row level security;
alter table books.journal_line force row level security;
create policy tenant_isolation on books.journal_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.attendance enable row level security;
alter table books.attendance force row level security;
create policy tenant_isolation on books.attendance
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table books.outbound_message enable row level security;
alter table books.outbound_message force row level security;
create policy tenant_isolation on books.outbound_message
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- Append-only: SELECT and INSERT for the app, nothing for the agent, no UPDATE or DELETE for anyone.
revoke all on books.item from public, munshi_app, munshi_agent;
grant select, insert on books.item to munshi_app;

revoke all on books.price from public, munshi_app, munshi_agent;
grant select, insert on books.price to munshi_app;

revoke all on books.supplier from public, munshi_app, munshi_agent;
grant select, insert on books.supplier to munshi_app;

revoke all on books.customer from public, munshi_app, munshi_agent;
grant select, insert on books.customer to munshi_app;

revoke all on books.staff from public, munshi_app, munshi_agent;
grant select, insert on books.staff to munshi_app;

revoke all on books.purchase from public, munshi_app, munshi_agent;
grant select, insert on books.purchase to munshi_app;

revoke all on books.purchase_line from public, munshi_app, munshi_agent;
grant select, insert on books.purchase_line to munshi_app;

revoke all on books.sale from public, munshi_app, munshi_agent;
grant select, insert on books.sale to munshi_app;

revoke all on books.sale_line from public, munshi_app, munshi_agent;
grant select, insert on books.sale_line to munshi_app;

revoke all on books.stock_move from public, munshi_app, munshi_agent;
grant select, insert on books.stock_move to munshi_app;

revoke all on books.payment from public, munshi_app, munshi_agent;
grant select, insert on books.payment to munshi_app;

revoke all on books.credit_entry from public, munshi_app, munshi_agent;
grant select, insert on books.credit_entry to munshi_app;

revoke all on books.journal_entry from public, munshi_app, munshi_agent;
grant select, insert on books.journal_entry to munshi_app;

revoke all on books.journal_line from public, munshi_app, munshi_agent;
grant select, insert on books.journal_line to munshi_app;

revoke all on books.attendance from public, munshi_app, munshi_agent;
grant select, insert on books.attendance to munshi_app;

revoke all on books.outbound_message from public, munshi_app, munshi_agent;
grant select, insert on books.outbound_message to munshi_app;

create index price_item_from on books.price (tenant_id, item_id, effective_from);
create unique index purchase_bill on books.purchase (tenant_id, supplier_id, bill_no) where reverses_id is null;
create index purchase_line_item on books.purchase_line (tenant_id, item_id);
create index sale_sold_at on books.sale (tenant_id, sold_at);
create index sale_line_item on books.sale_line (tenant_id, item_id);
create index stock_move_item_at on books.stock_move (tenant_id, item_id, at);
create index payment_paid_at on books.payment (tenant_id, paid_at);
create index credit_entry_customer on books.credit_entry (tenant_id, customer_id, at);
create index journal_line_entry on books.journal_line (tenant_id, entry_id);
create index attendance_staff_day on books.attendance (tenant_id, staff_id, day);
