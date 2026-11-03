// The books of files 10–13 and 15: G2 (the guard over every real books table), G3 (who may run or approve each command,
// against BLUEPRINT §2.4), G5 (append-only, the sandbox delete), G6 (the journal balances), G11 (children only in their
// parent's transaction), KEY1 (the composite keys: no service moves or buys stock; a child's currency, customer and
// terms are its header's), TOT1, REV1, LIVE1, K6, PAY1, SAL1, SLOT1's revision rule, and H1/H2 (photo evidence).
// Red-proofs: test/v2/sabotage/books-core.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, sha, signUp, type Tenant } from './fixture.ts';
import { asOwner, MANIFEST, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  f = await fillTenant(db, await signUp(db, 'core-shop'));
  await db.sabotage();
});
afterAll(() => db?.close());

const BOOKS = Object.keys(MANIFEST.bookTables).sort();
const run = <T>(actor: string, command: string | undefined, fn: (c: pg.PoolClient) => Promise<T>, t: Tenant = f) =>
  tx(app, command ? { tenant_id: t.tenant, actor_id: actor, command } : { tenant_id: t.tenant, actor_id: actor }, fn);
const one = async (c: pg.PoolClient, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const journal = async (c: pg.PoolClient, lines: [string, number, string?][], memo = 'test') => {
  const entry = await one(c, `insert into books.journal_entry (tenant_id, entry_date, memo_code) values ($1, current_date, $2) returning id`, [f.tenant, memo]);
  for (const [account, amount, currency] of lines) {
    await c.query(`insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values ($1, $2, $3, $4, $5)`, [
      f.tenant,
      entry,
      account,
      amount,
      currency ?? 'INR',
    ]);
  }
  return entry;
};
// A draft-only command runs only under an approved decision: proposed in one transaction, decided in the next.
async function underDecision<T>(command: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const draft = await run(f.owner, undefined, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, $2, '{}', $3, 'member', 0) returning id`, [
      f.tenant,
      command,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  return run(f.owner, undefined, async (c) => {
    const d = await one(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`, [
      f.tenant,
      draft,
      f.owner,
    ]);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
    return fn(c);
  });
}

it('G2 every books table refuses a write with no decision and no direct command', async () => {
  for (const rel of BOOKS) {
    const r = await refused(run(f.owner, undefined, (c) => c.query(`insert into ${rel} (tenant_id) values ($1)`, [f.tenant])));
    expect(r.code, `${rel}: ${r.message}`).toBe('MS001');
    expect(r.message, rel).toMatch(/no approved decision and no direct command/);
  }
  console.log(`G2 ${BOOKS.length} books tables refuse a write with no command`);
  expect(BOOKS.length).toBeGreaterThan(20);
});

it('G2 a direct command admits only the books tables ref.command_table names for it', async () => {
  const { rows } = await db.admin.query<{ rel: string; command: string }>(
    `select b.rel, (select c.command from ref.command c join ref.command_authority a on a.command = c.command and a.role = 'owner'
                     where not c.draft_only and not exists (select 1 from ref.command_table t where t.command = c.command and t.rel = b.rel)
                     order by c.command limit 1) as command
       from ref.book_table b where b.rel = any($1) order by 1`,
    [BOOKS],
  );
  for (const { rel, command } of rows) {
    const r = await refused(run(f.owner, command, (c) => c.query(`insert into ${rel} (tenant_id) values ($1)`, [f.tenant])));
    expect(r.code, `${rel} under ${command}`).toBe('MS001');
    expect(r.message, `${rel} under ${command}`).toMatch(/does not write/);
  }
  expect(rows.length).toBe(BOOKS.length);
});

