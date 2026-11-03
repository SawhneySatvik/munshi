// Source-scanning gates for rulings (c) and (d). The database already refuses every write by the agent's role; these keep
// the code from routing around it: packages/agent never holds the app pool or a core writer, the read entry point it
// may use reaches no writer, the acting-member setting is set in one place, and only mintSnapshot writes snap.*.
// Under a b* sabotage a planted file joins the scan (harness-level), and its gate must fail.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../../db/test/v2/sabotage/index.ts';

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
  // A worker runs a script outside the import graph, whatever names it.
  [/\bnew\s+(?:Shared)?Worker\s*\(/, 'a worker'],
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

// The targets of `new URL('…', import.meta.url)`, a file beside the module: each is read as a relative import (a code
// file it names is a module reached; a data file is not). Of an interpolated template, the part before the first `${`.
export function urlTargets(text: string): string[] {
  const found: string[] = [];
  for (const m of uncommented(text).matchAll(/\bnew\s+URL\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*,\s*import\.meta\.url\s*\)/g)) {
    found.push((m[1] ?? m[2] ?? (m[3] as string).split('${')[0]) as string);
  }
  return found;
}

// Into a package's node_modules is not into the package: a link there leads to another package's files.
const throughNodeModules = (target: string) => target.split('/').includes('node_modules');

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
      // The model providers' package, by its manifest's exports: gate B6 holds what lies there to no core, no agent, no
      // database and no app, so B1 only checks that the name leads there.
      else if (spec === AI_PACKAGE) out.push(...aiExportViolations(`${file}: imports ${spec}`, planted.get(AI_MANIFEST) ?? readFileSync(path.join(ROOT, AI_MANIFEST), 'utf8')));
      else if (spec.startsWith('@munshi/') || spec === 'module' || spec === 'node:module' || /^(?!node:)[a-z][a-z0-9+.-]*:/i.test(spec)) {
        out.push(`${file}: imports ${spec}`);
      } else if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = spec.startsWith('/') ? path.relative(ROOT, spec) : path.normalize(path.join(path.dirname(file), spec));
        const found = resolve(target);
        if (throughNodeModules(target)) out.push(`${file}: imports ${spec} (${target}, through node_modules)`);
        else if (!inAgent(target) && !READ_SIDE.includes(found ?? target)) out.push(`${file}: imports ${spec} (${target}, outside ${AGENT})`);
        else if (!found) out.push(`${file}: imports ${spec}, which resolves to no file`);
        else queue.push(found);
      }
    }
    // A URL beside the module that names code is a module reached, by the same rules; one naming data is a read.
    for (const spec of urlTargets(text)) {
      const target = path.normalize(path.join(path.dirname(file), spec));
      const code = [resolve(target)].find((f) => f !== undefined && CODE.test(f));
      if (throughNodeModules(target)) out.push(`${file}: names ${spec} (${target}, through node_modules)`);
      else if (code && !inAgent(code) && !READ_SIDE.includes(code)) out.push(`${file}: names ${spec} (${code}, outside ${AGENT})`);
      else if (code) queue.push(code);
    }
  }
  return out;
}

// packages/ai, the model providers (D-081), is a leaf: node's built-ins, its two libraries, the test runner and its own
// files. No @munshi package (core, its read side and its types included, the agent, config), no database driver, no app,
// no db. Type-only imports count too, and so does every file in it: src, tests, scripts, fixtures, configs.
const AI = 'packages/ai';
const AI_PACKAGE = '@munshi/ai';
const AI_MANIFEST = 'packages/ai/package.json';
const AI_LIBRARIES = ['zod', 'openai', 'vitest', 'vitest/config'];
const AI_DEV_TOOLS = ['@types/node', 'tsx', 'typescript', 'vitest'];

// Every file the manifest's exports name (a string, or nested conditions), each must lie in packages/ai/src.
function aiExportViolations(who: string, manifest: string): string[] {
  const leaves = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : []);
  const targets = leaves((JSON.parse(manifest) as { exports?: unknown }).exports).map((t) => path.normalize(path.join(AI, t)));
  if (targets.length === 0) return [`${who}: ${AI_MANIFEST} exports nothing`];
  return targets.filter((t) => !t.startsWith(`${AI}/src/`) || throughNodeModules(t)).map((t) => `${who}: ${AI_MANIFEST} exports ${t}, outside ${AI}/src`);
}

