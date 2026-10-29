// The plan gate at volume (BP-DB-6, test/v2/perf/): its own config, run at the wave gate, never in db's test script or
// `pnpm check` — the volume takes minutes to build. Same cluster and template as the v2 suites (test/v2/global-setup.ts).
// MUNSHI_PERF tells the perf file it runs here; under any other config it skips (vitest.v2.config.ts excludes it).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sabotagePlugin } from './test/v2/sabotage/index.ts';

export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL('..', import.meta.url)))],
  test: {
    globalSetup: ['test/v2/global-setup.ts'],
    include: ['test/v2/perf/**/*.test.ts'],
    env: { MUNSHI_PERF: '1' },
    testTimeout: 300_000,
    hookTimeout: 900_000,
    silent: false, // the plan and timing report prints after the run, green or red
    // As in vitest.v2.config.ts: a sabotage run neither reads nor writes the transform cache.
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});
