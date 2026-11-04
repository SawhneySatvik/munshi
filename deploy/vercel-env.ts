// Sets the Vercel project's Production variables, through `vercel env add`, value on stdin. Prints names only. There is
// one project, `munshi`, with three services (deploy/vercel.md): the web app and the two shop sites. A project's
// variables reach every service, so this one list serves all three:
//
// - the role URLs, the deploy's secrets and MUNSHI_DB_CA from .env.production (written by db/src/supabase-roles.ts), and
//   the model keys set in .env. Never a migrator, admin or channel setting, nor a SUPABASE_* name (set those by hand).
//   The console's key, MUNSHI_PLATFORM_SECRET, goes only with --with-console, the operator's explicit choice to run the
//   superadmin console on that deployment (a live deployment requires it: packages/config); without the flag it is
//   refused, and /platform stays 404 there.
// - through --set, the non-secret settings and each site's publishable key (MUNSHI_SITE_KEY_ELITE,
//   MUNSHI_SITE_KEY_PRABHAVE: public by design, for the browser's writes), each checked to be that business's key.
//   Never a site's API address (the binding gives the server WEB_URL; the browser calls its own origin) nor a business
//   (each site app fixes its own), nor the one-key MUNSHI_SITE_KEY, which both sites would read.
//
//   node deploy/vercel-env.ts --project=munshi --cwd=<checkout linked to munshi> [--with-console] [--set NAME=value ...]
//
// The linked checkout's .vercel/project.json must name the same project, so the values never land in another.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
const SITES = ['elite', 'prabhave'];
/** What --set takes: the non-secret settings, each site's publishable key, and the sites' sample label. */
const SETTABLE = /^(MUNSHI_(MODEL_MODE|DEMO_TENANT_ID|AI|SEND_MODE|APP_URL)|MUNSHI_SITE_KEY_(ELITE|PRABHAVE)|NEXT_PUBLIC_MUNSHI_SITE_SAMPLE)$/;

/** The one Vercel project: the web app and the two shop sites, as services. */
export const PROJECT = 'munshi';
export type Project = typeof PROJECT;

type Env = Record<string, string | undefined>;

/** The project named by --project=<name> (or --project <name>); throws unless it is the one project. */
export function projectOf(args: string[]): Project {
  const at = args.indexOf('--project');
  const project = at >= 0 ? args[at + 1] : args.find((a) => a.startsWith('--project='))?.slice(10);
  if (project !== PROJECT) throw new Error(`vercel-env: --project must be ${PROJECT}, the one project with the web app and both sites`);
  return project;
}

/** The project, the linked checkout and the name and value of each variable to set; throws on anything refused. */
export function vercelValues(args: string[], production: Env, local: Env): { cwd: string; project: Project; values: Record<string, string> } {
  const cwd = args.find((a) => a.startsWith('--cwd='))?.slice(6);
  if (!cwd) throw new Error('vercel-env: --cwd=<linked checkout> is required');
  const withConsole = args.includes('--with-console');
  const project = projectOf(args);
  const extra: Record<string, string> = {};
  const sets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith('--cwd=') || arg === '--with-console' || arg.startsWith('--project=')) continue;
    if (arg === '--project') i++;
    else if (arg === '--set') sets.push(args[++i] ?? '');
    else throw new Error(`vercel-env: unknown argument ${arg}`);
  }
  for (const pair of sets) {
    const [name, ...rest] = pair.split('=');
    if (!name || !SETTABLE.test(name)) throw new Error(`vercel-env: --set takes only the non-secret settings and the sites' publishable keys, not ${name}`);
    extra[name] = rest.join('=');
  }
  const values: Record<string, string> = { ENABLE_EXPERIMENTAL_COREPACK: '1', ...extra };
  // Each site reads only its own name, so a key under the other's name would be sent with the other's requests.
  for (const slug of SITES) {
    const name = `MUNSHI_SITE_KEY_${slug.toUpperCase()}`;
    const key = values[name];
    if (key !== undefined && !new RegExp(`^mpk_${slug}_[A-Za-z0-9_-]{43}$`).test(key)) throw new Error(`vercel-env: ${name} must be ${slug}'s publishable key (mpk_${slug}_…)`);
  }

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
  return { cwd, project, values };
}

/** Refuses a checkout whose Vercel link (.vercel/project.json, linkage metadata only) names another project or none. */
export function checkLink(cwd: string, project: Project): void {
  let linked: string | undefined;
  try {
    linked = (JSON.parse(readFileSync(path.join(cwd, '.vercel', 'project.json'), 'utf8')) as { projectName?: string }).projectName;
  } catch {
    // no link, or not JSON: refused below
  }
  if (linked !== project) {
    throw new Error(`vercel-env: ${cwd} is linked to ${linked ?? 'no named project'}, not ${project}: run \`vercel link --yes --project ${project}\` there first`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  projectOf(args);
  const production = parseEnv(readFileSync(new URL('.env.production', ROOT), 'utf8'));
  const local = parseEnv(readFileSync(new URL('.env', ROOT), 'utf8'));
  const { cwd, project, values } = vercelValues(args, production, local);
  checkLink(cwd, project);
  for (const [name, value] of Object.entries(values)) {
    const r = spawnSync('vercel', ['env', 'add', name, 'production', '--force', '--project', project], { cwd, input: value, stdio: ['pipe', 'ignore', 'ignore'] });
    console.log(`vercel-env: ${project} ${name} ${r.status === 0 ? 'set' : `FAILED (exit ${r.status})`}`);
    if (r.status !== 0) process.exitCode = 1;
  }
}
