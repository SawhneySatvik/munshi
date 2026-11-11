// The v2 red-proof cases and their three paths:
//   sql  — run as superuser in the test file's fresh database, at the end of its beforeAll (TestDb.sabotage);
//   ts   — a source-text mutation applied as vitest loads the module (sabotagePlugin, in every v2 vitest config);
//   none — harness-level: the harness asks sabotageIs(name).
// Every path reports `applied` or `failed` to MUNSHI_SABOTAGE_REPORT, which test/redproof.ts reads: a case that did not
// apply is an ERROR there, never a red. Each area's cases live in their own file and join CASES here.
import { appendFileSync } from 'node:fs';
import type { Case } from './case.ts';
import { AGENT_VIEWS_CASES } from './agent-views.ts';
import { AGENTS_WIRED_CASES } from './agents-wired.ts';
import { AI_CASES } from './ai.ts';
import { API_CASES } from './api.ts';
import { APPS_SITES_CASES } from './apps-sites.ts';
import { DESKS_CASES } from './desks.ts';
import { DEV_PORTAL_CASES } from './dev-portal.ts';
import { AUDIT_CASES } from './audit.ts';
import { BOOKS_CASES } from './books.ts';
import { BOOKS_CORE_CASES } from './books-core.ts';
import { BOOTSTRAP_CASES } from './bootstrap.ts';
import { CORE_PLATFORM_CASES } from './core-platform.ts';
import { CORE_JOBS_CASES } from './core-jobs.ts';
import { CORE_CONTRACTS_CASES } from './core-contracts.ts';
import { CORE_BOOT_CASES } from './core-boot.ts';
import { CORE_COMMANDS_CASES } from './core-commands.ts';
import { PERF_CASES } from './perf.ts';
import { CORE_AI_CASES } from './core-ai.ts';
import { CORE_APPROVALS_CASES } from './core-approvals.ts';
import { CORE_SNAPSHOTS_CASES } from './core-snapshots.ts';
import { CORE_READS_CASES } from './core-reads.ts';
import { CORE_VIEWS_CASES } from './core-views.ts';
import { CORE_COUNTER_CASES } from './core-counter.ts';
import { CORE_MESSAGING_CASES } from './core-messaging.ts';
import { CORE_AUTH_CASES } from './core-auth.ts';
import { CORE_CAPABILITIES_CASES } from './core-capabilities.ts';
import { CORE_STAFF_CASES } from './core-staff.ts';
import { CORE_HOLDS_CASES } from './core-holds.ts';
import { CORE_REVERSE_CASES } from './core-reverse.ts';
import { CORE_SHOWCASE_CASES } from './core-showcase.ts';
import { PACKAGE_CASES } from './packages.ts';
import { CORE_ORDERS_CASES } from './core-orders.ts';
import { CORE_WIRE_CASES } from './core-wire.ts';
import { AGENT_CHAT_EVAL_CASES } from './agent-chat-and-evals.ts';
import { DEPLOY_CASES } from './deploy.ts';
import { SEED_SETTLEMENT_CASES } from './seed-settlements.ts';
import { MODEL_CONTROLS_CASES } from './model-controls.ts';
import { MODEL_CHOICE_CASES } from './model-choice.ts';
import { PAYPAL_CASES } from './paypal.ts';
import { PAYPAL_APP_CASES } from './paypal-app.ts';
import { DEPLOY_PREP_CASES } from './deploy-prep.ts';
import { ERASE_CASES } from './erase.ts';
import { GRID_CASES } from './grid.ts';
import { HARNESS_CASES } from './harness.ts';
import { MANIFEST_CASES } from './manifest.ts';
import { IG_CASES } from './instagram.ts';
import { CARD_CASES } from './card.ts';
import { LIVE_CHANNELS_CASES } from './live-channels.ts';
import { MEMORY_APP_CASES } from './memory-app.ts';
import { MESSAGING_CASES } from './messaging.ts';
import { OFFERS_PACKAGES_GST_CASES } from './offers-packages-gst.ts';
import { ONBOARDING_CASES } from './onboarding.ts';
import { OPS_CASES } from './ops.ts';
import { ORDERS_CASES } from './orders.ts';
import { PLATFORM_CASES } from './platform.ts';
import { PWA_CASES } from './pwa.ts';
import { ROLE_CASES } from './role.ts';
import { ROLES_CASES } from './roles.ts';
import { SEAL_CASES } from './seal.ts';
import { SITES_CASES } from './sites.ts';
import { RUNS_CASES } from './runs.ts';
import { ROUTER_CASES } from './router.ts';
import { SNAP_CASES } from './snap.ts';
import { SARVAM_CASES } from './sarvam.ts';
import { SPEND_CASES } from './spend.ts';
import { SURPLUS_APP_CASES } from './surplus-app.ts';
import { PURGE_ROUTER_PUSH_CASES } from './purge-router-and-push.ts';
import { CHANNEL_GRANTS_BUDGETS_CASES } from './channel-grants-and-budgets.ts';
import { TENANCY_CASES } from './tenancy.ts';
import { WID_CACHE_CASES } from './wid-cache.ts';
import { OP_CASES } from './operator.ts';
import { HOME_POLISH_CASES } from './home-polish.ts';
import { HOSTED_SITES_CASES } from './hosted-sites.ts';
import { DEMO_CLOCK_CASES } from './demo-clock.ts';
import { SCHEDULE_CASES } from './schedule.ts';