// The manifest itself: its exports in src, and no dependency but its two libraries and the dev tools.
function aiManifestViolations(manifest: string): string[] {
  const pkg = JSON.parse(manifest) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return [
    ...aiExportViolations(AI_MANIFEST, manifest),
    ...Object.keys(pkg.dependencies ?? {}).filter((d) => !AI_LIBRARIES.includes(d)).map((d) => `${AI_MANIFEST}: depends on ${d}`),
    ...Object.keys(pkg.devDependencies ?? {}).filter((d) => !AI_DEV_TOOLS.includes(d)).map((d) => `${AI_MANIFEST}: depends on ${d} (dev)`),
  ];
}
const named = (text: string) => [...uncommented(text).matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);

export function aiViolations(srcs: Src[]): string[] {
  const out: string[] = [];
  for (const { file, text } of srcs) {
    const code = uncommented(text);
    for (const [re, what] of COMPUTED) if (re.test(code)) out.push(`${file}: ${what}`);
    if (/\bDATABASE_URL\b/.test(text)) out.push(`${file}: names DATABASE_URL (the app's connection)`);
    for (const spec of new Set([...imports(text), ...named(text)])) {
      if (AI_LIBRARIES.includes(spec) || (spec.startsWith('node:') && spec !== 'node:module')) continue;
      const target = spec.startsWith('.') ? path.normalize(path.join(path.dirname(file), spec)) : null;
      if (target?.startsWith(`${AI}/`) && !throughNodeModules(target)) continue;
      out.push(target ? `${file}: imports ${spec} (${target}, outside ${AI})` : `${file}: imports ${spec}`);
    }
    // A URL beside the module: one that names code (or code reached as a directory's index) is an import, held the same.
    for (const spec of urlTargets(text)) {
      const target = path.normalize(path.join(path.dirname(file), spec));
      const candidates = [target, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'].map((e) => target + e), path.join(target, 'index.ts')];
      const code = CODE.test(target) || candidates.some((t) => CODE.test(t) && existsSync(path.join(ROOT, t)));
      if (throughNodeModules(target) || (code && !target.startsWith(`${AI}/`))) out.push(`${file}: names ${spec} (${target}, outside ${AI})`);
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
  expect(planted(`import { generate, type Deps } from '@munshi/ai';`)).toEqual([]); // held by B6, not followed here
  // Through the package's own node_modules is outside it; a worker is refused; a URL beside the module that names code
  // is an import, one that names data is a read.
  expect(planted(`import { recordSale } from '../node_modules/@munshi/core/src/commands.ts';`)).toHaveLength(1);
  expect(planted(`new Worker('./w.js');`)).toHaveLength(1);
  expect(planted(`const u = new URL('../../core/src/commands.ts', import.meta.url);`)).toHaveLength(1);
  // Source text holding a template's `${`, written `$(` here (a plain string may not hold the other spelling).
  const tpl = (t: string) => t.replaceAll('$(', '${');
  expect(planted(tpl('const u = new URL(`../../core/src/$(name}`, import.meta.url);'))).toHaveLength(1); // its index.ts is code
  expect(planted(`const u = new URL('../fixtures/media/bill.png', import.meta.url);`)).toEqual([]);
  expect(urlTargets(tpl('new URL("./a.ts", import.meta.url); new URL(`../b/$(x}.ts`, import.meta.url); new URL(path, base);'))).toEqual(['./a.ts', '../b/']);
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
  // The agent's own node_modules links to core: a relative path through it reaches a writer.
  if (sabotageIs('b1-agent-via-node-modules')) plant('packages/agent/src/planted.ts', `import { recordSale } from '../node_modules/@munshi/core/src/commands.ts';`);
  if (sabotageIs('b1-agent-url-code')) plant('packages/agent/src/planted.ts', `const writer = new URL('../../core/src/commands.ts', import.meta.url);`);
  if (sabotageIs('b1-agent-worker')) plant('packages/agent/src/planted.ts', `new Worker(new URL('./worker.ts', import.meta.url));`);
  // @munshi/ai's manifest pointed at core: the agent's import of it would load core's index.
  if (sabotageIs('b1-ai-exports-core')) plant(AI_MANIFEST, JSON.stringify({ name: '@munshi/ai', exports: { '.': '../core/src/index.ts' } }));
  console.log(`B1 scanned ${srcs.length} files of packages/agent`);
  expect(srcs.map((s) => s.file)).toContain('packages/agent/src/index.ts');
  expect(agentViolations(srcs)).toEqual([]);
});

it('B6 packages/ai imports no @munshi package, no database driver and no app: only node, its libraries and its own files', () => {
  const srcs = walk(AI, true, ['node_modules']);
  const plant = (file: string, text: string) => srcs.push({ file, text });
  if (sabotageIs('b6-ai-imports-core')) plant('packages/ai/src/planted.ts', `import { createAppPool } from '@munshi/core';`);
  if (sabotageIs('b6-ai-imports-core-types')) plant('packages/ai/src/planted.ts', `import type { Cell } from '@munshi/core/read';`);
  if (sabotageIs('b6-ai-imports-agent')) plant('packages/ai/src/planted.ts', `export { ask } from '@munshi/agent';`);
  if (sabotageIs('b6-ai-imports-pg')) plant('packages/ai/src/planted.ts', `import pg from 'pg';`);
  if (sabotageIs('b6-ai-via-app')) plant('packages/ai/src/providers/planted.ts', `import { appPool } from '../../../../apps/web/lib/server/db.ts';`);
  if (sabotageIs('b6-ai-via-core-path')) plant('packages/ai/test/planted.test.ts', `import { recordSale } from '../../core/src/commands.ts';`);
  if (sabotageIs('b6-ai-computed-import')) plant('packages/ai/fixtures/planted.mts', 'const core = await import(`@munshi/core`);');
  if (sabotageIs('b6-ai-via-node-modules')) plant('packages/ai/src/planted.ts', `import { z } from '../node_modules/zod/index.js';`);
  if (sabotageIs('b6-ai-url-code')) plant('packages/ai/src/planted.ts', `const writer = new URL('../../core/src/commands', import.meta.url);`);
  if (sabotageIs('b6-ai-worker')) plant('packages/ai/src/planted.ts', `new Worker(new URL('./worker.ts', import.meta.url));`);
  let manifest = readFileSync(path.join(ROOT, AI_MANIFEST), 'utf8');
  if (sabotageIs('b6-ai-exports-core')) manifest = JSON.stringify({ ...JSON.parse(manifest), exports: { '.': '../core/src/index.ts' } });
  if (sabotageIs('b6-ai-depends-core')) manifest = JSON.stringify({ ...JSON.parse(manifest), dependencies: { '@munshi/core': 'workspace:*', zod: '4.6.7' } });
  console.log(`B6 scanned ${srcs.length} files of packages/ai and its manifest`);
  expect(srcs.map((s) => s.file)).toEqual(expect.arrayContaining(['packages/ai/src/index.ts', 'packages/ai/src/providers/generate.ts', 'packages/ai/vitest.config.ts']));
  expect(aiViolations(srcs)).toEqual([]);
  expect(aiManifestViolations(manifest)).toEqual([]);
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
    srcs.push({ file: 'apps/web/lib/planted.ts', text: `await c.query("insert into snap.snapshot (tenant_id, query_name, purpose, columns, rows) values ($1, 'x', 'display', $2, $3)");` });
  }
  if (sabotageIs('b4-jobs-insert')) {
    srcs.push({ file: 'packages/core/src/jobs-core.ts', text: `await c.query('insert into snap.snapshot (tenant_id, purpose) values ($1, $2)');` });
  }
  const write = /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|copy|merge\s+into)\s+(only\s+)?"?snap"?\s*\.\s*"?snapshot\b/gi;
  const hits = srcs.flatMap((s) => [...s.text.matchAll(write)].map((m) => ({ file: s.file, at: m.index as number, text: s.text })));
  // The one other write: the jobs purge deletes old unpinned snapshots (BLUEPRINT §4.4, J2). A delete mints no number;
  // the pin's key keeps every snapshot a shown number still cites.
  const isPurge = (h: (typeof hits)[number]) => {
    const start = h.text.indexOf('async function purgeSnapshots(');
    return h.file === 'packages/core/src/jobs-core.ts' && /^delete\s+from/i.test(h.text.slice(h.at)) && start > -1 && h.at > start && h.at < h.text.indexOf('\n}\n', start);
  };
  expect(hits.filter(isPurge)).toHaveLength(1);
  const mints = hits.filter((h) => !isPurge(h));
  expect(mints.map((h) => h.file)).toEqual(['packages/core/src/snapshots.ts']); // one row per snapshot, its cells as JSON
  for (const h of mints) {
    const start = h.text.indexOf('export async function mintIn(');
    const end = h.text.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(h.at > start && h.at < end, 'a snap.* write outside mintIn').toBe(true);
  }
});
