// pnpm dev — the whole app on this machine, from a clean .run/: an embedded PostgreSQL 17 in .run/pg17 (passwords and
// the session secret generated under .run/, never printed), bootstrapped and built from db/schema (db:reset's path),
// the demo shop seeded as munshi_app and its watchers run as munshi_jobs, one reorder drafted from the shelf gap the
// watchers found, then `next dev` for apps/web with every setting its boot check requires (webEnv) and the dev ticker
// (scripts/dev-ticker.ts) with the same CRON_SECRET, redis-server on a socket in .run/ for the cache (MUNSHI_CACHE_URL),
// and the widget demo page on localhost:4173. The app reads nothing under .run/: its secrets arrive as environment
// variables.
//
// The build drops every Munshi schema, so before it runs dev proves the target is this dev cluster: a 127.0.0.1
// connection, the data directory .run/pg17, and the database comment it wrote with the marker in .run/dev.json; reset()
// checks the cluster again before it builds.
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Capability, issueSiteKey, openSession, proposeDraft, publishRelease, runWatchers, switchCapability, withTx } from '@munshi/core';
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

// The widget demo (design/widget-demo/index.html, BP-WID-1): the apparel showcase's site lists the demo page's origin and
// its owner issues a fresh publishable key for it. A publishable key is made to sit in a public page, so dev prints it
// in the demo's address; the database keeps only its sha256.
export const WIDGET_DEMO_PORT = 4173;
export async function widgetDemoSite(app: pg.Pool, tenantId: string, origin: string): Promise<{ slug: string; key: string }> {
  const ownerId = await withTx(app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(`select id::text from ops.member where role = 'owner' and active order by created_at limit 1`);
    return rows[0]?.id;
  });
  const session = ownerId ? await openSession(app, tenantId, ownerId) : null;
  if (!session) throw new Error('dev: the widget demo shop has no active owner');
  return withTx(app, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ id: string; slug: string }>(
      `select s.id::text as id, d.slug from ops.site s cross join ops.tenant_directory d where d.tenant_id = s.tenant_id order by s.created_at, s.id limit 1`,
    );
    const site = rows[0];
    if (!site) throw new Error('dev: the widget demo shop has no site');
    await c.query('update ops.site set origins = array_append(origins, $2) where id = $1 and not ($2 = any(origins))', [site.id, origin]);
    const { key } = await issueSiteKey(c, site.id, site.slug);
    return { slug: site.slug, key };
  });
}

// The hosted shop sites (apps/sites, BP-SITES-1): each showcase site lists the sites app's origin and gets its own
// publishable key, as the widget demo does. Elite's seed stops short of a public site, so its look (empty: the look is
// the site app's), its stylists' public profiles (the invented stylists, under their seed names) and its release are
// made here, the release as the owner role as the Prabhave seed publishes its own. `off` (dev's MUNSHI_DEV_SITE_OFF,
// `<slug>:<capability>`) switches one capability off and republishes, so the sites can be seen with it off.
export const SITES_DEMO_PORT = 3150;
export async function sitesDemo(
  app: pg.Pool,
  owner: pg.ClientBase,
  sites: { tenantId: string; stylists?: Map<string, string> }[],
  origin: string,
  off?: string,
): Promise<{ slug: string; key: string }[]> {
  const keys: { slug: string; key: string }[] = [];
  for (const { tenantId, stylists } of sites) {
    const made = await widgetDemoSite(app, tenantId, origin);
    const { rows } = await withTx(app, { kind: 'system', tenantId }, (c) =>
      c.query<{ site: string; owner: string; looks: number }>(
        `select s.id::text as site, (select id::text from ops.member where role = 'owner' and active order by created_at limit 1) as owner,
                (select count(*)::int from ops.site_look l where l.site_id = s.id) as looks
           from ops.site s order by s.created_at limit 1`,
      ),
    );
    const site = rows[0];
    const session = site ? await openSession(app, tenantId, site.owner) : null;
    if (!site || !session) throw new Error('dev: a showcase site has no owner');
    let publish = false;
    if (site.looks === 0) {
      await withTx(app, { kind: 'member', session }, async (c) => {
        await c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{}', 'inter')`, [tenantId, site.site]);
        for (const [name, staffId] of stylists ?? []) {
          await c.query(
            `insert into ops.staff_public (tenant_id, staff_id, shop_id, display_name, consent_at)
             select tenant_id, staff_id, shop_id, $2, now() - interval '1 minute' from books.staff_terms
              where staff_id = $1 order by effective_from desc limit 1`,
            [staffId, name],
          );
        }
      });
      publish = true;
    }
    const [offSlug, capability] = (off ?? '').split(':');
    if (offSlug === made.slug && capability) {
      await switchCapability(app, session, capability as Capability, false);
      publish = true;
    }
    if (publish) {
      await owner.query('begin');
      try {
        await owner.query('set local role munshi_owner');
        await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
        const { rows: look } = await owner.query<{ id: string }>('select id::text from ops.site_look where site_id = $1 order by created_at desc limit 1', [site.site]);
        await publishRelease(owner as pg.PoolClient, { siteId: site.site, lookId: look[0]?.id as string });
        await owner.query('commit');
      } catch (err) {
        await owner.query('rollback');
        throw err;
      }
    }
    keys.push(made);
  }
  return keys;
}

