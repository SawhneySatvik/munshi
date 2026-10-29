// 00_bootstrap.sql on a managed-style admin (BLUEPRINT §2.2): a login with CREATEROLE and CREATEDB that is not a
// superuser, as `postgres` is on Supabase. Roles are cluster-wide and the harness cluster already holds them, so this
// file starts its own PostgreSQL 17 from the native binaries (never importing embedded-postgres in a worker: its exit
// hook is G8's lesson). The admin creates and owns the database, runs the bootstrap, and the whole build then runs as
// munshi_migrator. The large-object revoke cannot succeed there; the bootstrap prints that residual and does not raise.
// Red-proofs: test/v2/sabotage/bootstrap.ts.
import { spawnSync } from 'node:child_process';
import { chownSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bootstrap } from '../../../src/bootstrap.ts';
import { build } from '../../../src/build.ts';
import { sabotageIs } from '../sabotage/index.ts';
import { MANIFEST } from './lib.ts';

const ADMIN = { user: 'nsu_admin', password: 'nsu_admin' };
const DATABASE = 'munshi_nsu';
let dir: string;
let port: number;
let pgCtl: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no free port'))));
    });
  });
}

// initdb refuses to run as root (a cloud container's user): there, as embedded-postgres does, the cluster is owned and
// run by the machine's postgres user.
const asUser: { uid?: number; gid?: number } = (() => {
  if (process.getuid?.() !== 0) return {};
  const id = (flag: string) => Number(spawnSync('id', [flag, 'postgres'], { encoding: 'utf8' }).stdout.trim());
  return { uid: id('-u'), gid: id('-g') };
})();

function run(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...asUser });
  if (r.status !== 0) throw new Error(`${path.basename(bin)} failed (${r.status}): ${r.stderr.slice(-600)}`);
}

async function connect(login: { user: string; password?: string }, database: string): Promise<pg.Client> {
  const c = new pg.Client({ host: '127.0.0.1', port, database, ...login });
  await c.connect();
  return c;
}

beforeAll(async () => {
  const require = createRequire(realpathSync(createRequire(import.meta.url).resolve('embedded-postgres-17')));
  const bins = (await import(require.resolve(`@embedded-postgres/${process.platform}-${process.arch}`))) as { initdb: string; pg_ctl: string };
  pgCtl = bins.pg_ctl;
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-nsu-'));
  if (asUser.uid !== undefined && asUser.gid !== undefined) chownSync(dir, asUser.uid, asUser.gid);
  port = await freePort();
  run(bins.initdb, ['-D', path.join(dir, 'data'), '-U', 'postgres', '--auth=trust', '--no-sync', '--encoding=UTF8']);
  run(pgCtl, ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, 'start']);
  const superuser = await connect({ user: 'postgres' }, 'postgres');
  await superuser.query(`create role ${ADMIN.user} login createrole createdb password '${ADMIN.password}'`);
  await superuser.end();
  const admin = await connect(ADMIN, 'postgres');
  await admin.query(`create database ${DATABASE}`);
  await admin.end();
});

afterAll(() => {
  if (dir) {
    spawnSync(pgCtl, ['-D', path.join(dir, 'data'), '-m', 'fast', '-w', 'stop'], asUser);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('SUPA1 the bootstrap runs as a non-superuser admin, printing the large-object residual, and the whole build then runs as munshi_migrator', async () => {
  const admin = await connect(sabotageIs('v2-boot-as-superuser') ? { user: 'postgres' } : ADMIN, DATABASE);
  const notices: string[] = [];
  admin.on('notice', (n) => notices.push(`${n.severity}: ${n.message}`));
  try {
    const who = await admin.query<{ su: boolean }>('select rolsuper as su from pg_roles where rolname = current_user');
    expect(who.rows[0]?.su).toBe(false);
    await bootstrap(admin);
    const residual = notices.filter((n) => n.includes('agent_large_objects=possible'));
    console.log(`SUPA1 the non-superuser bootstrap printed: ${residual.join(' | ')}`);
    expect(residual).toEqual([expect.stringMatching(/^WARNING: bootstrap residual: agent_large_objects=possible/)]);
    // The admin made the roles, so it holds ADMIN on them and sets their passwords, as the operator would.
    for (const [role, r] of Object.entries(MANIFEST.roles)) if (r.login) await admin.query(`alter role ${role} password '${role}'`);
    const roles = await admin.query<{ rolname: string; login: boolean; inherit: boolean; bad: boolean }>(
      `select rolname, rolcanlogin as login, rolinherit as inherit, rolsuper or rolbypassrls or rolcreaterole or rolcreatedb as bad
         from pg_roles where rolname like 'munshi\\_%' order by rolname`,
    );
    expect(roles.rows).toEqual(
      Object.entries(MANIFEST.roles)
        .map(([rolname, r]) => ({ rolname, ...r, bad: false }))
        .sort((x, y) => x.rolname.localeCompare(y.rolname)),
    );
    // A second run changes nothing and still does not raise.
    await bootstrap(admin);
  } finally {
    await admin.end();
  }
  const migrator = await connect({ user: 'munshi_migrator', password: 'munshi_migrator' }, DATABASE);
  try {
    const built = await build(migrator);
    expect(built.files.at(-1)).toBe('90_seal.sql');
    const tables = await migrator.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname in ('ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'agent_view', 'idp', 'platform')`,
    );
    expect(tables.rows[0]?.n).toBe(MANIFEST.tables.length);
  } finally {
    await migrator.end();
  }
});