// BLUEPRINT §2.4, transcribed: who runs each command of files 10–21 directly, and who approves the draft-only ones.
const AUTHORITY: Record<string, { draftOnly: boolean; roles: string[] }> = {
  'item.create': { draftOnly: false, roles: ['manager', 'owner'] },
  'item.revise': { draftOnly: false, roles: ['owner'] },
  'item.alias': { draftOnly: false, roles: ['manager', 'owner'] },
  'price.set': { draftOnly: false, roles: ['owner'] },
  'grid.apply': { draftOnly: true, roles: ['owner'] },
  'customer.create': { draftOnly: false, roles: ['manager', 'owner'] },
  'customer.terms': { draftOnly: false, roles: ['manager', 'owner'] },
  'contact.link': { draftOnly: false, roles: ['manager', 'owner'] },
  'supplier.create': { draftOnly: false, roles: ['manager', 'owner'] },
  'staff.create': { draftOnly: false, roles: ['owner'] },
  'staff.terms': { draftOnly: false, roles: ['owner'] },
  'consent.record': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'booking.confirm': { draftOnly: false, roles: ['manager', 'owner'] },
  'shift.pattern.set': { draftOnly: false, roles: ['manager', 'owner'] },
  'shift.change': { draftOnly: false, roles: ['manager', 'owner'] },
  'leave.record': { draftOnly: false, roles: ['manager', 'owner'] },
  'leave.reverse': { draftOnly: false, roles: ['manager', 'owner'] },
  'holiday.set': { draftOnly: false, roles: ['manager', 'owner'] },
  'holiday.reverse': { draftOnly: false, roles: ['manager', 'owner'] },
  'attendance.mark': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'advance.give': { draftOnly: false, roles: ['owner'] },
  'advance.reverse': { draftOnly: false, roles: ['owner'] },
  'salary.run': { draftOnly: true, roles: ['owner'] },
  'wages.pay': { draftOnly: false, roles: ['manager', 'owner'] },
  'sale.record': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'sale.reverse': { draftOnly: false, roles: ['owner'] },
  'purchase.record': { draftOnly: false, roles: ['manager', 'owner'] },
  'purchase.reverse': { draftOnly: false, roles: ['owner'] },
  'stock.count': { draftOnly: false, roles: ['manager', 'owner'] },
  'stock.waste': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'stock.reverse': { draftOnly: false, roles: ['manager', 'owner'] },
  'credit.record': { draftOnly: false, roles: ['manager', 'owner'] },
  'credit.reverse': { draftOnly: false, roles: ['owner'] },
  'payment.record': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'payment.reverse': { draftOnly: false, roles: ['owner'] },
  'settlement.record': { draftOnly: false, roles: ['manager', 'owner'] },
  'settlement.reverse': { draftOnly: false, roles: ['owner'] },
  'settlement.import': { draftOnly: false, roles: ['manager', 'owner'] },
  'offer.create': { draftOnly: false, roles: ['owner'] },
  'offer.end': { draftOnly: false, roles: ['owner'] },
  'loyalty.rule.set': { draftOnly: false, roles: ['owner'] },
  'package.plan.create': { draftOnly: false, roles: ['owner'] },
  'package.redeem': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'package.expire': { draftOnly: true, roles: ['owner'] },
  'tax.registration.set': { draftOnly: false, roles: ['owner'] },
  'reorder.place': { draftOnly: false, roles: ['manager', 'owner'] },
  'campaign.send': { draftOnly: true, roles: ['owner'] },
  'campaign.post': { draftOnly: true, roles: ['owner'] },
  'message.reply': { draftOnly: true, roles: ['manager', 'owner'] },
  'customer.remind': { draftOnly: true, roles: ['manager', 'owner'] },
  'order.confirm': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'order.step': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'order.reschedule': { draftOnly: false, roles: ['manager', 'owner', 'staff'] },
  'order.cancel': { draftOnly: false, roles: ['manager', 'owner'] },
  'order.reverse': { draftOnly: false, roles: ['manager', 'owner'] },
  // 25_surplus.sql (W2-B): a gift of stock is a draft an owner or a manager approves.
  'surplus.give': { draftOnly: true, roles: ['manager', 'owner'] },
  // 24_paypal.sql (D-079): asking for a PayPal link, and cancelling one, are drafts an owner or a manager approves.
  'paypal.request': { draftOnly: true, roles: ['manager', 'owner'] },
  'paypal.cancel': { draftOnly: true, roles: ['manager', 'owner'] },
};

