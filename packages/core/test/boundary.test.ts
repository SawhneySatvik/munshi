// Source-scanning gates for rulings (c) and (d). The database already refuses every write by the agent's role; these keep
// the code from routing around it: packages/agent never holds the app pool or a core writer, the read entry point it
// may use reaches no writer, the acting-member setting is set in one place, and only mintSnapshot writes snap.*.
// Under a b* sabotage a planted file joins the scan (harness-level), and its gate must fail.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../../db/test/sabotage.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
type Src = { file: string; text: string }; // file relative to the repo root

function walk(rel: string, tests: boolean): Src[] {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.(ts|tsx|js|mjs|cjs)$/.test(rel) ? [{ file: rel, text: readFileSync(abs, 'utf8') }] : [];
  return readdirSync(abs).flatMap((name) => {
    if (['node_modules', '.next', 'dist', 'fixtures', 'coverage'].includes(name)) return [];
    if (!tests && (name === 'test' || /\.test\.tsx?$/.test(name))) return [];
    return walk(path.join(rel, name), tests);
  });
}

// Every non-test source that ships: the packages, the app, the database runner and seed, the scripts.
const shipped = () => [...readdirSync(path.join(ROOT, 'packages')).flatMap((p) => walk(`packages/${p}`, false)), ...walk('apps', false), ...walk('db/src', false), ...walk('db/seed', false), ...walk('scripts', false)];

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

// What packages/agent may not reach: core except its read entry point, the db package, the app's connection string.
export function agentViolations(srcs: Src[]): string[] {
  const out: string[] = [];
  for (const { file, text } of srcs) {
    for (const spec of imports(text)) {
      const target = spec.startsWith('.') ? path.normalize(path.join(path.dirname(file), spec)) : spec;
      if (target.startsWith('@munshi/core') && target !== '@munshi/core/read') out.push(`${file}: imports ${spec}`);
      else if (target.startsWith('@munshi/db') || target.startsWith('packages/core/') || target.startsWith('db/')) out.push(`${file}: imports ${spec}`);
    }
    if (/\bDATABASE_URL\b/.test(text)) out.push(`${file}: names DATABASE_URL (the app's connection)`);
  }
  return out;
}

it('B0 the import scanner sees every form of import, and lets type-only imports and the read entry point through', () => {
  const planted = (text: string) => agentViolations([{ file: 'packages/agent/src/x.ts', text }]);
  expect(planted(`import { createAppPool } from '@munshi/core';`)).toHaveLength(1);
  expect(planted(`import {\n  decide,\n  withTx,\n} from "@munshi/core";`)).toHaveLength(1);
  expect(planted(`export * from '@munshi/core/src/commands.ts';`)).toHaveLength(1);
  expect(planted(`const m = await import('@munshi/core');`)).toHaveLength(1);
  expect(planted(`const m = require('@munshi/db/migrate');`)).toHaveLength(1);
  expect(planted(`import '../../core/src/pool.ts';`)).toHaveLength(1);
  expect(planted(`const url = process.env.DATABASE_URL;`)).toHaveLength(1);
  expect(planted(`import type { Session } from '@munshi/core';`)).toEqual([]);
  expect(planted(`import { resolveRef, renderCell } from '@munshi/core/read';`)).toEqual([]);
  expect(planted(`import pg from 'pg'; import { z } from 'zod';`)).toEqual([]);
});

it('B1 packages/agent imports no app pool, no core writer and no db, and never names the app connection', () => {
  const srcs = walk('packages/agent', true);
  if (sabotageIs('b1-agent-imports-pool')) srcs.push({ file: 'packages/agent/src/planted.ts', text: `import { createAppPool } from '@munshi/core';` });
  if (sabotageIs('b1-agent-imports-command')) srcs.push({ file: 'packages/agent/src/tools/planted.ts', text: `import { recordSale } from '../../../core/src/commands.ts';` });
  if (sabotageIs('b1-agent-database-url')) srcs.push({ file: 'packages/agent/src/planted.ts', text: `new pg.Pool({ connectionString: process.env.DATABASE_URL });` });
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
  expect([...reached].sort()).toEqual(['packages/core/src/errors.ts', 'packages/core/src/money.ts', 'packages/core/src/read.ts']);
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
  expect(h.at).toBeGreaterThan(h.text.indexOf('export async function withTx('));
});

it('B4 only mintSnapshot writes snap.*', () => {
  const srcs = shipped();
  if (sabotageIs('b4-snap-written-elsewhere')) {
    srcs.push({ file: 'apps/web/lib/planted.ts', text: `await c.query('insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num) values ($1, $2, 0, $3, $4, $5)');` });
  }
  const write = /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|copy|merge\s+into)\s+(only\s+)?"?snap"?\s*\.\s*"?snapshot(_cell)?\b/gi;
  const hits = srcs.flatMap((s) => [...s.text.matchAll(write)].map((m) => ({ file: s.file, at: m.index as number, text: s.text })));
  expect(hits.map((h) => h.file)).toEqual(['packages/core/src/snapshots.ts', 'packages/core/src/snapshots.ts']);
  for (const h of hits) {
    const start = h.text.indexOf('export async function mintIn(');
    const end = h.text.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(h.at > start && h.at < end, 'a snap.* write outside mintIn').toBe(true);
  }
});
