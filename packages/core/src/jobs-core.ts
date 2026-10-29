// The core's background jobs (BLUEPRINT §4.4): the purges of files 00–09, run by jobs.ts as munshi_jobs with no actor.
// Each statement deletes or erases only what that role's restrictive policy or erasure trigger admits, and where the
// role can read the table it restates the rule in its own WHERE, so a loosened policy never widens a job. Later areas
// add their jobs in their own files (jobs-holds.ts, jobs-orders.ts, jobs-messaging.ts) with registerJob, and jobs.ts
// spreads them in; this file imports nothing of core's, so those files can import it with no cycle.
import type pg from 'pg';

// Rows removed or erased, per kind: for the caller's report and the tests, never shown.
export type Removed = Record<string, number>;

// perTenant: run once per tenant in the directory, inside that tenant's own context (forced RLS would otherwise make a
// purge delete nothing). `every` is the slot's length: the job runs at most once per minute, hour or day.
export type Job = { name: string; every: 'minute' | 'hour' | 'day'; perTenant: boolean; run: (c: pg.PoolClient) => Promise<Removed> };

export function registerJob(name: string, job: Omit<Job, 'name'>): Job {
  // ops.job_claim.job's own check: a name it would refuse fails here, at load, not at the first claim.
  if (!/^[a-z_]{2,40}$/.test(name)) throw new Error(`jobs: ${name} is not a job name`);
  return { name, ...job };
}

const count = (r: pg.QueryResult) => r.rowCount ?? 0;

// A pin can land on a snapshot while this delete waits for it: the pin's foreign key then fails the delete with 23503
// (06_snap.sql; no role holds the UPDATE that SKIP LOCKED would need). Rolled back to the savepoint and run again, the
// delete sees the committed pin and leaves that snapshot; so 23503 means "skip it", and every other error is raised.
async function purgeSnapshots(c: pg.PoolClient): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    await c.query('savepoint purge');
    try {
      const r = await c.query(
        `delete from snap.snapshot s
          where s.purpose in ('display', 'watch', 'evidence') and s.created_at < now() - interval '7 days'
            and not exists (select 1 from snap.pin p where p.tenant_id = s.tenant_id and p.snapshot_id = s.id)`,
      );
      await c.query('release savepoint purge');
      return count(r);
    } catch (err) {
      await c.query('rollback to savepoint purge');
      if ((err as { code?: string }).code !== '23503' || attempt === 3) throw err;
    }
  }
}

export const CORE_JOBS: Job[] = [
  // A finding's pin on a snapshot it no longer names goes first (pin_release, 07), so that snapshot can go too.
  registerJob('snapshots', {
    every: 'day',
    perTenant: true,
    run: async (c) => {
      const pins = await c.query(
        `delete from snap.pin p
          where p.holder = 'finding'
            and not exists (select 1 from ai.finding f where f.tenant_id = p.tenant_id and f.id = p.holder_id and f.snapshot_id = p.snapshot_id)`,
      );
      return { pins: count(pins), snapshots: await purgeSnapshots(c) };
    },
  }),
  // The role holds DELETE but no SELECT on ops.idempotency and ops.login_session: a WHERE would be refused, so their
  // policies (7 days; 30 days past expiry) choose the rows. An unused invite's email is erased once it has expired.
  registerJob('sweep', {
    every: 'hour',
    perTenant: true,
    run: async (c) => ({
      idempotency: count(await c.query('delete from ops.idempotency')),
      sessions: count(await c.query('delete from ops.login_session')),
      invites: count(await c.query('update ops.member_invite set email = null, erased_at = now() where erased_at is null and expires_at <= now()')),
    }),
  }),
  // Global tables, no tenant: rate windows older than a day (DELETE only, the policy chooses) and claims finished more
  // than 7 days ago. An unfinished claim is never swept: the next trigger takes it over after 5 minutes.
  registerJob('sweep_global', {
    every: 'hour',
    perTenant: false,
    run: async (c) => ({
      rate_counters: count(await c.query('delete from ops.rate_counter')),
      job_claims: count(await c.query(`delete from ops.job_claim where finished_at < now() - interval '7 days'`)),
    }),
  }),
  registerJob('retention', {
    every: 'day',
    perTenant: true,
    run: async (c) => ({ traces: count(await c.query(`delete from ai.trace where at < now() - interval '90 days'`)) }),
  }),
];
