// The hosted demo's shops, once, on a freshly built hosted database (docs/deploy/supabase.md; no pnpm script: run it as
// below): the kirana, Bansal and the two showcase tenants exactly as `pnpm dev` seeds them (db/src/dev.ts's reseed),
// the watchers run, and the first platform operator ("Demo operator") enrolled, who approves the demo defaults, the
// model allow-list and both showcase sites. Its sign-in (email, password, authenticator URI and identity
// subject) goes to .run/hosted-operator.json (mode 0600), never printed; the subject is what the platform CLI's
// --subject takes when this operator approves a new operator's enrolment (docs/deploy/supabase.md).
//
//   node --env-file=.env.production db/seed/hosted.ts --confirm=<project ref>
//
// Refuses unless --confirm names the project in DATABASE_URL, the database says it is a hosted demo, and it holds no
// tenant (a second run would collide with the first operator). The owner steps run on the migrator's connection, which
// may SET ROLE munshi_owner. MUNSHI_MODEL_MODE decides the seed date as in dev (live: today). Prints ids, never secrets.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDatabaseTls, databaseTls } from '@munshi/core';
import pg from 'pg';
import { type DevOperator, reseed } from '../src/dev.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** The hosted seeds' first operator (this file and hosted-copy.ts): "Demo operator"; `pnpm dev`'s is "Dev operator". */
export const hostedOperator = (secrets: { identitySecret: string; platformSecret: string }, out: string): DevOperator => ({ ...secrets, out, displayName: 'Demo operator' });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`seed:hosted: ${name} is not set`);
  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const confirm = args.length === 1 && args[0]?.startsWith('--confirm=') ? args[0].slice('--confirm='.length) : '';
  if (!confirm) throw new Error('seed:hosted takes only --confirm=<project ref>');
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA));
  const ref = decodeURIComponent(new URL(need('DATABASE_URL')).username).split('.')[1];
  if (ref !== confirm) throw new Error('seed:hosted: --confirm does not name the project in DATABASE_URL');

  const owner = new pg.Client({ connectionString: need('MIGRATOR_DATABASE_URL'), application_name: 'munshi_seed_hosted' });
  await owner.connect();
  const app = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 4 });
  const jobs = new pg.Pool({ connectionString: need('JOBS_DATABASE_URL'), max: 2 });
  const pub = new pg.Pool({ connectionString: need('PUBLIC_DATABASE_URL'), max: 2 });
  const platform = new pg.Pool({ connectionString: need('PLATFORM_DATABASE_URL'), max: 2 });
  try {
    await owner.query('begin');
    await owner.query('set local role munshi_owner');
    const { rows: dep } = await owner.query<{ kind: string; hosted: boolean }>('select kind, hosted from ops.deployment');
    const { rows: n } = await owner.query<{ n: number }>('select count(*)::int as n from ops.tenant');
    await owner.query('commit');
    if (dep[0]?.kind !== 'demo' || dep[0]?.hosted !== true) throw new Error('seed:hosted: the database is not a hosted demo (build it with --deployment demo)');
    if ((n[0]?.n ?? 0) > 0) throw new Error('seed:hosted: the database already holds tenants; rebuild it first');

    const started = Date.now();
    mkdirSync(path.join(ROOT, '.run'), { recursive: true });
    const out = path.join(ROOT, '.run', 'hosted-operator.json');
    const secrets = { identitySecret: need('MUNSHI_IDENTITY_SECRET'), platformSecret: need('MUNSHI_PLATFORM_SECRET') };
    const { tenantId, summary } = await reseed(app, jobs, { pub, platform, owner }, hostedOperator(secrets, out));
    console.log(`seed:hosted: seeded ${summary} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    console.log(`seed:hosted: MUNSHI_DEMO_TENANT_ID=${tenantId}`);
    console.log(`seed:hosted: the Demo operator's sign-in is in ${path.relative(ROOT, out)} (0600)`);
  } finally {
    await platform.end();
    await pub.end();
    await jobs.end();
    await app.end();
    await owner.end();
  }
}
