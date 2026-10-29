// Red-proofs of the screen reads' move into core (SPINE-V): SQL1's web half, which scans apps/web's source text.
import type { Case } from './case.ts';

export const CORE_VIEWS_CASES: Case[] = [
  // harness-level: a query planted in lib/server/ledger.ts's scanned text
  {
    sabotage: 'v2-sql1-planted',
    file: 'test/sql1.test.ts',
    test: 'SQL1 no file under apps/web runs SQL or names a table, outside lib/server/{agent-port,session,config,db}.ts',
    dir: 'apps/web',
    config: 'vitest.config.ts',
  },
];
