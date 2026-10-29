// Source-scanning gates for rulings (c) and (d). The database already refuses every write by the agent's role; these keep
// the code from routing around it: packages/agent never holds the app pool or a core writer, the read entry point it
// may use reaches no writer, the acting-member setting is set in one place, and only mintSnapshot writes snap.*.
// Under a b* sabotage a planted file joins the scan (harness-level), and its gate must fail.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../../db/test/sabotage.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
type Src = { file: string; text: string }; // file relative to the repo root

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SHIPPED_SKIP = ['node_modules', '.next', 'dist', 'fixtures', 'coverage'];
const AGENT_SKIP = ['node_modules']; // the agent's fixtures, tests and any built output are scanned too

function walk(rel: string, tests: boolean, skip: string[], root = ROOT): Src[] {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return CODE.test(rel) ? [{ file: rel, text: readFileSync(abs, 'utf8') }] : [];
  return readdirSync(abs).flatMap((name) => {
    if (skip.includes(name)) return [];
    if (!tests && (name === 'test' || /\.test\.tsx?$/.test(name))) return [];
    return walk(path.join(rel, name), tests, skip, root);
  });
}

// Every non-test source that ships: the packages, the app, the database runner and seed, the scripts.
const shipped = () =>
  [
    ...readdirSync(path.join(ROOT, 'packages')).flatMap((p) => walk(`packages/${p}`, false, SHIPPED_SKIP)),
    ...walk('apps', false, SHIPPED_SKIP),
    ...walk('db/src', false, SHIPPED_SKIP),
    ...walk('db/seed', false, SHIPPED_SKIP),
    ...walk('scripts', false, SHIPPED_SKIP),
  ];

