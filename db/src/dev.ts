// pnpm dev — the whole app on this machine, from a clean .run/: an embedded PostgreSQL 17 in .run/pg17 (passwords and
// the session secret generated under .run/, never printed), bootstrapped and built from db/schema (db:reset's path),
// the demo shop seeded as munshi_app and its watchers run as munshi_jobs, one reorder drafted from the shelf gap the
// watchers found, then `next dev` for apps/web with every setting its boot check requires (webEnv) and the dev ticker
// (scripts/dev-ticker.ts) with the same CRON_SECRET. The app reads nothing under .run/: its secrets arrive as
// environment variables.
//
// The build drops every Munshi schema, so before it runs dev proves the target is this dev cluster: a 127.0.0.1
// connection, the data directory .run/pg17, and the database comment it wrote with the marker in .run/dev.json; reset()
// checks the cluster again before it builds.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, proposeDraft, runWatchers, withTx } from '@munshi/core';
import pg from 'pg';
import { ELITE } from '../seed/elite.ts';
import { SHOP, seedKirana } from '../seed/kirana.ts';
import { PRABHAVE } from '../seed/prabhave.ts';
import { seedShowcase } from '../seed/showcase.ts';
import { reset } from './reset.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUN = path.join(ROOT, '.run');
const PGDATA = path.join(RUN, 'pg17');
const DATABASE = 'munshi_dev';
const SUPERUSER = 'postgres';

type Secrets = { superuser: string; app: string; marker: string };
type Cell = { k: string; t?: string; n?: string };

