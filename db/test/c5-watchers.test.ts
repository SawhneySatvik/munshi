// C5: the deterministic watchers over the kirana seed find every planted situation in the answer key (worked out by hand
// from the seed's plan) and nothing else; re-running raises nothing twice; and they run with no actor, writing no book
// row. Under the c5-omit-* sabotages the seed leaves one plant out, and the first test must fail.
import { readFileSync } from 'node:fs';
import { addDays, type Cell, renderCell, runWatchers } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Kirana, PLANTS, type Plant, seedKirana } from '../seed/kirana.ts';
import { openTestDb, type TestDb, tx } from './db.ts';
import { sabotageIs } from './sabotage.ts';

type Answer = { kind: Plant; match: Record<string, string | number>; expect: Record<string, number> };
const ANSWERS = (JSON.parse(readFileSync(new URL('../seed/kirana.answers.json', import.meta.url), 'utf8')) as { plants: Answer[] }).plants;
const AS_OF = '2026-10-27';

let db: TestDb;
let k: Kirana;
let seedMs = 0;
beforeAll(async () => {
  db = await openTestDb();
  const omit = PLANTS.filter((p) => sabotageIs(`c5-omit-${p}`));
  const t0 = Date.now();
  k = await seedKirana(db.app, { asOf: AS_OF, omit });
  seedMs = Date.now() - t0;
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(db.app, { tenant: k.tenantId }, (c) => c.query(sql, params))).rows;
const dayOffset = (day: string) => Math.round((Date.parse(day) - Date.parse(AS_OF)) / 86_400_000);

// A finding's snapshot row, as plain values: text and dates as text, numbers as numbers; days relative to as_of.
async function findingRows(runId: string) {
  const rows = await q(
    `select f.kind, f.dedupe_key, c.col, c.kind as cell_kind, c.num::text as num, c.txt, c.day::text as day
       from ops.finding f join snap.snapshot_cell c on c.snapshot_id = f.snapshot_id and c.row_no = f.snapshot_row
      where f.run_id = $1 order by f.dedupe_key, c.col`,
    [runId],
  );
  const byKey = new Map<string, { kind: string; v: Record<string, string | number> }>();
  for (const r of rows) {
    const f: { kind: string; v: Record<string, string | number> } = byKey.get(r.dedupe_key) ?? { kind: r.kind, v: {} };
    if (r.cell_kind === 'date') f.v[`${r.col}_day`] = dayOffset(r.day);
    else f.v[r.col] = r.num !== null ? Number(r.num) : r.txt;
    byKey.set(r.dedupe_key, f);
  }
  return [...byKey.values()];
}

let firstRun: Awaited<ReturnType<typeof runWatchers>>;

it('C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else', async () => {
  firstRun = await runWatchers(db.app, k.tenantId, AS_OF);
  const found = await findingRows(firstRun.runId);
  const matched = new Set<number>();
  for (const [i, a] of ANSWERS.entries()) {
    const hit = found.find((f) => f.kind === a.kind && Object.entries(a.match).every(([col, v]) => f.v[col] === v));
    if (hit && Object.entries(a.expect).every(([col, v]) => hit.v[col] === v)) matched.add(i);
    else console.log(`C5 MISSED ${a.kind} ${JSON.stringify(a.match)}: ${hit ? `found ${JSON.stringify(hit.v)}` : 'no finding'}`);
  }
  const kinds = new Set(ANSWERS.map((a) => a.kind));
  const kindsFound = [...kinds].filter((kind) => ANSWERS.every((a, i) => a.kind !== kind || matched.has(i)));
  const unexpected = found.length - matched.size;
  console.log(
    `C5 seeded in ${seedMs} ms (${k.counts.sales} sales); found ${kindsFound.length} of ${kinds.size} planted kinds, ` +
      `${matched.size} of ${ANSWERS.length} situations, ${unexpected} unexpected`,
  );
  expect(kinds.size).toBe(5);
  expect(ANSWERS.length).toBe(8);
  expect(kindsFound.length).toBe(kinds.size);
  expect(matched.size).toBe(ANSWERS.length);
  expect(found.length).toBe(ANSWERS.length); // nothing beyond the answer key: the controls stay quiet
});

it('C5 re-running the watchers raises nothing twice, the same day or the next', async () => {
  const before = (await q('select count(*)::int as n from ops.finding'))[0].n;
  // The next morning too: a dedupe key built from anything that drifts by the day would raise every situation again.
  for (const day of [AS_OF, addDays(AS_OF, 1)]) {
    const again = await runWatchers(db.app, k.tenantId, day);
    expect(again.rows, day).toBe(firstRun.rows); // the same situations were seen again…
    expect(again.raised, day).toEqual([]); // …and raised nothing new
  }
  expect(firstRun.rows).toBe(ANSWERS.length);
  expect((await q('select count(*)::int as n from ops.finding'))[0].n).toBe(before);
});

it('C5 watchers run with no actor and write no book row', async () => {
  const audit = async () => (await q('select count(*)::int as n from audit.audit_log'))[0].n;
  const before = await audit();
  const run = await runWatchers(db.app, k.tenantId, AS_OF);
  expect(await audit()).toBe(before); // a book row (or anything audited) would add an entry
  const snaps = await q('select actor_id from snap.snapshot where run_id = $1', [run.runId]);
  expect(snaps.length).toBe(5);
  expect(snaps.filter((s) => s.actor_id !== null)).toEqual([]); // stamped by the database from the (absent) actor
  const [r] = await q('select trigger, started_by from ops.run where id = $1', [run.runId]);
  expect(r).toEqual({ trigger: 'watcher', started_by: null });
});

it('C5 a finding renders its numbers from its snapshot cells', async () => {
  const [f] = await q(
    `select c.kind, c.num::text as num, c.currency, c.unit, c.txt, c.day::text as day, c.at from ops.finding f
       join snap.snapshot_cell c on c.snapshot_id = f.snapshot_id and c.row_no = f.snapshot_row and c.col = 'overdue'
      where f.kind = 'overdue_credit' order by c.num::bigint desc limit 1`,
  );
  expect(renderCell(f as Cell)).toBe('₹1,200');
});
