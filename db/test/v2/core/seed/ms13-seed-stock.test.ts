// MS-13: the kirana seed never takes an item below zero on hand — checked after every single stock move, in time order
// (stricter than the end of each seeded day), read back from books.stock_move rather than from the seed's own tally.
// Red-proof: MS13_REDPROOF=1 plants one oversold move (superuser, triggers off) after seeding, and the first test must fail.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Kirana, seedKirana } from '../../../../seed/kirana.ts';
import { openTestDb, type TestDb } from '../../db.ts';

let db: TestDb;
let k: Kirana;
beforeAll(async () => {
  db = await openTestDb();
  k = await seedKirana(db.as('munshi_app'), { asOf: '2026-10-27' });
  if (process.env.MS13_REDPROOF) {
    const c = await db.admin.connect();
    await c.query('set session_replication_role = replica');
    await c.query(
      `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, at, created_by, created_txid, created_at)
       select tenant_id, id, -999000, 'waste', now(), (select id from ops.member where tenant_id = $1 limit 1), txid_current(), now()
         from books.item where tenant_id = $1 limit 1`,
      [k.tenantId],
    );
    c.release(true);
  }
}, 300_000);
afterAll(() => db.close());

it('MS-13 no item is ever below zero on hand, after any move of the 90 seeded days', async () => {
  const { rows } = await db.admin.query<{ item: string; low: string; moves: string }>(
    `select r.name as item, min(run)::text as low, count(*)::text as moves
       from (select item_id, sum(qty_milli) over (partition by item_id order by at, created_at, id) as run
               from books.stock_move where tenant_id = $1) m
       join books.item_revision r on r.tenant_id = $1 and r.item_id = m.item_id
      group by r.name having min(run) < 0 order by r.name`,
    [k.tenantId],
  );
  expect(rows).toEqual([]);
  const { rows: n } = await db.admin.query('select count(distinct item_id)::int as items, count(*)::int as moves from books.stock_move where tenant_id = $1', [k.tenantId]);
  expect(n[0].items).toBe(60); // a positive expectation: the check looked at all 60 SKUs
  expect(n[0].moves).toBeGreaterThan(2000);
}, 60_000);
