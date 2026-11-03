// WIPE1 (db/src/hosted-wipe.ts): wiping Munshi out of a hosted database before a rebuild on the same project. Roles are
// cluster-wide and the wipe drops them, so this file starts its own PostgreSQL 17 from the native binaries, as
// gates/00-bootstrap.test.ts does, with a non-superuser admin (CREATEROLE, CREATEDB) standing in for Supabase's
// `postgres`, and schemas named as Supabase's (auth, storage, realtime, extensions) planted by the superuser. The wipe
// must drop every Munshi object and role, leave those schemas, the extension and the admin's own objects alone, refuse
// a live deployment and a Munshi-owned object inside a Supabase schema, and leave a database the bootstrap and the
// build rebuild. Red-proofs: test/v2/sabotage/wipe.ts.
import { spawnSync } from 'node:child_process';
import { chownSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bootstrap } from '../../../src/bootstrap.ts';
import { build, MUNSHI_SCHEMAS } from '../../../src/build.ts';
import { adminRef, hostedWipe, MUNSHI_ROLES, parseWipeArgs } from '../../../src/hosted-wipe.ts';

const ADMIN = { user: 'wipe_admin', password: 'wipe_admin' };
const DATABASE = 'munshi_wipe';
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

// initdb refuses to run as root (a cloud container's user): there the cluster is run by the machine's postgres user.
const asUser: { uid?: number; gid?: number } = (() => {
  if (process.getuid?.() !== 0) return {};
  const id = (flag: string) => Number(spawnSync('id', [flag, 'postgres'], { encoding: 'utf8' }).stdout.trim());
  return { uid: id('-u'), gid: id('-g') };
})();

function run(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...asUser });
  if (r.status !== 0) throw new Error(`${path.basename(bin)} failed (${r.status}): ${r.stderr.slice(-600)}`);
}

async function connect(login: { user: string; password?: string }, database = DATABASE): Promise<pg.Client> {
  const c = new pg.Client({ host: '127.0.0.1', port, database, ...login });
  await c.connect();
  return c;
}

async function as<T>(login: { user: string; password?: string }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await connect(login);
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const SUPERUSER = { user: 'postgres' };
const MIGRATOR = { user: 'munshi_migrator', password: 'munshi_migrator' };

/** Bootstrap as the admin, give the migrator its password, and build, recording the deployment's kind. */
async function rebuild(kind: 'demo' | 'live'): Promise<string[]> {
  await as(ADMIN, async (a) => {
    await bootstrap(a);
    await a.query(`alter role munshi_migrator password 'munshi_migrator'`);
  });
  return as(MIGRATOR, async (m) => (await build(m, { deployment: { kind, hosted: true } })).files);
}

/** What is in the database: Munshi's roles and schemas, and whether each planted object of someone else's stands. */
async function census() {
  return as(SUPERUSER, async (c) => {
    const one = async (sql: string) => (await c.query<{ v: unknown }>(sql)).rows[0]?.v;
    return {
      roles: (await c.query<{ r: string }>(`select rolname as r from pg_roles where rolname like 'munshi\\_%' order by 1`)).rows.map((x) => x.r),
      schemas: (await c.query<{ s: string }>('select nspname as s from pg_namespace where nspname = any($1) order by 1', [MUNSHI_SCHEMAS])).rows.map((x) => x.s),
      authUsers: await one('select count(*)::int as v from auth.users'),
      storage: await one(`select to_regclass('storage.buckets')::text as v`),
      realtime: await one(`select to_regclass('realtime.messages')::text as v`),
      extensionsTable: await one(`select to_regclass('extensions.keep')::text as v`),
      btreeGist: await one(`select extname as v from pg_extension where extname = 'btree_gist'`),
      adminFunction: await one(`select to_regprocedure('public.keep_me()')::text as v`),
    };
  });
}

const KEPT = {
  authUsers: 1,
  storage: 'storage.buckets',
  realtime: 'realtime.messages',
  extensionsTable: 'extensions.keep',
  btreeGist: 'btree_gist',
  adminFunction: 'keep_me()',
};

const refusal = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};

