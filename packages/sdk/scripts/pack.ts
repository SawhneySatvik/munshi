// pnpm sdk:pack: the SDK as a tarball for /developers/sdk (shipped with its sha256, not on npm). It compiles src/ to
// JavaScript with declarations in a staging folder, writes a package.json with no dependencies, packs it with npm into
// apps/web/public/developers/, and prints the tarball's sha256 (pnpm kit records it for the portal).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SDK_VERSION = '0.1.0';
export const SDK_FILE = `munshi-sdk-${SDK_VERSION}.tgz`;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(root, 'apps/web/public/developers');

const stage = mkdtempSync(path.join(tmpdir(), 'munshi-sdk-'));
try {
  writeFileSync(
    path.join(stage, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(root, 'tsconfig.base.json'),
      compilerOptions: { rootDir: path.join(here, '../src'), outDir: path.join(stage, 'dist'), sourceMap: false, rewriteRelativeImportExtensions: true, types: [] },
      files: ['index.ts', 'money.ts', 'schema.gen.ts'].map((f) => path.join(here, '../src', f)),
    }),
  );
  execFileSync(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(stage, 'tsconfig.json')], { stdio: 'inherit' });
  writeFileSync(
    path.join(stage, 'package.json'),
    `${JSON.stringify(
      {
        name: '@munshi/sdk',
        version: SDK_VERSION,
        description: 'A typed client for the Munshi API v1: published figures with their refs, and writes a shop approves',
        type: 'module',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        files: ['dist'],
        dependencies: {},
        engines: { node: '>=20' },
      },
      null,
      2,
    )}\n`,
  );
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', out], { cwd: stage, encoding: 'utf8' })) as { filename: string }[];
  if (packed[0]?.filename !== SDK_FILE) throw new Error(`sdk:pack: npm wrote ${packed[0]?.filename}, not ${SDK_FILE}`);
  const sha256 = createHash('sha256').update(readFileSync(path.join(out, SDK_FILE))).digest('hex');
  process.stdout.write(`wrote apps/web/public/developers/${SDK_FILE} (sha256 ${sha256})\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