export const CASES: Case[] = [...HARNESS_CASES, ...MANIFEST_CASES, ...BOOTSTRAP_CASES, ...BOOKS_CASES, ...ERASE_CASES, ...TENANCY_CASES, ...OPS_CASES, ...SNAP_CASES, ...AI_CASES, ...RUNS_CASES, ...AUDIT_CASES, ...PLATFORM_CASES, ...ROLE_CASES, ...SEAL_CASES, ...BOOKS_CORE_CASES, ...SITES_CASES, ...CORE_PLATFORM_CASES, ...CORE_JOBS_CASES, ...OFFERS_PACKAGES_GST_CASES, ...MESSAGING_CASES, ...GRID_CASES, ...ORDERS_CASES, ...AGENT_VIEWS_CASES, ...CORE_COMMANDS_CASES, ...CORE_APPROVALS_CASES, ...CORE_SNAPSHOTS_CASES, ...CORE_READS_CASES, ...CORE_VIEWS_CASES, ...CORE_COUNTER_CASES, ...CORE_MESSAGING_CASES, ...CORE_AUTH_CASES, ...CORE_CAPABILITIES_CASES, ...CORE_STAFF_CASES, ...CORE_HOLDS_CASES, ...CORE_REVERSE_CASES, ...CORE_ORDERS_CASES, ...CORE_CONTRACTS_CASES, ...CORE_BOOT_CASES, ...PERF_CASES, ...CORE_AI_CASES, ...CORE_WIRE_CASES, ...CORE_SHOWCASE_CASES, ...PACKAGE_CASES, ...API_CASES, ...AGENT_CHAT_EVAL_CASES, ...WID_CACHE_CASES, ...APPS_SITES_CASES, ...DEV_PORTAL_CASES, ...DEPLOY_CASES, ...SEED_SETTLEMENT_CASES, ...MODEL_CONTROLS_CASES, ...MODEL_CHOICE_CASES, ...DEPLOY_PREP_CASES, ...SPEND_CASES, ...DESKS_CASES, ...AGENTS_WIRED_CASES, ...SARVAM_CASES, ...PAYPAL_CASES, ...PAYPAL_APP_CASES, ...PWA_CASES, ...LIVE_CHANNELS_CASES, ...ROLES_CASES, ...ONBOARDING_CASES, ...MEMORY_APP_CASES, ...SURPLUS_APP_CASES];
// Later sets, one line each.
CASES.push(...PURGE_ROUTER_PUSH_CASES);
CASES.push(...ROUTER_CASES);
CASES.push(...IG_CASES);
CASES.push(...CHANNEL_GRANTS_BUDGETS_CASES);
CASES.push(...OP_CASES);
CASES.push(...CARD_CASES);
CASES.push(...HOME_POLISH_CASES);
CASES.push(...HOSTED_SITES_CASES);
CASES.push(...DEMO_CLOCK_CASES);
CASES.push(...SCHEDULE_CASES);

