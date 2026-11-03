// The screens' named reads (packages/core/src/queries-app.ts) over a small shop. The headline: the counter's quote
// equals the sale it then records, to the paisa (same rounding), checked against figures worked out here in JS.
import { addDays, businessDate, lineAmount, mintSnapshot, recordPurchase, recordSale, runCommand, type Cell } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
let sugar: string; // an item with no price
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'MS10');
  sugar = ((await runCommand(app, s.owner, 'item.create', { name: 'Loose sugar', unit: 'kg' })) as { itemId: string }).itemId;
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

// The counter's reads as counter staff; the office's (a bill's lines, the last prices, the week's total) as the manager (staff are
// refused them, test/v2/core/agent/role-reads.test.ts).
const OFFICE = new Set(['bill.lines_for', 'purchases.last_prices', 'sales.week_total']);
const mint = (name: string, params: unknown) => mintSnapshot(app, { kind: 'member', session: OFFICE.has(name) ? s.manager : s.staff }, name, params);
const num = (c: Cell | undefined) => (c && 'num' in c ? Number(c.num) : null);

it('sale.quote prices each line from books.price, rounds like sale.record, and equals the sale then recorded', async () => {
  const lines = [
    { itemId: s.biscuits, qtyMilli: 3000 },
    { itemId: s.butter, qtyMilli: 2509 },
  ];
  const want = [lineAmount(3000, 1000), lineAmount(2509, 6200)];
  expect(want).toEqual([3000, 15556]); // independent of the SQL: 15,555.8 rounds up
  const total = lineAmount(3000, 1000) + lineAmount(2509, 6200);

  const quote = await mint('sale.quote', { item_ids: lines.map((l) => l.itemId), qty_milli: lines.map((l) => l.qtyMilli) });
  expect(quote.rows.map((r) => [num(r.unit_price), num(r.amount), num(r.total)])).toEqual([
    [1000, want[0], total],
    [6200, want[1], total],
  ]);
  expect(quote.rows[0]?.price_by).toEqual({ kind: 'text', txt: 'direct' });
  expect(quote.rows[0]?.item).toEqual({ kind: 'text', txt: 'Glucose biscuits 70 g' });

  // Record it, paying exactly the quoted total in cash: the books' total and lines are the quote's.
  const { saleId } = (await recordSale(app, s.staff, {
    shopId: s.shopId,
    lines,
    payments: [{ method: 'cash', amountMinor: num(quote.rows[0]?.total) as number }],
  })) as { saleId: string };
  const sale = (await db.admin.query('select total_minor::int as total from books.sale where id = $1', [saleId])).rows[0];
  expect(sale.total).toBe(num(quote.rows[0]?.total));
  const booked = (await db.admin.query('select unit_price_minor::int as p, qty_milli::int as q from books.sale_line where sale_id = $1 order by line_no', [saleId])).rows;
  expect(booked.map((l) => lineAmount(l.q, l.p))).toEqual(quote.rows.map((r) => num(r.amount)));

  // The receipt of that sale: the same lines, total, the cash tender, no credit, and who it was sold to (nobody).
  const receipt = await mint('sale.receipt', { sale_id: saleId });
  expect(receipt.rows.map((r) => [num(r.qty), num(r.unit_price), num(r.amount), num(r.total)])).toEqual([
    [3000, 1000, 3000, total],
    [2509, 6200, 15556, total],
  ]);
  expect(receipt.rows[0]).toMatchObject({ cash: { num: String(total) }, upi: { num: '0' }, card: { num: '0' }, on_credit: { num: '0' }, customer_id: { kind: 'null' } });
  expect(receipt.rows[0]?.sold_at).toMatchObject({ kind: 'timestamp' });
});

it('sale.quote: an item with no price has no price, no amount and no total; a repeated item is two lines', async () => {
  const quote = await mint('sale.quote', { item_ids: [s.biscuits, sugar, s.biscuits], qty_milli: [1000, 500, 2000] });
  expect(quote.rows.map((r) => [num(r.line_no), num(r.unit_price), num(r.amount), num(r.total)])).toEqual([
    [1, 1000, 1000, null],
    [2, null, null, null],
    [3, 1000, 2000, null],
  ]);
  await expect(mint('sale.quote', { item_ids: [s.biscuits], qty_milli: [1000, 2000] })).rejects.toMatchObject({ code: 'invalid' });
});

