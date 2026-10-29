// The v2 red-proof cases and their three paths, as in v1's test/sabotage.ts but over v2's own list:
//   sql  — run as superuser in the test file's fresh database, at the end of its beforeAll (TestDb.sabotage);
//   ts   — a source-text mutation applied as vitest loads the module (sabotagePlugin, in every v2 vitest config);
//   none — harness-level: the harness asks sabotageIs(name).
// Every path reports `applied` or `failed` to MUNSHI_SABOTAGE_REPORT, which test/redproof.ts reads: a case that did not
// apply is an ERROR there, never a red. Each area's cases live in their own file and join CASES here.
import { appendFileSync } from 'node:fs';
import type { Case } from '../../sabotage.ts';
import { HARNESS_CASES } from './harness.ts';

export const CASES: Case[] = [...HARNESS_CASES];

// Cases that cannot apply: redproof runs them first and must call each ERROR, one per path.
export const PLANTED: Case[] = [
  {
    sabotage: 'v2-planted-unappliable-sql',
    file: 'test/v2/harness.test.ts',
    test: 'PG17 the harness runs PostgreSQL 17',
    config: 'vitest.v2.config.ts',
    sql: "do $$ begin raise exception 'planted: this sabotage cannot apply'; end $$;",
  },
  {
    sabotage: 'v2-planted-unappliable-ts',
    file: 'test/v2/harness.test.ts',
    test: 'PG17 the harness runs PostgreSQL 17',
    config: 'vitest.v2.config.ts',
    ts: { file: 'db/test/v2/db.ts', from: 'text that db.ts does not contain', to: '' },
  },
  // Harness-level, but nothing asks for it: what a deleted sabotage hook looks like.
  { sabotage: 'v2-planted-unapplied', file: 'test/v2/harness.test.ts', test: 'PG17 the harness runs PostgreSQL 17', config: 'vitest.v2.config.ts' },
];

const ALL = [...CASES, ...PLANTED];
const known = (name: string) => ALL.filter((c) => c.sabotage === name);

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
