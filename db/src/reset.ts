// pnpm db:reset — bootstrap and build the laptop's v2 database, the PostgreSQL 17 cluster in .run/pg17 (v1's pnpm dev
// keeps .run/pg), and nothing else. The build drops every Munshi schema, so before anything runs it proves the target:
// the admin connection is a superuser on a loopback address whose data directory is .run/pg17, and the migrator
// connection is munshi_migrator on that same server. Populate (§3.3) joins here when it exists.
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { bootstrap } from './bootstrap.ts';
import { type Built, build } from './build.ts';
import { SCHEMA_DIR } from './schema-files.ts';

const PG17 = fileURLToPath(new URL('../../.run/pg17', import.meta.url));
const LOOPBACK = ['127.0.0.1', '::1'];

type Server = { host: string | null; port: number; started: string; db: string; user: string; super: boolean };

async function server(c: pg.Client): Promise<Server> {
  const { rows } = await c.query<Server>(
    `select host(inet_server_addr()) as host, inet_server_port() as port, pg_postmaster_start_time()::text as started,
            current_database() as db, current_user as user, r.rolsuper as super
       from pg_roles r where r.rolname = current_user`,
  );
  return rows[0] as Server;
}

const refuse = (why: string): never => {
  throw new Error(`reset: refusing: ${why}`);
};

export async function reset(admin: pg.Client, migratorUrl: string, dir = SCHEMA_DIR): Promise<Built> {
  const a = await server(admin);
  if (!a.host || !LOOPBACK.includes(a.host)) refuse('the admin connection is not on a loopback address');
  if (!a.super) refuse('the admin connection is not a superuser');
  const { rows } = await admin.query<{ data: string }>("select current_setting('data_directory') as data");
  const data = rows[0]?.data ?? '';
  if (!existsSync(PG17) || !existsSync(data) || realpathSync(data) !== realpathSync(PG17)) refuse("the server's data directory is not .run/pg17");

  await bootstrap(admin, dir);
  // A fresh bootstrap leaves the migrator login without a password; this is the laptop's own cluster, checked above.
  const password = decodeURIComponent(new URL(migratorUrl).password);
  await admin.query(`alter role munshi_migrator password ${admin.escapeLiteral(password)}`);
  const migrator = new pg.Client({ connectionString: migratorUrl });
  await migrator.connect();
  try {
    const m = await server(migrator);
    const same = m.host === a.host && m.port === a.port && m.started === a.started && m.db === a.db;
    if (!same || m.user !== 'munshi_migrator' || m.super) refuse('the migrator connection is not munshi_migrator on the same local server');
    return await build(migrator, { dir });
  } finally {
    await migrator.end();
  }
}

// CLI: ADMIN_DATABASE_URL (the local superuser) and MIGRATOR_DATABASE_URL from the environment, never printed. No flags.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error(`reset takes no arguments, not ${process.argv.slice(2).join(' ')}`);
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
  if (!adminUrl || !migratorUrl) throw new Error('reset needs ADMIN_DATABASE_URL (the local superuser) and MIGRATOR_DATABASE_URL');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const built = await reset(admin, migratorUrl);
    console.log(`reset: .run/pg17 rebuilt, ${built.files.length} schema file(s), sha256 ${built.sha256.slice(0, 12)}`);
  } finally {
    await admin.end();
  }
}
