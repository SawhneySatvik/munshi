// pnpm dev — the whole app on this machine, from a clean .run/: an embedded Postgres in .run/pg (passwords and the
// session secret generated under .run/, never printed), migrated, the demo shop reseeded and its watchers run, one
// reorder drafted from the shelf gap the watchers found, then `next dev` for apps/web connected as munshi_app.
//
// The reseed wipes every tenant, so before migrating it proves the target is this dev cluster: a 127.0.0.1 connection,
// the data directory .run/pg, and the database comment it wrote with the marker in .run/dev.json. The wipe runs in one
// transaction that holds an exclusive lock on ops.tenant while it checks that every tenant is synthetic and truncates.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeDraft, runWatchers, withTx } from '@munshi/core';
import pg from 'pg';
import { SHOP, seedKirana } from '../seed/kirana.ts';
import { migrate } from './migrate.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUN = path.join(ROOT, '.run');
const PGDATA = path.join(RUN, 'pg');
const DATABASE = 'munshi_dev';
const SUPERUSER = 'postgres';

type Secrets = { superuser: string; app: string; marker: string };

// The demo's waiting draft: reorder what the largest shelf gap lost, from the supplier of the item's latest bill. Its
// quantity is the gap's own `missing` cell (its payload ref, which the card shows), cited with the rest of the row, so a
// later change to the count makes the draft stale. Proposed by the watcher run that found the gap (no actor).
export async function proposeDemoDraft(app: pg.Pool, tenantId: string): Promise<string> {
  const found = await withTx(app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string; run_id: string; snapshot_id: string; snapshot_row: number; item_id: string; missing: string }>(
      `select f.id, f.run_id, f.snapshot_id, f.snapshot_row, i.txt as item_id, m.num::text as missing
         from ops.finding f
         join snap.snapshot_cell i on i.snapshot_id = f.snapshot_id and i.row_no = f.snapshot_row and i.col = 'item_id'
         join snap.snapshot_cell m on m.snapshot_id = f.snapshot_id and m.row_no = f.snapshot_row and m.col = 'missing'
        where f.kind = 'shrinkage' and f.status = 'open'
        order by m.num desc, f.created_at limit 1`,
    );
    const gap = rows[0];
    if (!gap) throw new Error('dev: the watchers found no shelf gap to draft a reorder from');
    const { rows: bill } = await c.query<{ supplier_id: string }>(
      `select p.supplier_id from books.purchase_line pl join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
        where pl.item_id = $1 order by p.bill_date desc, pl.created_at desc limit 1`,
      [gap.item_id],
    );
    if (!bill[0]) throw new Error('dev: the shelf-gap item has no bill to reorder from');
    return { ...gap, supplierId: bill[0].supplier_id };
  });
  const cite = (col: string) => ({ snapshotId: found.snapshot_id, row: found.snapshot_row, col });
  return proposeDraft(
    app,
    { tenantId, runId: found.run_id },
    {
      command: 'reorder.place',
      payload: { supplierId: found.supplierId, lines: [{ itemId: found.item_id, qtyMilli: Number(found.missing) }] },
      basedOn: ['item_id', 'expected', 'counted', 'missing'].map(cite),
      payloadRefs: { 'lines[0].qtyMilli': cite('missing') },
      findingId: found.id,
    },
  );
}

function secretFile(file: string, make: () => string): string {
  if (!existsSync(file)) {
    writeFileSync(file, make(), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return readFileSync(file, 'utf8');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('dev: no free port'))));
    });
  });
}

