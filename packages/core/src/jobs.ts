// The background-jobs runner: runDueJobs runs every due job as munshi_jobs, which has no book grant, and never names an
// actor. It imports no command runner (the source scan in db/test/v2/core/jobs/role.test.ts). Each job claims its slot
// in ops.job_claim first, so however many triggers fire at once (after a write, on a page load, the dev ticker, the
// cron) a slot's work runs once. Each area's jobs live in their own file and join JOBS here.
import pg from 'pg';
import { CORE_JOBS, type Job, type Removed } from './jobs-core.ts';
import { HOLD_JOBS } from './jobs-holds.ts';
import { MESSAGING_JOBS } from './jobs-messaging.ts';
import { ORDER_JOBS } from './jobs-orders.ts';
import { PAYPAL_JOBS } from './jobs-paypal.ts';
import { SIGNUP_JOBS } from './jobs-signups.ts';

export type { Job, Removed } from './jobs-core.ts';
export { registerJob } from './jobs-core.ts';

export const JOBS: readonly Job[] = [...CORE_JOBS, ...HOLD_JOBS, ...MESSAGING_JOBS, ...ORDER_JOBS, ...PAYPAL_JOBS, ...SIGNUP_JOBS];

export type JobRun = { job: string; slot: string; tenantId: string | null; outcome: 'ok' | 'failed'; removed: Removed; errorCode?: string };

// The jobs pool, connected as munshi_jobs. The tick route passes its connection settings in.
export function createJobsPool(connectionString: string, max = 2): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: 'munshi_jobs' });
}

// The purges delete whatever munshi_jobs's restrictive policies admit, so on any other role (a superuser or a BYPASSRLS
// role skips them; the app's role is the one that writes books) the runner refuses to start.
const verified = new WeakSet<pg.Pool>();
export async function assertJobsRole(pool: pg.Pool): Promise<void> {
  if (verified.has(pool)) return;
  const { rows } = await pool.query<{ role: string; superuser: boolean; bypass: boolean }>(
    'select rolname as role, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user',
  );
  const me = rows[0];
  if (me?.role !== 'munshi_jobs' || me.superuser || me.bypass) {
    throw new Error('jobs: the runner connects as munshi_jobs (not a superuser, no BYPASSRLS); refusing to run');
  }
  verified.add(pool);
}

// True when this caller runs the slot: it inserted the claim, or took over one left unfinished for 5 minutes (a run
// that died). Two takers of one lapsed claim cannot both win: the second re-reads the row the first moved, and its
// claimed_at is no longer old.
export async function claim(pool: pg.Pool, job: string, slot: string): Promise<boolean> {
  const taken = await pool.query('insert into ops.job_claim (job, slot) values ($1, $2) on conflict do nothing', [job, slot]);
  if (taken.rowCount === 1) return true;
  const lapsed = await pool.query(
    `update ops.job_claim set claimed_at = now() where job = $1 and slot = $2 and finished_at is null and claimed_at < now() - interval '5 minutes'`,
    [job, slot],
  );
  return lapsed.rowCount === 1;
}

const FINISH = 'update ops.job_claim set finished_at = now(), outcome = $3, error_code = $4 where job = $1 and slot = $2 and finished_at is null';
const PERIOD = { minute: 16, hour: 13, day: 10 }; // of an ISO instant, in UTC: 2026-10-29T10:15, 2026-10-29T10, 2026-10-29

// A SQLSTATE (or MS0nn) in lower case, else `error`: never an error's message.
const errorCode = (err: unknown) => {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9]{5}$/.test(code) ? code.toLowerCase() : 'error';
};

// One slot's work in one transaction under the tenant's context (none for a global job), finished `ok` in that same
// transaction; on failure rolled back and finished `failed` with its code, so the next slot tries again. A job may
// commit part of its work first (checkpoint): what it committed stays, and only the rest is rolled back.
async function runSlot(pool: pg.Pool, job: Job, slot: string, tenantId: string | null): Promise<JobRun> {
  const run = { job: job.name, slot, tenantId };
  try {
    const client = await pool.connect();
    let broken = false;
    try {
      const begin = async () => {
        await client.query('begin');
        await client.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId ?? '']);
      };
      await begin();
      const removed = await job.run(client, async () => {
        await client.query('commit');
        await begin();
      });
      await client.query(FINISH, [job.name, slot, 'ok', null]);
      await client.query('commit');
      return { ...run, outcome: 'ok', removed };
    } catch (err) {
      await client.query('rollback').catch(() => {
        broken = true;
      });
      throw err;
    } finally {
      client.release(broken);
    }
  } catch (err) {
    const code = errorCode(err);
    await pool.query(FINISH, [job.name, slot, 'failed', code]);
    return { ...run, outcome: 'failed', removed: {}, errorCode: code };
  }
}

// Runs every due job (or only the named ones) and returns what this call ran; a slot another trigger holds is left to
// it. Slots are named from `now`, in UTC. The run takes no new work once its budget is spent, leaving the rest to the
// next trigger.
export async function runDueJobs(pool: pg.Pool, now = new Date(), only?: readonly string[], budgetMs = 20_000): Promise<JobRun[]> {
  const unknown = only?.filter((name) => !JOBS.some((j) => j.name === name)) ?? [];
  if (unknown.length) throw new Error(`jobs: no job named ${unknown.join(', ')}`);
  await assertJobsRole(pool);
  const stopAt = Date.now() + budgetMs;
  const due = JOBS.filter((j) => !only || only.includes(j.name));
  // The directory, not ops.tenant: a tenant table read with no tenant context returns no rows under forced RLS. A real
  // shop the operator has not accepted is skipped: it holds nothing but its creation, and the PayPal sweep and
  // the outbox never reach a provider for it; the daily signups job purges it once it lapses.
  const tenants = due.some((j) => j.perTenant)
    ? (
        await pool.query<{ tenant_id: string }>(
          `select d.tenant_id from ops.tenant_directory d
            where not d.live or exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id) order by d.tenant_id`,
        )
      ).rows.map((r) => r.tenant_id)
    : [];
  const runs: JobRun[] = [];
  for (const job of due) {
    for (const tenantId of job.perTenant ? tenants : [null]) {
      if (Date.now() >= stopAt) return runs;
      const slot = [job.name, tenantId, now.toISOString().slice(0, PERIOD[job.every])].filter(Boolean).join(':');
      if (await claim(pool, job.name, slot)) runs.push(await runSlot(pool, job, slot, tenantId));
    }
  }
  return runs;
}
