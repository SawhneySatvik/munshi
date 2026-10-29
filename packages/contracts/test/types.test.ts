// Runs the compile-time gate test/types.ts through tsc, so the red-proof harness can see it fail (vitest strips types).
// tsc reads files from disk, which a ts sabotage cannot reach, so the check runs in a scratch copy of the project with
// its own copy of schema.gen.ts; under a harness-level sabotage that copy drifts by one optional field, either way.
// Red-proofs: db/test/v2/sabotage/core-contracts.ts.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { reportSabotage, sabotageIs } from '../../../db/test/v2/sabotage/index.ts';

const pkg = path.join(import.meta.dirname, '..');
const repo = path.join(pkg, '..', '..');
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'munshi-contract-types-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// One optional field more on the SDK's side, or one fewer: mutual assignability passes both, identity fails both.
const DRIFTS = [
  { name: 'v2-con-types-sdk-wider', from: '  ref: Ref;\n};\n\nexport type Note', to: '  ref: Ref;\n  source?: string | undefined;\n};\n\nexport type Note' },
  { name: 'v2-con-types-sdk-narrower', from: '  itemId?: Id | undefined;\n  message: string;', to: '  message: string;' },
];

function generated(): string {
  const text = readFileSync(path.join(repo, 'packages/sdk/src/schema.gen.ts'), 'utf8');
  for (const d of DRIFTS) {
    if (!sabotageIs(d.name)) continue;
    if (text.split(d.from).length !== 2) {
      reportSabotage(d.name, 'failed', 'schema.gen.ts does not contain the text to drift exactly once');
      throw new Error(`sabotage ${d.name}: schema.gen.ts does not contain the text to drift exactly once`);
    }
    return text.replace(d.from, d.to);
  }
  return text;
}

it('TYPE1 the SDK types and the zod-inferred types are identical, both ways, for every component and every route', () => {
  const contracts = path.join(scratch, 'packages/contracts');
  mkdirSync(path.join(contracts, 'test'), { recursive: true });
  mkdirSync(path.join(scratch, 'packages/sdk/src'), { recursive: true });
  copyFileSync(path.join(repo, 'tsconfig.base.json'), path.join(scratch, 'tsconfig.base.json'));
  copyFileSync(path.join(pkg, 'test/types.ts'), path.join(contracts, 'test/types.ts'));
  // Each package.json says "type": "module", which decides how tsc reads the files beside it.
  copyFileSync(path.join(pkg, 'package.json'), path.join(contracts, 'package.json'));
  copyFileSync(path.join(repo, 'packages/sdk/package.json'), path.join(scratch, 'packages/sdk/package.json'));
  symlinkSync(path.join(pkg, 'src'), path.join(contracts, 'src'));
  symlinkSync(path.join(pkg, 'node_modules'), path.join(contracts, 'node_modules'));
  const gen = path.join(scratch, 'packages/sdk/src/schema.gen.ts');
  writeFileSync(gen, generated());
  const config = JSON.parse(readFileSync(path.join(pkg, 'tsconfig.json'), 'utf8')) as { include?: string[]; files?: string[] };
  delete config.include;
  config.files = ['test/types.ts'];
  writeFileSync(path.join(contracts, 'tsconfig.json'), JSON.stringify(config));

  const run = spawnSync(process.execPath, [tsc, '-p', path.join(contracts, 'tsconfig.json'), '--noEmit', '--listFiles'], { encoding: 'utf8' });
  const out = `${run.stdout}${run.stderr}`;
  // The scratch copy is the file checked, not the repo's.
  expect(out).toContain(gen);
  expect(out.split('\n').filter((l) => l.includes('error TS'))).toEqual([]);
  expect(run.status).toBe(0);
});
