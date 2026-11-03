import type { Case } from './case.ts';

export const VERCEL_SERVICES_CASES: Case[] = [
  {
    sabotage: 'v2-vercel-services-catchall-order',
    file: 'test/v2/deploy/vercel.test.ts',
    test: 'the services layout routes both sites before the web catch-all and carries no environment value',
    config: 'vitest.v2.config.ts',
  },
  {
    sabotage: 'v2-vercel-services-env-value',
    file: 'test/v2/deploy/vercel.test.ts',
    test: 'the services layout routes both sites before the web catch-all and carries no environment value',
    config: 'vitest.v2.config.ts',
  },
];
