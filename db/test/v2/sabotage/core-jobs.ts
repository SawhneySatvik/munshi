// Red-proofs of the jobs runner (test/v2/core/jobs/): each breaks one protection of packages/core/src/jobs*.ts or the tick
// route, and its named test must fail.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/jobs';
const JOBS = 'packages/core/src/jobs.ts';
const CORE = 'packages/core/src/jobs-core.ts';
const ROUTE = 'apps/web/app/api/internal/tick/route.ts';

const CLAIM1 = 'CLAIM1 each job runs once per slot under 10 concurrent triggers, and the claim admits one of 10 concurrent callers';
const CLAIM2 = 'CLAIM2 a claim left unfinished for 5 minutes is taken over and its job runs; a younger one is left to its run';
const CLAIM3 = 'CLAIM3 a run whose budget is spent claims nothing';
const SWEEP1 = "SWEEP1 each purge job removes exactly every tenant's planted due rows, a positive count, and keeps every pinned, recent or not-yet-due row";
const J2_RACE = 'J2 a pin inserted while the purge runs survives with its snapshot, and the purge still removes the rest of its due snapshots';
const J1_GRANTS = 'J1 the jobs pool holds no write grant on any books table, and every write it attempts is refused';
const J1_ROLE = 'J1 runDueJobs runs only on a munshi_jobs connection: the app and the superuser are refused before any claim';
const J1_SCAN = 'J1 no jobs*.ts file imports a command runner, the acting-member context or the app pool, directly or through another file';
const CRON1 = 'CRON1 a missing, wrong or unset CRON_SECRET answers 404, opens no jobs connection and claims nothing; the right one runs the jobs; nothing is logged';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: source, from, to },
});

export const CORE_JOBS_CASES: Case[] = [
  // the claim dropped: every trigger runs every slot
  ts('v2-jobs-claim-dropped', 'claim.test.ts', CLAIM1, JOBS, 'return lapsed.rowCount === 1;', 'return true;'),
  // a lapsed claim is never taken over: a run that died strands its slot
  ts('v2-jobs-no-takeover', 'claim.test.ts', CLAIM2, JOBS, 'return lapsed.rowCount === 1;', 'return false;'),
  ts('v2-jobs-no-budget', 'claim.test.ts', CLAIM3, JOBS, 'if (Date.now() >= stopAt) return runs;', ''),
  // each job runs once with no tenant context instead of once per tenant: forced RLS makes every tenant purge a no-op
  ts('v2-jobs-no-tenant-loop', 'sweep.test.ts', SWEEP1, JOBS, 'job.perTenant ? tenants : [null]', '[null]'),
  // a pin that lands during the purge fails the whole tenant's purge instead of being skipped
  ts('v2-jobs-23503-error', 'pin-race.test.ts', J2_RACE, CORE, "if ((err as { code?: string }).code !== '23503' || attempt === 3) throw err;", 'throw err;'),
  { sabotage: 'v2-jobs-j1-grant', file: `${DIR}/role.test.ts`, test: J1_GRANTS, config: V2, sql: 'grant insert on books.probe to munshi_jobs;' },
  ts('v2-jobs-role-check', 'role.test.ts', J1_ROLE, JOBS, "if (me?.role !== 'munshi_jobs' || me.superuser || me.bypass) {", 'if (false) {'),
  // harness-level: a command import planted in jobs-core.ts's scanned text
  { sabotage: 'v2-jobs-scan-command', file: `${DIR}/role.test.ts`, test: J1_SCAN, config: V2 },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of route.ts, not a template
  ts('v2-jobs-any-secret', 'cron.test.ts', CRON1, ROUTE, 'return secret !== "" && timingSafeEqual(digest(given), digest(`Bearer ${secret}`));', 'return true;'),
];
