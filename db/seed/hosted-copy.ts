// The hosted demo's shops without hours of network round trips: seeded through `pnpm dev`'s own path (db/src/dev.ts's
// reseed) into a throwaway local PostgreSQL 17 built from the same db/schema, with the hosted deploy's identity and
// platform secrets, then copied into the hosted database in ONE transaction. Measured on 31 Oct: seeding over the network
// to Supabase in Mumbai took about 4.5 s a sale, about 3 hours for the demo.
//
//   MUNSHI_MODEL_MODE=live node --env-file=.env.production db/seed/hosted-copy.ts --confirm=<ref>
//
// The copy runs as the owner role (the migrator may SET ROLE munshi_owner): for each Munshi table with rows here and
// none there, in foreign-key order, it lifts FORCE RLS and the user triggers (the book guard, the audit writers: the
// rows are copied as written, audit chain included), inserts the rows, then puts both back. A table already filled by
// the build (ref.*, ops.deployment, ops.schema_version) is left alone. Refuses unless --confirm names the project, the
// target is a hosted demo, the schema shas match and the target holds no tenant. Prints counts and ids, never secrets.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseTls } from '@munshi/core';
import pg from 'pg';
import { reseed } from '../src/dev.ts';
import { hostedOperator } from './hosted.ts';
import { bootstrap } from '../src/bootstrap.ts';
import { build, MUNSHI_SCHEMAS } from '../src/build.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LOGINS = ['munshi_app', 'munshi_agent', 'munshi_jobs', 'munshi_platform', 'munshi_public', 'munshi_idp'] as const;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`seed:hosted-copy: ${name} is not set`);
  return v;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });

type Table = { name: string; cols: string[] };

/** Munshi tables in an order where every foreign key's target comes first (self references are one statement). */
async function tablesInOrder(c: pg.Client): Promise<Table[]> {
  const { rows } = await c.query<{ t: string; cols: string[]; deps: string[] }>(
    `select n.nspname || '.' || k.relname as t,
            array(select quote_ident(a.attname) from pg_attribute a
                   where a.attrelid = k.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
                   order by a.attnum) as cols,
            array(select distinct fn.nspname || '.' || fk.relname from pg_constraint f
                    join pg_class fk on fk.oid = f.confrelid join pg_namespace fn on fn.oid = fk.relnamespace
                   where f.conrelid = k.oid and f.contype = 'f' and f.confrelid <> k.oid) as deps
       from pg_class k join pg_namespace n on n.oid = k.relnamespace
      where k.relkind in ('r', 'p') and n.nspname = any($1::text[])`,
    [MUNSHI_SCHEMAS],
  );
  const byName = new Map(rows.map((r) => [r.t, r]));
  const done = new Set<string>();
  const out: Table[] = [];
  const visit = (t: string, stack: Set<string>) => {
    if (done.has(t)) return;
    if (stack.has(t)) return; // a cycle (books.order and ops.order_request name each other): the keys are dropped for the copy
    const r = byName.get(t);
    if (!r) return;
    stack.add(t);
    for (const d of r.deps) visit(d, stack);
    stack.delete(t);
    done.add(t);
    out.push({ name: t, cols: r.cols });
  };
  for (const t of [...byName.keys()].sort()) visit(t, new Set());
  return out;
}

