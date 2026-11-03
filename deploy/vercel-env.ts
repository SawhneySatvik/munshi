// Sets a Vercel project's Production variables from .env.production (the deploy's own settings, written by
// db/src/supabase-roles.ts) and the named model keys from .env, through `vercel env add`, value on stdin. Prints names
// only. Never sends a migrator, admin or channel setting (deploy/vercel.md). The console's key, MUNSHI_PLATFORM_SECRET,
// goes only with --with-console, the operator's explicit choice to run the superadmin console on that deployment (a live
// deployment requires it: packages/config); without the flag it is refused, and /platform stays 404 there.
//
//   node deploy/vercel-env.ts --cwd=<a linked checkout> [--with-console] [--set NAME=value ...]   (extra values for non-secrets only)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = new URL('../', import.meta.url);
const NEVER = /^(MIGRATOR_DATABASE_URL|ADMIN_DATABASE_URL|MUNSHI_PLATFORM_SECRET|WHATSAPP_.*|INSTAGRAM_.*|MUNSHI_PHONE_ROUTE_SECRET|SUPABASE_.*|DIRECT_.*|SESSION_POOL_.*|TRANSACTION_POOL_.*)$/;
const CONSOLE = 'MUNSHI_PLATFORM_SECRET';
const FROM_PRODUCTION = [
  'DATABASE_URL', 'PUBLIC_DATABASE_URL', 'JOBS_DATABASE_URL', 'AGENT_DATABASE_URL', 'IDP_DATABASE_URL', 'PLATFORM_DATABASE_URL',
  'MUNSHI_DEPLOYMENT', 'MUNSHI_SESSION_SECRET', 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'CRON_SECRET', 'MUNSHI_DB_CA',
];
const MODEL_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SARVAM_API_KEY', 'META_MODEL_API_KEY', 'BASETEN_API_KEY'];

type Env = Record<string, string | undefined>;

/** The name and value of each variable to set, from the parsed files and the arguments; throws on anything refused. */
export function vercelValues(args: string[], production: Env, local: Env): { cwd: string; values: Record<string, string> } {
  const cwd = args.find((a) => a.startsWith('--cwd='))?.slice(6);
  if (!cwd) throw new Error('vercel-env: --cwd=<linked checkout> is required');
  const withConsole = args.includes('--with-console');
  const extra: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith('--cwd=') || arg === '--with-console') continue;
    if (arg !== '--set') throw new Error(`vercel-env: unknown argument ${arg}`);
    const [name, ...rest] = (args[++i] ?? '').split('=');
    if (!name || !/^MUNSHI_(MODEL_MODE|DEMO_TENANT_ID|AI|SEND_MODE)$/.test(name)) throw new Error(`vercel-env: --set takes only non-secret MUNSHI_ settings, not ${name}`);
    extra[name] = rest.join('=');
  }
  const values: Record<string, string> = { ENABLE_EXPERIMENTAL_COREPACK: '1', ...extra };
  for (const name of FROM_PRODUCTION) if (production[name]) values[name] = production[name] as string;
  for (const name of MODEL_KEYS) if (local[name]) values[name] = local[name] as string;
  if (withConsole) {
    // The key the hosted seed sealed the operators' TOTP secrets under: any other opens none of them.
    // The console's sign-in is the password identity's: without these two it signs nobody in.
    const missing = [CONSOLE, 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET'].filter((name) => !production[name]);
    if (missing.length) throw new Error(`vercel-env: --with-console needs ${missing.join(', ')} in .env.production`);
    values[CONSOLE] = production[CONSOLE] as string;
  } else if (production.MUNSHI_DEPLOYMENT === 'live') {
    throw new Error('vercel-env: a live deployment runs the console: pass --with-console');
  }
  for (const name of Object.keys(values)) if (NEVER.test(name) && !(withConsole && name === CONSOLE)) throw new Error(`vercel-env: refusing ${name}`);
  return { cwd, values };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const production = parseEnv(readFileSync(new URL('.env.production', ROOT), 'utf8'));
  const local = parseEnv(readFileSync(new URL('.env', ROOT), 'utf8'));
  const { cwd, values } = vercelValues(process.argv.slice(2), production, local);
  for (const [name, value] of Object.entries(values)) {
    spawnSync('vercel', ['env', 'rm', name, 'production', '--yes'], { cwd, stdio: 'ignore' });
    const r = spawnSync('vercel', ['env', 'add', name, 'production'], { cwd, input: value, stdio: ['pipe', 'ignore', 'ignore'] });
    console.log(`vercel-env: ${name} ${r.status === 0 ? 'set' : `FAILED (exit ${r.status})`}`);
  }
}
