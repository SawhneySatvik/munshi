// The growth readings (growth.*): peak hours by weekday, new versus repeat customers, the average basket
// by week, slow movers and the payment-mode mix. The expected figures are worked out here by hand from the sales this
// test rings up (not read back from the SQL), and every figure comes back as a stored cell. No customer name or id is in
// any cell, and another shop's growth page reads its own books, not these.
import { addDays, businessDate, localTime, recordSale, runCommand, viewGrowth, withPage } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
let other: Shop;
const TZ = 'Asia/Kolkata';
const today = businessDate(new Date(), TZ);
const asOf = addDays(today, -1);
const D = (n: number) => addDays(asOf, -n);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Growth');
  other = await smallShop(app, 'Growth other');
  const since = localTime(D(60), 0, TZ).toISOString();
  const run = async (name: string, input: unknown) => (await runCommand(app, s.owner, name, input)) as Record<string, string>;
  const tea = (await run('item.create', { name: 'Tea leaves 250 g', unit: 'pack', effectiveFrom: since })).itemId as string;
  const coffee = (await run('item.create', { name: 'Filter coffee 200 g', unit: 'pack', effectiveFrom: since })).itemId as string;
  for (const id of [tea, coffee]) await run('price.set', { itemId: id, amountMinor: 1000, effectiveFrom: since });
  await runCommand(app, s.manager, 'purchase.record', {
    supplierId: s.supplier,
    billNo: 'GT-OLD',
    billDate: D(60),
    receivedAt: localTime(D(60), 540, TZ).toISOString(),
    lines: [
      { itemId: tea, qtyMilli: 30_000, unitCostMinor: 800, expiresOn: '2028-01-31' },
      { itemId: coffee, qtyMilli: 5000, unitCostMinor: 900, expiresOn: '2028-01-31' },
    ],
  });
  const [cA, cB, cC] = await Promise.all(['Customer A', 'Customer B', 'Customer C'].map(async (name) => (await run('customer.create', { name })).customerId as string));
  const sell = (day: string, minutes: number, method: 'cash' | 'upi', customerId?: string) =>
    recordSale(app, s.staff, {
      shopId: s.shopId,
      soldAt: localTime(day, minutes, TZ).toISOString(),
      ...(customerId ? { customerId } : {}),
      lines: [{ itemId: tea, qtyMilli: 1000 }],
      payments: [{ method, amountMinor: 1000 }],
    });
  // Anonymous: week 1 holds three bills (₹30 in all, the second ₹20 on UPI... each bill is one pack, ₹10), week 2 one.
  await sell(D(20), 605, 'cash');
  await sell(D(20), 640, 'upi');
  await sell(D(20), 900, 'cash');
  await sell(D(13), 615, 'cash'); // D(13) is the same weekday as D(20): hour 10 now holds three bills
  // Named, all in week 3: A twice (repeat), B once (new), C once here and once before the window (repeat).
  await sell(D(5), 660, 'cash', cA);
  await sell(D(4), 660, 'cash', cA);
  await sell(D(3), 720, 'upi', cB);
  await sell(D(40), 720, 'cash', cC);
  await sell(D(2), 720, 'cash', cC);
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

const num = (c: { kind: string; num?: string } | undefined) => (c && 'num' in c ? Number(c.num) : null);
const txt = (c: { kind: string; txt?: string } | undefined) => (c && 'txt' in c ? c.txt : null);
// The owner's page (the view is null for a role it is not for).
const page = async (shop: Shop) => {
  const g = await withPage(app, shop.owner, (c) => viewGrowth(c, shop.owner));
  if (!g) throw new Error('test: the owner reads the growth page');
  return g;
};

it('peak hour of each weekday: the busiest hour, its bills and takings', async () => {
  const g = await page(s);
  expect(g.asOf).toBe(asOf);
  const wd = WEEKDAY[new Date(`${D(20)}T00:00:00Z`).getUTCDay()];
  const dayAfter = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
  const rows = g.peak.rows.map((r) => [txt(r.weekday), num(r.hour), num(r.bills), num(r.total)]);
  expect(rows.find((r) => r[0] === wd)).toEqual([wd, 10, 3, 3000]);
  // Every other weekday that sold: A on D(5), D(4), B on D(3), C on D(2); each its own hour and bills.
  expect(rows.length).toBe(new Set([D(20), D(13), D(5), D(4), D(3), D(2)].map(dayAfter)).size);
  expect(rows.find((r) => r[0] === dayAfter(D(5)))?.slice(1)).toEqual([11, 1, 1000]);
});

it('customers: counts only, new versus repeat, and the bills with no customer', async () => {
  const [row] = (await page(s)).customers.rows;
  expect(Object.keys(row ?? {}).sort()).toEqual(['anonymous_bills', 'customers', 'named_bills', 'new_customers', 'repeat_customers']);
  expect([num(row?.customers), num(row?.new_customers), num(row?.repeat_customers), num(row?.named_bills), num(row?.anonymous_bills)]).toEqual([3, 1, 2, 4, 4]);
});

it('the average basket for the four weeks, oldest first, with its direction against the week before', async () => {
  const w = (await page(s)).basket.rows.map((r) => [txt(r.week_from) ?? (r.week_from?.kind === 'date' ? r.week_from.day : null), num(r.bills), num(r.average), txt(r.trend)]);
  expect(w).toEqual([
    [addDays(asOf, -27), 0, null, 'none'],
    [addDays(asOf, -20), 3, 1000, 'none'],
    [addDays(asOf, -13), 1, 1000, 'flat'],
    [addDays(asOf, -6), 4, 1000, 'flat'],
  ]);
});

it('slow movers: stock with no sale for 30 days, never-sold included; a recent seller is not', async () => {
  const names = (await page(s)).slow.rows.map((r) => [txt(r.item), num(r.on_hand), r.last_sold_on?.kind]);
  expect(names).toEqual([['Filter coffee 200 g', 5000, 'null']]);
});

it('payment mix: cash, UPI and card as recorded, with each share in basis points', async () => {
  const m = (await page(s)).mix.rows.map((r) => [txt(r.method), num(r.payments), num(r.amount), num(r.share_bp)]);
  // Cash: A twice, C once in the window, and three anonymous bills = 6 × ₹10; UPI: one anonymous and B = 2 × ₹10.
  expect(m).toEqual([
    ['cash', 6, 6000, 7500],
    ['upi', 2, 2000, 2500],
  ]);
});

it('another shop reads its own books: nothing of this one, and no name or id in any cell', async () => {
  const g = await page(other);
  expect([g.peak.rows.length, g.slow.rows.length, g.mix.rows.length]).toEqual([0, 0, 0]);
  expect(num(g.customers.rows[0]?.customers)).toBe(0);
  const mine = await page(s);
  for (const snap of [mine.peak, mine.customers, mine.basket, mine.slow, mine.mix]) {
    expect(JSON.stringify(snap.rows)).not.toMatch(/Customer [ABC]|customer_id/);
  }
});
