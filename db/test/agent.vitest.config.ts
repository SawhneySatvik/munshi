import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from './sabotage.ts';

// packages/agent's own tests under a sabotage (redproof's `config` for its cases). It lives here because packages/agent
// may import nothing outside itself, its vitest config included (gate B1).
export default defineConfig({
  root: fileURLToPath(new URL('../../packages/agent', import.meta.url)),
  plugins: [sabotagePlugin(fileURLToPath(new URL('../..', import.meta.url)))],
  test: { include: ['test/**/*.test.ts'], fsModuleCache: !process.env.MUNSHI_SABOTAGE },
});
