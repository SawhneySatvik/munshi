// C5: the deterministic watchers over the kirana seed find every planted situation in the answer key (worked out by hand
// from the seed's plan) and nothing else; re-running raises nothing twice; they run as the jobs role with no actor,
// writing no book row; and each finding (ai.finding) pins the snapshot holding its row, moving to a newer one only when
// its row's cells changed. Under the v2-c5-omit-* sabotages the seed leaves one plant out, and the first test must fail.
// Red-proofs: test/v2/sabotage/core-reads.ts.
import { readFileSync } from 'node:fs';
import { addDays, type Cell, readRow, renderCell, resolveRef, runWatchers } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Kirana, PLANTS, type Plant, seedKirana } from '../../../../seed/kirana.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { sabotageIs } from '../../sabotage/index.ts';

type Answer = { kind: Plant; match: Record<string, string | number>; expect: Record<string, number> };
const ANSWERS = (JSON.parse(readFileSync(new URL('../../../../seed/kirana.answers.json', import.meta.url), 'utf8')) as { plants: Answer[] }).plants;
const AS_OF = '2026-10-27';
// Harness-level sabotages are asked only when one is set (the v2 case list joins this file's cases at integration).
const planted = (name: string) => process.env.MUNSHI_SABOTAGE === name && sabotageIs(name);

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let k: Kirana;
let seedMs = 0;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  const omit = PLANTS.filter((p) => planted(`v2-c5-omit-${p}`));
  const t0 = Date.now();
  k = await seedKirana(app, { asOf: AS_OF, omit });
  seedMs = Date.now() - t0;
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

// The answer key names a customer or a supplier; a snapshot cell holds only its id (no person's name enters a cell,
// BLUEPRINT §2.6), so a name is matched through the seed's own name → id maps.
const PARTY: Record<string, [string, () => Map<string, string>]> = { customer: ['customer_id', () => k.customers], supplier: ['supplier_id', () => k.suppliers] };
const matchOf = (a: Answer) =>
  Object.entries(a.match).map(([col, v]): [string, string | number] => {
    const party = PARTY[col];
    return party ? [party[0], party[1]().get(v as string) as string] : [col, v];
  });
const q = async (sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: k.tenantId }, (c) => c.query(sql, params))).rows;
const dayOffset = (day: string) => Math.round((Date.parse(day) - Date.parse(AS_OF)) / 86_400_000);

// A finding's snapshot row, as plain values: text and dates as text, numbers as numbers; days relative to as_of.
async function findingRows(runId: string) {
  const rows = await q(
    `select f.kind, f.dedupe_key, s.columns, s.rows -> f.snapshot_row as cells
       from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
      where f.first_run_id = $1 order by f.dedupe_key`,
    [runId],
  );
  return rows.map((r: { kind: string; columns: { n: string; k: string }[]; cells: { k: string; n?: string; t?: string; d?: string }[] }) => {
    const v: Record<string, string | number | null> = {};
    for (const [i, col] of r.columns.entries()) {
      const cell = r.cells[i] as { k: string; n?: string; t?: string; d?: string };
      if (cell.k === 'date') v[`${col.n}_day`] = dayOffset(cell.d as string);
      else v[col.n] = cell.n !== undefined ? Number(cell.n) : (cell.t ?? null);
    }
    return { kind: r.kind, v };
  });
}

let firstRun: Awaited<ReturnType<typeof runWatchers>> | undefined;
// The first run, made here when a test runs alone (redproof runs one named test at a time).
const watched = async () => {
  firstRun ??= await runWatchers(jobs, k.tenantId, AS_OF);
  return firstRun;
};

