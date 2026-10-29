// pnpm reseed — rebuilds the demo shop in one command: wipe every tenant, seed "Sharma General Store (synthetic)" as
// munshi_app through packages/core, run the watchers once as munshi_jobs. For the local dev database only (the one
// `pnpm dev` makes, built from db/schema; `pnpm db:reset` rebuilds the schema itself): DATABASE_URL must be a superuser
// connection to it (never printed). Before the wipe it proves the target is that cluster, as db/src/dev.ts does: a
// 127.0.0.1 connection, the data directory .run/pg17, and the database comment holding this .run/dev.json marker. The
// wipe then runs in one transaction that holds an exclusive lock on ops.tenant while it checks every tenant is synthetic
// and truncates. Books are append-only for every runtime role; only this admin path, on that database, truncates them.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWatchers } from '@munshi/core';
import pg from 'pg';
import { SHOP, seedKirana } from './kirana.ts';

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
try {
  await assertDevCluster(admin);
  let wiped = 0;
  await admin.query('begin');
  try {
    // Held until commit: no tenant can be added between the check and the wipe.
    await admin.query('lock table ops.tenant in access exclusive mode');
    const { rows: tenants } = await admin.query<{ name: string }>('select name from ops.tenant');
    const real = tenants.filter((t) => !t.name.endsWith('(synthetic)'));
    if (real.length) throw new Error(`reseed: refusing to wipe ${real.length} tenant(s) that are not synthetic`);
    await admin.query('truncate ops.tenant cascade');
    await admin.query('commit');
    wiped = tenants.length;
  } catch (err) {
    await admin.query('rollback');
    throw err;
  }
  for (const [pool, role] of [
    [app, 'munshi_app'],
    [jobs, 'munshi_jobs'],
  ] as const) {
    const { rows } = await pool.query<{ role: string }>('select current_user as role');
    if (rows[0]?.role !== role) throw new Error(`reseed: the ${role === 'munshi_app' ? 'seed' : 'watchers'} must run as ${role}`);
  }
  const k = await seedKirana(app);
  const w = await runWatchers(jobs, k.tenantId, k.asOf);
  const c = k.counts;
  console.log(
    `reseed: wiped ${wiped} synthetic tenant(s); seeded ${SHOP} as of ${k.asOf}: ` +
      `${k.items.size} SKUs, ${c.sales} sales, ${c.purchases} bills, ${k.customers.size} credit customers, ${c.payments} repayments, ` +
      `${c.settlements} settlements, ${c.stockCounts} counts; watchers raised ${w.raised.length} findings; ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await jobs.end();
  await app.end();
  await admin.end();
}
