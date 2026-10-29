// W2's successor check (docs/superpowers/plans/2026-10-29-w2-backend.md): no v1 test disappears unaccounted for while
// the backend moves to v2. Every test in db/test/v2/baseline-v1.json, measured from vitest's JSON reports before the
// spine, either still runs and passes (same suite, file and title) or has an entry in db/test/v2/successors.json naming
// a test that ran and passed, or a reason it was retired. Reads vitest's reports, never a grep of the sources, so
// .each rows count as the tests they are.
//
// Usage, from the repo root, after running each suite with --reporter=json --outputFile=<file>:
//   node scripts/w2-successors.ts --root=<tree the reports ran in> core=<json> agent=<json> db-v1=<json> db-v2=<json> web=<json>
//   node scripts/w2-successors.ts --write-baseline --root=<tree> core=<json> ...   (SPINE-0 only)
// Exit 1 on any problem.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Test = { suite: string; file: string; title: string };
type Successor = { suite: string; file: string; title?: string };
// An entry without a title covers every baseline test of that file: each must run under the same title in successor.file.
type Entry = { suite: string; file: string; title?: string; successor?: Successor; retired?: string };
type Report = { testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[] };

const repo = path.join(import.meta.dirname, '..');
const BASELINE = path.join(repo, 'db/test/v2/baseline-v1.json');
const SUCCESSORS = path.join(repo, 'db/test/v2/successors.json');
const SUITES = ['core', 'agent', 'db-v1', 'db-v2', 'web'];

const args = process.argv.slice(2);
const writeBaseline = args.includes('--write-baseline');
const root = args.find((a) => a.startsWith('--root='))?.slice('--root='.length);
const reports = args.filter((a) => !a.startsWith('--')).map((a) => a.split('='));
for (const a of args.filter((a) => a.startsWith('--'))) {
  if (a !== '--write-baseline' && !a.startsWith('--root=')) throw new Error(`unknown flag ${a}`);
}
if (!root) throw new Error('--root=<tree the reports ran in> is required');
if (reports.length === 0) throw new Error('no reports given: suite=<json> ...');
for (const [suite, file] of reports) {
  if (!SUITES.includes(suite as string) || !file) throw new Error(`bad report argument ${suite}=${file}: suites are ${SUITES.join(', ')}`);
}

const key = (t: Test) => `${t.suite}|${t.file}|${t.title}`;
const ran = new Map<string, string>();
for (const [suite, file] of reports as [string, string][]) {
  const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
  for (const r of report.testResults) {
    const rel = path.relative(root, r.name);
    for (const a of r.assertionResults) {
      ran.set(key({ suite, file: rel, title: [...a.ancestorTitles, a.title].join(' > ') }), a.status);
    }
  }
}

if (writeBaseline) {
  const tests = [...ran].map(([k, status]) => {
    if (status !== 'passed') throw new Error(`baseline test did not pass: ${k} (${status})`);
    const [suite, file, ...title] = k.split('|');
    return { suite, file, title: title.join('|') } as Test;
  });
  if (tests.length === 0) throw new Error('baseline: the reports hold no tests');
  writeFileSync(BASELINE, `${JSON.stringify(tests, null, 1)}\n`);
  const bySuite = Object.groupBy(tests, (t) => t.suite);
  console.log(`baseline: ${tests.length} tests (${Object.entries(bySuite).map(([s, t]) => `${s} ${t?.length}`).join(', ')})`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Test[];
const entries = (JSON.parse(readFileSync(SUCCESSORS, 'utf8')) as { entries: Entry[] }).entries;
if (baseline.length === 0) throw new Error('the baseline holds no tests');
const passed = (t: Test) => ran.get(key(t)) === 'passed';
const problems: string[] = [];
const used = new Set<Entry>();
let still = 0;
let replaced = 0;
let retired = 0;

for (const t of baseline) {
  if (passed(t)) {
    still++;
    continue;
  }
  const e = entries.find((e) => e.suite === t.suite && e.file === t.file && e.title === t.title) ??
    entries.find((e) => e.suite === t.suite && e.file === t.file && e.title === undefined);
  if (!e) {
    problems.push(`no longer runs and has no entry: ${key(t)}${ran.has(key(t)) ? ` (${ran.get(key(t))})` : ''}`);
    continue;
  }
  used.add(e);
  if (e.retired !== undefined) {
    if (e.retired.trim() === '') problems.push(`retired without a reason: ${key(t)}`);
    else retired++;
    continue;
  }
  if (!e.successor) {
    problems.push(`entry names neither a successor nor a reason: ${key(t)}`);
    continue;
  }
  const s: Test = { suite: e.successor.suite, file: e.successor.file, title: e.successor.title ?? t.title };
  if (passed(s)) replaced++;
  else problems.push(`successor did not run and pass: ${key(t)} -> ${key(s)}`);
}
for (const e of entries) {
  if (!used.has(e)) problems.push(`entry matches no missing baseline test: ${e.suite}|${e.file}|${e.title ?? '(whole file)'}`);
}

for (const p of problems) console.log(`PROBLEM  ${p}`);
console.log(`successors: ${baseline.length} baseline tests; ${still} still run, ${replaced} replaced, ${retired} retired; ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
