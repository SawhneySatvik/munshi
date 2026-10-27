// MS-13: the hosted migration path. The whole migration set is applied on a fresh embedded cluster as munshi_migrator
// (a non-superuser; only 0001 runs as the cluster admin), then the g* guarantee gates run against that database.
// The runs are child vitest processes under test/migrator.vitest.config.ts, each with its own cluster. The red run
// gives the role superuser: the state check must fail and the process must exit non-zero.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const dbDir = path.join(import.meta.dirname, '..');
const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

type Report = { numPassedTests: number; numFailedTests: number; testResults: { name: string; assertionResults: { title: string; status: string }[] }[] };

function run(files: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-ms13-'));
  const json = path.join(dir, 'report.json');
  try {
    const child = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'test/migrator.vitest.config.ts', ...files, '--reporter=json', `--outputFile=${json}`], {
      cwd: dbDir,
      env: { ...process.env, ...env, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    return { exit: child.status, report: JSON.parse(readFileSync(json, 'utf8')) as Report };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('MS-13 every migration applies as munshi_migrator and every g* gate then passes', () => {
  const { exit, report } = run([]);
  const titles = report.testResults.flatMap((f) => f.assertionResults.map((a) => a.title));
  expect(titles.filter((t) => t.startsWith('MS-13')).length).toBe(2); // the state checks ran, not only the gates
  expect(report.testResults.length).toBe(13); // 12 g* files + the state file
  expect(report.numFailedTests).toBe(0);
  expect(report.numPassedTests).toBeGreaterThan(60);
  expect(exit).toBe(0);
}, 180_000);

it('MS-13 red: a superuser migrator fails the state check and the run exits non-zero', () => {
  const { exit, report } = run(['test/ms13-migrator.state.ts'], { MS13_SUPERUSER_MIGRATOR: '1' });
  const failed = report.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === 'failed');
  expect(failed.map((a) => a.title)).toEqual(['MS-13 the migrator is no superuser, bypasses no RLS and can create no role or database']);
  expect(exit).not.toBe(0);
}, 120_000);
