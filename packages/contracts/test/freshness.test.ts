// The committed generated files are a fresh generation from the zod schemas as loaded, so a schema edited without
// regenerating cannot ship. Contents, not mtimes: a git checkout sets every mtime, so an age check would fail on a
// clean clone. Red-proofs: db/test/v2/sabotage/core-contracts.ts (a schema edited without regenerating; the emitter
// edited; a clock in the output).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generate } from '../src/generate.ts';

const committed = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

// The first line that differs, so a stale file fails with something to read instead of a 7,000-line diff.
function firstDifference(onDisk: string, fresh: string): string | null {
  if (onDisk === fresh) return null;
  const a = onDisk.split('\n');
  const b = fresh.split('\n');
  const i = a.findIndex((line, n) => line !== b[n]);
  const at = i === -1 ? a.length : i;
  return `line ${at + 1}: committed ${JSON.stringify(a[at] ?? '<end>')}, fresh ${JSON.stringify(b[at] ?? '<end>')}: run pnpm contracts`;
}

it('openapi.json is byte for byte a fresh generation from the zod schemas', () => {
  expect(firstDifference(committed('../openapi.json'), generate().openapi)).toBeNull();
});

it('the SDK schema.gen.ts is byte for byte a fresh generation from openapi.json', () => {
  expect(firstDifference(committed('../../sdk/src/schema.gen.ts'), generate().types)).toBeNull();
});

it('two generations give identical bytes', () => {
  const [a, b] = [generate(), generate()];
  expect(firstDifference(a.openapi, b.openapi)).toBeNull();
  expect(firstDifference(a.types, b.types)).toBeNull();
  expect(a.openapi.length).toBeGreaterThan(100_000);
});
