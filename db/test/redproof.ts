// Proves every gate can fail: runs the suite clean (each named test must pass), then each case of test/sabotage.ts
// alone (its named test must run and fail, and the run must exit non-zero). Reads vitest's JSON report, not its exit
// code alone, so a typo'd filter, "no tests matched" or a harness crash cannot pass for a red; and reads the sabotage
// report, so a sabotage that failed to apply or never applied is an ERROR, never a red. A full run first runs the
// planted cases (sabotages that cannot apply) and requires an ERROR for each: the ERROR branch is red-proved every run.
// Usage: node test/redproof.ts [sabotage-name ...]   (exit 1 on any NOT RED or ERROR)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, type Case, PLANTED } from './sabotage.ts';

const repoRoot = path.join(import.meta.dirname, '..', '..');
const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const outDir = mkdtempSync(path.join(tmpdir(), 'munshi-redproof-'));
let runs = 0;

type Report = { testResults: { assertionResults: { title: string; status: string }[] }[] };

function run(dir: string, files: string[], sabotage?: string, test?: string) {
  const n = runs++;
  const json = path.join(outDir, `run-${n}.json`);
  const sabotageLog = path.join(outDir, `sabotage-${n}.log`);
  const args = [vitestBin, 'run', ...files, '--reporter=json', `--outputFile=${json}`];
  if (test) args.push('-t', `^${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', MUNSHI_SABOTAGE_REPORT: sabotageLog };
  delete env.MUNSHI_SABOTAGE;
  if (sabotage) env.MUNSHI_SABOTAGE = sabotage;
  const child = spawnSync(process.execPath, args, { cwd: path.join(repoRoot, dir), env, encoding: 'utf8' });
  const log = existsSync(sabotageLog) ? readFileSync(sabotageLog, 'utf8').split('\n').filter(Boolean) : [];
  let report: Report | undefined;
  try {
    report = JSON.parse(readFileSync(json, 'utf8')) as Report;
  } catch {
    // no report: judged by the caller (ERROR when a sabotage failed, NOT RED otherwise)
  }
  const results = report?.testResults.flatMap((f) => f.assertionResults) ?? [];
  const tail = report ? '' : `vitest wrote no report (exit ${child.status}):\n${child.stdout.slice(-1500)}${child.stderr.slice(-1500)}`;
  return { exit: child.status, results, log, tail };
}

type Outcome = 'RED' | 'NOT RED' | 'ERROR';

function judge(c: Case): { outcome: Outcome; line: string } {
  const { exit, results, log, tail } = run(c.dir ?? 'db', [c.file], c.sabotage, c.test);
  const failed = log.filter((l) => l.startsWith('failed '));
  const applied = log.filter((l) => l === `applied ${c.sabotage}`).length;
  if (failed.length || applied === 0) {
    const why = failed.length ? `failed to apply: ${failed.join('; ').slice(0, 300)}` : 'never applied';
    return { outcome: 'ERROR', line: `exit ${exit}  sabotage ${why}` };
  }
  const target = results.filter((r) => r.title === c.test).map((r) => r.status).join();
  const othersRan = results.filter((r) => r.title !== c.test && r.status !== 'skipped' && r.status !== 'pending').length;
  // Under g8-exit-hook the harness fix is removed, so this very run exits 0 despite its failure: that is the lesson.
  const exitOk = c.sabotage === 'g8-exit-hook' ? true : exit !== 0;
  const red = target === 'failed' && othersRan === 0 && exitOk;
  const line = `exit ${exit}  ${c.test}: ${target || 'not run'}${othersRan ? ` (${othersRan} other tests ran)` : ''}${tail ? `\n${tail}` : ''}`;
  return { outcome: red ? 'RED' : 'NOT RED', line };
}

const only = process.argv.slice(2);
const cases = only.length ? [...CASES, ...PLANTED].filter((c) => only.includes(c.sabotage)) : CASES;
const unknown = only.filter((n) => !cases.some((c) => c.sabotage === n));
if (cases.length === 0 || unknown.length) throw new Error(`no case named ${unknown.join(', ') || only.join(', ')}`);
const problems: string[] = [];

if (!only.length) {
  for (const c of PLANTED) {
    const { outcome, line } = judge(c);
    console.log(`SELFTEST ${outcome === 'ERROR' ? 'ok    ' : 'BROKEN'}  ${c.sabotage.padEnd(28)} ${outcome}  ${line}`);
    if (outcome !== 'ERROR') problems.push(`self-test: planted ${c.sabotage} was ${outcome}, expected ERROR`);
  }
}

for (const dir of [...new Set(cases.map((c) => c.dir ?? 'db'))]) {
  const inDir = cases.filter((c) => (c.dir ?? 'db') === dir);
  const clean = run(dir, [...new Set(inDir.map((c) => c.file))]);
  for (const c of inDir) {
    const status = clean.results.filter((r) => r.title === c.test).map((r) => r.status);
    if (status.join() !== 'passed') problems.push(`clean run (${dir}): "${c.test}" was ${status.join() || 'not run'}, expected passed`);
  }
  if (clean.log.length) problems.push(`clean run (${dir}) reported a sabotage: ${clean.log.join('; ')}`);
  const passed = clean.results.filter((r) => r.status === 'passed').length;
  console.log(`clean    ${dir.padEnd(14)} exit ${clean.exit}  ${passed} of ${clean.results.length} tests passed${clean.tail ? `\n${clean.tail}` : ''}`);
}

const tally: Record<Outcome, number> = { RED: 0, 'NOT RED': 0, ERROR: 0 };
for (const c of cases) {
  const { outcome, line } = judge(c);
  tally[outcome]++;
  console.log(`${outcome.padEnd(7)}  ${c.sabotage.padEnd(28)} ${line}`);
  if (outcome !== 'RED') problems.push(`${c.sabotage}: ${outcome}  ${line}`);
}

rmSync(outDir, { recursive: true, force: true });
const summary = `${tally.RED} RED, ${tally['NOT RED']} NOT RED, ${tally.ERROR} ERROR of ${cases.length} cases`;
if (problems.length) {
  console.error(`\nredproof FAILED (${summary}):\n${problems.join('\n')}`);
  process.exit(1);
}
const selftest = only.length ? '' : `; self-test: ${PLANTED.length} planted unappliable sabotages reported ERROR`;
console.log(`\nredproof: ${summary}; green when clean${selftest}`);