const url = (user: string, password: string, port: number, database: string) =>
  `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;

// Refuses unless this connection is the dev cluster dev.ts made: before any migration or wipe.
async function assertDevCluster(admin: pg.Client, marker: string): Promise<void> {
  const { rows } = await admin.query<{ host: string | null; data: string; note: string | null; super: boolean }>(
    `select host(inet_server_addr()) as host, current_setting('data_directory') as data,
            shobj_description(d.oid, 'pg_database') as note, r.rolsuper as super
       from pg_database d, pg_roles r where d.datname = current_database() and r.rolname = current_user`,
  );
  const me = rows[0];
  const problems = [
    me?.host === '127.0.0.1' ? '' : 'not a 127.0.0.1 connection',
    me && realpathSync(me.data) === realpathSync(PGDATA) ? '' : 'not the cluster in .run/pg',
    me?.note === `munshi-dev ${marker}` ? '' : 'the database lacks this .run/ marker',
    me?.super ? '' : 'not a superuser connection',
  ].filter(Boolean);
  if (problems.length) throw new Error(`dev: refusing to migrate or reseed: ${problems.join('; ')}`);
}

async function reseed(admin: pg.Client, app: pg.Pool): Promise<{ tenantId: string; summary: string }> {
  await admin.query('begin');
  try {
    // Held until commit: no tenant can be added between the check and the wipe.
    await admin.query('lock table ops.tenant in access exclusive mode');
    const { rows } = await admin.query<{ name: string }>('select name from ops.tenant');
    if (rows.some((t) => !t.name.endsWith('(synthetic)'))) throw new Error('dev: refusing to wipe a tenant that is not synthetic');
    await admin.query('truncate ops.tenant cascade');
    await admin.query('commit');
  } catch (err) {
    await admin.query('rollback');
    throw err;
  }
  const { rows: who } = await app.query<{ role: string; super: boolean }>(
    'select current_user as role, rolsuper as super from pg_roles where rolname = current_user',
  );
  if (who[0]?.role !== 'munshi_app' || who[0].super) throw new Error('dev: the seed must write as munshi_app');
  const k = await seedKirana(app);
  const w = await runWatchers(app, k.tenantId, k.asOf);
  await proposeDemoDraft(app, k.tenantId);
  return { tenantId: k.tenantId, summary: `${SHOP} as of ${k.asOf}: ${k.counts.sales} sales; watchers raised ${w.raised.length} findings; 1 reorder drafted` };
}

async function main(): Promise<void> {
  mkdirSync(RUN, { recursive: true, mode: 0o700 });
  const fresh = !existsSync(path.join(RUN, 'dev.json'));
  if (fresh) rmSync(PGDATA, { recursive: true, force: true }); // its superuser password went with the old dev.json
  const secrets = JSON.parse(
    secretFile(path.join(RUN, 'dev.json'), () =>
      JSON.stringify({ superuser: randomBytes(24).toString('hex'), app: randomBytes(24).toString('hex'), marker: randomBytes(16).toString('hex') }),
    ),
  ) as Secrets;
  secretFile(path.join(RUN, 'session-secret'), () => randomBytes(32).toString('hex'));

  // Loaded here, not at the top: importing embedded-postgres registers exit hooks, and tests import this module.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const cluster = new EmbeddedPostgres({ databaseDir: PGDATA, port, user: SUPERUSER, password: secrets.superuser, persistent: true, onLog: () => {} });
  const started = Date.now();
  try {
    if (!existsSync(path.join(PGDATA, 'PG_VERSION'))) await cluster.initialise();
    await cluster.start(); // rejects with no reason when postgres exits early
  } catch {
    console.error('dev: the embedded Postgres in .run/pg did not start (is another pnpm dev still running?)');
    process.exit(1);
  }
  let web: ReturnType<typeof spawn> | undefined;
  const stop = async (code: number) => {
    web?.kill('SIGTERM');
    await cluster.stop();
    process.exit(code); // explicit: embedded-postgres's beforeExit hook would otherwise exit 0
  };
  try {
    const server = new pg.Client({ connectionString: url(SUPERUSER, secrets.superuser, port, 'postgres') });
    await server.connect();
    const { rows } = await server.query('select 1 from pg_database where datname = $1', [DATABASE]);
    if (!rows.length) {
      await server.query(`create database ${DATABASE}`);
      await server.query(`comment on database ${DATABASE} is 'munshi-dev ${secrets.marker}'`);
    }
    await server.end();

    const admin = new pg.Client({ connectionString: url(SUPERUSER, secrets.superuser, port, DATABASE) });
    await admin.connect();
    const app = new pg.Pool({ connectionString: url('munshi_app', secrets.app, port, DATABASE), max: 4 });
    try {
      await assertDevCluster(admin, secrets.marker);
      const ran = await migrate(admin);
      await admin.query(`alter role munshi_app password '${secrets.app}'`); // hex: nothing to escape
      const { tenantId, summary } = await reseed(admin, app);
      writeFileSync(path.join(RUN, 'demo-tenant'), tenantId, { mode: 0o600 });
      console.log(`dev: ${ran.length ? `applied ${ran.length} migration(s); ` : ''}seeded ${summary} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } finally {
      await app.end();
      await admin.end();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'dev: failed');
    await stop(1);
  }

  const webDir = path.join(ROOT, 'apps', 'web');
  // localhost only: the demo sign-in has no password, so the app is not offered to the network.
  web = spawn(path.join(webDir, 'node_modules', '.bin', 'next'), ['dev', '--hostname', 'localhost', '--port', process.env.PORT ?? '3000'], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url('munshi_app', secrets.app, port, DATABASE) },
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => web?.kill(signal));
  web.on('exit', (code) => void stop(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
