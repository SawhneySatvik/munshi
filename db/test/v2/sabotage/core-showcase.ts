// Red-proofs of the showcase seeds (BP-CORE-5b, test/v2/core/seed/showcase.test.ts). The omit cases are harness-level: a
// seed option leaves one planted situation out of Elite or Prabhave (the test asks sabotageIs), so that tenant's
// answer-key test must fail, the watchers missing a situation its key names. The rest break what the other clauses
// lean on: a looser watcher threshold makes a control speak (nothing else may be found), a book row left without its
// audit entry, and a site_verify change proposed but never approved.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/core/seed/showcase.test.ts';
const ELITE_FOUND = 'SHOW Elite: the watchers find exactly the planted situations of elite.answers.json, and nothing else';
const PRABHAVE_FOUND = 'SHOW Prabhave: the watchers find exactly the planted situations of prabhave.answers.json, and nothing else';
const AUDITED =
  'SHOW the seed writes book rows only through core: each has an audit entry naming its command, and the only one under a decision is the owner-approved salary run';
const VERIFIED = 'SHOW both showcase sites are verified, each by its own approved site_verify change, and the public reads them as verified';

const omit = (plant: string, test: string): Case => ({ sabotage: `v2-showcase-omit-${plant}`, file: FILE, test, config: V2 });
const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: V2, ts: { file, from, to } });

export const CORE_SHOWCASE_CASES: Case[] = [
  ...['idle_stylist', 'package_expiry', 'regulars_lapsing'].map((p) => omit(p, ELITE_FOUND)),
  ...['dead_stock', 'hold_expiring', 'order_unanswered', 'order_late'].map((p) => omit(p, PRABHAVE_FOUND)),
  // Two visits make a regular: Vikram (the control) lapses too.
  ts('v2-showcase-regulars-threshold', ELITE_FOUND, 'packages/core/src/queries-watch-people.ts', 'where v.n >= 3 and v.last_on', 'where v.n >= 2 and v.last_on'),
  // A 40-day window: Bottle green (last sold on day −44, the control) and pieces last sold on day −40 read as dead.
  ts(
    'v2-showcase-dead-window',
    PRABHAVE_FOUND,
    'packages/core/src/queries-watch-stock.ts',
    "(select end_at from bounds) - interval '45 days'",
    "(select end_at from bounds) - interval '40 days'",
  ),
  // After the seed, one of Elite's sales loses its audit entry (as the superuser, triggers off).
  {
    sabotage: 'v2-showcase-unaudited-row',
    file: FILE,
    test: AUDITED,
    config: V2,
    sql: `begin; set local session_replication_role = replica;
          delete from audit.audit_log a using ops.tenant_directory d
           where a.ctid = (select x.ctid from audit.audit_log x where x.tenant_id = d.tenant_id and x.entity = 'books.sale' limit 1) and d.slug = 'elite';
          commit;`,
  },
  // the site_verify approval (the model_allow loop above it calls approveChange the same way)
  ts(
    'v2-showcase-unapproved',
    VERIFIED,
    'db/seed/showcase.ts',
    'await withOperator(pools.platform, session, (c) => approveChange(c, id, { digest: diff.digest }));\n    verifications.push(id);',
    'verifications.push(id);',
  ),
];

const DEFAULTS = 'SHOW the demo default config is set by the seeded operator’s approved change: a sample shop without a config of its own has AI on, at the demo caps';
CORE_SHOWCASE_CASES.push(
  // the demo default config never approved
  ts('v2-showcase-defaults-unapproved', DEFAULTS, 'db/seed/showcase.ts', 'await withOperator(pools.platform, session, (c) => approveChange(c, defaultsChangeId, { digest: defaults.digest }));', ''),
  // the defaults set after the sites were verified: the showcase shops' own config rows then carry AI off
  {
    sabotage: 'v2-showcase-defaults-late',
    file: FILE,
    test: DEFAULTS,
    config: V2,
    ts: { file: 'db/seed/showcase.ts', from: '  const verifications: string[] = [];\n', to: '  const verifications: string[] = [];\n  if (verifications.length === 0) return { asOf, elite, prabhave, operatorId: op.operatorId, verifications, defaultsChangeId: null };\n' },
  },
);