it('G3 who may run or approve each command of files 10–21 is BLUEPRINT §2.4’s table, and no runtime role changes it', async () => {
  const { rows } = await db.admin.query<{ command: string; draft_only: boolean; roles: string[] }>(
    `select c.command, c.draft_only, coalesce(array_agg(a.role order by a.role) filter (where a.role is not null), '{}') as roles
       from ref.command c left join ref.command_authority a on a.command = c.command where c.command not like 'probe.%' group by 1, 2 order by 1`,
  );
  const held = Object.fromEntries(rows.map((r) => [r.command, { draftOnly: r.draft_only, roles: r.roles }]));
  console.log(`G3 ${rows.length} commands in ref; ${Object.keys(AUTHORITY).length} transcribed from §2.4`);
  expect(Object.keys(AUTHORITY).length).toBe(58);
  expect(held).toEqual(AUTHORITY);
  expect((await refused(run(f.owner, undefined, (c) => c.query(`insert into ref.command_authority (command, role) values ('price.set', 'manager')`)))).code).toBe('42501');
});

it('G5 every books table refuses an UPDATE and a DELETE, even as the owner, by the append-only rule; the sandbox reset deletes', async () => {
  let refusals = 0;
  for (const rel of BOOKS) {
    for (const sql of [`update ${rel} set created_at = created_at`, `delete from ${rel}`]) {
      const r = await refused(asOwner(db.admin, [sql], f.tenant));
      expect(r.code, `${rel}: ${sql}`).toBe('MS001');
      expect(r.message, `${rel}: ${sql}`).toMatch(/is append-only/);
      refusals++;
    }
  }
  expect(refusals).toBe(2 * BOOKS.length);
  const sandbox = await signUp(db, 'core-sandbox', { sandbox: true });
  const item = await run(
    sandbox.owner,
    'item.create',
    (c) => one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'good', 'piece') returning id`, [sandbox.tenant]),
    sandbox,
  );
  const [deleted] = await asOwner(db.admin, [`delete from books.item where id = '${item}'`], sandbox.tenant);
  expect(deleted?.rowCount).toBe(1);
});

it('G6 every journal entry balances per currency at commit, and has lines', async () => {
  const entry = (lines: [string, number, string?][]) => run(f.owner, 'settlement.record', (c) => journal(c, lines));
  expect((await refused(entry([['cash', 100], ['sales', -99]]))).code).toBe('MS004');
  expect((await refused(entry([]))).code).toBe('MS004');
  expect((await refused(entry([['cash', 100, 'INR'], ['sales', -100, 'AUD']]))).code).toBe('MS004');
  await entry([['cash', 100, 'INR'], ['sales', -100, 'INR'], ['cash', 7, 'AUD'], ['sales', -7, 'AUD']]);
});

it('G11 every child books table takes a row only in its parent’s transaction', async () => {
  const children = (await db.admin.query<{ rel: string }>(`select rel from ref.book_table where parent_rel is not null order by 1`)).rows.map((r) => r.rel);
  expect(children).toEqual([
    'books.invoice',
    'books.invoice_line',
    'books.journal_line',
    'books.offer_item',
    'books.order_line',
    'books.package_holding',
    'books.package_plan_line',
    'books.purchase_line',
    'books.salary_line',
    'books.sale_discount',
    'books.sale_line',
  ]);
  const salaryRun = (await db.admin.query(`select id from books.salary_run where tenant_id = $1 limit 1`, [f.tenant])).rows[0].id;
  const entry = (await db.admin.query(`select id from books.journal_entry where tenant_id = $1 limit 1`, [f.tenant])).rows[0].id;
  const late: [string, string | undefined, string, string][] = [
    ['books.sale_line', 'sale.record', 'sale_id', f.sale],
    ['books.purchase_line', 'purchase.record', 'purchase_id', f.purchase],
    ['books.journal_line', 'sale.record', 'entry_id', entry],
    ['books.sale_discount', 'sale.record', 'sale_id', f.sale],
    ['books.package_holding', 'sale.record', 'sale_id', f.sale],
    ['books.invoice', 'sale.record', 'sale_id', f.sale],
    ['books.invoice_line', 'sale.record', 'invoice_id', (await db.admin.query(`select id from books.invoice where sale_id = $1`, [f.counterSale])).rows[0].id],
    ['books.offer_item', 'offer.create', 'offer_id', f.offer],
    ['books.package_plan_line', 'package.plan.create', 'plan_id', f.plan],
    ['books.order_line', 'order.confirm', 'order_id', f.order],
  ];
  for (const [rel, command, col, parent] of late) {
    const r = await refused(run(f.owner, command, (c) => c.query(`insert into ${rel} (tenant_id, ${col}) values ($1, $2)`, [f.tenant, parent])));
    expect(r.code, rel).toBe('MS006');
  }
  const salary = await refused(underDecision('salary.run', (c) => c.query(`insert into books.salary_line (tenant_id, run_id) values ($1, $2)`, [f.tenant, salaryRun])));
  expect(salary.code).toBe('MS006');
});

it('KEY1 a service or a package never moves stock or is bought; a line keeps its sale’s currency, a credit entry its sale’s customer, a salary line its terms', async () => {
  const pkg = await run(f.owner, 'item.create', (c) => one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'package', 'piece') returning id`, [f.tenant]));
  for (const item of [f.service, pkg]) {
    const move = await refused(
      run(f.owner, 'stock.waste', (c) => c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, at) values ($1, $2, -1000, 'waste', now())`, [f.tenant, item])),
    );
    expect(move.code, 'stock move').toBe('23503');
  }
  const bought = await refused(
    run(f.owner, 'purchase.record', async (c) => {
      const p = await one(c, `insert into books.purchase (tenant_id, supplier_id, total_minor, currency) values ($1, $2, 1000, 'INR') returning id`, [f.tenant, f.supplier]);
      await c.query(`insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency) values ($1, $2, 1, $3, 1000, 1000, 'INR')`, [
        f.tenant,
        p,
        f.service,
      ]);
    }),
  );
  expect(bought.code).toBe('23503');
  const otherCustomer = await run(f.owner, 'customer.create', (c) => one(c, 'insert into books.customer (tenant_id) values ($1) returning id', [f.tenant]));
  const sale = (currency: string, creditFor: string) =>
    run(f.owner, 'sale.record', async (c) => {
      const s = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 0, 'INR') returning id`, [
        f.tenant,
        f.shop,
        f.customer,
      ]);
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
         values ($1, $2, 1, $3, 'good', $4, 1000, 0, 0, $5)`,
        [f.tenant, s, f.good, f.goodPrice, currency],
      );
      await c.query(`insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, at) values ($1, $2, 100, 'INR', $3, now())`, [f.tenant, creditFor, s]);
    });
  expect((await refused(sale('USD', f.customer))).code).toBe('23503');
  expect((await refused(sale('INR', otherCustomer))).code).toBe('23503');
  await sale('INR', f.customer);
  const salary = await refused(
    underDecision('salary.run', async (c) => {
      const r = await one(c, `insert into books.salary_run (tenant_id, period_start, period_end) values ($1, current_date + 400, current_date + 430) returning id`, [f.tenant]);
      await c.query(
        `insert into books.salary_line (tenant_id, run_id, staff_id, terms_id, pay_kind, pay_minor, days_milli, gross_minor, advance_recovered_minor, net_minor, currency)
         values ($1, $2, $3, $4, 'monthly', 9999999, 30000, 9999999, 0, 9999999, 'INR')`,
        [f.tenant, r, f.staffRow, f.terms],
      );
    }),
  );
  expect(salary.code).toBe('23503');
});

it('TOT1 a sale’s total is its lines’ gross and a purchase’s its lines’ cost, rounded half away from zero, checked at commit', async () => {
  const sale = (total: number) =>
    run(f.owner, 'sale.record', async (c) => {
      const s = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, now(), $3, 'INR') returning id`, [f.tenant, f.shop, total]);
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
         values ($1, $2, 1, $3, 'good', $4, 2000, 25000, 50000, 'INR')`,
        [f.tenant, s, f.good, f.goodPrice],
      );
    });
  expect((await refused(sale(49999))).code).toBe('MS004');
  await sale(50000);
  const purchase = (total: number, bill: string) =>
    run(f.owner, 'purchase.record', async (c) => {
      const p = await one(c, `insert into books.purchase (tenant_id, supplier_id, bill_no, total_minor, currency) values ($1, $2, $3, $4, 'INR') returning id`, [
        f.tenant,
        f.supplier,
        bill,
        total,
      ]);
      // 1.5 packs at 333 a pack is 499.5, which rounds half away from zero to 500.
      await c.query(`insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency) values ($1, $2, 1, $3, 1500, 333, 'INR')`, [
        f.tenant,
        p,
        f.good,
      ]);
    });
  expect((await refused(purchase(499, 'T-1'))).code).toBe('MS004');
  await purchase(500, 'T-2');
});

it('REV1 a reversal header that leaves a child of its original unreversed fails at commit; with each child reversed it commits', async () => {
  const salaryRun = (await db.admin.query(`select id from books.salary_run where tenant_id = $1 and reverses_id is null limit 1`, [f.tenant])).rows[0].id as string;
  const line = (await db.admin.query(`select * from books.salary_line where tenant_id = $1 and run_id = $2`, [f.tenant, salaryRun])).rows[0];
  const reverse = (withLine: boolean) =>
    underDecision('salary.run', async (c) => {
      const header = await one(
        c,
        `insert into books.salary_run (tenant_id, period_start, period_end, reverses_id, reason)
         select tenant_id, period_start, period_end, id, 'wrong_figure' from books.salary_run where tenant_id = $1 and id = $2 returning id`,
        [f.tenant, salaryRun],
      );
      if (withLine) {
        await c.query(
          `insert into books.salary_line (tenant_id, run_id, staff_id, terms_id, pay_kind, pay_minor, days_milli, gross_minor, advance_recovered_minor, net_minor, currency,
                                          reverses_id, reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'wrong_figure')`,
          [f.tenant, header, line.staff_id, line.terms_id, line.pay_kind, line.pay_minor, -line.days_milli, -line.gross_minor, -line.advance_recovered_minor,
            -line.net_minor, line.currency, line.id],
        );
      }
    });
  const r = await refused(reverse(false));
  expect(r.code).toBe('MS013');
  expect(r.message).toMatch(/not reversed/);
  await reverse(true);
});

it('REV1 a full sale.reverse nets every table it wrote to zero, and a partial amount is refused', async () => {
  const original = (await db.admin.query(`select * from books.sale where id = $1`, [f.sale])).rows[0];
  const lines = (await db.admin.query(`select * from books.sale_line where sale_id = $1`, [f.sale])).rows;
  const move = (await db.admin.query(`select * from books.stock_move where source_id = $1`, [f.sale])).rows[0];
  const pay = (await db.admin.query(`select * from books.payment where sale_id = $1`, [f.sale])).rows[0];
  const credit = (await db.admin.query(`select * from books.credit_entry where sale_id = $1`, [f.sale])).rows[0];
  const entry = (await db.admin.query(`select * from books.journal_entry where source_id = $1`, [f.sale])).rows[0];
  const entryLines = (await db.admin.query(`select * from books.journal_line where entry_id = $1`, [entry.id])).rows;
  const reverse = (factor: number) =>
    run(f.owner, 'sale.reverse', async (c) => {
      const s = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency, reverses_id, reason) values ($1, $2, now(), $3, $4, $5, $6, 'returned_goods') returning id`, [
        f.tenant,
        original.shop_id,
        original.customer_id,
        -original.total_minor * factor,
        original.currency,
        f.sale,
      ]);
      for (const l of lines) {
        await c.query(
          `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, staff_id, qty_milli, unit_price_minor, gross_minor, tax_class, tax_rate_bp,
                                        tax_minor, currency, reverses_id, reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'returned_goods')`,
          [f.tenant, s, l.line_no, l.item_id, l.item_kind, l.price_id, l.staff_id, -l.qty_milli, l.unit_price_minor, -l.gross_minor * factor, l.tax_class,
            l.tax_rate_bp, -l.tax_minor, l.currency, l.id],
        );
      }
      await c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at, reverses_id, reason) values ($1, $2, $3, $4, 'books.sale', $5, now(), $6, 'returned_goods')`, [
        f.tenant,
        move.item_id,
        -move.qty_milli,
        move.kind,
        s,
        move.id,
      ]);
      await c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at, reverses_id, reason) values ($1, $2, $3, $4, $5, $6, $7, now(), $8, 'returned_goods')`, [
        f.tenant,
        pay.direction,
        pay.method,
        -pay.amount_minor,
        pay.currency,
        pay.customer_id,
        s,
        pay.id,
      ]);
      await c.query(`insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, at, reverses_id, reason) values ($1, $2, $3, $4, $5, now(), $6, 'returned_goods')`, [
        f.tenant,
        credit.customer_id,
        -credit.amount_minor,
        credit.currency,
        s,
        credit.id,
      ]);
      const e = await one(c, `insert into books.journal_entry (tenant_id, entry_date, memo_code, source_rel, source_id, reverses_id, reason) values ($1, current_date, 'sale', 'books.sale', $2, $3, 'returned_goods') returning id`, [
        f.tenant,
        s,
        entry.id,
      ]);
      for (const l of entryLines) {
        await c.query(`insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency, reverses_id, reason) values ($1, $2, $3, $4, $5, $6, 'returned_goods')`, [
          f.tenant,
          e,
          l.account,
          -l.amount_minor,
          l.currency,
          l.id,
        ]);
      }
    });
  expect((await refused(reverse(0.96))).code).toBe('MS013');
  await reverse(1);
  const { rows } = await db.admin.query(
    `select (select sum(total_minor) from books.sale where id = $1 or reverses_id = $1)::int as sale,
            (select sum(gross_minor) from books.sale_line where id = any($2) or reverses_id = any($2))::int as lines,
            (select sum(qty_milli) from books.stock_move where id = $3 or reverses_id = $3)::int as stock,
            (select sum(amount_minor) from books.payment where id = $4 or reverses_id = $4)::int as payment,
            (select sum(amount_minor) from books.credit_entry where id = $5 or reverses_id = $5)::int as credit,
            (select count(*) from (select account from books.journal_line where entry_id = $6 or reverses_id = any($7)
                                     group by account having sum(amount_minor) <> 0) x)::int as unbalanced_accounts`,
    [f.sale, lines.map((l) => l.id), move.id, pay.id, credit.id, entry.id, entryLines.map((l) => l.id)],
  );
  expect(rows[0]).toEqual({ sale: 0, lines: 0, stock: 0, payment: 0, credit: 0, unbalanced_accounts: 0 });
});