const count = async (c: pg.ClientBase, t: string) => (await c.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0]?.n ?? 0;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const confirm = args.length === 1 && args[0]?.startsWith('--confirm=') ? args[0].slice('--confirm='.length) : '';
  if (!confirm) throw new Error('seed:hosted-copy takes only --confirm=<project ref>');
  const ref = decodeURIComponent(new URL(need('DATABASE_URL')).username).split('.')[1];
  if (ref !== confirm) throw new Error('seed:hosted-copy: --confirm does not name the project in DATABASE_URL');
  const identitySecret = need('MUNSHI_IDENTITY_SECRET');
  const platformSecret = need('MUNSHI_PLATFORM_SECRET');
  const remoteTls = databaseTls(process.env.MUNSHI_DB_CA);

  // 1. The throwaway local cluster, seeded as pnpm dev seeds (no TLS: a 127.0.0.1 socket).
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-hosted-copy-'));
  const superPw = randomBytes(24).toString('hex');
  const { default: EmbeddedPostgres } = await import('embedded-postgres-17');
  const port = await freePort();
  const cluster = new EmbeddedPostgres({ databaseDir: path.join(dir, 'pg17'), port, user: 'postgres', password: superPw, persistent: false, initdbFlags: ['--encoding=UTF8'], onLog: () => {} });
  const local = (user: string, pw: string, db = 'munshi') => `postgresql://${user}:${pw}@127.0.0.1:${port}/${db}`;
  let exit = 1;
  try {
    await cluster.initialise();
    await cluster.start();
    const server = new pg.Client({ connectionString: local('postgres', superPw, 'postgres') });
    await server.connect();
    await server.query('create database munshi');
    await server.end();
    const admin = new pg.Client({ connectionString: local('postgres', superPw) });
    await admin.connect();
    const pw = Object.fromEntries([...LOGINS, 'munshi_migrator'].map((r) => [r, randomBytes(18).toString('hex')]));
    admin.on('error', () => {}); // the cluster stops in finally; a late FATAL must not crash the exit path
    // reset()'s steps without its .run/pg17 checks: this cluster is the throwaway one made above.
    await bootstrap(admin);
    await admin.query(`alter role munshi_migrator password '${pw.munshi_migrator}'`);
    const migrator = new pg.Client({ connectionString: local('munshi_migrator', pw.munshi_migrator as string) });
    await migrator.connect();
    const built = await build(migrator);
    await migrator.end();
    for (const role of LOGINS) await admin.query(`alter role ${role} password '${pw[role]}'`);
    const app = new pg.Pool({ connectionString: local('munshi_app', pw.munshi_app as string), max: 4 });
    const jobs = new pg.Pool({ connectionString: local('munshi_jobs', pw.munshi_jobs as string), max: 2 });
    const pub = new pg.Pool({ connectionString: local('munshi_public', pw.munshi_public as string), max: 2 });
    const platform = new pg.Pool({ connectionString: local('munshi_platform', pw.munshi_platform as string), max: 2 });
    const started = Date.now();
    mkdirSync(path.join(ROOT, '.run'), { recursive: true, mode: 0o700 });
    const out = path.join(ROOT, '.run', 'hosted-operator.json');
    const seeded = await reseed(app, jobs, { pub, platform, owner: admin }, hostedOperator({ identitySecret, platformSecret }, out));
    await Promise.all([app.end(), jobs.end(), pub.end(), platform.end()]);
    console.log(`seed:hosted-copy: seeded locally in ${((Date.now() - started) / 1000).toFixed(0)} s: ${seeded.summary}`);

    // 2. The hosted target: checked, then filled in one transaction as the owner.
    const remote = new pg.Client({ connectionString: need('MIGRATOR_DATABASE_URL'), application_name: 'munshi_hosted_copy', ssl: remoteTls ?? false });
    await remote.connect();
    try {
      await remote.query('begin');
      await remote.query('set local role munshi_owner');
      // FORCE RLS binds the owner too, so a table's rows are counted (and written) only after it is lifted; every lifted
      // table is restored before the commit. The local side is read as its superuser, which RLS never binds.
      const lifted: string[] = [];
      const lift = async (t: string) => {
        if (lifted.includes(t)) return;
        await remote.query(`alter table ${t} no force row level security`);
        await remote.query(`alter table ${t} disable trigger user`);
        lifted.push(t);
      };
      for (const t of ['ops.deployment', 'ops.schema_version', 'ops.tenant']) await lift(t);
      const { rows: dep } = await remote.query<{ kind: string; hosted: boolean }>('select kind, hosted from ops.deployment');
      if (dep[0]?.kind !== 'demo' || dep[0]?.hosted !== true) throw new Error('the target is not a hosted demo (build it with --deployment demo)');
      const { rows: sha } = await remote.query<{ sha: string }>("select encode(sha256, 'hex') as sha from ops.schema_version");
      if (sha[0]?.sha !== built.sha256) throw new Error('the target was built from another db/schema: rebuild it from this checkout');
      if ((await count(remote, 'ops.tenant')) > 0) throw new Error('the target already holds tenants: rebuild it first');

      // Every Munshi foreign key is dropped for the copy and re-added with its own name and definition before the commit,
      // which validates every copied row against it again: cycles need no ordering, and integrity is still checked.
      const { rows: fks } = await remote.query<{ t: string; name: string; def: string }>(
        `select conrelid::regclass::text as t, conname as name, pg_get_constraintdef(oid) as def from pg_constraint
          where contype = 'f' and connamespace in (select oid from pg_namespace where nspname = any($1::text[]))`,
        [MUNSHI_SCHEMAS],
      );
      const ident = (n: string) => `"${n.replace(/"/g, '""')}"`;
      for (const fk of fks) await remote.query(`alter table ${fk.t} drop constraint ${ident(fk.name)}`);

      await admin.query('begin');
      const tables = await tablesInOrder(admin);
      let copied = 0;
      let rowsCopied = 0;
      for (const t of tables) {
        const here = await count(admin, t.name);
        if (here === 0) continue;
        await lift(t.name);
        if ((await count(remote, t.name)) > 0) continue; // filled by the build (ref.*, the deployment and version rows)
        const cols = t.cols.join(', ');
        for (let off = 0; off < here; off += 2000) {
          const { rows } = await admin.query<{ j: string }>(
            `select coalesce(json_agg(x), '[]')::text as j from (select ${cols} from ${t.name} order by ctid offset ${off} limit 2000) x`,
          );
          await remote.query(`insert into ${t.name} (${cols}) overriding system value select ${cols} from json_populate_recordset(null::${t.name}, $1::json)`, [rows[0]?.j ?? '[]']);
        }
        if ((await count(remote, t.name)) !== here) throw new Error(`${t.name}: the row counts differ after the copy`);
        copied += 1;
        rowsCopied += here;
      }
      for (const fk of fks) await remote.query(`alter table ${fk.t} add constraint ${ident(fk.name)} ${fk.def}`);
      console.log(`seed:hosted-copy: ${fks.length} foreign keys re-added and validated`);
      for (const t of lifted) {
        await remote.query(`alter table ${t} enable trigger user`);
        await remote.query(`alter table ${t} force row level security`);
      }
      await admin.query('commit');
      await remote.query('commit');
      console.log(`seed:hosted-copy: copied ${rowsCopied} rows into ${copied} tables in one transaction; FORCE RLS and the triggers restored on each`);
      console.log(`seed:hosted-copy: MUNSHI_DEMO_TENANT_ID=${seeded.tenantId}`);
      console.log(`seed:hosted-copy: the Demo operator's sign-in is in ${path.relative(ROOT, out)} (0600)`);
      exit = 0;
    } catch (err) {
      await remote.query('rollback').catch(() => {});
      console.error(`seed:hosted-copy: refused, nothing written: ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, '[url]') : 'error'}`);
    } finally {
      await remote.end();
      await admin.end();
    }
  } finally {
    await cluster.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    process.exit(exit); // explicit: embedded-postgres's beforeExit hook would otherwise exit 0 (Munim gotcha 33)
  }
}
