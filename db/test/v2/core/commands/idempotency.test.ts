// IDEM1, core's half: a direct command carrying an idempotency key runs once. A replay of the same request returns the
// first run's ids and writes nothing, a double tap (two at once) records one sale, and a different request under a used
// key is a conflict. The key is the member's own: another member's same key is a fresh one.
import { CoreError, runCommand } from '@munshi/core';
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
  s = await smallShop(app, 'IDEM1');
  await db.sabotage();
});
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, params))).rows;
const sales = async () => (await q('select count(*)::int as n from books.sale'))[0].n as number;
const sale = (packs: number) => ({ shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: packs * 1000 }], payments: [{ method: 'cash', amountMinor: packs * 1000 }] });

it('IDEM1 a replayed key returns the stored ids and writes nothing; a different request under the same key is a conflict', async () => {
  const before = await sales();
  const first = await runCommand(app, s.staff, 'sale.record', sale(2), 'counter-tap-0001');
  expect(first).toEqual({ saleId: expect.any(String) });
  expect(await runCommand(app, s.staff, 'sale.record', sale(2), 'counter-tap-0001')).toEqual(first);
  expect(await sales()).toBe(before + 1);

  // A double tap: both wait on one key, one sale is recorded, and both answers name it.
  const [a, b] = await Promise.all([1, 2].map(() => runCommand(app, s.staff, 'sale.record', sale(1), 'counter-tap-0002')));
  expect(a).toEqual(b);
  expect(await sales()).toBe(before + 2);

  const other = await runCommand(app, s.staff, 'sale.record', sale(3), 'counter-tap-0001').catch((e: unknown) => e);
  expect(other).toBeInstanceOf(CoreError);
  expect(other).toMatchObject({ code: 'conflict', fields: ['key'] });
  expect(await sales()).toBe(before + 2);

  // Another member's key of the same text is their own.
  expect(await runCommand(app, s.manager, 'sale.record', sale(2), 'counter-tap-0001')).not.toEqual(first);
  expect(await sales()).toBe(before + 3);
  const [stored] = await q(`select result from ops.idempotency where scope = $1 and key = 'counter-tap-0001'`, [`member:${s.staff.memberId}`]);
  expect(stored).toEqual({ result: first });
  console.log(`IDEM1 six requests on two keys of one member and one of another: ${(await sales()) - before} sales recorded`);
});
