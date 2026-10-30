import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from '../../db/test/v2/sabotage/index.ts';

// The adapters' own tests (the cache against a real redis-server); no database. The v2 sabotage plugin lets db/test/redproof.ts break a source file as vitest loads it.
export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('../..', import.meta.url)))],
  // The transform cache would serve the unmutated module to a ts sabotage, so a sabotage run neither reads nor writes it.
  test: { include: ['test/**/*.test.ts'], fsModuleCache: !process.env.MUNSHI_SABOTAGE },
});
