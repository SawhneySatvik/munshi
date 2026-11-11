// Runs APIMatic's CLI on Munshi's API (docs/api-sdks.md). It writes packages/contracts/openapi.json, less its deferred
// operations, into apimatic/src/spec beside APIMATIC-META.json, which is the layout the CLI reads, then runs one command. The key is APIMATIC_API_KEY (from
// the environment or .env); it reaches the CLI as an argument and is never printed.
// Run: node apimatic/run.ts validate | portal | sdk
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apimaticSettings, loadEnvFiles } from '../packages/config/src/index.ts';

// Pinned, and run through pnpm dlx so the CLI's own dependencies stay out of the workspace's lockfile.
const CLI = '@apimatic/cli@2.2.0';
const input = fileURLToPath(new URL('.', import.meta.url));

const COMMANDS: Record<string, string[][]> = {
  validate: [['api', 'validate']],
  // Written to apimatic/portal and apimatic/sdk/<language>, both ignored by git.
  portal: [['portal', 'generate', '--force']],
  sdk: [
    ['sdk', 'generate', '--language=typescript', '--force'],
    ['sdk', 'generate', '--language=python', '--force'],
  ],
};

const which = process.argv[2] ?? '';
const steps = COMMANDS[which];
if (!steps) {
  console.error(`apimatic: say which: ${Object.keys(COMMANDS).join(' | ')}`);
  process.exit(2);
}

loadEnvFiles([new URL('../.env', import.meta.url)]);
const { apiKey } = apimaticSettings();
if (!apiKey) {
  console.error('apimatic: APIMATIC_API_KEY is not set. Every APIMatic command, validation included, runs on APIMatic\'s servers and needs it.');
  process.exit(1);
}

// The document as `pnpm contracts` wrote it, less what is specified but not built (x-munshi-deferred: the secret-key
// reads and their scheme), so no SDK offers a call the API does not answer.
type Deferrable = { 'x-munshi-deferred'?: boolean };
const spec = JSON.parse(readFileSync(new URL('../packages/contracts/openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Deferrable>>;
  components: { securitySchemes: Record<string, Deferrable> };
};
for (const [path, operations] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(operations)) if (operation['x-munshi-deferred']) delete operations[method];
  if (Object.keys(operations).length === 0) delete spec.paths[path];
}
for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) if (scheme['x-munshi-deferred']) delete spec.components.securitySchemes[name];
writeFileSync(new URL('src/spec/openapi.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);

for (const step of steps) {
  console.log(`apimatic: ${step.join(' ')}`);
  const run = spawnSync('pnpm', ['dlx', CLI, ...step, `--input=${input}`, `--auth-key=${apiKey}`], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