async function race(sql: string, params: unknown[], command: string): Promise<string> {
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', $3, true)`, [
        f.tenant,
        f.owner,
        command,
      ]);
    }
    await c1.query(sql, params);
    let settled = false;
    const second = c2.query(sql, params).then(
      () => 'recorded',
      (e: { code: string }) => e.code,
    );
    void second.finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(settled, 'the second writer waits for the first').toBe(false);
    await c1.query('commit');
    const outcome = await second;
    await c2.query(outcome === 'recorded' ? 'commit' : 'rollback');
    return outcome;
  } finally {
    c1.release();
    c2.release();
  }
}

it('LIVE1 two purchases of one supplier’s bill at once, or two settlements of one channel and day, record one row and refuse the other; a reversed one is recorded again', async () => {
  expect(await race(`insert into books.purchase (tenant_id, supplier_id, bill_no, total_minor, currency) values ($1, $2, 'L-1', 0, 'INR')`, [f.tenant, f.supplier], 'purchase.record')).toBe(
    '23505',
  );
  const settle = `insert into books.settlement (tenant_id, channel, business_date, amount_minor, currency, received_on) values ($1, 'card', current_date - 1, 500, 'INR', current_date)`;
  expect(await race(settle, [f.tenant], 'settlement.record')).toBe('23505');
  await run(f.owner, 'settlement.reverse', (c) =>
    c.query(
      `insert into books.settlement (tenant_id, channel, business_date, amount_minor, currency, received_on, reverses_id, reason)
       select tenant_id, channel, business_date, -amount_minor, currency, received_on, id, 'duplicate' from books.settlement
        where tenant_id = $1 and channel = 'card' and business_date = current_date - 1 and reverses_id is null`,
      [f.tenant],
    ),
  );
  await run(f.owner, 'settlement.record', (c) => c.query(settle, [f.tenant]));
  const { rows } = await db.admin.query(`select count(*)::int as n from books.settlement where tenant_id = $1 and channel = 'card' and business_date = current_date - 1`, [f.tenant]);
  expect(rows[0].n).toBe(3);
});

