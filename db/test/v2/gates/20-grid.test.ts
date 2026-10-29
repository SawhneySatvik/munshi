// 20_grid.sql, the database parts of GR3 and GR4: a batch is an active member's own and pins the snapshot it was opened
// on; its changes come only in its transaction, by the member who opened it, at most 500, each naming exactly its
// kind's fields. GR1 (stale on a changed base) and GR2 (read-only columns) are core's. Red-proofs: test/v2/sabotage/grid.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  f = await fillTenant(db, await signUp(db, 'grid-shop'));
  await db.sabotage();
});
afterAll(() => db?.close());

const one = async (c: pg.ClientBase, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const open = (c: pg.ClientBase, source = 'typed', document: string | null = null) =>
  one(c, `insert into ops.grid_batch (tenant_id, base_snapshot_id, source, document_id, created_by, created_txid) values ($1, $2, $3, $4, $5, 0) returning id`, [
    f.tenant,
    f.snapshot,
    source,
    document,
    f.staff,
  ]);
const change = (c: pg.ClientBase, batch: string, line: number, cols = `'price', $4, null, 100, 'INR', null`) =>
  c.query(`insert into ops.grid_change (tenant_id, batch_id, line_no, kind, item_id, add_key, amount_minor, currency, new_item) values ($1, $2, $3, ${cols})`, [
    f.tenant,
    batch,
    line,
    ...(cols.includes('$4') ? [f.good] : []),
  ]);

it('GR3 a batch is an active member’s own, stamped whatever was sent, its file an import, and pins the snapshot it was opened on; its changes come only in its transaction, by that member', async () => {
  const batch = await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => open(c));
  const { rows } = await db.admin.query(
    `select b.created_by, b.created_txid > 0 as stamped, exists (select 1 from snap.pin p where p.holder = 'grid' and p.holder_id = b.id and p.snapshot_id = $2) as pinned
       from ops.grid_batch b where b.id = $1`,
    [batch, f.snapshot],
  );
  expect(rows).toEqual([{ created_by: f.owner, stamped: true, pinned: true }]);
  expect((await refused(tx(app, { tenant_id: f.tenant }, (c) => open(c)))).code, 'no actor').toBe('MS007');
  const photo = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => open(c, 'file', f.document)));
  expect([photo.code, photo.message]).toEqual(['MS007', "grid refused: a batch's file is an import document"]);
  const late = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => change(c, batch, 1)));
  expect([late.code, late.message]).toEqual(['MS006', "grid refused: a change is added in its batch's transaction, by the member who opened it"]);
  const otherMember = await refused(
    tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
      const b = await open(c);
      await c.query(`select set_config('munshi.actor_id', $1, true)`, [f.manager]);
      await change(c, b, 1);
    }),
  );
  expect(otherMember.code).toBe('MS006');
});

it('GR4 a batch takes at most 500 changes, one per line, each naming exactly its kind’s fields', async () => {
  const batch = (fn: (c: pg.PoolClient, b: string) => Promise<unknown>) =>
    tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
      const b = await open(c);
      await fn(c, b);
    });
  await batch(async (c, b) => {
    for (let n = 1; n <= 500; n++) await change(c, b, n);
  });
  expect((await refused(batch((c, b) => change(c, b, 501)))).code, 'line 501').toBe('23514');
  expect((await refused(batch(async (c, b) => {
    await change(c, b, 1);
    await change(c, b, 1);
  }))).code, 'a line twice').toBe('23505');
  for (const [what, cols] of [
    ['a price naming no item', `'price', null, null, 100, 'INR', null`],
    ['a new item with no key', `'new_item', null, null, 100, 'INR', '{"name": "X"}'`],
    ['a new item with no fields', `'new_item', null, 'x', 100, 'INR', null`],
  ] as const) {
    expect((await refused(batch((c, b) => change(c, b, 1, cols)))).code, what).toBe('23514');
  }
});
