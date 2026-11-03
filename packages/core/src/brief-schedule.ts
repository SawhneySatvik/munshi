// The back office's schedule, beside the jobs runner rather than in it: a watcher run and a brief each open their own
// transactions (a brief calls its narrator between two), which a job's one transaction cannot hold, and the jobs files
// may not reach session.ts (db/test/v2/core/jobs/role.test.ts). Per tenant the watchers run at most once an hour; once
// a branch's day has reached BRIEF_HOUR in the shop's zone, its brief for that day is written (writeBrief writes one a
// day per branch). Each run is claimed in ops.job_claim as a job's slot is, so two ticks at once never run one twice.
// As munshi_jobs, with no actor: a watcher and a brief write findings and briefs, never a book row.
//
// `holdSampleDay` (the app sets it while model answers are replayed from recordings): a seeded sample shop's business
// day stays the day its books were seeded as of (seededDay). The recorded answers were asked on that day, and its books
// end there; moving the day to the wall clock's would ask the models a question no recording answers, and put a day the
// books do not hold behind every "today". Its watchers and its brief run as of that day, so the pages, which read as of
// the latest watcher run (asOfDate), stay on it; the brief does not wait for a morning hour (that day's morning has
// passed). Only the operator's synthetic sample shops are held (the kirana and the second kirana, seeded as of the day
// the recorded questions were asked); a real shop, a visitor's sandbox (its own books, kept from today) and a showcase
// shop (seeded as of tomorrow, for its bookings) follow the clock.
import type pg from 'pg';
import { type BriefNarrator, writeBrief } from './brief.ts';
import { assertJobsRole, claim } from './jobs.ts';
import { withTx } from './session.ts';
import { runWatchers } from './watchers.ts';

export const BRIEF_HOUR = 7;

export type BackOfficeRun = { kind: 'watchers' | 'brief'; slot: string; outcome: 'ok' | 'failed' };

const FINISH = 'update ops.job_claim set finished_at = now(), outcome = $3, error_code = $4 where job = $1 and slot = $2 and finished_at is null';

async function claimed(pool: pg.Pool, job: 'watchers' | 'brief', slot: string, work: () => Promise<unknown>): Promise<BackOfficeRun | null> {
  if (!(await claim(pool, job, slot))) return null;
  try {
    await work();
    await pool.query(FINISH, [job, slot, 'ok', null]);
    return { kind: job, slot, outcome: 'ok' };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    await pool.query(FINISH, [job, slot, 'failed', typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'error']);
    return { kind: job, slot, outcome: 'failed' };
  }
}

export async function runBackOffice(
  pool: pg.Pool,
  now = new Date(),
  opts: { narrate?: BriefNarrator; budgetMs?: number; holdSampleDay?: boolean } = {},
): Promise<BackOfficeRun[]> {
  await assertJobsRole(pool);
  const stopAt = Date.now() + (opts.budgetMs ?? 20_000);
  // A real shop the operator has not accepted is skipped, as in runDueJobs: it holds nothing to watch or brief.
  const { rows: tenants } = await pool.query<{ tenant_id: string }>(
    `select d.tenant_id::text as tenant_id from ops.tenant_directory d
      where not d.live or exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id) order by d.tenant_id`,
  );
  const runs: BackOfficeRun[] = [];
  const kept = (r: BackOfficeRun | null) => r && runs.push(r);
  for (const { tenant_id: tenantId } of tenants) {
    if (Date.now() >= stopAt) break;
    const held = opts.holdSampleDay ? await seededDay(pool, tenantId) : null;
    kept(await claimed(pool, 'watchers', `watchers:${tenantId}:${now.toISOString().slice(0, 13)}`, () => runWatchers(pool, tenantId, held ?? undefined, now)));
    const { rows: shops } = await withTx(pool, { kind: 'system', tenantId }, (c) =>
      c.query<{ id: string; day: string; hour: number }>(
        `select s.id::text as id, ($1::timestamptz at time zone t.time_zone)::date::text as day,
                extract(hour from $1::timestamptz at time zone t.time_zone)::int as hour
           from ops.shop s cross join ops.tenant t order by s.id`,
        [now],
      ),
    );
    for (const shop of shops) {
      if ((!held && shop.hour < BRIEF_HOUR) || Date.now() >= stopAt) continue;
      const day = held ?? shop.day;
      kept(
        await claimed(pool, 'brief', `brief:${tenantId}:${shop.id}:${day}`, () =>
          writeBrief(pool, tenantId, shop.id, { asOf: day, ...(opts.narrate ? { narrate: opts.narrate } : {}) }),
        ),
      );
    }
  }
  return runs;
}

// The earliest business date the tenant's watchers have run as of: the seed's run, and every held run since. The
// earliest rather than the first run's, because a run's snapshots go after a week (the snapshots job) and the seed's
// may be gone; and rather than the latest's, so a shop whose day a clock-bound run moved returns to its own. Null
// before its first run, and for any shop but an operator's synthetic sample (not a sandbox).
async function seededDay(pool: pg.Pool, tenantId: string): Promise<string | null> {
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) =>
    c.query<{ as_of: string | null }>(
      `select min((s.params->>'as_of')::date)::text as as_of
         from snap.snapshot s join ai.run r on r.tenant_id = s.tenant_id and r.id = s.run_id
        where r.trigger = 'watcher' and r.ended_at is not null and s.params ? 'as_of'
          and exists (select 1 from ops.tenant t where t.tenant_id = r.tenant_id and t.data_class = 'synthetic' and not t.sandbox)`,
    ),
  );
  return rows[0]?.as_of ?? null;
}
