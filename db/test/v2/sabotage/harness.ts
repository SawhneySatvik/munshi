// Red-proofs of the v2 harness and runner. Each case breaks one protection; redproof then requires its named
// test to fail. Harness-level cases are asked for by test/v2/global-setup.ts or test/v2/db.ts through sabotageIs.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const HARNESS = 'test/v2/harness.test.ts';

// The one line of db/src/build.ts that refuses a live deployment; the ts case removes it.
export const LIVE_CHECK = "if (live) throw new Error(\"build: refusing a live deployment (ops.deployment.kind = 'live'): live is built once, then only migrated\");";

export const HARNESS_CASES: Case[] = [
  // global-setup starts the PostgreSQL 18 package instead of 17
  { sabotage: 'v2-pg18', file: HARNESS, test: 'the harness runs PostgreSQL 17', config: V2 },
  // the build connection (the template's and the tests') is the superuser, not munshi_migrator
  {
    sabotage: 'v2-build-superuser',
    file: HARNESS,
    test: 'the build runs as munshi_migrator: a file that needs a superuser fails, naming the file',
    config: V2,
  },
  {
    sabotage: 'v2-build-live',
    file: HARNESS,
    test: 'the build refuses a live deployment, naming live, and leaves it standing; a demo one is rebuilt',
    config: V2,
    ts: { file: 'db/src/build.ts', from: LIVE_CHECK, to: '' },
  },
  // the build forgets to drop the ten schemas first
  {
    sabotage: 'v2-build-no-drop',
    file: HARNESS,
    test: 'an empty set builds: the ten Munshi schemas are dropped and no schema is written',
    config: V2,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of build.ts, not a template
    ts: { file: 'db/src/build.ts', from: "await client.query(`drop schema if exists ${MUNSHI_SCHEMAS.join(', ')} cascade`);", to: '' },
  },
  // the files are read in reverse name order: every directory but db/schema itself, whose real files the template must
  // still build in order (reversed there, the global setup fails and no test runs at all, which is not a red)
  {
    sabotage: 'v2-schema-reversed',
    file: HARNESS,
    test: 'files apply in name order and 00 is not the build’s; swapped, the build fails naming the file that ran too early',
    config: V2,
    ts: {
      file: 'db/src/schema-files.ts',
      from: 'const names = readdirSync(dir).sort();',
      to: 'const names = dir === SCHEMA_DIR ? readdirSync(dir).sort() : readdirSync(dir).sort().reverse();',
    },
  },
  // global-setup leaves embedded-postgres's beforeExit and exit listeners in place
  { sabotage: 'v2-g8-exit-hook', file: 'test/v2/g8-exit-code.test.ts', test: 'a failing v2 test run exits non-zero, a passing one exits 0', config: V2 },
];
