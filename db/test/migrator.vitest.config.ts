// The db gates, run against a template built by munshi_migrator (see test/migrator-path.ts). Run by
// test/ms13-migrator.test.ts; by hand: ../node_modules/.bin/vitest run --config test/migrator.vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';

export default defineConfig({
  ...base,
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: [{ find: /^\.\.\/src\/migrate\.ts$/, replacement: fileURLToPath(new URL('./migrator-path.ts', import.meta.url)) }] },
  test: { ...base.test, include: ['test/g*.test.ts', 'test/ms13-migrator.state.ts'] }, // replaces, not merges, the include
});
