// The second demo shop, "Bansal Super Mart (sample)" (db/seed/bansal.ts). The watchers, run two hours after the seed
// (the order request's arrival is stamped by the database), find every situation in the hand-worked answer key
// (db/seed/bansal.answers.json) and nothing else; the key's read rows (the shelf gap's reorder) are returned by their
// read. A key row marked pending is checked once its read exists. Then the committed sample statement, which is the
// seed's own (bansalStatement), previews against the books and, imported, records only the day the books lack.
// Red-proofs: test/v2/sabotage/seed-settlements.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { previewStatement, runCommand, runWatchers, WATCHERS, withPage } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { BANSAL, type BansalSeed, bansalStatement, seedBansal } from '../../../../seed/bansal.ts';
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

it('BANSALSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder', async () => {
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
  for (const a of missed) console.log(`BANSALSEED MISSED ${a.kind} ${JSON.stringify(a.match)}: ${JSON.stringify(found.filter((f) => f.kind === a.kind))}`);
  const extra = found.filter((f) => !watched.some((a) => f.kind === a.kind && matches(a, f.v)));
  for (const f of extra) console.log(`BANSALSEED UNEXPECTED ${f.kind} ${JSON.stringify(f.v)}`);
  console.log(`BANSALSEED ${found.length} findings for ${watched.length} keyed watcher rows; pending: ${KEY.plants.filter((a) => !QUERIES.has(a.read)).map((a) => a.kind).join(', ') || 'none'}`);
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

it('BANSALSETTLE the sample statement is the seed\'s, and importing it records only the missing day, which clears its finding', async () => {
  const file = readFileSync(new URL('../../../../seed/merchants/bansal/settlement-2026-10-27.csv', import.meta.url));
  expect(file.toString('utf8')).toBe(bansalStatement(AS_OF));
  const statement = { sha256: createHash('sha256').update(file).digest('hex'), rows: file.toString('utf8').split('\n').map((l) => l.split(',')) };
  await runWatchers(jobs, b.tenantId, AS_OF);
  const p = await withPage(app, b.owner, (c) => previewStatement(c, statement));
  expect(p.errors).toEqual([]);
  const verdicts = p.lines.map((l) => `${dayOffset(l.txnDate)} ${l.status} ${l.verdict}`);
  expect(verdicts.filter((v) => !v.endsWith('SETTLED already_recorded'))).toEqual(['-3 SETTLED matched', '-1 ON_HOLD matched']);
  expect(verdicts).toHaveLength(30);
  const count = async () => (await tx(app, { tenant_id: b.tenantId }, (c) => c.query("select business_date::text as day, amount_minor::int as amount from books.settlement where utr is not null"))).rows;
  await runCommand(app, b.manager, 'settlement.import', statement);
  expect((await count()).map((r) => [dayOffset(r.day), r.amount])).toEqual([[-3, 213800]]);
  await runCommand(app, b.manager, 'settlement.import', statement);
  expect(await count()).toHaveLength(1);
  const run = await runWatchers(jobs, b.tenantId, AS_OF);
  const open = await tx(app, { tenant_id: b.tenantId }, (c) => c.query("select status from ai.finding where kind = 'missing_settlement'"));
  expect(open.rows.map((r) => r.status)).toEqual(['resolved']);
  expect(run.resolved).toHaveLength(1);
});