beforeAll(async () => {
  const require = createRequire(realpathSync(createRequire(import.meta.url).resolve('embedded-postgres-17')));
  const bins = (await import(require.resolve(`@embedded-postgres/${process.platform}-${process.arch}`))) as { initdb: string; pg_ctl: string };
  pgCtl = bins.pg_ctl;
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-wipe-'));
  if (asUser.uid !== undefined && asUser.gid !== undefined) chownSync(dir, asUser.uid, asUser.gid);
  port = await freePort();
  run(bins.initdb, ['-D', path.join(dir, 'data'), '-U', 'postgres', '--auth=trust', '--no-sync', '--encoding=UTF8']);
  run(pgCtl, ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, 'start']);
  const superuser = await connect(SUPERUSER, 'postgres');
  await superuser.query(`create role ${ADMIN.user} login createrole createdb password '${ADMIN.password}'`);
  await superuser.end();
  const admin = await connect(ADMIN, 'postgres');
  await admin.query(`create database ${DATABASE}`);
  await admin.end();
  // Supabase's own schemas, owned by another role (here the superuser); `extensions` exists before the bootstrap.
  await as(SUPERUSER, (c) =>
    c.query(`
      create schema auth; create table auth.users (id int); insert into auth.users values (1);
      create schema storage; create table storage.buckets (id text);
      create schema realtime; create table realtime.messages (id int);
      create schema extensions; create table extensions.keep (id int);
      grant usage, create on schema extensions to ${ADMIN.user};`),
  );
  // The admin's own object in public, which is not Munshi's.
  await as(ADMIN, (c) => c.query(`create function public.keep_me() returns int language sql as 'select 1'`));
});

afterAll(() => {
  if (dir) {
    spawnSync(pgCtl, ['-D', path.join(dir, 'data'), '-m', 'fast', '-w', 'stop'], asUser);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('WIPE1 refuses a live deployment and changes nothing', async () => {
  expect((await rebuild('live')).at(-1)).toBe('90_seal.sql');
  const before = await census();
  expect(await as(ADMIN, (a) => refusal(() => hostedWipe(a)))).toBe("hosted-wipe: refusing a live deployment (ops.deployment.kind = 'live')");
  expect(await census()).toEqual(before);
  expect(before.schemas).toHaveLength(MUNSHI_SCHEMAS.length);
});

it('WIPE1 drops every Munshi schema, stray object and role, and leaves Supabase’s schemas, the extension and the admin’s own objects', async () => {
  // Back to a demo: the build itself refuses to drop a live database, so the superuser clears its record first.
  await as(SUPERUSER, (c) => c.query('drop schema ops cascade'));
  await rebuild('demo');
  await as(SUPERUSER, (c) => c.query(`create function public.munshi_stray() returns int language sql as 'select 1';
    alter function public.munshi_stray() owner to munshi_owner;`));

  const before = await census();
  const plan = await as(ADMIN, (a) => hostedWipe(a, { dryRun: true }));
  expect(plan.schemas).toEqual([...MUNSHI_SCHEMAS].sort());
  expect(plan.roles).toEqual([...MUNSHI_ROLES].sort());
  expect(plan.elsewhere).toContain('function public.munshi_stray()');
  expect(plan.protectedHits).toEqual([]);
  console.log(`WIPE1 the dry run lists, outside the Munshi schemas: ${plan.elsewhere.join(' | ')}`);
  expect(await census()).toEqual(before);

  await as(ADMIN, (a) => hostedWipe(a));
  expect(await census()).toEqual({ roles: [], schemas: [], ...KEPT });
  expect(await as(SUPERUSER, async (c) => (await c.query(`select to_regprocedure('public.munshi_stray()')::text as v`)).rows[0]?.v)).toBeNull();

  // The same project rebuilds: the bootstrap makes the roles again and the build applies every file.
  expect((await rebuild('demo')).at(-1)).toBe('90_seal.sql');
  const after = await census();
  expect(after.roles).toEqual([...MUNSHI_ROLES].sort());
  expect(after.schemas).toHaveLength(MUNSHI_SCHEMAS.length);
});

it('WIPE1 refuses when a Munshi role owns anything in a Supabase schema, and changes nothing', async () => {
  await as(SUPERUSER, (c) => c.query('create table storage.munshi_thing (id int); alter table storage.munshi_thing owner to munshi_owner;'));
  const before = await census();
  expect(await as(ADMIN, (a) => refusal(() => hostedWipe(a)))).toBe('hosted-wipe: refusing: a Munshi role owns table storage.munshi_thing in a Supabase schema');
  expect(await census()).toEqual(before);
  expect(await as(SUPERUSER, async (c) => (await c.query(`select to_regclass('storage.munshi_thing')::text as v`)).rows[0]?.v)).toBe('storage.munshi_thing');
});

it('WIPE1 the CLI takes the project ref only from the admin URL, and requires --env and --confirm', () => {
  expect(adminRef('postgresql://postgres.abcd:pw@pooler.invalid:5432/postgres')).toBe('abcd');
  expect(() => adminRef('postgresql://munshi_app.abcd:pw@pooler.invalid:5432/postgres')).toThrow('must log in as postgres.<ref>');
  expect(parseWipeArgs(['--env=.env', '--confirm=abcd', '--dry-run'])).toEqual({ env: '.env', confirm: 'abcd', dryRun: true, keepRoles: false });
  expect(() => parseWipeArgs(['--env=.env'])).toThrow('--env=<file> and --confirm=<project ref> are required');
  expect(() => parseWipeArgs(['--env=.env', '--confirm=abcd', '--force'])).toThrow('unknown argument --force');
});