// The demo page, and nothing else, on localhost.
function serveWidgetDemo(port: number): ReturnType<typeof createHttpServer> {
  const page = readFileSync(path.join(ROOT, 'design', 'widget-demo', 'index.html'));
  const server = createHttpServer((req, res) => {
    const known = req.method === 'GET' && (req.url?.split('?')[0] === '/' || req.url?.split('?')[0] === '/index.html');
    res.writeHead(known ? 200 : 404, { 'content-type': known ? 'text/html; charset=utf-8' : 'text/plain', 'cache-control': 'no-store' });
    res.end(known ? page : 'not found');
  });
  server.on('error', () => console.error(`dev: the widget demo could not listen on localhost:${port}`));
  server.listen(port, 'localhost');
  return server;
}

// The cache (BLUEPRINT §4.8): redis-server on a Unix socket in .run/ (no TCP port, no persistence), stopped with dev.
// Without redis-server on PATH the app keeps its in-process memory cache.
function startRedis(): { child: ReturnType<typeof spawn>; url: string } | undefined {
  if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error('dev: redis-server is not on PATH; the app uses its memory cache');
    return undefined;
  }
  const socket = path.join(RUN, 'redis.sock');
  rmSync(socket, { force: true });
  const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700', '--save', '', '--appendonly', 'no', '--dir', RUN], {
    stdio: 'ignore',
  });
  child.on('error', () => console.error('dev: redis-server did not start; the app reads Postgres for every request'));
  return { child, url: `unix://${socket}` };
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
async function reseed(
  app: pg.Pool,
  jobs: pg.Pool,
  showcase: { pub: pg.Pool; platform: pg.Pool; owner: pg.ClientBase },
): Promise<{ tenantId: string; widgetTenantId: string; sites: { tenantId: string; stylists?: Map<string, string> }[]; summary: string }> {
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
    widgetTenantId: sc.prabhave.tenantId,
    sites: [{ tenantId: sc.elite.tenantId, stylists: sc.elite.staff }, { tenantId: sc.prabhave.tenantId }],
    summary:
      `${SHOP} as of ${when.label}: ${k.counts.sales} sales; watchers raised ${w.raised.length} findings; 1 reorder drafted; ` +
      `${ELITE} and ${PRABHAVE} as of ${sc.asOf}, both sites verified: watchers raised ${raised} findings`,
  };
}

async function main(): Promise<void> {
  mkdirSync(RUN, { recursive: true, mode: 0o700 });
  const fresh = !existsSync(path.join(RUN, 'dev.json'));
  if (fresh) rmSync(PGDATA, { recursive: true, force: true }); // its superuser password went with the old dev.json
  // As root (a cloud container), embedded-postgres runs the cluster as the machine's postgres user, which must reach and
  // own the data directory: .run becomes traversable (its secrets stay 0600, root's) and pg17 is postgres's.
  if (process.getuid?.() === 0) {
    const id = (flag: string) => Number(spawnSync('id', [flag, 'postgres'], { encoding: 'utf8' }).stdout.trim());
    mkdirSync(PGDATA, { recursive: true, mode: 0o700 });
    chmodSync(RUN, 0o711);
    chownSync(PGDATA, id('-u'), id('-g'));
  }
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
  let demo: ReturnType<typeof createHttpServer> | undefined;
  let redis: ReturnType<typeof startRedis>;
  let demoTenantId = '';
  let widget: { slug: string; key: string } | undefined;
  let siteKeys: { slug: string; key: string }[] = [];
  const webPort = process.env.PORT ?? '3000';
  const stop = async (code: number) => {
    demo?.close();
    redis?.child.kill('SIGTERM');
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
      const { tenantId, widgetTenantId, sites, summary } = await reseed(app, jobs, { pub, platform, owner: admin });
      demoTenantId = tenantId;
      widget = await widgetDemoSite(app, widgetTenantId, `http://localhost:${WIDGET_DEMO_PORT}`);
      siteKeys = await sitesDemo(app, admin, sites, `http://localhost:${SITES_DEMO_PORT}`, process.env.MUNSHI_DEV_SITE_OFF);
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

  redis = startRedis();
  const webDir = path.join(ROOT, 'apps', 'web');
  // localhost only: the demo sign-in has no password, so the app is not offered to the network.
  web = spawn(path.join(webDir, 'node_modules', '.bin', 'next'), ['dev', '--hostname', 'localhost', '--port', webPort], {
    cwd: webDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...webEnv(port, logins, { session: sessionSecret, cron: cronSecret, identity: identitySecret, rate: rateSecret }, demoTenantId),
      ...(redis ? { MUNSHI_CACHE_URL: redis.url } : {}),
    },
  });
  // The jobs tick once a minute (BLUEPRINT §4.4). Its first tick may come before next dev answers; it says so and
  // tries again a minute later.
  ticker = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-ticker.ts')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CRON_SECRET: cronSecret, MUNSHI_TICK_URL: `http://localhost:${webPort}/api/internal/tick` },
  });
  demo = serveWidgetDemo(WIDGET_DEMO_PORT);
  if (widget) {
    const q = new URLSearchParams({ site: widget.slug, key: widget.key, api: `http://localhost:${webPort}` });
    console.log(`dev: the widget demo (design/widget-demo) is at http://localhost:${WIDGET_DEMO_PORT}/?${q}`);
  }
  // Publishable keys are made for public pages; the hosted sites (apps/sites) run on localhost:SITES_DEMO_PORT.
  for (const k of siteKeys) console.log(`dev: hosted site ${k.slug}: MUNSHI_SITE_KEY=${k.key} (origin http://localhost:${SITES_DEMO_PORT})`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => web?.kill(signal));
  web.on('exit', (code) => void stop(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
