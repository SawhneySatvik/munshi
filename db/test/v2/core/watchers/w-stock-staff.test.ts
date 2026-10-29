// W-STK and W-STF: dead stock (the `stock` capability) and an unrecovered staff advance (`staff`), each against a key
// worked by hand, with its boundary controls. Dead stock: a jar bought on day −45 and never sold, and soap last sold on
// day −45, are dead; tea last sold on day −44, jam first bought on day −44, and an item sold out are not. Advances: ₹600
// given on day −40 plus ₹200 on day −5 to one staff member (₹800 out, oldest day −40) is flagged; ₹500 given exactly
// 30 days ago, and ₹300 given on day −50 then reversed, are not. Days are business days in the shop's zone; advances
// are planted under advance.give and advance.reverse (plant.ts). With each capability off, its watcher finds nothing.
// Red-proofs: test/v2/sabotage/core-ai.ts.
import { businessDate, localTime, recordPurchase, recordSale, runCommand, runWatchers } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';
import { asCommand, findings, one, plusDays, runQueries, setCapability, TENANT } from './plant.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let today: string;
const items = new Map<string, string>();
const staff = new Map<string, string>();

const at = (day: number, minute: number) => localTime(plusDays(today, day), minute, 'Asia/Kolkata').toISOString();
const run = (name: string, input: unknown) => runCommand(app, s.owner, name, input) as Promise<Record<string, string>>;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Dusty');
  today = businessDate(new Date(), 'Asia/Kolkata');
  // name, bought on (day), units, unit cost; then sales (day, units)
  const plan: [string, number, number, number, [number, number][]][] = [
    ['Dusty jar', -45, 5, 4000, []],
    ['Old soap', -80, 10, 2000, [[-45, 2]]],
    ['Fresh tea', -80, 10, 3000, [[-44, 1]]],
    ['New jam', -44, 6, 5000, []],
    ['Sold out', -70, 3, 1500, [[-60, 3]]],
  ];
  for (const [name, bought, units, cost, sales] of plan) {
    const itemId = (await run('item.create', { name, unit: 'pack', effectiveFrom: at(-100, 0) })).itemId as string;
    items.set(name, itemId);
    await run('price.set', { itemId, amountMinor: cost * 2, effectiveFrom: at(-100, 0) });
    await recordPurchase(app, s.manager, {
      supplierId: s.supplier,
      billNo: `D-${items.size}`,
      billDate: plusDays(today, bought),
      receivedAt: at(bought, 540),
      lines: [{ itemId, qtyMilli: units * 1000, unitCostMinor: cost, expiresOn: plusDays(today, 400) }],
    });
    for (const [day, n] of sales) {
      await recordSale(app, s.staff, { shopId: s.shopId, soldAt: at(day, 720), lines: [{ itemId, qtyMilli: n * 1000 }], payments: [{ method: 'cash', amountMinor: n * cost * 2 }] });
    }
  }
  for (const name of ['Asha', 'Bilal', 'Chitra']) staff.set(name, (await run('staff.create', { name, shopId: s.shopId, dailyWageMinor: 60_000 })).staffId as string);
  const give = (who: string, amount: number, day: number) =>
    asCommand(app, s.owner, 'advance.give', (c) =>
      one<{ id: string }>(c, `insert into books.advance (tenant_id, staff_id, amount_minor, currency, given_on) values (${TENANT}, $1, $2, 'INR', $3) returning id`, [
        staff.get(who),
        amount,
        plusDays(today, day),
      ]),
    );
  await give('Asha', 60_000, -40);
  await give('Asha', 20_000, -5);
  await give('Bilal', 50_000, -30);
  const reversed = await give('Chitra', 30_000, -50);
  await asCommand(app, s.owner, 'advance.reverse', (c) =>
    c.query(`insert into books.advance (tenant_id, staff_id, amount_minor, currency, given_on, reverses_id, reason) values (${TENANT}, $1, -30000, 'INR', $2, $3, 'entered_in_error')`, [
      staff.get('Chitra'),
      plusDays(today, -50),
      reversed.id,
    ]),
  );
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

// First in the file (and alone in a fresh database): with both capabilities off, a run reads neither kind.
it('W-STK with stock and staff off, a run reads neither watcher and the shop gets none of their findings', async () => {
  await setCapability(app, s.owner, 'stock', false);
  await setCapability(app, s.owner, 'staff', false);
  const off = await runWatchers(jobs, s.owner.tenantId, today);
  expect(await findings(jobs, s.owner.tenantId, "kind in ('dead_stock', 'unrecovered_advance')")).toEqual([]);
  const read = await runQueries(jobs, s.owner.tenantId, off.runId);
  expect(read).toContain('watch.order_late'); // the run itself ran
  expect(read.filter((q) => q === 'watch.dead_stock' || q === 'watch.unrecovered_advance')).toEqual([]);
  await setCapability(app, s.owner, 'stock', true);
  await setCapability(app, s.owner, 'staff', true);
});

it('W-STK dead stock: the jar never sold since day −45 and the soap last sold on day −45, nothing else', async () => {
  await runWatchers(jobs, s.owner.tenantId, today);
  const found = await findings(jobs, s.owner.tenantId, "kind = 'dead_stock'");
  expect(found.map((f) => [f.key, f.status, f.severity, f.shop])).toEqual(
    [
      [`dead_stock:${items.get('Dusty jar')}`, 'open', 'low', null],
      [`dead_stock:${items.get('Old soap')}`, 'open', 'low', null],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const byItem = new Map(found.map((f) => [f.v.item, f.v]));
  expect(byItem.get('Dusty jar')).toEqual({ item_id: items.get('Dusty jar'), parent_item_id: null, item: 'Dusty jar', on_hand: 5000, last_sold_on: null, unit_cost: 4000, stock_value: 20_000 });
  expect(byItem.get('Old soap')).toEqual({ item_id: items.get('Old soap'), parent_item_id: null, item: 'Old soap', on_hand: 8000, last_sold_on: plusDays(today, -45), unit_cost: 2000, stock_value: 16_000 });
});

it('W-STF an advance still out after 30 days: ₹800 owed by one staff member since day −40, nothing else', async () => {
  await runWatchers(jobs, s.owner.tenantId, today);
  const found = await findings(jobs, s.owner.tenantId, "kind = 'unrecovered_advance'");
  expect(found).toEqual([
    {
      kind: 'unrecovered_advance',
      key: `unrecovered_advance:${staff.get('Asha')}`,
      status: 'open',
      shop: null,
      severity: 'medium',
      v: { staff_id: staff.get('Asha'), outstanding: 80_000, oldest_given_on: plusDays(today, -40), days_outstanding: 40 },
    },
  ]);
});

it('W-STK the shop has no finding but the planted ones', async () => {
  const kinds = (await findings(jobs, s.owner.tenantId)).map((f) => f.kind).sort();
  expect(kinds).toEqual(['dead_stock', 'dead_stock', 'unrecovered_advance']);
});
