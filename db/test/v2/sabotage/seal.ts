// Red-proofs of the seal (test/v2/gates/90-seal.test.ts). The seal is read through fs, so the case rewrites the text
// the test loads, dropping one of the seal's checks before it runs.
import type { Case } from '../../sabotage.ts';

export const SEAL_CASES: Case[] = [
  {
    sabotage: 'v2-seal-no-force-check',
    file: 'test/v2/gates/90-seal.test.ts',
    test: 'SEAL the seal passes on the built schema, and names every problem planted in it',
    config: 'vitest.v2.config.ts',
    ts: {
      file: 'db/test/v2/gates/90-seal.test.ts',
      from: "const seal = readFileSync(path.join(SCHEMA_DIR, '90_seal.sql'), 'utf8');",
      to: "const seal = readFileSync(path.join(SCHEMA_DIR, '90_seal.sql'), 'utf8').replace(\"case when not c.relforcerowsecurity then 'RLS not forced' end,\", '');",
    },
  },
];
