// Proves every gate can fail: runs the suite clean (each named test must pass), then each case of test/v2/sabotage/
// alone (its named test must run and fail, and the run must exit non-zero). Reads vitest's JSON report, not its exit
// code alone, so a typo'd filter, "no tests matched" or a harness crash cannot pass for a red; and reads the sabotage
// report, so a sabotage that failed to apply or never applied is an ERROR, never a red. A full run first runs the
// planted cases (sabotages that cannot apply) and requires an ERROR for each: the ERROR branch is red-proved every run.
// The cases are test/v2/sabotage/'s (db/schema on PG17, and the packages' own gates, each in its package).
// --only=v2 is accepted and selects the same set.
// Usage: node test/redproof.ts [--only=v2] [sabotage-name ...]   (exit 1 on any NOT RED or ERROR)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Case } from './v2/sabotage/case.ts';
import { CASES as V2_CASES, PLANTED as V2_PLANTED } from './v2/sabotage/index.ts';

const repoRoot = path.join(import.meta.dirname, '..', '..');
const vitestBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const outDir = mkdtempSync(path.join(tmpdir(), 'munshi-redproof-'));
let runs = 0;

type Report = { testResults: { name: string; assertionResults: { title: string; status: string }[] }[] };

function run(dir: string, files: string[], sabotage?: string, test?: string, config?: string) {
  const n = runs++;
  const json = path.join(outDir, `run-${n}.json`);
  const sabotageLog = path.join(outDir, `sabotage-${n}.log`);
  const args = [vitestBin, 'run', ...files, '--reporter=json', `--outputFile=${json}`];
  if (test) args.push('-t', `^${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  if (config) args.push('--config', config);
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
  const results = report?.testResults.flatMap((f) => f.assertionResults.map((a) => ({ ...a, file: f.name }))) ?? [];
  const tail = report ? '' : `vitest wrote no report (exit ${child.status}):\n${child.stdout.slice(-1500)}${child.stderr.slice(-1500)}`;
  return { exit: child.status, results, log, tail };
}

type Outcome = 'RED' | 'NOT RED' | 'ERROR';

function judge(c: Case): { outcome: Outcome; line: string } {
  const { exit, results, log, tail } = run(c.dir ?? 'db', [c.file], c.sabotage, c.test, c.config);
  const failed = log.filter((l) => l.startsWith('failed '));
  const applied = log.filter((l) => l === `applied ${c.sabotage}`).length;
  if (failed.length || applied === 0) {
    const why = failed.length ? `failed to apply: ${failed.join('; ').slice(0, 300)}` : 'never applied';
    return { outcome: 'ERROR', line: `exit ${exit}  sabotage ${why}` };
  }
  const target = results.filter((r) => r.title === c.test).map((r) => r.status).join();
  const othersRan = results.filter((r) => r.title !== c.test && r.status !== 'skipped' && r.status !== 'pending').length;
  // Under g8-exit-hook the harness fix is removed, so this very run exits 0 despite its failure: that is the lesson.
  const exitOk = c.sabotage === 'g8-exit-hook' || c.sabotage === 'v2-g8-exit-hook' ? true : exit !== 0;
  const red = target === 'failed' && othersRan === 0 && exitOk;
  const line = `exit ${exit}  ${c.test}: ${target || 'not run'}${othersRan ? ` (${othersRan} other tests ran)` : ''}${tail ? `\n${tail}` : ''}`;
  return { outcome: red ? 'RED' : 'NOT RED', line };
}

const SETS = { v2: { cases: V2_CASES, planted: V2_PLANTED } };

const args = process.argv.slice(2);
let set: keyof typeof SETS | undefined;
const only: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === '--only' || arg.startsWith('--only=')) {
    const value = arg === '--only' ? args[++i] : arg.slice('--only='.length);
    if (value !== 'v2') throw new Error(`--only takes v2, not ${value ?? 'nothing'}`);
    if (set) throw new Error('--only is given twice');
    set = value;
  } else if (arg.startsWith('-')) {
    throw new Error(`unknown option ${arg}`);
  } else {
    only.push(arg);
  }
}
const sets = [SETS.v2];
const all = sets.flatMap((s) => s.cases);
const planted = sets.flatMap((s) => s.planted);
const cases = only.length ? [...all, ...planted].filter((c) => only.includes(c.sabotage)) : all;
const unknown = only.filter((n) => !cases.some((c) => c.sabotage === n));
if (cases.length === 0 || unknown.length) throw new Error(`no case named ${unknown.join(', ') || only.join(', ')}`);
const problems: string[] = [];

if (!only.length) {
  for (const c of planted) {
    const { outcome, line } = judge(c);
    console.log(`SELFTEST ${outcome === 'ERROR' ? 'ok    ' : 'BROKEN'}  ${c.sabotage.padEnd(28)} ${outcome}  ${line}`);
    if (outcome !== 'ERROR') problems.push(`self-test: planted ${c.sabotage} was ${outcome}, expected ERROR`);
  }
}

// One clean run per directory, as before, and one more for v2's cases, which need the v2 config.
const cleanGroup = (c: Case) => ({ dir: c.dir ?? 'db', config: c.config });
const groups = [...new Set(cases.map((c) => JSON.stringify(cleanGroup(c))))];
for (const group of groups) {
  const { dir, config } = JSON.parse(group) as { dir: string; config?: string };
  const label = config ? `${dir} (${config})` : dir;
  const inGroup = cases.filter((c) => JSON.stringify(cleanGroup(c)) === group);
  const clean = run(dir, [...new Set(inGroup.map((c) => c.file))], undefined, undefined, config);
  for (const c of inGroup) {
    // Only the case's own file counts; a file vitest re-ran (a worker lost under load) reports its tests again, and a
    // test that passed every time it ran is passed.
    const status = clean.results.filter((r) => r.title === c.test && r.file.endsWith(`/${c.file}`)).map((r) => r.status);
    if (status.length === 0 || status.some((st) => st !== 'passed')) problems.push(`clean run (${label}): "${c.test}" was ${status.join() || 'not run'}, expected passed`);
    else if (status.length > 1) console.log(`note     "${c.test.slice(0, 80)}" ran ${status.length} times in the clean run, passing each time`);
  }
  if (clean.log.length) problems.push(`clean run (${label}) reported a sabotage: ${clean.log.join('; ')}`);
  const passed = clean.results.filter((r) => r.status === 'passed').length;
  console.log(`clean    ${label.padEnd(14)} exit ${clean.exit}  ${passed} of ${clean.results.length} tests passed${clean.tail ? `\n${clean.tail}` : ''}`);
}

const tally: Record<Outcome, number> = { RED: 0, 'NOT RED': 0, ERROR: 0 };
const bySet = { v2: { ...tally } };
for (const c of cases) {
  const { outcome, line } = judge(c);
  tally[outcome]++;
  bySet.v2[outcome]++;
  console.log(`${outcome.padEnd(7)}  ${c.sabotage.padEnd(28)} ${line}`);
  if (outcome !== 'RED') problems.push(`${c.sabotage}: ${outcome}  ${line}`);
}

rmSync(outDir, { recursive: true, force: true });
const count = (t: Record<Outcome, number>) => `${t.RED} RED, ${t['NOT RED']} NOT RED, ${t.ERROR} ERROR`;
const perSet = [`v2 ${count(bySet.v2)}`];
const summary = `${count(tally)} of ${cases.length} cases (${perSet.join('; ')})`;
if (problems.length) {
  console.error(`\nredproof FAILED (${summary}):\n${problems.join('\n')}`);
  process.exit(1);
}
const selftest = only.length ? '' : `; self-test: ${planted.length} planted unappliable sabotages reported ERROR`;
console.log(`\nredproof: ${summary}; green when clean${selftest}`);
