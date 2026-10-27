// pnpm reseed — rebuilds the demo shop in one command: migrate, wipe every tenant, seed "Sharma General Store
// (synthetic)" as munshi_app through packages/core, run the watchers once. For a DEV database only: DATABASE_URL must be
// a superuser connection (it is never printed), and the wipe refuses if any tenant is not synthetic. Books are
// append-only for every runtime role; only this admin path, on a dev database, truncates them.
import { runWatchers } from '@munshi/core';
import pg from 'pg';
import { migrate } from '../src/migrate.ts';
import { SHOP, seedKirana } from './kirana.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('reseed: DATABASE_URL is not set (a superuser connection to a dev database)');
  process.exit(1);
}
const started = Date.now();
const admin = new pg.Client({ connectionString: url });
await admin.connect();
const app = new pg.Pool({ connectionString: url, max: 4, options: '-c role=munshi_app' }); // every write as the app role
try {
  const { rows: who } = await admin.query<{ super: boolean }>('select rolsuper as super from pg_roles where rolname = current_user');
  if (!who[0]?.super) throw new Error('reseed: needs a superuser connection to a dev database');
  const ran = await migrate(admin);
  const { rows: tenants } = await admin.query<{ name: string }>('select name from ops.tenant');
  const real = tenants.filter((t) => !t.name.endsWith('(synthetic)'));
  if (real.length) throw new Error(`reseed: refusing to wipe ${real.length} tenant(s) that are not synthetic`);
  await admin.query('truncate ops.tenant cascade');
  const { rows: role } = await app.query<{ role: string }>('select current_user as role');
  if (role[0]?.role !== 'munshi_app') throw new Error('reseed: the seed must write as munshi_app');
  const k = await seedKirana(app);
  const w = await runWatchers(app, k.tenantId, k.asOf);
  const c = k.counts;
  console.log(
    `reseed: ${ran.length ? `applied ${ran.join(', ')}; ` : ''}wiped ${tenants.length} synthetic tenant(s); seeded ${SHOP} as of ${k.asOf}: ` +
      `${k.items.size} SKUs, ${c.sales} sales, ${c.purchases} bills, ${k.customers.size} credit customers, ${c.payments} repayments, ` +
      `${c.settlements} settlements, ${c.stockCounts} counts; watchers raised ${w.raised.length} findings; ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await app.end();
  await admin.end();
}
