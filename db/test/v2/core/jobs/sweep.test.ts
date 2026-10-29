// SWEEP1 for the tables of files 00–09 (BLUEPRINT §4.4, §2.6, §2.8): in two tenants, each purge job removes exactly the
// planted due rows (display, watch and evidence snapshots, a moved finding's released pin and its old snapshot, old
// traces, idempotency keys, sessions 30 days past expiry, expired invites' emails; and globally old rate windows and
// finished claims), a positive count, and keeps every pinned, recent or not-yet-due row. "Kept" is every row the
// tables held before the run but the planted due ones, read from the tables themselves, so rows a fixture adds (another
// draft's pin, a site's release pin) are kept by the same assertion. Red-proofs: test/v2/sabotage/core-jobs.ts.
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, type JobRun, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Filled, fillTenant, invite, plantProbeCommand, sha, signUp } from '../../gates/fixture.ts';
import { plant } from '../../gates/lib.ts';
import { jobsUrl, mint } from './lib.ts';

type Planted = {
  f: Filled;
  dueSnapshots: string[];
  keptSnapshots: string[];
  moved: { finding: string; from: string; to: string };
  dueTrace: string;
  dueSession: string;
  keptSession: string;
  dueInvite: string;
  keptInvite: string;
};

let db: TestDb;
let pool: pg.Pool;
let planted: Planted[];

const OLD = `now() - interval '8 days'`;

async function plantTenant(slug: string): Promise<Planted> {
  const f = await fillTenant(db, await signUp(db, slug));
  const app = db.as('munshi_app');
  const jobs = db.as('munshi_jobs');
  const member = { tenant_id: f.tenant, actor_id: f.owner };
  const watcher = { tenant_id: f.tenant };
  const display = await mint(app, member, 'display', '101');
  const evidence = await mint(app, member, 'evidence', '102');
  const watch = await mint(jobs, watcher, 'watch', '103');
  const release = await mint(app, member, 'release', '104');
  const recent = await mint(app, member, 'display', '105');
  // A finding raised on one watch snapshot, then re-seen with changed cells on a newer one: its pin on the first is the
  // one the job releases, and the first, unpinned and old, is then purged.
  const from = await mint(jobs, watcher, 'watch', '106');
  const { finding, run } = await tx(jobs, watcher, async (c) => {
    const run = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [f.tenant])).rows[0]
      ?.id as string;
    const finding = (
      await c.query<{ id: string }>(
        `insert into ai.finding (tenant_id, shop_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id)
         values ($1, $2, 'stock', 'shrinkage', 'shrinkage:moved', 'low', $3, 0, '\\x00', 'amount', $4, $4) returning id`,
        [f.tenant, f.shop, from, run],
      )
    ).rows[0]?.id as string;
    return { finding, run };
  });
  const to = await mint(jobs, watcher, 'watch', '107');
  await tx(jobs, watcher, (c) => c.query('update ai.finding set snapshot_id = $1, snapshot_row = 0, last_run_id = $2 where id = $3', [to, run, finding]));
  // f.snapshot is pinned by an answer and a draft, f.watchSnapshot by a finding and the brief: old, but kept.
  await plant(db.admin, `update snap.snapshot set created_at = ${OLD} where id = any($1)`, [[display, evidence, watch, from, release, f.snapshot, f.watchSnapshot]]);

  const dueTrace = await tx(app, member, async (c) => {
    const r = await c.query<{ id: string }>(`insert into ai.trace (tenant_id, run_id, seq, kind, label) values ($1, $2, 2, 'route', 'old') returning id`, [
      f.tenant,
      f.run,
    ]);
    return r.rows[0]?.id as string;
  });
  await plant(db.admin, `update ai.trace set at = now() - interval '91 days' where id = $1`, [dueTrace]);

  await tx(app, member, (c) =>
    c.query(`insert into ops.idempotency (tenant_id, scope, key, command, request_sha256) values ($1, $2, 'old-00001', 'sale.record', $3)`, [
      f.tenant,
      `member:${f.owner}`,
      sha('old'),
    ]),
  );
  await plant(db.admin, `update ops.idempotency set created_at = ${OLD} where tenant_id = $1 and key = 'old-00001'`, [f.tenant]);

  const sessions = await tx(app, { tenant_id: f.tenant, actor_id: f.staff }, async (c) => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await c.query<{ id: string }>(
        `insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, 'demo', now() + interval '1 hour') returning id`,
        [f.tenant, f.staff],
      );
      ids.push(r.rows[0]?.id as string);
    }
    return ids;
  });
  const [dueSession, lateSession] = sessions as [string, string];
  await plant(db.admin, `update ops.login_session set created_at = now() - interval '31 days 2 hours', expires_at = now() - interval '31 days 1 hour' where id = $1`, [
    dueSession,
  ]);
  await plant(db.admin, `update ops.login_session set created_at = now() - interval '29 days 2 hours', expires_at = now() - interval '29 days 1 hour' where id = $1`, [
    lateSession,
  ]);

  const dueInvite = (await invite(db, f, f.owner, f.manager)).id;
  const keptInvite = (await invite(db, f, f.owner, f.manager)).id;
  await plant(db.admin, `update ops.member_invite set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1`, [dueInvite]);

  return {
    f,
    dueSnapshots: [display, evidence, watch, from],
    keptSnapshots: [release, recent, to, f.snapshot, f.watchSnapshot],
    moved: { finding, from, to },
    dueTrace,
    dueSession,
    keptSession: lateSession,
    dueInvite,
    keptInvite,
  };
}

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  planted = [await plantTenant('sweep-shop'), await plantTenant('sweep-other')];
  // The global rows: rate windows and finished claims, one due and one not; a lapsed claim is taken over, never swept.
  await db.admin.query(`insert into ops.rate_counter (bucket, window_start, hits) values (decode(md5('old'), 'hex'), now() - interval '2 days', 3),
                          (decode(md5('new'), 'hex'), now() - interval '1 hour', 1)`);
  await plant(
    db.admin,
    `insert into ops.job_claim (job, slot, claimed_at, finished_at, outcome) values
       ('watch', 'old-done', ${OLD}, ${OLD}, 'ok'), ('watch', 'new-done', now() - interval '1 day', now() - interval '1 day', 'ok'),
       ('watch', 'lapsed', now() - interval '1 hour', null, null)`,
  );
  pool = createJobsPool(jobsUrl(db), 4);
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

