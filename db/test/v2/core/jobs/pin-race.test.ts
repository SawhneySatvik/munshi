// J2 at the runner (BLUEPRINT §2.8, review B10): a pin inserted while the snapshot purge runs survives with its
// snapshot, and the purge still removes the rest of its tenant's due snapshots. No role holds UPDATE on snap.snapshot,
// so the purge cannot skip locked rows: the pin's foreign key fails its delete with 23503, which it treats as "skip"
// (the migrator's ruling, 06_snap.sql). Red-proofs: test/v2/sabotage/core-jobs.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { plantProbeCommand, signUp, type Tenant } from '../../gates/fixture.ts';
import { plant } from '../../gates/lib.ts';
import { jobsUrl, jobsWaitingOnLock, mint } from './lib.ts';

let db: TestDb;
let t: Tenant;
let pool: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  t = await signUp(db, 'race-shop');
  pool = createJobsPool(jobsUrl(db), 2);
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

it('J2 a pin inserted while the purge runs survives with its snapshot, and the purge still removes the rest of its due snapshots', async () => {
  const member = { tenant_id: t.tenant, actor_id: t.owner };
  const app = db.as('munshi_app');
  const [cited, doomed] = [await mint(app, member, 'display', '100'), await mint(app, member, 'display', '200')];
  await plant(db.admin, `update snap.snapshot set created_at = now() - interval '8 days' where id = any($1)`, [[cited, doomed]]);

  // A draft citing `cited`, left open: its pin holds a key-share lock on the snapshot until it commits.
  const pinner = await app.connect();
  let run: Promise<unknown> | undefined;
  try {
    await pinner.query('begin');
    await pinner.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [member.tenant_id, member.actor_id]);
    await pinner.query(
      `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', 0)`,
      [t.tenant, JSON.stringify([{ snapshotId: cited, row: 0, col: 'amount' }])],
    );
    run = runDueJobs(pool, new Date(), ['snapshots']);
    await jobsWaitingOnLock(db); // the purge reached `cited` while the pin was still open
    await pinner.query('commit');
  } catch (err) {
    await pinner.query('rollback');
    throw err;
  } finally {
    pinner.release();
  }
  expect(await run).toEqual([{ job: 'snapshots', slot: expect.any(String), tenantId: t.tenant, outcome: 'ok', removed: { pins: 0, snapshots: 1 } }]);
  const kept = await db.admin.query<{ id: string }>('select id from snap.snapshot where id = any($1)', [[cited, doomed]]);
  expect(kept.rows).toEqual([{ id: cited }]);
  const pins = await db.admin.query<{ holder: string }>('select holder from snap.pin where snapshot_id = $1', [cited]);
  expect(pins.rows).toEqual([{ holder: 'draft' }]);
  const orphans = await db.admin.query<{ n: number }>(
    'select count(*)::int as n from snap.pin p where not exists (select 1 from snap.snapshot s where s.tenant_id = p.tenant_id and s.id = p.snapshot_id)',
  );
  expect(orphans.rows[0]?.n).toBe(0);
});