it('sale.receipt: a sale on credit shows the credit and its customer', async () => {
  const { saleId } = (await recordSale(app, s.staff, {
    shopId: s.shopId,
    customerId: s.customer,
    lines: [{ itemId: s.biscuits, qtyMilli: 2000 }],
    payments: [{ method: 'upi', amountMinor: 500 }],
  })) as { saleId: string };
  const receipt = await mint('sale.receipt', { sale_id: saleId });
  expect(receipt.rows).toHaveLength(1);
  expect(receipt.rows[0]).toMatchObject({ total: { num: '2000' }, upi: { num: '500' }, cash: { num: '0' }, on_credit: { num: '1500' }, customer_id: { kind: 'text', txt: s.customer } });
});

it('bill.lines_for gives a bill’s lines by id, with the earlier bill’s cost of the same item', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { purchaseId } = (await recordPurchase(app, s.manager, {
    supplierId: s.supplier,
    billNo: 'GT-2',
    billDate: day,
    lines: [
      { itemId: s.butter, qtyMilli: 6000, unitCostMinor: 5900, expiresOn: '2027-04-30' },
      { itemId: sugar, qtyMilli: 1500, unitCostMinor: 4333 },
    ],
  })) as { purchaseId: string };
  const lines = await mint('bill.lines_for', { purchase_id: purchaseId });
  expect(lines.rows.map((r) => [num(r.line_no), num(r.qty), num(r.unit_cost), num(r.amount), num(r.prev_unit_cost)])).toEqual([
    [1, 6000, 5900, lineAmount(6000, 5900), 5600], // the earlier bill (GT-1) paid ₹56 for butter
    [2, 1500, 4333, lineAmount(1500, 4333), null], // 6,499.5 paise rounds up to 6,500; sugar was never bought before
  ]);
  expect(num(lines.rows[1]?.amount)).toBe(6500);
  expect(lines.rows.map((r) => (r.item as { txt: string }).txt)).toEqual(['Butter 100 g', 'Loose sugar']);
  expect(lines.rows[0]?.expires_on).toEqual({ kind: 'date', day: '2027-04-30' });
  expect(lines.rows[1]?.expires_on).toEqual({ kind: 'null' });
  // An id that is no bill of this shop reads as no lines.
  expect((await mint('bill.lines_for', { purchase_id: s.customer })).rows).toEqual([]);

  // purchases.last_prices: one row per bought item, at its latest line (butter on GT-2, not GT-1); unbought items absent.
  const last = await mint('purchases.last_prices', {});
  expect(last.rows.map((r) => [(r.item as { txt: string }).txt, num(r.unit_cost), (r.bill_no as { txt: string }).txt])).toEqual([
    ['Butter 100 g', 5900, 'GT-2'],
    ['Glucose biscuits 70 g', 850, 'GT-1'],
    ['Loose sugar', 4333, 'GT-2'],
  ]);
  expect(last.rows[0]?.supplier_id).toEqual({ kind: 'text', txt: s.supplier }); // the supplier by id: no name in a cell
});

it('sales.week_total sums the range: bills, total and each tender, from the raw sale rows', async () => {
  const today = businessDate(new Date(), 'Asia/Kolkata');
  const raw = (await db.admin.query(
    `select count(*)::int as bills, sum(total_minor)::int as total,
            (select coalesce(sum(amount_minor), 0)::int from books.payment where direction = 'in' and method = 'cash') as cash,
            (select coalesce(sum(amount_minor), 0)::int from books.payment where direction = 'in' and method = 'upi') as upi
       from books.sale`,
  )).rows[0];
  expect(raw.bills).toBe(2);
  const week = await mint('sales.week_total', { from: addDays(today, -6), to: addDays(today, 1) });
  expect(week.rows).toHaveLength(1);
  expect(week.rows[0]).toMatchObject({
    bills: { num: String(raw.bills) },
    total: { num: String(raw.total), currency: 'INR' },
    cash: { num: String(raw.cash) },
    upi: { num: String(raw.upi) },
    card: { num: '0' },
    on_credit: { num: String(raw.total - raw.cash - raw.upi) },
  });
  const empty = await mint('sales.week_total', { from: addDays(today, -60), to: addDays(today, -54) });
  expect(empty.rows[0]).toMatchObject({ bills: { num: '0' }, total: { num: '0' } });
  await expect(mint('sales.week_total', { from: today, to: addDays(today, -1) })).rejects.toMatchObject({ code: 'invalid' });
});
