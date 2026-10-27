// The child run of gate G8: the same embedded-Postgres global setup, one test that passes or fails on purpose.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { root: `${import.meta.dirname}/../..`, globalSetup: ['test/global-setup.ts'], include: ['test/g8/case.test.ts'] },
});
