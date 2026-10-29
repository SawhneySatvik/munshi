// G8 on v2: a failing test run exits non-zero despite embedded-postgres's exit hook, and a passing one exits 0. Each
// child is a whole vitest run on the v2 global setup (test/v2/g8/vitest.config.ts).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';

const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

function child(file: 'pass' | 'fail') {
  const run = spawnSync(process.execPath, [vitestBin, 'run', `test/v2/g8/${file}.test.ts`, '--config', 'test/v2/g8/vitest.config.ts'], {
    cwd: path.join(import.meta.dirname, '..', '..'),
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

it('G8 a failing v2 test run exits non-zero, a passing one exits 0', () => {
  const failing = child('fail');
  expect(failing.out).toMatch(/Tests\s+1 failed/);
  expect(failing.status).not.toBe(0);
  const passing = child('pass');
  expect(passing.out).toMatch(/Tests\s+1 passed/);
  expect(passing.status).toBe(0);
});
