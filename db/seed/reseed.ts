// pnpm reseed — rebuilds the demo shops in one command: wipe every tenant, seed "Sharma General Store (synthetic)" and
// the second demo shop "Bansal Super Mart (sample)" as munshi_app through packages/core, then the two showcase tenants
// (db/seed/showcase.ts: provisioned and Prabhave's release published as the owner role through this connection, the site's asks and carts as munshi_public, both sites
// verified by the seed's own operator as munshi_platform), and run the watchers once as munshi_jobs. For the local dev database only (the one
// `pnpm dev` makes, built from db/schema; `pnpm db:reset` rebuilds the schema itself): DATABASE_URL must be a superuser
// connection to it (never printed). Before the wipe it proves the target is that cluster, as db/src/dev.ts does: a
// 127.0.0.1 connection, the data directory .run/pg17, and the database comment holding this .run/dev.json marker. The
// wipe then runs in one transaction that holds an exclusive lock on ops.tenant while it checks every tenant is synthetic
// (or a showcase tenant) and truncates. Books are append-only for every runtime role; only this admin path, on that
// database, truncates them. The cascade from ops.tenant reaches platform.change and what names a change. A first
// operator can be seeded only while none exists, so the showcase seed's own operator (its secrets were never kept) goes
// too; any other operator stays, and then the showcase sites are left unverified, as the summary says.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWatchers } from '@munshi/core';
import pg from 'pg';
import { BANSAL, seedBansal } from './bansal.ts';
import { ELITE } from './elite.ts';
import { SHOP, seedKirana } from './kirana.ts';
import { seedKiranaPaypal } from './kirana-paypal.ts';
import { PRABHAVE } from './prabhave.ts';
import { SHOWCASE_OPERATOR, seedShowcase } from './showcase.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('reseed: DATABASE_URL is not set (a superuser connection to a dev database)');
  process.exit(1);
}
const RUN = path.join(fileURLToPath(new URL('../..', import.meta.url)), '.run');

// Refuses unless this connection is the dev cluster dev.ts made: before any wipe.
async function assertDevCluster(admin: pg.Client): Promise<void> {
  const { rows } = await admin.query<{ host: string | null; data: string; note: string | null; super: boolean }>(
    `select host(inet_server_addr()) as host, current_setting('data_directory') as data,
            shobj_description(d.oid, 'pg_database') as note, r.rolsuper as super
       from pg_database d, pg_roles r where d.datname = current_database() and r.rolname = current_user`,
  );
  const me = rows[0];
  let marker: string | undefined;
  let sameDir = false;
  try {
    marker = (JSON.parse(readFileSync(path.join(RUN, 'dev.json'), 'utf8')) as { marker?: string }).marker;
    sameDir = !!me && realpathSync(me.data) === realpathSync(path.join(RUN, 'pg17'));
  } catch {} // no .run/ here: the checks below refuse
  const problems = [
    me?.host === '127.0.0.1' ? '' : 'not a 127.0.0.1 connection',
    sameDir ? '' : 'not the cluster in .run/pg17',
    marker && me?.note === `munshi-dev ${marker}` ? '' : 'the database lacks this .run/ marker',
    me?.super ? '' : 'not a superuser connection',
  ].filter(Boolean);
  if (problems.length) throw new Error(`reseed: refusing to wipe: ${problems.join('; ')}`);
}

const started = Date.now();
const admin = new pg.Client({ connectionString: url });
await admin.connect();
// Every write as the role whose job it is: the seed as the app, the watchers as the jobs role.
const app = new pg.Pool({ connectionString: url, max: 4, options: '-c role=munshi_app' });
const jobs = new pg.Pool({ connectionString: url, max: 2, options: '-c role=munshi_jobs' });
const pub = new pg.Pool({ connectionString: url, max: 2, options: '-c role=munshi_public' });
const platform = new pg.Pool({ connectionString: url, max: 2, options: '-c role=munshi_platform' });
try {
  await assertDevCluster(admin);
  let wiped = 0;
  let operators = 0;
  await admin.query('begin');
  try {
    // Held until commit: no tenant can be added between the check and the wipe.
    await admin.query('lock table ops.tenant in access exclusive mode');
    const { rows: tenants } = await admin.query<{ name: string; data_class: string }>('select name, data_class from ops.tenant');
    const real = tenants.filter((t) => !t.name.endsWith('(synthetic)') && !(t.data_class === 'synthetic' && t.name === BANSAL) && !(t.data_class === 'showcase' && (t.name === ELITE || t.name === PRABHAVE)));
    if (real.length) throw new Error(`reseed: refusing to wipe ${real.length} tenant(s) that are not synthetic or the showcase`);
    await admin.query('truncate ops.tenant cascade');
    const { rows: ops } = await admin.query<{ n: number; others: number }>(
      'select count(*)::int as n, count(*) filter (where display_name <> $1)::int as others from platform.operator',
      [SHOWCASE_OPERATOR],
    );
    if (ops[0]?.n && !ops[0].others) await admin.query('truncate platform.operator cascade');
    operators = ops[0]?.others ?? 0;
    await admin.query('commit');
    wiped = tenants.length;
  } catch (err) {
    await admin.query('rollback');
    throw err;
  }
  for (const [pool, role] of [
    [app, 'munshi_app'],
    [jobs, 'munshi_jobs'],
    [pub, 'munshi_public'],
    [platform, 'munshi_platform'],
  ] as const) {
    const { rows } = await pool.query<{ role: string }>('select current_user as role');
    if (rows[0]?.role !== role) throw new Error(`reseed: the ${role} pool must run as ${role}`);
  }
  const k = await seedKirana(app);
  // PayPal sandbox on the kirana (recorded mode): a customer reachable on WhatsApp, and a paid link the books do not show.
  await seedKiranaPaypal({ app, jobs, pub }, k);
  const w = await runWatchers(jobs, k.tenantId, k.asOf);
  const c = k.counts;
  console.log(
    `reseed: wiped ${wiped} synthetic tenant(s); seeded ${SHOP} as of ${k.asOf}: ` +
      `${k.items.size} SKUs, ${c.sales} sales, ${c.purchases} bills, ${k.customers.size} credit customers, ${c.payments} repayments, ` +
      `${c.settlements} settlements, ${c.stockCounts} counts; watchers raised ${w.raised.length} findings`,
  );
  const b = await seedBansal(app, { asOf: k.asOf });
  const bw = await runWatchers(jobs, b.tenantId, b.asOf);
  console.log(`reseed: seeded ${BANSAL} as of ${b.asOf}: ${b.items.size} SKUs, ${b.counts.sales} sales, ${b.counts.settlements} settlements; watchers raised ${bw.raised.length} findings`);
  const sc = await seedShowcase({ app, pub, platform }, admin, { verify: operators === 0 });
  let raised = 0;
  for (const tenantId of [sc.elite.tenantId, sc.prabhave.tenantId]) raised += (await runWatchers(jobs, tenantId, sc.asOf)).raised.length;
  console.log(
    `reseed: seeded ${ELITE} and ${PRABHAVE} as of ${sc.asOf}; ` +
      `${sc.verifications.length ? 'both sites verified by the seed operator' : `sites left unverified: ${operators} other operator(s) exist`}; ` +
      `watchers raised ${raised} findings; ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await platform.end();
  await pub.end();
  await jobs.end();
  await app.end();
  await admin.end();
}
