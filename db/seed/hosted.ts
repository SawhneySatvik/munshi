// The hosted demo's shops, once, on a freshly built hosted database (docs/deploy/supabase.md; no pnpm script: run it as
// below): the kirana, Bansal and the two showcase tenants exactly as `pnpm dev` seeds them (db/src/dev.ts's reseed),
// the watchers run, and the first platform operator ("Demo operator") enrolled, who approves the demo defaults, the
// model allow-list and both showcase sites. Both sites are then published, as `pnpm dev` publishes them (hostedSites).
// The operator's sign-in (email, password, authenticator URI and identity subject) goes to .run/hosted-operator.json
// (mode 0600), never printed; the subject is what the platform CLI's --subject takes when this operator approves a new
// operator's enrolment (docs/deploy/supabase.md).
//
//   node --env-file=.env.production db/seed/hosted.ts --confirm=<project ref> \
//     [--elite-origin=https://<elite host> --prabhave-origin=https://<prabhave host>]
//
// With the two sites' origins, each site lists its own and gets a fresh publishable key, written to
// .run/hosted-site-keys.json (0600) and never printed. Without them the sites are published read-only: their pages
// answer, their bookings, holds and orders are refused until db/src/site-origins.ts adds the origins and keys.
// Refuses unless --confirm names the project in DATABASE_URL, the database says it is a hosted demo, and it holds no
// tenant (a second run would collide with the first operator). The owner steps run on the migrator's connection, which
// may SET ROLE munshi_owner. MUNSHI_MODEL_MODE decides the seed date as in dev (live: today). Prints ids, never secrets.
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDatabaseTls, databaseTls } from '@munshi/core';
import pg from 'pg';
import { type DevOperator, publishShowcaseSite, reseed } from '../src/dev.ts';
import { issueSiteKeys, type Origins, SITE_KEYS_FILE, type SiteKey, siteArgs, writeSiteKeys } from '../src/site-origins.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** The hosted seeds' first operator (this file and hosted-copy.ts): "Demo operator"; `pnpm dev`'s is "Dev operator". */
export const hostedOperator = (secrets: { identitySecret: string; platformSecret: string }, out: string): DevOperator => ({ ...secrets, out, displayName: 'Demo operator' });

/**
 * Both showcase sites published (Elite's look, public stylists and release; Prabhave's seed published its own), then,
 * given the origins, each site's origin listed and a fresh publishable key issued. The keys are returned, never said:
 * the caller writes them with writeSiteKeys once its seed has landed.
 */
export async function hostedSites(
  app: pg.Pool,
  owner: pg.ClientBase,
  sites: { tenantId: string; stylists?: Map<string, string> }[],
  origins: Origins | undefined,
  say: (line: string) => void,
): Promise<SiteKey[]> {
  const published: { slug: string; tenantId: string }[] = [];
  for (const site of sites) published.push({ slug: await publishShowcaseSite(app, owner, site), tenantId: site.tenantId });
  say(`published the ${published.map((p) => p.slug).join(' and ')} sites`);
  if (!origins) {
    say('no site origins given: the sites stay read-only (their bookings, holds and orders are refused) until db/src/site-origins.ts adds them');
    return [];
  }
  return issueSiteKeys(app, published, origins);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`seed:hosted: ${name} is not set`);
  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { confirm, origins } = siteArgs(process.argv.slice(2), 'seed:hosted');
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
    const say = (line: string) => console.log(`seed:hosted: ${line}`);
    const { tenantId, sites, summary } = await reseed(app, jobs, { pub, platform, owner }, hostedOperator(secrets, out));
    const keys = await hostedSites(app, owner, sites, origins, say);
    say(`seeded ${summary} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    say(`MUNSHI_DEMO_TENANT_ID=${tenantId}`);
    say(`the Demo operator's sign-in is in ${path.relative(ROOT, out)} (0600)`);
    if (keys.length) writeSiteKeys(SITE_KEYS_FILE, keys, say);
    else rmSync(SITE_KEYS_FILE, { force: true }); // an earlier seed's keys went with its database
  } finally {
    await platform.end();
    await pub.end();
    await jobs.end();
    await app.end();
    await owner.end();
  }
}
