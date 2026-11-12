// Runs the Munshi collection with newman against one environment (munshi-hosted or munshi-local), one or more folders.
// Secrets come only from the caller's shell, never from a file: MUNSHI_INTEGRATION_SECRET (the feed), PAYPAL_CLIENT_ID and
// PAYPAL_CLIENT_SECRET (a PayPal sandbox app). They reach newman as environment overrides in this process, never on a
// command line and never printed. A folder whose secret is not set is refused before anything runs, and the site writes
// never run against the hosted deployment (they would queue requests on its sample sites).
//   pnpm postman:test                                     the public reads, hosted
//   pnpm postman:test -- --env=local --folder="Integration feed"
//   pnpm postman:test -- --folder="PayPal sandbox"
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type Summary = { run: { failures: unknown[]; stats: Record<string, { total: number; failed: number }> } };
type Newman = { run: (opts: Record<string, unknown>, done: (err: Error | null, summary: Summary) => void) => void };
const newman = createRequire(import.meta.url)('newman') as Newman;

const file = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const NEEDS: Record<string, [variable: string, name: string][]> = {
  'Integration feed': [['integrationSecret', 'MUNSHI_INTEGRATION_SECRET']],
  'PayPal sandbox': [
    ['paypalClientId', 'PAYPAL_CLIENT_ID'],
    ['paypalClientSecret', 'PAYPAL_CLIENT_SECRET'],
  ],
};

function refuse(message: string): never {
  console.error(`postman: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const env = args.find((a) => a.startsWith('--env='))?.slice(6) ?? 'hosted';
const folders = args.filter((a) => a.startsWith('--folder=')).map((a) => a.slice(9));
if (!folders.length) folders.push('Public reads');
if (env !== 'hosted' && env !== 'local') refuse('--env must be hosted or local');
if (env === 'hosted' && folders.some((f) => f === 'Site writes' || f === 'Public API v1')) {
  refuse('the site writes run only against local (they queue requests a person then decides)');
}

const envVar: { key: string; value: string }[] = [];
for (const folder of folders) {
  for (const [variable, name] of NEEDS[folder] ?? []) {
    const value = process.env[name];
    if (!value) refuse(`the "${folder}" folder needs ${name} set in your shell`);
    envVar.push({ key: variable, value });
  }
}

newman.run(
  {
    collection: file('munshi.postman_collection.json'),
    environment: file(`munshi-${env}.postman_environment.json`),
    folder: folders,
    envVar,
    reporters: ['cli'],
    delayRequest: 150,
    timeoutRequest: 30_000,
  },
  (err, summary) => {
    if (err) {
      console.error(`postman: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (summary.run.failures.length) process.exitCode = 1;
  },
);
