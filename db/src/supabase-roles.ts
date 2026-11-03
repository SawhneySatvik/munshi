// docs/deploy/supabase.md steps 2–3 in one run, for a hosted Supabase project: 00_bootstrap.sql as the project's admin,
// a fresh password for each of the seven Munshi logins, and .env.production written (mode 0600) with each login's URL
// through the right pooler, plus the deploy's generated secrets. Nothing secret is printed: only role names, the
// project ref and where the file went.
//
//   node db/src/supabase-roles.ts --env=<.env with the project's Supabase names> --out=<.env.production> --confirm=<ref>
//
// The admin URL is SESSION_POOL_CONNECTION_STRING (user postgres.<ref>, the session pooler); the runtime pools use the
// transaction pooler's host (port 6543), the migrator the session pooler (5432). URLs carry no sslmode: every Munshi
// process verifies the server against MUNSHI_DB_CA (Supabase's root, deploy/supabase-root-2021.crt), written here as
// base64. Re-running rotates every login password; secrets already in --out are kept.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { applyDatabaseTls, databaseTls } from '@munshi/core';
import pg from 'pg';
import { bootstrap } from './bootstrap.ts';

export const LOGINS = ['munshi_migrator', 'munshi_app', 'munshi_public', 'munshi_jobs', 'munshi_agent', 'munshi_idp', 'munshi_platform'] as const;
type Login = (typeof LOGINS)[number];

const URL_NAME: Record<Login, string> = {
  munshi_migrator: 'MIGRATOR_DATABASE_URL',
  munshi_app: 'DATABASE_URL',
  munshi_public: 'PUBLIC_DATABASE_URL',
  munshi_jobs: 'JOBS_DATABASE_URL',
  munshi_agent: 'AGENT_DATABASE_URL',
  munshi_idp: 'IDP_DATABASE_URL',
  munshi_platform: 'PLATFORM_DATABASE_URL',
};

/** The secrets a deploy generates once and keeps (each 32 random bytes as hex). */
const SECRETS = ['MUNSHI_SESSION_SECRET', 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'MUNSHI_PLATFORM_SECRET', 'CRON_SECRET'] as const;

function flag(name: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (!hit) throw new Error(`supabase-roles: --${name}=… is required`);
  return hit.slice(name.length + 3);
}

/** One login's URL on a pooler: Supabase's shared pooler takes `<role>.<ref>` as the user (docs/deploy/supabase.md). */
export function loginUrl(pooler: URL, role: string, ref: string, password: string): string {
  const u = new URL(pooler.toString());
  u.username = `${role}.${ref}`;
  u.password = password;
  u.search = '';
  return u.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const a of process.argv.slice(2)) if (!/^--(env|out|confirm)=/.test(a)) throw new Error(`supabase-roles: unknown argument ${a.split('=')[0]}`);
  const source = parseEnv(readFileSync(flag('env'), 'utf8'));
  const outPath = flag('out');
  const session = new URL(source.SESSION_POOL_CONNECTION_STRING ?? '');
  const transaction = new URL(source.TRANSACTION_POOL_CONNECTION_STRING ?? '');
  const [adminUser, ref] = decodeURIComponent(session.username).split('.');
  if (adminUser !== 'postgres' || !ref) throw new Error('supabase-roles: SESSION_POOL_CONNECTION_STRING must log in as postgres.<ref>');
  if (flag('confirm') !== ref) throw new Error('supabase-roles: --confirm must equal the project ref in the session pooler URL');
  if (session.port !== '5432' || transaction.port !== '6543') throw new Error('supabase-roles: expected the session pooler on 5432 and the transaction pooler on 6543');

  const ca = readFileSync(new URL('../../deploy/supabase-root-2021.crt', import.meta.url), 'utf8');
  const caBase64 = Buffer.from(ca).toString('base64');
  applyDatabaseTls(databaseTls(caBase64));

  const kept = existsSync(outPath) ? parseEnv(readFileSync(outPath, 'utf8')) : {};
  const admin = new pg.Client({ connectionString: session.toString(), application_name: 'munshi_supabase_roles' });
  await admin.connect();
  const out: Record<string, string> = {};
  try {
    await bootstrap(admin);
    console.log('supabase-roles: 00_bootstrap.sql applied');
    for (const role of LOGINS) {
      const password = randomBytes(24).toString('hex');
      await admin.query(`alter role ${role} password ${admin.escapeLiteral(password)}`);
      out[URL_NAME[role]] = loginUrl(role === 'munshi_migrator' ? session : transaction, role, ref, password);
      console.log(`supabase-roles: ${role} password set`);
    }
  } finally {
    await admin.end();
  }
  for (const name of SECRETS) out[name] = kept[name] || randomBytes(32).toString('hex');
  out.MUNSHI_DEPLOYMENT = 'demo';
  out.MUNSHI_DB_CA = caBase64;
  for (const [name, value] of Object.entries(kept)) if (!(name in out) && value !== undefined) out[name] = value;
  writeFileSync(outPath, `${Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  chmodSync(outPath, 0o600);
  console.log(`supabase-roles: wrote ${Object.keys(out).length} settings (names only) to ${outPath}, mode 0600, project ${ref}`);
}