// Cases that cannot apply: redproof runs them first and must call each ERROR, one per path.
export const PLANTED: Case[] = [
  {
    sabotage: 'v2-planted-unappliable-sql',
    file: 'test/v2/harness.test.ts',
    test: 'the harness runs PostgreSQL 17',
    config: 'vitest.v2.config.ts',
    sql: "do $$ begin raise exception 'planted: this sabotage cannot apply'; end $$;",
  },
  {
    sabotage: 'v2-planted-unappliable-ts',
    file: 'test/v2/harness.test.ts',
    test: 'the harness runs PostgreSQL 17',
    config: 'vitest.v2.config.ts',
    ts: { file: 'db/test/v2/db.ts', from: 'text that db.ts does not contain', to: '' },
  },
  // Harness-level, but nothing asks for it: what a deleted sabotage hook looks like.
  { sabotage: 'v2-planted-unapplied', file: 'test/v2/harness.test.ts', test: 'the harness runs PostgreSQL 17', config: 'vitest.v2.config.ts' },
];

const ALL = [...CASES, ...PLANTED];
const known = (name: string) => ALL.filter((c) => c.sabotage === name);
// A name is one case: with two, only the first's mutation would ever run and the second's gate would go unproved.
const twice = [...new Set(ALL.map((c) => c.sabotage).filter((n, i, all) => all.indexOf(n) !== i))];
if (twice.length) throw new Error(`v2 sabotage names must be unique; used more than once: ${twice.join(', ')}`);

export function reportSabotage(name: string, outcome: 'applied' | 'failed', detail = ''): void {
  const file = process.env.MUNSHI_SABOTAGE_REPORT;
  if (file) appendFileSync(file, `${outcome} ${name}${detail ? ` ${detail.replace(/\s+/g, ' ')}` : ''}\n`);
}

// True when `name` is the current sabotage, and reports it applied.
export function sabotageIs(name: string): boolean {
  const cases = known(name);
  if (cases.length === 0 || cases.some((c) => c.sql || c.ts)) throw new Error(`${name} is not a v2 harness-level sabotage`);
  if (process.env.MUNSHI_SABOTAGE !== name) return false;
  reportSabotage(name, 'applied');
  return true;
}

// The SQL of an sql case; undefined for ts and harness-level cases; throws for a name v2 does not know.
export function sabotageSql(name: string): string | undefined {
  const cases = known(name);
  if (cases.length === 0) throw new Error(`unknown v2 sabotage ${name}`);
  return cases.find((c) => c.sql)?.sql;
}

// A vite plugin applying the current ts case as vitest loads its module. The text must occur exactly once; otherwise
// the case reports failed and the import throws, so a stale mutation is an ERROR, not a red.
export function sabotagePlugin(repoRoot: string) {
  const name = process.env.MUNSHI_SABOTAGE;
  const m = name ? known(name).find((c) => c.ts)?.ts : undefined;
  const target = m ? `${repoRoot.replace(/\/$/, '')}/${m.file}` : undefined;
  return {
    name: 'munshi-sabotage-v2',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!name || !m || id.split('?')[0] !== target) return null;
      if (code.split(m.from).length !== 2) {
        reportSabotage(name, 'failed', `${m.file} does not contain the text to break exactly once`);
        throw new Error(`sabotage ${name}: ${m.file} does not contain the text to break exactly once`);
      }
      reportSabotage(name, 'applied');
      return code.replace(m.from, m.to);
    },
  };
}
