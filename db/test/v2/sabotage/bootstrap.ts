// Red-proofs of the bootstrap gate (test/v2/gates/00-bootstrap.test.ts). A .sql file is read through fs, never imported,
// so no ts case can reach it; the case is harness-level and the test asks sabotageIs.
import type { Case } from '../../sabotage.ts';

export const BOOTSTRAP_CASES: Case[] = [
  // the bootstrap runs as the cluster's superuser, not the managed-style admin: the residual it must print never appears
  {
    sabotage: 'v2-boot-as-superuser',
    file: 'test/v2/gates/00-bootstrap.test.ts',
    test: 'SUPA1 the bootstrap runs as a non-superuser admin, printing the large-object residual, and the whole build then runs as munshi_migrator',
    config: 'vitest.v2.config.ts',
  },
];
