// P-3: the Paytm demo shop, "Bansal Super Mart (sample)" (db/seed/bansal.ts). The watchers, run two hours after the seed
// (the order request's arrival is stamped by the database), find every situation in the hand-worked answer key
// (db/seed/bansal.answers.json) and nothing else; the key's read rows (the shelf gap's reorder) are returned by their
// read. A key row marked pending is checked once its read exists (P-4's watch.missing_settlement). Red-proofs:
// test/v2/sabotage/paytm-seed.ts.
import { readFileSync } from 'node:fs';
import { runWatchers, WATCHERS } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { BANSAL, type BansalSeed, seedBansal } from '../../../../seed/bansal.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';

type Value = string | number | null;
type Answer = { kind: string; read: string; pending?: string; match: Record<string, Value>; expect: Record<string, Value> };
const KEY = JSON.parse(readFileSync(new URL('../../../../seed/bansal.answers.json', import.meta.url), 'utf8')) as {
  shop: string;
  capabilities: Record<string, string>;
  plants: Answer[];
};
const AS_OF = '2026-10-27';
const live = KEY.plants.filter((a) => QUERIES.has(a.read));

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let b: BansalSeed;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  b = await seedBansal(app, { asOf: AS_OF });
  await db.sabotage();
}, 240_000);
afterAll(() => db.close());

const dayOffset = (day: string) => Math.round((Date.parse(day) - Date.parse(AS_OF)) / 86_400_000);
// A snapshot row as plain values: numbers as numbers, text as text, a date as its offset from as_of (`<col>_day`).
const plain = (columns: { n: string }[], cells: { k: string; n?: string; t?: string; d?: string }[]) => {
  const v: Record<string, Value> = {};
  for (const [i, col] of columns.entries()) {
    const cell = cells[i] as { k: string; n?: string; t?: string; d?: string };
    if (cell.k === 'date') v[`${col.n}_day`] = dayOffset(cell.d as string);
    else v[col.n] = cell.n !== undefined ? Number(cell.n) : (cell.t ?? null);
  }
  return v;
};
// The key names an item, a customer or a code; a cell holds an item's name but only a customer's id (§2.6).
const matches = (a: Answer, v: Record<string, Value>) =>
  Object.entries(a.match).every(([col, want]) => (col === 'customer' ? v.customer_id === b.customers.get(want as string) : v[col] === want)) &&
  Object.entries(a.expect).every(([col, want]) => v[col] === want);

it('PAYTMSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder', async () => {
  expect(KEY.shop).toBe(BANSAL);
  expect(b.capabilities).toEqual(KEY.capabilities);
  expect(b.items.size).toBe(120);
  expect(b.counts).toEqual({ sales: 728, upiSales: 543, purchases: 4, settlements: 28, stockCounts: 1 });
  const run = await runWatchers(jobs, b.tenantId, AS_OF, new Date(b.seededAt.getTime() + 2 * 3_600_000));
  const found = await tx(app, { tenant_id: b.tenantId }, async (c) => {
    const { rows } = await c.query(
      `select f.kind, s.columns, s.rows -> f.snapshot_row as cells
         from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
        where f.first_run_id = $1 order by f.dedupe_key`,
      [run.runId],
    );
    return rows.map((r) => ({ kind: r.kind as string, v: plain(r.columns, r.cells) }));
  });
  const watched = live.filter((a) => WATCHERS.some((w) => w.query === a.read));
  const missed = watched.filter((a) => !found.some((f) => f.kind === a.kind && matches(a, f.v)));
  for (const a of missed) console.log(`PAYTMSEED MISSED ${a.kind} ${JSON.stringify(a.match)}: ${JSON.stringify(found.filter((f) => f.kind === a.kind))}`);
  const extra = found.filter((f) => !watched.some((a) => f.kind === a.kind && matches(a, f.v)));
  for (const f of extra) console.log(`PAYTMSEED UNEXPECTED ${f.kind} ${JSON.stringify(f.v)}`);
  console.log(`PAYTMSEED ${found.length} findings for ${watched.length} keyed watcher rows; pending: ${KEY.plants.filter((a) => !QUERIES.has(a.read)).map((a) => a.kind).join(', ') || 'none'}`);
  expect(watched.length).toBeGreaterThanOrEqual(6);
  expect(missed).toEqual([]);
  expect(extra).toEqual([]);

  // The key rows that are reads, not watchers: minted by the same SQL under the tenant's RLS.
  for (const a of live.filter((x) => !watched.includes(x))) {
    const q = QUERIES.get(a.read) as { sql: string; columns: Record<string, unknown> };
    const rows = await tx(app, { tenant_id: b.tenantId }, async (c) => (await c.query(q.sql, [AS_OF])).rows);
    const hit = rows.find((r) => matches(a, Object.fromEntries(Object.keys(q.columns).map((col) => [col, typeof r[col] === 'string' && /^-?\d+$/.test(r[col]) ? Number(r[col]) : r[col]]))));
    expect(hit, `${a.read} ${JSON.stringify(a.match)}`).toBeDefined();
  }
});
