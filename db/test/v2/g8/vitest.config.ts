// The child runs of gate G8 on v2: the v2 global setup and sabotage plugin, one test file named on the command line.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from '../sabotage/index.ts';

export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('../../../..', import.meta.url)))],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    globalSetup: ['test/v2/global-setup.ts'],
    include: ['test/v2/g8/*.test.ts'],
    hookTimeout: 120_000,
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});