it('K6 consent names the customer’s contact in effect; a customer re-linked to a new phone has no consent until the new contact gives it', async () => {
  const consent = (contact: string) =>
    run(f.staff, 'consent.record', (c) =>
      c.query(
        `insert into books.customer_consent (tenant_id, customer_id, contact_id, channel, purpose, granted, source, notice_version, at)
         values ($1, $2, $3, 'whatsapp', 'marketing', true, 'in_person', 'v1', now())`,
        [f.tenant, f.customer, contact],
      ),
    );
  const audience = async () =>
    (
      await tx(app, { tenant_id: f.tenant }, (c) =>
        c.query(
          `select k.granted from books.customer_consent k
            where k.customer_id = $1 and k.channel = 'whatsapp' and k.purpose = 'marketing'
              and k.contact_id = (select p.contact_id from books.party_contact p where p.customer_id = k.customer_id and p.effective_from <= now()
                                   order by p.effective_from desc, p.created_at desc, p.id desc limit 1)
            order by k.created_at desc, k.id desc limit 1`,
          [f.customer],
        ),
      )
    ).rows;
  await consent(f.customerContact);
  expect(await audience()).toEqual([{ granted: true }]);
  const newPhone = await run(f.owner, undefined, (c) =>
    one(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Customer', '+919700000999') returning id`, [f.tenant]),
  );
  expect((await refused(consent(newPhone))).code).toBe('MS001'); // not the customer's contact yet
  await run(f.owner, 'contact.link', (c) =>
    c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [f.tenant, f.customer, newPhone]),
  );
  expect(await audience()).toEqual([]);
  expect((await refused(consent(f.customerContact))).code).toBe('MS001'); // the old phone no longer speaks for them
  await consent(newPhone);
  expect(await audience()).toEqual([{ granted: true }]);
});