// Value imports only: `import type` / `export type` are erased and carry no code.
export function imports(text: string): string[] {
  const found: string[] = [];
  const forms = [
    /\bimport\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*()['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*()['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of forms) for (const m of text.matchAll(re)) if (!m[1]) found.push(m[2] as string);
  return found;
}

// A module the scanner cannot name: a computed import() or require(), or a require made at run time.
const COMPUTED: [RegExp, string][] = [
  [/\bimport\s*\(\s*(?!['"][^'"`]*['"]\s*[,)])/, 'a computed import()'],
  [/\brequire\s*\(\s*(?!['"][^'"`]*['"]\s*\))/, 'a computed require()'],
  [/\bcreateRequire\b/, 'createRequire'],
];

// The text with its comments blanked, so prose in a comment ("safe to import (…)") is not read as code. Strings,
// template literals and regex literals are kept as they are, and a slash that is not a comment is read as a regex up to
// the end of its line: a misreading can only keep a comment (a false alarm), never blank code.
export function uncommented(t: string): string {
  const quoted = (j: number, q: string) => {
    for (j++; j < t.length && t[j] !== q; j++) if (t[j] === '\\') j++;
    return j + 1;
  };
  const template = (j: number): number => {
    for (j++; j < t.length; j++) {
      if (t[j] === '\\') j++;
      else if (t[j] === '`') return j + 1;
      else if (t[j] === '$' && t[j + 1] === '{') j = expression(j + 2) - 1;
    }
    return j;
  };
  const expression = (j: number): number => {
    for (let depth = 0; j < t.length; j++) {
      const c = t[j] as string;
      if (c === "'" || c === '"') j = quoted(j, c) - 1;
      else if (c === '`') j = template(j) - 1;
      else if (c === '{') depth++;
      else if (c === '}' && depth-- === 0) return j + 1;
    }
    return j;
  };
  let out = '';
  for (let i = 0; i < t.length; ) {
    const c = t[i] as string;
    let j = i + 1;
    if (c === '/' && (t[i + 1] === '/' || t[i + 1] === '*')) {
      const end = t[i + 1] === '/' ? t.indexOf('\n', i) : t.indexOf('*/', i + 2) + 2;
      j = end < i + 2 ? t.length : end;
      out += t.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    if (c === "'" || c === '"') j = quoted(i, c);
    else if (c === '`') j = template(i);
    else if (c === '\\') j = i + 2;
    else if (c === '/') {
      let k = i + 1;
      for (let inClass = false; k < t.length && t[k] !== '\n'; k++) {
        if (t[k] === '\\') k++;
        else if (t[k] === '[') inClass = true;
        else if (t[k] === ']') inClass = false;
        else if (t[k] === '/' && !inClass) break;
      }
      if (t[k] === '/') j = k + 1;
    }
    out += t.slice(i, j);
    i = j;
  }
  return out;
}

const AGENT = 'packages/agent';
const inAgent = (file: string) => file.startsWith(`${AGENT}/`);
// Outside itself, packages/agent may reach only core's read entry point and what that imports (gate B2 holds the set).
// numbers.ts (the shared number detector and span parser) and time.ts (its dates) joined the read side.
const READ_SIDE = ['packages/core/src/read.ts', 'packages/core/src/money.ts', 'packages/core/src/errors.ts', 'packages/core/src/numbers.ts', 'packages/core/src/time.ts'];
const coreExports = JSON.parse(readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8')).exports as Record<string, string>;
const READ_ENTRY = path.normalize(path.join('packages/core', coreExports['./read'] as string));

// What packages/agent may not reach: core except its read entry point, the db package, the app, the app's connection
// string. Imports are followed to their files from every agent file; a relative import that resolves to nothing, a
// computed one and createRequire are violations too, since the scanner cannot see where they lead. The agent's files are
// the roots; a given file outside the agent stands in for that file on disk, and is scanned only if reached.
export function agentViolations(srcs: Src[]): string[] {
  const out: string[] = [];
  const planted = new Map(srcs.map((s) => [s.file, s.text]));
  const isFile = (f: string) => planted.has(f) || (existsSync(path.join(ROOT, f)) && statSync(path.join(ROOT, f)).isFile());
  const resolve = (target: string) =>
    [target, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'].map((e) => target + e), target.replace(/\.js$/, '.ts'), path.join(target, 'index.ts')].find(isFile);
  const queue = srcs.filter((s) => inAgent(s.file)).map((s) => s.file);
  const seen = new Set<string>();
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = planted.get(file) ?? readFileSync(path.join(ROOT, file), 'utf8');
    const code = uncommented(text);
    for (const [re, what] of COMPUTED) if (re.test(code)) out.push(`${file}: ${what}`);
    if (/\bDATABASE_URL\b/.test(text)) out.push(`${file}: names DATABASE_URL (the app's connection)`);
    for (const spec of imports(text)) {
      if (spec === '@munshi/core/read') queue.push(READ_ENTRY);
      else if (spec === '@munshi/agent' || spec.startsWith('@munshi/agent/')) continue;
      else if (spec.startsWith('@munshi/') || spec === 'module' || spec === 'node:module' || /^(?!node:)[a-z][a-z0-9+.-]*:/i.test(spec)) {
        out.push(`${file}: imports ${spec}`);
      } else if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = spec.startsWith('/') ? path.relative(ROOT, spec) : path.normalize(path.join(path.dirname(file), spec));
        const found = resolve(target);
        if (!inAgent(target) && !READ_SIDE.includes(found ?? target)) out.push(`${file}: imports ${spec} (${target}, outside ${AGENT})`);
        else if (!found) out.push(`${file}: imports ${spec}, which resolves to no file`);
        else queue.push(found);
      }
    }
  }
  return out;
}

it('B0 the import scanner sees every form of import, follows them to their files, and lets the read entry point through', () => {
  const planted = (text: string) => agentViolations([{ file: 'packages/agent/src/x.ts', text }]);
  expect(planted(`import { createAppPool } from '@munshi/core';`)).toHaveLength(1);
  expect(planted(`import {\n  decide,\n  withTx,\n} from "@munshi/core";`)).toHaveLength(1);
  expect(planted(`export * from '@munshi/core/src/commands.ts';`)).toHaveLength(1);
  expect(planted(`const m = await import('@munshi/core');`)).toHaveLength(1);
  expect(planted(`const m = require('@munshi/db/migrate');`)).toHaveLength(1);
  expect(planted(`import '../../core/src/pool.ts';`)).toHaveLength(1);
  expect(planted(`const url = process.env.DATABASE_URL;`)).toHaveLength(1);
  // The review's forms: a directory import of core, the app's pool, a template-literal import(), createRequire.
  expect(planted(`import { createAppPool, runCommand } from '../../core';`)).toHaveLength(1);
  expect(planted(`import { pool } from '../../../apps/web/lib/db.ts';`)).toHaveLength(1);
  expect(planted('const m = await import(`@munshi/core`);')).toHaveLength(1);
  expect(planted(`const r = createRequire(import.meta.url); const m = r('@munshi/core');`)).toHaveLength(1);
  expect(planted(`import * as mod from 'node:module';`)).toHaveLength(1);
  expect(planted(`const name = '@munshi/core'; const m = await import(name);`)).toHaveLength(1);
  expect(planted(`const m = await import('@munshi/' + 'core');`)).toHaveLength(1);
  expect(planted(`const m = require(name);`)).toHaveLength(1);
  expect(planted(`import x from '${ROOT}/packages/core/src/index.ts';`)).toHaveLength(1);
  expect(planted(`import x from 'file:///srv/packages/core/src/index.ts';`)).toHaveLength(1);
  expect(planted(`import { helper } from './nowhere.ts';`)).toHaveLength(1);
  // A comment is prose, not code; a string, template or regex holding `//` hides no code after it.
  expect(planted(`// safe for the agent to import (the gate allows it)\n/* nor require (sic) */ const a = 1;`)).toEqual([]);
  expect(planted(`const u = 'http://x'; const m = await import(name);`)).toHaveLength(1);
  expect(planted(`const u = \`http://\${host}//\`; const m = await import(name);`)).toHaveLength(1);
  expect(planted(`const r = /[//]/; const m = await import(name);`)).toHaveLength(1);
  expect(planted(`const r = /\\/\\//; const m = await import(name);`)).toHaveLength(1);
  expect(planted(`const half = total / 2; const m = await import(name); // halve`)).toHaveLength(1);
  // Followed: were the read entry point to import a writer, the agent would reach it through '@munshi/core/read'.
  const reached = agentViolations([
    { file: 'packages/agent/src/a.ts', text: `import { resolveRef } from '@munshi/core/read';` },
    { file: 'packages/core/src/read.ts', text: `import { withTx } from './session.ts';` },
  ]);
  expect(reached).toEqual(['packages/core/src/read.ts: imports ./session.ts (packages/core/src/session.ts, outside packages/agent)']);
  const relative = agentViolations([
    { file: 'packages/agent/src/a.ts', text: `import { resolveRef } from '../../core/src/read.ts';` },
    { file: 'packages/core/src/read.ts', text: `import { withTx } from './session.ts';` },
  ]);
  expect(relative).toEqual(reached);
  expect(planted(`import type { Session } from '@munshi/core';`)).toEqual([]);
  expect(planted(`import { resolveRef, renderCell } from '@munshi/core/read';`)).toEqual([]);
  expect(planted(`import pg from 'pg'; import { z } from 'zod'; const fs = await import('node:fs');`)).toEqual([]);
  // The walk takes the agent's fixtures, tests and .mts/.cjs files, and skips only node_modules.
  const tmp = mkdtempSync(path.join(tmpdir(), 'munshi-b0-'));
  try {
    for (const f of ['fixtures/f.ts', 'src/m.mts', 'src/c.cjs', 'test/t.test.ts', 'dist/index.js', 'node_modules/n/index.ts', 'fixtures/a.json']) {
      mkdirSync(path.dirname(path.join(tmp, AGENT, f)), { recursive: true });
      writeFileSync(path.join(tmp, AGENT, f), '');
    }
    const files = walk(AGENT, true, AGENT_SKIP, tmp).map((s) => s.file.slice(AGENT.length + 1));
    expect(files.sort()).toEqual(['dist/index.js', 'fixtures/f.ts', 'src/c.cjs', 'src/m.mts', 'test/t.test.ts']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

it('B1 packages/agent imports no app pool, no core writer and no db, and never names the app connection', () => {
  const srcs = walk(AGENT, true, AGENT_SKIP);
  const plant = (file: string, text: string) => srcs.push({ file, text });
  if (sabotageIs('b1-agent-imports-pool')) plant('packages/agent/src/planted.ts', `import { createAppPool } from '@munshi/core';`);
  if (sabotageIs('b1-agent-imports-command')) plant('packages/agent/src/tools/planted.ts', `import { recordSale } from '../../../core/src/commands.ts';`);
  if (sabotageIs('b1-agent-database-url')) plant('packages/agent/src/planted.ts', `new pg.Pool({ connectionString: process.env.DATABASE_URL });`);
  if (sabotageIs('b1-agent-dir-import')) plant('packages/agent/src/planted.ts', `import { createAppPool, runCommand } from '../../core';`);
  if (sabotageIs('b1-agent-via-app')) plant('packages/agent/src/planted.ts', `import { appPool } from '../../../apps/web/lib/server/db.ts';`);
  if (sabotageIs('b1-agent-computed-import')) plant('packages/agent/fixtures/planted.mts', 'const core = await import(`@munshi/core`);');
  if (sabotageIs('b1-agent-create-require')) plant('packages/agent/src/planted.ts', `const core = createRequire(import.meta.url)('@munshi/core');`);
  console.log(`B1 scanned ${srcs.length} files of packages/agent`);
  expect(srcs.map((s) => s.file)).toContain('packages/agent/src/index.ts');
  expect(agentViolations(srcs)).toEqual([]);
});

it('B2 @munshi/core/read reaches only read.ts, money.ts and errors.ts, and none writes or sets context', () => {
  const read = (file: string) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    return sabotageIs('b2-read-imports-writer') && file.endsWith('read.ts') ? `import { withTx } from './session.ts';\n${text}` : text;
  };
  const reached = new Set<string>();
  const visit = (file: string) => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const spec of imports(read(file))) if (spec.startsWith('.')) visit(path.normalize(path.join(path.dirname(file), spec)));
  };
  visit('packages/core/src/read.ts');
  expect([...reached].sort()).toEqual([
    'packages/core/src/errors.ts',
    'packages/core/src/money.ts',
    'packages/core/src/numbers.ts',
    'packages/core/src/read.ts',
    'packages/core/src/time.ts',
  ]);
  for (const file of reached) expect(read(file), file).not.toMatch(/insert\s+into|update\s+\w+(\.\w+)?\s+set|delete\s+from|set_config|withTx|\.connect\(/i);
});

it('B3 only withTx in packages/core/src/session.ts names the acting-member setting', () => {
  const srcs = shipped();
  if (sabotageIs('b3-actor-set-elsewhere')) {
    srcs.push({ file: 'db/seed/planted.ts', text: `await c.query("select set_config('munshi.actor_id', $1, true)", [ownerId]);` });
  }
  const hits = srcs.flatMap((s) => [...s.text.matchAll(/munshi\.actor_id/g)].map((m) => ({ file: s.file, at: m.index as number, text: s.text })));
  console.log(`B3 scanned ${srcs.length} shipped source files; the setting is named ${hits.length} time(s)`);
  expect(srcs.length).toBeGreaterThan(10);
  expect(hits.map((h) => h.file)).toEqual(['packages/core/src/session.ts']);
  const h = hits[0] as { at: number; text: string };
  const start = h.text.indexOf('export async function withTx<');
  expect(start).toBeGreaterThan(-1);
  expect(h.at > start && h.at < h.text.indexOf('\n}\n', start), 'the setting is named outside withTx').toBe(true);
});

it('B4 only mintSnapshot writes snap.*', () => {
  const srcs = shipped();
  if (sabotageIs('b4-snap-written-elsewhere')) {
    srcs.push({ file: 'apps/web/lib/planted.ts', text: `await c.query('insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num) values ($1, $2, 0, $3, $4, $5)');` });
  }
  if (sabotageIs('b4-jobs-insert')) {
    srcs.push({ file: 'packages/core/src/jobs-core.ts', text: `await c.query('insert into snap.snapshot (tenant_id, purpose) values ($1, $2)');` });
  }
  const write = /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|copy|merge\s+into)\s+(only\s+)?"?snap"?\s*\.\s*"?snapshot(_cell)?\b/gi;
  const hits = srcs.flatMap((s) => [...s.text.matchAll(write)].map((m) => ({ file: s.file, at: m.index as number, text: s.text })));
  // The one other write: the jobs purge deletes old unpinned snapshots (BLUEPRINT §4.4, J2). A delete mints no number;
  // the pin's key keeps every snapshot a shown number still cites.
  const isPurge = (h: (typeof hits)[number]) => {
    const start = h.text.indexOf('async function purgeSnapshots(');
    return h.file === 'packages/core/src/jobs-core.ts' && /^delete\s+from/i.test(h.text.slice(h.at)) && start > -1 && h.at > start && h.at < h.text.indexOf('\n}\n', start);
  };
  expect(hits.filter(isPurge)).toHaveLength(1);
  const mints = hits.filter((h) => !isPurge(h));
  expect(mints.map((h) => h.file)).toEqual(['packages/core/src/snapshots.ts', 'packages/core/src/snapshots.ts']);
  for (const h of mints) {
    const start = h.text.indexOf('export async function mintIn(');
    const end = h.text.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(h.at > start && h.at < end, 'a snap.* write outside mintIn').toBe(true);
  }
});
