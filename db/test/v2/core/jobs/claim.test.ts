// The jobs runner's claim: a slot's work runs once however many triggers fire at once; a claim left
// unfinished for 5 minutes is taken over and a younger one is not; a run whose budget is spent takes no new work.
// Red-proofs: test/v2/sabotage/core-jobs.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { claim, createJobsPool, JOBS, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { plant } from '../../gates/lib.ts';
import { dayAfter, jobsUrl, mint } from './lib.ts';

let db: TestDb;
let t: Tenant;
let u: Tenant;
let pool: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  t = await signUp(db, 'claim-shop');
  u = await signUp(db, 'claim-other');
  // Room for every trigger at once: db.as() pools hold 4 connections, which would queue the triggers.
  pool = createJobsPool(jobsUrl(db), 12);
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

const app = () => db.as('munshi_app');

it('each job runs once per slot under 10 concurrent triggers, and the claim admits one of 10 concurrent callers', async () => {
  const due: string[] = [];
  for (const x of [t, u]) due.push(await mint(app(), { tenant_id: x.tenant, actor_id: x.owner }, 'display', '100'));
  await plant(db.admin, `update snap.snapshot set created_at = now() - interval '8 days' where id = any($1)`, [due]);
  const now = new Date();
  const runs = (await Promise.all(Array.from({ length: 10 }, () => runDueJobs(pool, now)))).flat();
  const claims = await db.admin.query<{ slot: string; outcome: string }>('select slot, outcome from ops.job_claim order by slot');
  const perTenant = JOBS.filter((j) => j.perTenant).length;
  expect(claims.rows).toHaveLength(perTenant * 2 + (JOBS.length - perTenant));
  expect(claims.rows.length).toBeGreaterThan(0);
  // A slot that ran twice would appear twice here.
  expect(runs.map((r) => r.slot).sort()).toEqual(claims.rows.map((r) => r.slot));
  expect(claims.rows.filter((r) => r.outcome !== 'ok')).toEqual([]);
  expect(runs.reduce((n, r) => n + (r.removed.snapshots ?? 0), 0)).toBe(due.length);

  const takers = await Promise.all(Array.from({ length: 10 }, () => claim(pool, 'probe', 'probe:once')));
  expect(takers.filter(Boolean)).toHaveLength(1);
});

it('a claim left unfinished for 5 minutes is taken over and its job runs; a younger one is left to its run', async () => {
  const now = dayAfter(2);
  const day = now.toISOString().slice(0, 10);
  const [lapsed, live] = [`retention:${t.tenant}:${day}`, `retention:${u.tenant}:${day}`];
  await plant(
    db.admin,
    `insert into ops.job_claim (job, slot, claimed_at) values ('retention', $1, now() - interval '6 minutes'), ('retention', $2, now() - interval '4 minutes')`,
    [lapsed, live],
  );
  const runs = await runDueJobs(pool, now, ['retention']);
  expect(runs.map((r) => [r.slot, r.outcome])).toEqual([[lapsed, 'ok']]);
  const { rows } = await db.admin.query<{ slot: string; outcome: string | null }>(
    `select slot, outcome from ops.job_claim where slot = any($1) order by slot = $2 desc`,
    [[lapsed, live], lapsed],
  );
  expect(rows).toEqual([
    { slot: lapsed, outcome: 'ok' },
    { slot: live, outcome: null },
  ]);
});

it('a run whose budget is spent claims nothing', async () => {
  const now = dayAfter(3);
  expect(await runDueJobs(pool, now, undefined, 0)).toEqual([]);
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ops.job_claim where slot like $1', [`%${now.toISOString().slice(0, 10)}%`]);
  expect(rows[0]?.n).toBe(0);
  // The same run with time left claims every slot of that day.
  expect((await runDueJobs(pool, now)).length).toBeGreaterThan(0);
});
