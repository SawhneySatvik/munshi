// The SDK ships with no runtime dependency (BLUEPRINT §5.6, gate S8): its package.json names none, and its source
// imports only its own files. Red-proofs: db/test/v2/sabotage/core-contracts.ts (harness-level: each plants the breach in
// what the test reads).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../../db/test/v2/sabotage/index.ts';

const root = path.join(import.meta.dirname, '..');

it('SDK1 the package.json names no dependency of any kind', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
  if (sabotageIs('v2-sdk-dependency')) pkg.dependencies = { zod: '4.6.7' };
  expect(pkg.name).toBe('@munshi/sdk');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
    expect([field, Object.keys((pkg[field] as object | undefined) ?? {})]).toEqual([field, []]);
  }
});

it('SDK2 the source imports only its own files: no package, no node: builtin, nothing outside src', () => {
  const src = path.join(root, 'src');
  const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
  expect(files.sort()).toEqual(['index.ts', 'money.ts', 'schema.gen.ts']);
  const specifiers: string[] = [];
  for (const file of files) {
    let text = readFileSync(path.join(src, file), 'utf8');
    if (file === 'index.ts' && sabotageIs('v2-sdk-import')) text = `import { z } from 'zod';\n${text}`;
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) specifiers.push(m[1] as string);
  }
  expect(specifiers.length).toBeGreaterThan(2);
  expect(specifiers.filter((s) => !/^\.\/[a-z.-]+\.ts$/.test(s))).toEqual([]);
});
