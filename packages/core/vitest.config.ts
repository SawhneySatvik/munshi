import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from '../../db/test/v2/sabotage/index.ts';

// Pure unit tests and source-scanning gates; the database-backed tests of core live in db/test (the embedded-Postgres
// harness). Sabotage tooling is shared with db/test (redproof runs both).
export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('../..', import.meta.url)))],
  test: { include: ['test/**/*.test.ts'], fsModuleCache: !process.env.MUNSHI_SABOTAGE },
});
