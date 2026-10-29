// Red-proofs of the v2 harness and runner (BP-DB-0). Each case breaks one protection; redproof then requires its named
// test to fail. Harness-level cases are asked for by test/v2/global-setup.ts or test/v2/db.ts through sabotageIs.
import type { Case } from '../../sabotage.ts';

const V2 = 'vitest.v2.config.ts';
const HARNESS = 'test/v2/harness.test.ts';

// The one line of db/src/build.ts that refuses a live deployment; the ts case removes it.
export const LIVE_CHECK = "if (live) throw new Error(\"build: refusing a live deployment (ops.deployment.kind = 'live'): live is built once, then only migrated\");";

export const HARNESS_CASES: Case[] = [
  // global-setup starts the PostgreSQL 18 package instead of 17
  { sabotage: 'v2-pg18', file: HARNESS, test: 'PG17 the harness runs PostgreSQL 17', config: V2 },
  // the build connection (the template's and the tests') is the superuser, not munshi_migrator
  {
    sabotage: 'v2-build-superuser',
    file: HARNESS,
    test: 'BUILD-SUPERUSER the build runs as munshi_migrator: a file that needs a superuser fails, naming the file',
    config: V2,
  },
  {
    sabotage: 'v2-build-live',
    file: HARNESS,
    test: 'BUILD-LIVE the build refuses a live deployment, naming live, and leaves it standing; a demo one is rebuilt',
    config: V2,
    ts: { file: 'db/src/build.ts', from: LIVE_CHECK, to: '' },
  },
  // the build forgets to drop the ten schemas first
  {
    sabotage: 'v2-build-no-drop',
    file: HARNESS,
    test: 'BUILD-EMPTY an empty set builds: the ten Munshi schemas are dropped and no schema is written',
    config: V2,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of build.ts, not a template
    ts: { file: 'db/src/build.ts', from: "await client.query(`drop schema if exists ${MUNSHI_SCHEMAS.join(', ')} cascade`);", to: '' },
  },
  // the files are read in reverse name order
  {
    sabotage: 'v2-schema-reversed',
    file: HARNESS,
    test: 'ORDER files apply in name order and 00 is not the build’s; swapped, the build fails naming the file that ran too early',
    config: V2,
    ts: { file: 'db/src/schema-files.ts', from: 'const names = readdirSync(dir).sort();', to: 'const names = readdirSync(dir).sort().reverse();' },
  },
  // global-setup leaves embedded-postgres's beforeExit and exit listeners in place
  { sabotage: 'v2-g8-exit-hook', file: 'test/v2/g8-exit-code.test.ts', test: 'G8 a failing v2 test run exits non-zero, a passing one exits 0', config: V2 },
];
