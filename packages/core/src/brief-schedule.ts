// The back office's schedule (BLUEPRINT §7.3–§7.5), beside the jobs runner rather than in it: a watcher run and a brief
// each open their own transactions (a brief calls its narrator between two), which a job's one transaction cannot hold,
// and the jobs files may not reach session.ts (J1). Per tenant the watchers run at most once an hour; once a branch's
// day has reached BRIEF_HOUR in the shop's zone, its brief for that day is written (writeBrief writes one a day per
// branch). Each run is claimed in ops.job_claim as a job's slot is, so two ticks at once never run one twice. As
// munshi_jobs, with no actor: a watcher and a brief write findings and briefs, never a book row.
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

export async function runBackOffice(pool: pg.Pool, now = new Date(), opts: { narrate?: BriefNarrator; budgetMs?: number } = {}): Promise<BackOfficeRun[]> {
  await assertJobsRole(pool);
  const stopAt = Date.now() + (opts.budgetMs ?? 20_000);
  const { rows: tenants } = await pool.query<{ tenant_id: string }>('select tenant_id::text as tenant_id from ops.tenant_directory order by tenant_id');
  const runs: BackOfficeRun[] = [];
  const kept = (r: BackOfficeRun | null) => r && runs.push(r);
  for (const { tenant_id: tenantId } of tenants) {
    if (Date.now() >= stopAt) break;
    kept(await claimed(pool, 'watchers', `watchers:${tenantId}:${now.toISOString().slice(0, 13)}`, () => runWatchers(pool, tenantId, undefined, now)));
    const { rows: shops } = await withTx(pool, { kind: 'system', tenantId }, (c) =>
      c.query<{ id: string; day: string; hour: number }>(
        `select s.id::text as id, ($1::timestamptz at time zone t.time_zone)::date::text as day,
                extract(hour from $1::timestamptz at time zone t.time_zone)::int as hour
           from ops.shop s cross join ops.tenant t order by s.id`,
        [now],
      ),
    );
    for (const shop of shops) {
      if (shop.hour < BRIEF_HOUR || Date.now() >= stopAt) continue;
      kept(
        await claimed(pool, 'brief', `brief:${tenantId}:${shop.id}:${shop.day}`, () =>
          writeBrief(pool, tenantId, shop.id, { asOf: shop.day, ...(opts.narrate ? { narrate: opts.narrate } : {}) }),
        ),
      );
    }
  }
  return runs;
}
