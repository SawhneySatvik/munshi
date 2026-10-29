// The v2 suites: PostgreSQL 17 and a template built from db/schema (test/v2/global-setup.ts). v1 keeps vitest.config.ts.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from './test/v2/sabotage/index.ts';

export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('..', import.meta.url)))],
  test: {
    globalSetup: ['test/v2/global-setup.ts'],
    include: ['test/v2/**/*.test.ts'],
    exclude: ['test/v2/g8/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The transform cache would serve the unmutated module to a ts sabotage (and could serve a mutated one to a clean
    // run), so a sabotage run neither reads nor writes it.
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});