it('C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else', async () => {
  firstRun = await runWatchers(jobs, k.tenantId, AS_OF);
  const found = await findingRows(firstRun.runId);
  const matched = new Set<number>();
  for (const [i, a] of ANSWERS.entries()) {
    const hit = found.find((f) => f.kind === a.kind && matchOf(a).every(([col, v]) => v !== undefined && f.v[col] === v));
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
  const first = await watched();
  const before = (await q('select count(*)::int as n from ai.finding'))[0].n;
  // The next morning too: a dedupe key built from anything that drifts by the day would raise every situation again.
  for (const day of [AS_OF, addDays(AS_OF, 1)]) {
    const again = await runWatchers(jobs, k.tenantId, day);
    expect(again.rows, day).toBe(first.rows); // the same situations were seen again…
    expect(again.raised, day).toEqual([]); // …and raised nothing new
  }
  expect(first.rows).toBe(ANSWERS.length);
  expect((await q('select count(*)::int as n from ai.finding'))[0].n).toBe(before);
});

it('C5 watchers run with no actor and write no book row', async () => {
  const audit = async () => (await q('select count(*)::int as n from audit.audit_log'))[0].n;
  const before = await audit();
  const run = await runWatchers(jobs, k.tenantId, AS_OF);
  expect(await audit()).toBe(before); // a book row (or anything audited) would add an entry
  const snaps = await q('select actor_id, purpose from snap.snapshot where run_id = $1', [run.runId]);
  // One snapshot per watcher whose capability the kirana's pack has on (BLUEPRINT §7.3 × ref.pack_capability, worked by
  // hand): stock 3 (shrinkage, expiry, dead_stock), buying 1, credit 1, counter 2 (short and missing settlement, P-4),
  // staff 1, orders 3.
  expect(snaps.length).toBe(11);
  expect(snaps.filter((s) => s.actor_id !== null || s.purpose !== 'watch')).toEqual([]); // stamped by the database from the (absent) actor
  const [r] = await q('select trigger, started_by, outcome from ai.run where id = $1', [run.runId]);
  expect(r).toEqual({ trigger: 'watcher', started_by: null, outcome: 'raised' });
});

it('C5 a finding renders its numbers from its snapshot cells', async () => {
  await watched();
  const owed = await tx(app, { tenant_id: k.tenantId }, async (c) => {
    const { rows } = await c.query("select snapshot_id::text, snapshot_row from ai.finding where kind = 'overdue_credit'");
    return Promise.all(rows.map((f) => resolveRef(c, { snapshotId: f.snapshot_id, row: f.snapshot_row, col: 'overdue' })));
  });
  expect(owed).toHaveLength(3);
  const top = owed.sort((x, y) => Number((y as { num: string }).num) - Number((x as { num: string }).num))[0];
  expect(renderCell(top as Cell)).toBe('₹1,200');
});

it("C5 a finding states its desk, its impact cell and that cell's severity, and pins the snapshot holding its row", async () => {
  await watched();
  const findings = await q(
    `select f.id::text, f.kind, f.desk, f.impact_col, f.severity, f.snapshot_id::text, f.snapshot_row,
            (select count(*)::int from snap.pin p where p.tenant_id = f.tenant_id and p.holder = 'finding' and p.holder_id = f.id and p.snapshot_id = f.snapshot_id) as pinned
       from ai.finding f order by f.dedupe_key`,
  );
  expect(findings).toHaveLength(ANSWERS.length);
  const DESK: Record<Plant, string> = { shrinkage: 'stock', price_creep: 'stock', expiry: 'stock', overdue_credit: 'sales', short_settlement: 'sales' }; // udhaar is the Sales & Money desk's (§7.2)
  const IMPACT: Record<Plant, string | null> = { shrinkage: 'loss', price_creep: null, expiry: 'at_risk_value', overdue_credit: 'overdue', short_settlement: 'short' };
  // BLUEPRINT §7.4's IN ladder, in paise: critical from ₹10,000, high from ₹2,000, medium from ₹500.
  const ladder = (paise: number) => (paise >= 1_000_000 ? 'critical' : paise >= 200_000 ? 'high' : paise >= 50_000 ? 'medium' : 'low');
  for (const f of findings) {
    const col = IMPACT[f.kind as Plant];
    const impact = col ? await tx(app, { tenant_id: k.tenantId }, (c) => resolveRef(c, { snapshotId: f.snapshot_id, row: f.snapshot_row, col })) : null;
    expect([f.desk, f.impact_col, f.severity, f.pinned], f.kind).toEqual([DESK[f.kind as Plant], col, ladder(impact?.kind === 'money' ? Number(impact.num) : 0), 1]);
  }
  // The answer key's own figures, so the ladder is not only checked against itself: ₹1,375.65 at risk, ₹1,200 overdue.
  expect(findings.filter((f) => f.severity === 'medium').length).toBe(ANSWERS.filter((a) => (a.expect.at_risk_value ?? a.expect.overdue ?? 0) >= 50_000).length);
});

// Last in the file: it moves the watchers' date on.
it('C5 seen again, a finding names the new run, keeps its snapshot while its cells are the same, and moves to the new one (pinned, with a seen event) when they changed', async () => {
  const state = () => q('select id::text, kind, snapshot_id::text, snapshot_row, last_run_id::text from ai.finding order by id');
  const seen = async () => (await q("select count(*)::int as n from ai.finding_event where kind = 'seen'"))[0].n as number;
  const cellsAt = (snapshotId: string, row: number) => tx(app, { tenant_id: k.tenantId }, (c) => readRow(c, { snapshotId, row }));
  await watched();
  const before = await state();
  expect(before).toHaveLength(ANSWERS.length);
  const seenBefore = await seen();
  // The next morning (the runs above end on as_of itself): days_left and days_overdue move on, the rest of the cells hold.
  const run = await runWatchers(jobs, k.tenantId, addDays(AS_OF, 1));
  expect(run.raised).toEqual([]);
  const after = new Map((await state()).map((f) => [f.id, f]));
  const latest = new Map((await q('select query_name, id::text, rows from snap.snapshot where run_id = $1', [run.runId])).map((s) => [s.query_name.slice('watch.'.length), s]));
  let kept = 0;
  let moved = 0;
  for (const b of before) {
    const a = after.get(b.id) as (typeof before)[number];
    expect(a.last_run_id, b.kind).toBe(run.runId); // still seen, by this run
    const was = await cellsAt(b.snapshot_id, b.snapshot_row);
    const now = await cellsAt(a.snapshot_id, a.snapshot_row);
    // Its numbers are the latest run's: that run's snapshot of its kind holds a row with exactly these cells.
    const own = latest.get(b.kind) as { id: string; rows: unknown[] };
    const fresh = await Promise.all(own.rows.map((_, i) => cellsAt(own.id, i)));
    expect(fresh, b.kind).toContainEqual(now);
    if (JSON.stringify(was) === JSON.stringify(now)) {
      expect(a.snapshot_id, b.kind).toBe(b.snapshot_id);
      kept++;
    } else {
      expect(a.snapshot_id, b.kind).toBe(own.id);
      moved++;
    }
  }
  console.log(`C5 seen again the next morning: ${kept} kept their snapshot, ${moved} moved`);
  expect(kept).toBeGreaterThan(0);
  expect(moved).toBeGreaterThan(0);
  expect(await seen()).toBe(seenBefore + moved); // a seen event only where the cells changed
  const unpinned = await q(
    `select f.id from ai.finding f where not exists (select 1 from snap.pin p where p.tenant_id = f.tenant_id and p.holder = 'finding' and p.holder_id = f.id and p.snapshot_id = f.snapshot_id)`,
  );
  expect(unpinned).toEqual([]);
});
