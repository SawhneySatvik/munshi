import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['test/g8/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