it('PAY1 payment.record cannot pay a staff member and wages.pay can; staff mark only their own day, and never after an owner’s or manager’s mark', async () => {
  const pay = (actor: string, command: string) =>
    run(actor, command, async (c) => {
      await c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, staff_id, paid_at) values ($1, 'out', 'cash', 1000, 'INR', $2, now())`, [
        f.tenant,
        f.staffRow,
      ]);
      await journal(c, [['wages_payable', 1000], ['cash', -1000]], 'wages');
    });
  const r = await refused(pay(f.staff, 'payment.record'));
  expect(r.code).toBe('MS001');
  expect(r.message).toMatch(/wages.pay or advance.give/);
  await pay(f.owner, 'wages.pay');
  const mark = (actor: string, staffRow: string, day: string) =>
    run(actor, 'attendance.mark', (c) =>
      c.query(`insert into books.attendance (tenant_id, staff_id, shop_id, day, status, marked_by_role) values ($1, $2, $3, current_date + ${day}, 'absent', 'staff')`, [
        f.tenant,
        staffRow,
        f.shop,
      ]),
    );
  await mark(f.manager, f.staffRow, '1');
  const late = await refused(mark(f.staff, f.staffRow, '1'));
  expect(late.code).toBe('MS001');
  expect(late.message).toMatch(/owner or manager has marked/);
  const other = await run(f.owner, 'staff.create', async (c) => {
    const s = await one(c, 'insert into books.staff (tenant_id) values ($1) returning id', [f.tenant]);
    await c.query(`insert into books.staff_terms (tenant_id, staff_id, shop_id, pay_kind, pay_minor, currency, effective_from) values ($1, $2, $3, 'daily', 50000, 'INR', current_date)`, [
      f.tenant,
      s,
      f.shop,
    ]);
    return s;
  });
  const someoneElse = await refused(mark(f.staff, other, '2'));
  expect(someoneElse.message).toMatch(/marks only their own day/);
  const { rows } = await db.admin.query(`select marked_by_role from books.attendance where tenant_id = $1 and day = current_date + 1`, [f.tenant]);
  expect(rows).toEqual([{ marked_by_role: 'manager' }]); // stamped from the marker, whatever was sent
});

it('SAL1 recovered advances never exceed those outstanding; two live salary lines for one staff member never cover overlapping periods; live leave never overlaps', async () => {
  const line = (start: string, end: string, recovered: number) =>
    underDecision('salary.run', async (c) => {
      const r = await one(c, `insert into books.salary_run (tenant_id, period_start, period_end) values ($1, ${start}, ${end}) returning id`, [f.tenant]);
      await c.query(
        `insert into books.salary_line (tenant_id, run_id, staff_id, terms_id, pay_kind, pay_minor, days_milli, gross_minor, advance_recovered_minor, net_minor, currency)
         values ($1, $2, $3, $4, 'monthly', 1500000, 30000, 1500000, $5::bigint, 1500000 - $5::bigint, 'INR')`,
        [f.tenant, r, f.staffRow, f.terms, recovered],
      );
    });
  // The staff member's advances total 50000, whatever has been recovered or reversed.
  const over = await refused(line('current_date + 500', 'current_date + 530', 50001));
  expect(over.code).toBe('MS009');
  await line('current_date + 600', 'current_date + 630', 0);
  const twice = await refused(line('current_date + 620', 'current_date + 650', 0));
  expect(twice.code).toBe('MS001');
  expect(twice.message).toMatch(/overlapping period/);
  await line('current_date + 631', 'current_date + 660', 0);
  const leave = () =>
    run(f.owner, 'leave.record', (c) =>
      c.query(`insert into books.leave (tenant_id, staff_id, kind, first_day, last_day) values ($1, $2, 'paid', current_date + 61, current_date + 62)`, [f.tenant, f.staffRow]),
    );
  const clash = await refused(leave());
  expect(clash.message).toMatch(/overlaps live leave/);
  await run(f.owner, 'leave.reverse', (c) =>
    c.query(
      `insert into books.leave (tenant_id, staff_id, kind, first_day, last_day, half_day, reverses_id, reason)
       select tenant_id, staff_id, kind, first_day, last_day, half_day, id, 'entered_in_error' from books.leave where tenant_id = $1 and first_day = current_date + 60`,
      [f.tenant],
    ),
  );
  await leave();
});

it('SLOT1 a service’s revision gives its duration, and no other item’s does', async () => {
  const revise = (item: string, duration: number | null) =>
    run(f.owner, 'item.revise', (c) =>
      c.query(`insert into books.item_revision (tenant_id, item_id, name, duration_min, effective_from) values ($1, $2, 'Revised', $3, now())`, [f.tenant, item, duration]),
    );
  expect((await refused(revise(f.service, null))).message).toMatch(/service's revision gives its duration/);
  expect((await refused(revise(f.good, 30))).message).toMatch(/service's revision gives its duration/);
  await revise(f.service, 45);
  await revise(f.good, null);
});

it('H2 a bill’s lines are accepted only in the transaction that read it; H1 a shelf count’s raw answer is hashed and its boxes counted', async () => {
  const read = await run(f.owner, undefined, (c) =>
    one(c, `insert into ops.bill_read (tenant_id, run_id, supplier_id, photo_sha256, model, created_txid) values ($1, $2, $3, $4, 'model-x', 0) returning id`, [
      f.tenant,
      f.run,
      f.supplier,
      sha(randomUUID()),
    ]),
  );
  const late = await refused(
    run(f.owner, undefined, (c) =>
      c.query(
        `insert into ops.bill_line (tenant_id, bill_read_id, line_no, item_text, qty_milli, unit_cost_minor, qty_box, cost_box) values ($1, $2, 1, 'Tea', 1000, 100, '{1,1,2,2}', '{3,1,4,2}')`,
        [f.tenant, read],
      ),
    ),
  );
  expect(late.code).toBe('MS006');
  const count = (raw: string, rawHash: Buffer, matches: number) =>
    run(f.owner, undefined, (c) =>
      c.query(
        `insert into ops.shelf_count (tenant_id, run_id, item_id, photo_sha256, phrase, model, raw, raw_sha256, matches) values ($1, $2, $3, $4, 'Tea', 'model-x', $5, $6, $7)`,
        [f.tenant, f.run, f.good, sha(randomUUID()), raw, rawHash, matches],
      ),
    );
  const raw = '3<|box;x1=1;y1=2;x2=3;y2=4;w=5;h=6|> 4<|box;x1=1;y1=2;x2=3;y2=4;w=5;h=6|>';
  expect((await refused(count(raw, sha('forged'), 2))).code).toBe('23514');
  expect((await refused(count(raw, sha(raw), 3))).code).toBe('23514');
  await count(raw, sha(raw), 2);
  expect((await refused(tx(db.as('munshi_jobs'), { tenant_id: f.tenant }, (c) => c.query('insert into ops.bill_read (tenant_id) values ($1)', [f.tenant])))).code).toBe('42501');
});
