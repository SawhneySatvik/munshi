// ITEM1: item.create makes a good by default and a service when asked (no other core path makes a service). A
// service is sold by the session, its revision carries its duration (b_revision_kind), and the kind in the item's key
// keeps it out of stock moves and purchases; a good has a stock unit and no duration. Which kinds a shop's capabilities
// admit is core's check, never the database's, and is not built here.
import { CoreError, recordSale, runCommand, type Session, switchCapability } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'ITEM1');
  await switchCapability(app, s.owner, 'bookings', true); // a service needs a capability that admits services
  await db.sabotage();
});
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, params))).rows;
const run = async (who: Session, name: string, input: unknown) => (await runCommand(app, who, name, input)) as Record<string, string>;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const items = async () => Number((await q('select count(*) as n from books.item'))[0].n);

it('item.create makes a good by default and a service when asked: a service is sold by the session with its duration, and never moves stock or is bought', async () => {
  const tea = (await run(s.manager, 'item.create', { name: 'Tea 250 g', unit: 'pack' })).itemId as string;
  const cut = (await run(s.owner, 'item.create', { kind: 'service', name: 'Haircut (synthetic)', durationMin: 30, category: 'hair' })).itemId as string;
  const shape = async (itemId: string) =>
    (await q('select i.kind, i.unit, r.duration_min, r.category from books.item i join books.item_revision r on r.item_id = i.id where i.id = $1', [itemId]))[0];
  expect(await shape(tea)).toEqual({ kind: 'good', unit: 'pack', duration_min: null, category: null });
  expect(await shape(cut)).toEqual({ kind: 'service', unit: 'session', duration_min: 30, category: 'hair' });

  // Sold at the counter, one session, with no stock move.
  await run(s.owner, 'price.set', { itemId: cut, amountMinor: 25_000, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
  const sale = (await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: cut, qtyMilli: 1_000 }], payments: [{ method: 'cash', amountMinor: 25_000 }] })) as {
    saleId: string;
  };
  expect(await q('select item_kind, gross_minor::int as gross from books.sale_line where sale_id = $1', [sale.saleId])).toEqual([{ item_kind: 'service', gross: 25_000 }]);
  expect(await q('select id from books.stock_move where item_id = $1', [cut])).toEqual([]);

  // The item key carries the kind: a service is never written off, counted into stock or bought.
  for (const [command, input] of [
    ['stock.waste', { itemId: cut, qtyMilli: 1_000 }],
    ['stock.count', { itemId: cut, countedQtyMilli: 1_000 }],
    ['purchase.record', { supplierId: s.supplier, billNo: 'SVC-1', billDate: '2026-10-28', lines: [{ itemId: cut, qtyMilli: 1_000, unitCostMinor: 100 }] }],
  ] as const) {
    expect([command, await fails(run(s.owner, command, input))]).toEqual([command, expect.objectContaining({ code: 'invalid', sqlstate: '23503' })]);
  }
  expect(await q('select id from books.stock_move where item_id = $1', [cut])).toEqual([]);
});

it('an item.create input is a good with a unit or a service with a duration, and nothing else', async () => {
  const before = await items();
  const bad: [unknown, string[]][] = [
    [{ kind: 'service', name: 'Facial' }, ['durationMin']],
    [{ kind: 'service', name: 'Facial', durationMin: 4 }, ['durationMin']],
    [{ kind: 'service', name: 'Facial', durationMin: 45, unit: 'piece' }, ['(input)']],
    [{ kind: 'good', name: 'Soap', unit: 'piece', durationMin: 45 }, ['(input)']],
    [{ kind: 'package', name: 'Ten sessions' }, ['kind']],
    [{ name: 'Soap', unit: 'session' }, ['unit']],
  ];
  for (const [input, fields] of bad) {
    const e = await fails(run(s.owner, 'item.create', input));
    expect(e).toBeInstanceOf(CoreError);
    expect([input, e]).toEqual([input, expect.objectContaining({ code: 'invalid', fields })]);
  }
  expect(await items()).toBe(before);
});