// Every row of each table the jobs touch, one key per row (the tenant first), read as the superuser. An invite's key
// carries whether it is erased, since the sweep erases it rather than deleting it.
const TABLES = {
  snapshots: `select tenant_id || ':' || id as k from snap.snapshot`,
  pins: `select tenant_id || ':' || holder || ':' || snapshot_id || ':' || holder_id as k from snap.pin`,
  traces: `select tenant_id || ':' || id as k from ai.trace`,
  idempotency: `select tenant_id || ':' || scope || ':' || key as k from ops.idempotency`,
  sessions: `select tenant_id || ':' || id as k from ops.login_session`,
  invites: `select tenant_id || ':' || id || ':' || (erased_at is not null) as k from ops.member_invite`,
  rate_counters: `select encode(bucket, 'hex') as k from ops.rate_counter`,
  job_claims: `select job || ':' || slot as k from ops.job_claim`,
};
type Table = keyof typeof TABLES;
const NAMES = Object.keys(TABLES) as Table[];

async function rows(): Promise<Record<Table, string[]>> {
  const out = {} as Record<Table, string[]>;
  for (const name of NAMES) out[name] = (await db.admin.query<{ k: string }>(TABLES[name])).rows.map((r) => r.k).sort();
  return out;
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

it("SWEEP1 each purge job removes exactly every tenant's planted due rows, a positive count, and keeps every pinned, recent or not-yet-due row", async () => {
  // What was planted, from the plants themselves: the rows each job must remove, and the not-yet-due ones it must keep.
  const due: Record<Table, string[]> = {
    snapshots: planted.flatMap((p) => p.dueSnapshots.map((id) => `${p.f.tenant}:${id}`)),
    pins: planted.map((p) => `${p.f.tenant}:finding:${p.moved.from}:${p.moved.finding}`),
    traces: planted.map((p) => `${p.f.tenant}:${p.dueTrace}`),
    idempotency: planted.map((p) => `${p.f.tenant}:member:${p.f.owner}:old-00001`),
    sessions: planted.map((p) => `${p.f.tenant}:${p.dueSession}`),
    invites: planted.map((p) => `${p.f.tenant}:${p.dueInvite}:false`),
    rate_counters: [md5('old')],
    job_claims: ['watch:old-done'],
  };
  const kept: Partial<Record<Table, string[]>> = {
    snapshots: planted.flatMap((p) => p.keptSnapshots.map((id) => `${p.f.tenant}:${id}`)),
    pins: planted.map((p) => `${p.f.tenant}:finding:${p.moved.to}:${p.moved.finding}`),
    sessions: planted.map((p) => `${p.f.tenant}:${p.keptSession}`),
    invites: planted.map((p) => `${p.f.tenant}:${p.keptInvite}:false`),
    rate_counters: [md5('new')],
    job_claims: ['watch:lapsed', 'watch:new-done'],
  };
  const before = await rows();
  for (const name of NAMES) expect(before[name], `${name} before the run`).toEqual(expect.arrayContaining([...due[name], ...(kept[name] ?? [])]));
  for (const p of planted) {
    expect(before.pins.filter((k) => k.startsWith(`${p.f.tenant}:release:`)).length, 'a release pin before the run').toBeGreaterThan(0);
  }

  const runs = await runDueJobs(pool, new Date());
  const ran = (job: string, tenantId: string | null) => runs.filter((r: JobRun) => r.job === job && r.tenantId === tenantId).map((r) => [r.outcome, r.removed]);
  for (const p of planted) {
    const tenant = p.f.tenant;
    expect(ran('snapshots', tenant), tenant).toEqual([['ok', { pins: 1, snapshots: p.dueSnapshots.length }]]);
    expect(ran('sweep', tenant), tenant).toEqual([['ok', { idempotency: 1, sessions: 1, invites: 1 }]]);
    expect(ran('retention', tenant), tenant).toEqual([['ok', { traces: 1 }]]);
  }
  expect(ran('sweep_global', null)).toEqual([['ok', { rate_counters: 1, job_claims: 1 }]]);

  // After the run each table holds exactly what it held before but the due rows (the due invite now erased); the claims
  // table also holds this run's own claims.
  const after = await rows();
  for (const name of NAMES) {
    const gone = new Set(due[name]);
    const expected = before[name].filter((k) => !gone.has(k));
    if (name === 'invites') expected.push(...due.invites.map((k) => k.replace(/:false$/, ':true')));
    if (name === 'job_claims') {
      expect(after[name], name).toEqual(expect.arrayContaining(expected));
      expect(after[name].filter((k) => gone.has(k)), name).toEqual([]);
    } else {
      expect(after[name], name).toEqual(expected.sort());
    }
  }
  for (const p of planted) {
    expect(after.pins.filter((k) => k.startsWith(`${p.f.tenant}:release:`)).length, 'a release pin after the run').toBeGreaterThan(0);
  }
});
