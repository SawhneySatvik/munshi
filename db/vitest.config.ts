import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from './test/sabotage.ts';

export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('..', import.meta.url)))],
  test: {
    globalSetup: ['test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['test/g8/**', 'test/v2/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The transform cache would serve the unmutated module to a ts sabotage (and could serve a mutated one to a clean
    // run), so a sabotage run neither reads nor writes it.
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});
