// pnpm contracts: writes packages/contracts/openapi.json and packages/sdk/src/schema.gen.ts from the zod schemas. Both
// are committed; test/freshness.test.ts fails when either differs from a fresh generation.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.ts';

if (process.argv.length > 2) {
  process.stderr.write(`build.ts takes no arguments, not ${process.argv.slice(2).join(' ')}\n`);
  process.exit(2);
}
const { openapi, types } = generate();
for (const [file, text] of [
  ['../openapi.json', openapi],
  ['../../sdk/src/schema.gen.ts', types],
] as const) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  writeFileSync(path, text);
  process.stdout.write(`wrote ${path} (sha256 ${createHash('sha256').update(text).digest('hex').slice(0, 16)})\n`);
}
