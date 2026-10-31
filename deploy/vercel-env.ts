// Sets a Vercel project's Production variables from .env.production (the deploy's own settings, written by
// db/src/supabase-roles.ts) and the named model keys from .env, through `vercel env add`, value on stdin. Prints names
// only. Never sends a migrator, admin, platform-secret or channel setting (deploy/vercel.md).
//
//   node deploy/vercel-env.ts --cwd=<a linked checkout> [--set NAME=value ...]   (extra values for non-secrets only)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const ROOT = new URL('../', import.meta.url);
const NEVER = /^(MIGRATOR_DATABASE_URL|ADMIN_DATABASE_URL|MUNSHI_PLATFORM_SECRET|WHATSAPP_.*|INSTAGRAM_.*|MUNSHI_PHONE_ROUTE_SECRET|SUPABASE_.*|DIRECT_.*|SESSION_POOL_.*|TRANSACTION_POOL_.*)$/;
const FROM_PRODUCTION = [
  'DATABASE_URL', 'PUBLIC_DATABASE_URL', 'JOBS_DATABASE_URL', 'AGENT_DATABASE_URL', 'IDP_DATABASE_URL', 'PLATFORM_DATABASE_URL',
  'MUNSHI_DEPLOYMENT', 'MUNSHI_SESSION_SECRET', 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'CRON_SECRET', 'MUNSHI_DB_CA',
];
const MODEL_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SARVAM_API_KEY', 'META_MODEL_API_KEY', 'BASETEN_API_KEY'];

const args = process.argv.slice(2);
const cwd = args.find((a) => a.startsWith('--cwd='))?.slice(6);
if (!cwd) throw new Error('vercel-env: --cwd=<linked checkout> is required');
const extra: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [name, ...rest] = (args[i + 1] ?? '').split('=');
  if (!name || !/^MUNSHI_(EDITION|MODEL_MODE|DEMO_TENANT_ID|AI|SEND_MODE)$/.test(name)) throw new Error(`vercel-env: --set takes only non-secret MUNSHI_ settings, not ${name}`);
  extra[name] = rest.join('=');
}

const production = parseEnv(readFileSync(new URL('.env.production', ROOT), 'utf8'));
const local = parseEnv(readFileSync(new URL('.env', ROOT), 'utf8'));
const values: Record<string, string> = { ENABLE_EXPERIMENTAL_COREPACK: '1', ...extra };
for (const name of FROM_PRODUCTION) if (production[name]) values[name] = production[name] as string;
for (const name of MODEL_KEYS) if (local[name]) values[name] = local[name] as string;

for (const [name, value] of Object.entries(values)) {
  if (NEVER.test(name)) throw new Error(`vercel-env: refusing ${name}`);
  spawnSync('vercel', ['env', 'rm', name, 'production', '--yes'], { cwd, stdio: 'ignore' });
  const r = spawnSync('vercel', ['env', 'add', name, 'production'], { cwd, input: value, stdio: ['pipe', 'ignore', 'ignore'] });
  console.log(`vercel-env: ${name} ${r.status === 0 ? 'set' : `FAILED (exit ${r.status})`}`);
}
