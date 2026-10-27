// A tenant with one row in every tenant table, written through the real paths as munshi_app: ops rows directly, book
// rows under a member's direct command or an approved decision, so the guard and the audit chain run for every row.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { setCtx, tx } from './db.ts';

export type Tenant = {
  tenant: string;
  shop: string;
  owner: string;
  manager: string;
  staffMember: string;
  item: string;
  supplier: string;
  customer: string;
  staff: string;
  document: string;
  run: string;
  snapshot: string;
  finding: string;
  draft: string;
  decision: string;
};

export async function seedTenant(app: pg.Pool, label: string): Promise<Tenant> {
  const t: Tenant = {
    tenant: randomUUID(),
    shop: randomUUID(),
    owner: randomUUID(),
    manager: randomUUID(),
    staffMember: randomUUID(),
    item: randomUUID(),
    supplier: randomUUID(),
    customer: randomUUID(),
    staff: randomUUID(),
    document: randomUUID(),
    run: randomUUID(),
    snapshot: randomUUID(),
    finding: randomUUID(),
    draft: randomUUID(),
    decision: randomUUID(),
  };
  const T = t.tenant;

  await tx(app, { tenant: T }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name) values ($1, $2)', [T, `${label} General Store (synthetic)`]);
    await c.query('insert into ops.shop (tenant_id, id, name) values ($1, $2, $3)', [T, t.shop, 'Main counter']);
    await c.query(
      `insert into ops.member (tenant_id, id, name, role) values
         ($1, $2, 'Owner (synthetic)', 'owner'), ($1, $3, 'Manager (synthetic)', 'manager'), ($1, $4, 'Counter staff (synthetic)', 'staff')`,
      [T, t.owner, t.manager, t.staffMember],
    );
    await c.query(
      `insert into ops.document (tenant_id, id, kind, storage_key, sha256, mime, bytes, uploaded_by)
       values ($1, $2, 'bill', 'bills/1.jpg', $3, 'image/jpeg', 2048, $4)`,
      [T, t.document, 'a'.repeat(64), t.owner],
    );
  });

  const as = (command: string, fn: (c: pg.PoolClient) => Promise<unknown>) =>
    tx(app, { tenant: T, actor: t.owner, command }, fn);
  await as('item.create', (c) =>
    c.query(`insert into books.item (tenant_id, id, name, unit) values ($1, $2, 'Glucose biscuits 70 g', 'pack')`, [T, t.item]),
  );
  await as('price.set', (c) =>
    c.query(`insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 1000, 'INR', now())`, [
      T,
      t.item,
    ]),
  );
  await as('supplier.create', (c) =>
    c.query(`insert into books.supplier (tenant_id, id, name) values ($1, $2, 'Gupta Traders (simulated)')`, [T, t.supplier]),
  );
  await as('customer.create', (c) =>
    c.query(`insert into books.customer (tenant_id, id, name) values ($1, $2, 'Credit customer (synthetic)')`, [T, t.customer]),
  );
  await as('staff.create', (c) =>
    c.query(`insert into books.staff (tenant_id, id, name, member_id) values ($1, $2, 'Counter staff (synthetic)', $3)`, [
      T,
      t.staff,
      t.staffMember,
    ]),
  );
  await as('purchase.record', async (c) => {
    const p = randomUUID();
    await c.query(
      `insert into books.purchase (tenant_id, id, supplier_id, bill_no, bill_date, document_id, total_minor, currency)
       values ($1, $2, $3, 'B-1', current_date, $4, 8000, 'INR')`,
      [T, p, t.supplier, t.document],
    );
    await c.query(
      `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency)
       values ($1, $2, 1, $3, 10000, 800, 'INR')`,
      [T, p, t.item],
    );
    await c.query(
      `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_table, source_id, at)
       values ($1, $2, 10000, 'purchase', 'books.purchase', $3, now())`,
      [T, t.item, p],
    );
  });
  await as('sale.record', async (c) => {
    const s = randomUUID();
    const pay = randomUUID();
    const je = randomUUID();
    await c.query(
      `insert into books.sale (tenant_id, id, shop_id, sold_at, customer_id, total_minor, currency)
       values ($1, $2, $3, now(), $4, 2000, 'INR')`,
      [T, s, t.shop, t.customer],
    );
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, qty_milli, unit_price_minor, currency)
       values ($1, $2, 1, $3, 2000, 1000, 'INR')`,
      [T, s, t.item],
    );
    await c.query(
      `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_table, source_id, at)
       values ($1, $2, -2000, 'sale', 'books.sale', $3, now())`,
      [T, t.item, s],
    );
    await c.query(
      `insert into books.payment (tenant_id, id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at)
       values ($1, $2, 'in', 'cash', 1500, 'INR', $3, $4, now())`,
      [T, pay, t.customer, s],
    );
    await c.query(
      `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, at)
       values ($1, $2, 500, 'INR', $3, now())`,
      [T, t.customer, s],
    );
    await c.query(
      `insert into books.journal_entry (tenant_id, id, entry_date, source_table, source_id)
       values ($1, $2, current_date, 'books.sale', $3)`,
      [T, je, s],
    );
    await c.query(
      `insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values
         ($1, $2, 'cash', 1500, 'INR'), ($1, $2, 'receivable', 500, 'INR'), ($1, $2, 'sales', -2000, 'INR')`,
      [T, je],
    );
  });
  await as('attendance.record', (c) =>
    c.query(`insert into books.attendance (tenant_id, staff_id, day, status) values ($1, $2, current_date, 'present')`, [T, t.staff]),
  );
  await as('message.send', (c) =>
    c.query(
      `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, body)
       values ($1, 'whatsapp', 'customer', $2, 'Payment reminder (synthetic)')`,
      [T, t.customer],
    ),
  );

  // A watcher run: trace, snapshot with cells, finding, and a draft proposing a price change.
  await tx(app, { tenant: T }, async (c) => {
    await c.query(`insert into ops.run (tenant_id, id, trigger) values ($1, $2, 'watcher')`, [T, t.run]);
    await c.query(`insert into ops.run_trace (tenant_id, run_id, seq, kind, label) values ($1, $2, 1, 'snapshot', 'stock.on_hand')`, [
      T,
      t.run,
    ]);
    await c.query(
      `insert into snap.snapshot (tenant_id, id, query_name, params, run_id, row_count) values ($1, $2, 'stock.on_hand', '{}', $3, 1)`,
      [T, t.snapshot, t.run],
    );
    await c.query(
      `insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num, unit) values
         ($1, $2, 0, 'on_hand', 'quantity', 8000, 'pack')`,
      [T, t.snapshot],
    );
    await c.query(`insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, txt) values ($1, $2, 0, 'item', 'text', $3)`, [
      T,
      t.snapshot,
      'Glucose biscuits 70 g',
    ]);
    await c.query(
      `insert into ops.finding (tenant_id, id, kind, dedupe_key, snapshot_id, run_id) values ($1, $2, 'shrinkage', $3, $4, $5)`,
      [T, t.finding, `shrinkage:${t.item}`, t.snapshot, t.run],
    );
    await c.query(
      `insert into approval.draft (tenant_id, id, command_type, payload, based_on, run_id, finding_id)
       values ($1, $2, 'price.set', $3, $4, $5, $6)`,
      [
        T,
        t.draft,
        { item_id: t.item, amount_minor: 1100, currency: 'INR' },
        JSON.stringify([{ snapshot_id: t.snapshot, row: 0, col: 'on_hand' }]),
        t.run,
        t.finding,
      ],
    );
  });

  // The owner approves the draft; the price row is written under that decision in the same transaction.
  await tx(app, { tenant: T, actor: t.owner }, async (c) => {
    await c.query(`insert into approval.decision (tenant_id, id, draft_id, verdict, decided_by) values ($1, $2, $3, 'approved', $4)`, [
      T,
      t.decision,
      t.draft,
      t.owner,
    ]);
    await setCtx(c, { decision: t.decision });
    await c.query(
      `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 1100, 'INR', now())`,
      [T, t.item],
    );
    await c.query(`update approval.draft set status = 'executed', updated_at = now() where tenant_id = $1 and id = $2`, [T, t.draft]);
  });
  return t;
}

// A draft awaiting a decision, for tests that decide it themselves.
export async function proposeDraft(app: pg.Pool, t: Tenant, command = 'price.set'): Promise<string> {
  const id = randomUUID();
  await tx(app, { tenant: t.tenant }, (c) =>
    c.query(`insert into approval.draft (tenant_id, id, command_type, payload, run_id) values ($1, $2, $3, '{}', $4)`, [
      t.tenant,
      id,
      command,
      t.run,
    ]),
  );
  return id;
}
