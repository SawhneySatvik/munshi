// Proves every gate can fail: runs the suite clean (each named test must pass), then each case of test/sabotage.ts
// alone (its named test must run and fail, and the run must exit non-zero). Reads vitest's JSON report, not its exit
// code alone, so a typo'd filter, "no tests matched" or a harness crash cannot pass for a red.
// Usage: node test/redproof.ts [sabotage-name ...]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES } from './sabotage.ts';

const dbDir = path.join(import.meta.dirname, '..');
const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const outDir = mkdtempSync(path.join(tmpdir(), 'munshi-redproof-'));
let runs = 0;

type Report = { testResults: { assertionResults: { title: string; status: string }[] }[] };

function run(files: string[], sabotage?: string, test?: string) {
  const json = path.join(outDir, `run-${runs++}.json`);
  const args = [vitestBin, 'run', ...files, '--reporter=json', `--outputFile=${json}`];
  if (test) args.push('-t', `^${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  delete env.MUNSHI_SABOTAGE;
  if (sabotage) env.MUNSHI_SABOTAGE = sabotage;
  const child = spawnSync(process.execPath, args, { cwd: dbDir, env, encoding: 'utf8' });
  let report: Report;
  try {
    report = JSON.parse(readFileSync(json, 'utf8')) as Report;
  } catch {
    throw new Error(`vitest wrote no report (exit ${child.status}):\n${child.stdout.slice(-1500)}${child.stderr.slice(-1500)}`);
  }
  const results = report.testResults.flatMap((f) => f.assertionResults);
  return { exit: child.status, results };
}

const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.sabotage)) : CASES;
if (cases.length === 0) throw new Error(`no case named ${only.join(', ')}`);
const problems: string[] = [];

const clean = run([...new Set(cases.map((c) => c.file))]);
for (const c of cases) {
  const status = clean.results.filter((r) => r.title === c.test).map((r) => r.status);
  if (status.join() !== 'passed') problems.push(`clean run: "${c.test}" was ${status.join() || 'not run'}, expected passed`);
}
console.log(`clean    exit ${clean.exit}  ${clean.results.filter((r) => r.status === 'passed').length} of ${clean.results.length} tests passed`);

for (const c of cases) {
  const { exit, results } = run([c.file], c.sabotage, c.test);
  const target = results.filter((r) => r.title === c.test).map((r) => r.status).join();
  const othersRan = results.filter((r) => r.title !== c.test && r.status !== 'skipped' && r.status !== 'pending').length;
  // Under g8-exit-hook the harness fix is removed, so this very run exits 0 despite its failure: that is the lesson.
  const exitOk = c.sabotage === 'g8-exit-hook' ? true : exit !== 0;
  const red = target === 'failed' && othersRan === 0 && exitOk;
  console.log(`${red ? 'RED' : 'NOT RED'}  ${c.sabotage.padEnd(24)} exit ${exit}  ${c.test}: ${target || 'not run'}`);
  if (!red) problems.push(`${c.sabotage}: "${c.test}" was ${target || 'not run'} (exit ${exit}, ${othersRan} other tests ran)`);
}

rmSync(outDir, { recursive: true, force: true });
if (problems.length) {
  console.error(`\nredproof FAILED:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`\nredproof: ${cases.length} of ${cases.length} cases red under sabotage, green when clean`);
