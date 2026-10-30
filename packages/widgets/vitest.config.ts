import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from '../../db/test/v2/sabotage/index.ts';

// The widgets in jsdom against a contract-shaped API double (no database here; apps/web/test/api/widget.test.ts runs the
// shipped file against the real API and database). The v2 sabotage plugin lets db/test/redproof.ts break a source file.
export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('../..', import.meta.url)))],
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'], fsModuleCache: !process.env.MUNSHI_SABOTAGE },
});