// The demo's waiting draft: reorder what the largest shelf gap lost, from the supplier of the item's latest bill. Its
// quantity is the gap's own `missing` cell (its payload ref, which the card shows), cited with the rest of the row, so a
// later change to the count makes the draft stale. A watcher's run has no member to propose for, so the shop's owner
// proposes it, naming the finding.
export async function proposeDemoDraft(app: pg.Pool, tenantId: string): Promise<string> {
  const found = await withTx(app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string; snapshot_id: string; snapshot_row: number; columns: { n: string }[]; row: Cell[] }>(
      `select f.id, f.snapshot_id::text as snapshot_id, f.snapshot_row, s.columns, s.rows -> f.snapshot_row as row
         from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
        where f.kind = 'shrinkage' and f.status = 'open'
        order by f.created_at`,
    );
    const cell = (f: (typeof rows)[number], col: string) => f.row[f.columns.findIndex((x) => x.n === col)];
    const gap = rows
      .map((f) => ({ ...f, itemId: cell(f, 'item_id')?.t as string, missing: Number(cell(f, 'missing')?.n) }))
      .sort((a, b) => b.missing - a.missing)[0];
    if (!gap) throw new Error('dev: the watchers found no shelf gap to draft a reorder from');
    const { rows: bill } = await c.query<{ supplier_id: string }>(
      `select p.supplier_id from books.purchase_line pl join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
        where pl.item_id = $1 order by p.bill_date desc, pl.created_at desc limit 1`,
      [gap.itemId],
    );
    if (!bill[0]) throw new Error('dev: the shelf-gap item has no bill to reorder from');
    const { rows: owner } = await c.query<{ id: string }>(`select id::text from ops.member where role = 'owner' and active order by created_at limit 1`);
    return { ...gap, supplierId: bill[0].supplier_id, owner: owner[0]?.id as string };
  });
  const session = await openSession(app, tenantId, found.owner);
  if (!session) throw new Error('dev: the demo shop has no active owner');
  const cite = (col: string) => ({ snapshotId: found.snapshot_id, row: found.snapshot_row, col });
  return proposeDraft(
    app,
    { session },
    {
      command: 'reorder.place',
      payload: { supplierId: found.supplierId, lines: [{ itemId: found.itemId, qtyMilli: found.missing }] },
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

/** The dev cluster's logins and their passwords, generated once under .run/. */
export type Logins = Record<'munshi_app' | 'munshi_agent' | 'munshi_jobs' | 'munshi_platform' | 'munshi_public' | 'munshi_idp', string>;

// What next dev needs beyond the shell's environment: every setting the app's boot check requires
// (apps/web/lib/server/db.ts), each pool connecting as its own role. Pure, and never logged: the values are passwords
// and secrets.
export function webEnv(port: number, logins: Logins, secrets: { session: string; cron: string; identity: string; rate: string }, demoTenantId: string): Record<string, string> {
  const as = (role: keyof Logins) => url(role, logins[role], port, DATABASE);
  return {
    DATABASE_URL: as('munshi_app'),
    AGENT_DATABASE_URL: as('munshi_agent'),
    JOBS_DATABASE_URL: as('munshi_jobs'),
    PLATFORM_DATABASE_URL: as('munshi_platform'),
    PUBLIC_DATABASE_URL: as('munshi_public'),
    IDP_DATABASE_URL: as('munshi_idp'),
    MUNSHI_DEPLOYMENT: 'demo',
    MUNSHI_SESSION_SECRET: secrets.session,
    MUNSHI_DEMO_TENANT_ID: demoTenantId,
    CRON_SECRET: secrets.cron,
    // Real sign-in's keys: unused on the demo (real sign-in is 404 there) but the sample-shop sign-up's per-IP limit
    // keys its IP hash on the rate secret, as a deploy's would.
    MUNSHI_IDENTITY_SECRET: secrets.identity,
    MUNSHI_RATE_SECRET: secrets.rate,
  };
}

// Refuses unless this connection is the dev cluster dev.ts made: before any build or seed.
async function assertDevCluster(admin: pg.Client, marker: string): Promise<void> {
  const { rows } = await admin.query<{ host: string | null; data: string; note: string | null; super: boolean }>(
    `select host(inet_server_addr()) as host, current_setting('data_directory') as data,
            shobj_description(d.oid, 'pg_database') as note, r.rolsuper as super
       from pg_database d, pg_roles r where d.datname = current_database() and r.rolname = current_user`,
  );
  const me = rows[0];
  const problems = [
    me?.host === '127.0.0.1' ? '' : 'not a 127.0.0.1 connection',
    me && realpathSync(me.data) === realpathSync(PGDATA) ? '' : 'not the cluster in .run/pg17',
    me?.note === `munshi-dev ${marker}` ? '' : 'the database lacks this .run/ marker',
    me?.super ? '' : 'not a superuser connection',
  ].filter(Boolean);
  if (problems.length) throw new Error(`dev: refusing to build or seed: ${problems.join('; ')}`);
}

// Recorded model answers (the default) replay questions asked as of 27 Oct 2026, so the demo shop is seeded as of that
// day; with a live model the shop is seeded as of today (seedKirana's default).
export const RECORDED_AS_OF = '2026-10-27';
export const seedDate = (mode: string | undefined): { asOf: string | undefined; label: string } =>
  (mode || 'recorded') === 'recorded' ? { asOf: RECORDED_AS_OF, label: `${RECORDED_AS_OF} (recorded mode: the day the recorded answers replay)` } : { asOf: undefined, label: 'today (live mode)' };

// After a fresh build there is no tenant to wipe: the seed writes as the app, the watchers run as the jobs role. The two
// showcase tenants follow (db/seed/showcase.ts), as of tomorrow whatever the model mode: provisioned and their release
// published through `owner` (the dev superuser, as the owner role), the site's asks and carts on the public pool, and
// both sites verified by the seed's own operator on the platform pool (its secrets are made for the run and never kept,
// so nobody signs in as it).
async function reseed(app: pg.Pool, jobs: pg.Pool, showcase: { pub: pg.Pool; platform: pg.Pool; owner: pg.ClientBase }): Promise<{ tenantId: string; summary: string }> {
  const { rows: who } = await app.query<{ role: string; super: boolean }>(
    'select current_user as role, rolsuper as super from pg_roles where rolname = current_user',
  );
  if (who[0]?.role !== 'munshi_app' || who[0].super) throw new Error('dev: the seed must write as munshi_app');
  const when = seedDate(process.env.MUNSHI_MODEL_MODE);
  const k = await seedKirana(app, when.asOf ? { asOf: when.asOf } : {});
  const w = await runWatchers(jobs, k.tenantId, k.asOf);
  await proposeDemoDraft(app, k.tenantId);
  const sc = await seedShowcase({ app, pub: showcase.pub, platform: showcase.platform }, showcase.owner);
  let raised = 0;
  for (const tenantId of [sc.elite.tenantId, sc.prabhave.tenantId]) raised += (await runWatchers(jobs, tenantId, sc.asOf)).raised.length;
  return {
    tenantId: k.tenantId,
    summary:
      `${SHOP} as of ${when.label}: ${k.counts.sales} sales; watchers raised ${w.raised.length} findings; 1 reorder drafted; ` +
      `${ELITE} and ${PRABHAVE} as of ${sc.asOf}, both sites verified: watchers raised ${raised} findings`,
  };
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
  const sessionSecret = secretFile(path.join(RUN, 'session-secret'), () => randomBytes(32).toString('hex'));
  const cronSecret = secretFile(path.join(RUN, 'cron-secret'), () => randomBytes(32).toString('hex'));
  const identitySecret = secretFile(path.join(RUN, 'identity-secret'), () => randomBytes(32).toString('hex'));
  const rateSecret = secretFile(path.join(RUN, 'rate-secret'), () => randomBytes(32).toString('hex'));
  // The other logins, each in its own file so a dev.json written before it existed still works.
  const password = (name: string) => secretFile(path.join(RUN, `${name}-password`), () => randomBytes(24).toString('hex'));
  const logins: Logins = {
    munshi_app: secrets.app,
    munshi_agent: password('agent'),
    munshi_jobs: password('jobs'),
    munshi_platform: password('platform'),
    munshi_public: password('public'),
    munshi_idp: password('idp'),
  };
  const migratorPassword = password('migrator');

  // Loaded here, not at the top: importing embedded-postgres registers exit hooks, and tests import this module.
  const { default: EmbeddedPostgres } = await import('embedded-postgres-17');
  const port = await freePort();
  const cluster = new EmbeddedPostgres({ databaseDir: PGDATA, port, user: SUPERUSER, password: secrets.superuser, persistent: true, initdbFlags: ['--encoding=UTF8'], onLog: () => {} });
  const started = Date.now();
  try {
    if (!existsSync(path.join(PGDATA, 'PG_VERSION'))) await cluster.initialise();
    await cluster.start(); // rejects with no reason when postgres exits early
  } catch {
    console.error('dev: the embedded Postgres in .run/pg17 did not start (is another pnpm dev still running?)');
    process.exit(1);
  }
  let web: ReturnType<typeof spawn> | undefined;
  let ticker: ReturnType<typeof spawn> | undefined;
  let demoTenantId = '';
  const stop = async (code: number) => {
    ticker?.kill('SIGTERM');
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
    const app = new pg.Pool({ connectionString: url('munshi_app', logins.munshi_app, port, DATABASE), max: 4 });
    const jobs = new pg.Pool({ connectionString: url('munshi_jobs', logins.munshi_jobs, port, DATABASE), max: 2 });
    const pub = new pg.Pool({ connectionString: url('munshi_public', logins.munshi_public, port, DATABASE), max: 2 });
    const platform = new pg.Pool({ connectionString: url('munshi_platform', logins.munshi_platform, port, DATABASE), max: 2 });
    try {
      await assertDevCluster(admin, secrets.marker);
      const built = await reset(admin, url('munshi_migrator', migratorPassword, port, DATABASE));
      // Every login webEnv hands the app, so each of its pools can connect.
      for (const [role, secret] of Object.entries(logins)) {
        await admin.query(`alter role ${role} password '${secret}'`); // hex: nothing to escape
      }
      const { tenantId, summary } = await reseed(app, jobs, { pub, platform, owner: admin });
      demoTenantId = tenantId;
      console.log(`dev: built ${built.files.length} schema file(s); seeded ${summary} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } finally {
      await platform.end();
      await pub.end();
      await jobs.end();
      await app.end();
      await admin.end();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'dev: failed');
    await stop(1);
  }

  const webDir = path.join(ROOT, 'apps', 'web');
  const webPort = process.env.PORT ?? '3000';
  // localhost only: the demo sign-in has no password, so the app is not offered to the network.
  web = spawn(path.join(webDir, 'node_modules', '.bin', 'next'), ['dev', '--hostname', 'localhost', '--port', webPort], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, ...webEnv(port, logins, { session: sessionSecret, cron: cronSecret, identity: identitySecret, rate: rateSecret }, demoTenantId) },
  });
  // The jobs tick once a minute (BLUEPRINT §4.4). Its first tick may come before next dev answers; it says so and
  // tries again a minute later.
  ticker = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-ticker.ts')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CRON_SECRET: cronSecret, MUNSHI_TICK_URL: `http://localhost:${webPort}/api/internal/tick` },
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => web?.kill(signal));
  web.on('exit', (code) => void stop(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
