// The deploy check (db/src/deploy-check.ts, scripts/deploy-check.ts; deploy/supabase.md) against clones of the harness
// template, each standing in for a hosted database: every URL its own role, the deployment row and the build, the demo's
// channel fence, and SUPA1 (Supabase's API roles reach nothing of ours), planted here with roles of Supabase's names.
// Red-proofs: test/v2/sabotage/deploy.ts.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { type DeployCheck, deployCheck } from '../../../src/deploy-check.ts';
import { SUPERUSER } from '../global-setup.ts';
import { openTestDb, type TestDb } from '../db.ts';
import { POOL_ROLES, roleUrl, SCHEMA_SHA256 } from '../core/boot/lib.ts';

let good: TestDb; // demo, hosted
let bare: TestDb; // as the template built it: no deployment row
let live: TestDb; // live, hosted, built from the schema
let laptop: TestDb; // demo, hosted = false
let exposed: TestDb; // demo, hosted, with Supabase's roles planted

const deployment = (t: TestDb, kind: string, hosted: boolean) =>
  t.admin.query(`set role munshi_owner; insert into ops.deployment (one, kind, hosted) values (true, '${kind}', ${hosted}); reset role;`);

const PLANTED_ROLES = ['anon', 'authenticated', 'service_role', 'authenticator', 'deploy_check_bypass'];

beforeAll(async () => {
  [good, bare, live, laptop, exposed] = await Promise.all([openTestDb(), openTestDb(), openTestDb(), openTestDb(), openTestDb()]);
  await Promise.all([deployment(good, 'demo', true), deployment(live, 'live', true), deployment(laptop, 'demo', false), deployment(exposed, 'demo', true)]);
  // Roles are cluster-wide (made once, dropped in afterAll); every grant and setting below is the exposed clone's alone.
  await exposed.admin.query(`do $$
    declare r text;
    begin
      foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator'] loop
        if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
      end loop;
      if not exists (select 1 from pg_roles where rolname = 'deploy_check_bypass') then create role deploy_check_bypass nologin bypassrls; end if;
    end $$`);
  await exposed.admin.query(`
    grant usage on schema books to anon;
    grant select on ops.tenant to authenticated;
    grant usage on schema ai to service_role;
    grant select on audit.checkpoint to deploy_check_bypass;
    alter role authenticator in database ${exposed.name} set pgrst.db_schemas = 'public, graphql_public, snap';
    create function public.deploy_check_leak() returns int language sql as 'select 1';
    alter function public.deploy_check_leak() owner to munshi_owner;`);
  await Promise.all([good, bare, live, laptop, exposed].map((t) => t.sabotage()));
});

afterAll(async () => {
  await Promise.all([good, bare, live, laptop, exposed].map((t) => t?.close()));
  if (good) {
    const c = new pg.Client({ host: '127.0.0.1', port: inject('pg17Port'), database: 'postgres', ...SUPERUSER });
    await c.connect();
    await c.query(`drop role if exists ${PLANTED_ROLES.join(', ')}`);
    await c.end();
  }
});

const env = (t: TestDb, over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  ...Object.fromEntries(Object.entries(POOL_ROLES).map(([name, role]) => [name, roleUrl(t, role)])),
  MIGRATOR_DATABASE_URL: roleUrl(t, 'munshi_migrator'),
  MUNSHI_DEPLOYMENT: 'demo',
  ...over,
});

// Nothing a check returns carries a URL or a password.
const clean = (r: DeployCheck, secrets: string[]) => {
  const text = [...r.problems, ...r.notes].join('\n');
  expect(text).not.toMatch(/postgres(ql)?:\/\//);
  for (const s of secrets) expect(text).not.toContain(s);
};

it('DEPLOY1 deploy-check passes a hosted demo database whose every URL is its own role, and prints the large-object note', async () => {
  const e = env(good);
  const r = await deployCheck(e);
  expect(r).toEqual({ problems: [], notes: ['agent_large_objects=none'] });
  clean(r, Object.values(e).filter((v): v is string => !!v && v.includes('://')));
});

it('DEPLOY1 deploy-check refuses a missing URL or MUNSHI_DEPLOYMENT, naming each', async () => {
  for (const name of [...Object.keys(POOL_ROLES), 'MIGRATOR_DATABASE_URL']) {
    for (const value of [undefined, '']) expect((await deployCheck(env(good, { [name]: value }))).problems, name).toEqual([`${name} is not set`]);
  }
  for (const value of [undefined, '', 'staging']) {
    expect((await deployCheck(env(good, { MUNSHI_DEPLOYMENT: value }))).problems).toContain('MUNSHI_DEPLOYMENT is not demo or live');
  }
});

it('DEPLOY1 deploy-check refuses two variables sharing a URL or a password', async () => {
  const same = await deployCheck(env(good, { JOBS_DATABASE_URL: roleUrl(good, 'munshi_app') }));
  expect(same.problems).toContain('DATABASE_URL and JOBS_DATABASE_URL are the same URL: each role has its own login');
  const shared = randomBytes(12).toString('hex');
  const pw = await deployCheck(env(good, { AGENT_DATABASE_URL: roleUrl(good, 'munshi_agent', shared), IDP_DATABASE_URL: roleUrl(good, 'munshi_idp', shared) }));
  expect(pw.problems).toContain('AGENT_DATABASE_URL and IDP_DATABASE_URL share a password');
  clean(pw, [shared]);
});

it('DEPLOY1 deploy-check refuses a superuser, the migrator or another role behind a pool URL, the app behind the migrator URL, and a wrong password, printing only codes', async () => {
  const su = `postgres://${SUPERUSER.user}:${SUPERUSER.password}@${new URL(roleUrl(good, 'x')).host}/${good.name}`;
  const superuser = await deployCheck(env(good, { DATABASE_URL: su }));
  expect(superuser.problems).toEqual(
    expect.arrayContaining([
      'DATABASE_URL: connects as the wrong login, expected munshi_app',
      'DATABASE_URL: the login is a superuser',
      'DATABASE_URL: the login bypasses row-level security',
      'DATABASE_URL: the login can create roles or databases',
    ]),
  );
  const migrator = await deployCheck(env(good, { PUBLIC_DATABASE_URL: roleUrl(good, 'munshi_migrator'), MIGRATOR_DATABASE_URL: roleUrl(good, 'munshi_migrator', 'x') }));
  expect(migrator.problems).toEqual(
    expect.arrayContaining(['PUBLIC_DATABASE_URL: connects as the wrong login, expected munshi_public', 'PUBLIC_DATABASE_URL: the login is a member of munshi_owner']),
  );
  const swapped = await deployCheck(env(good, { JOBS_DATABASE_URL: roleUrl(good, 'munshi_platform'), MIGRATOR_DATABASE_URL: roleUrl(good, 'munshi_app', 'y') }));
  expect(swapped.problems).toEqual(
    expect.arrayContaining(['JOBS_DATABASE_URL: connects as the wrong login, expected munshi_jobs', 'MIGRATOR_DATABASE_URL: cannot connect (28P01)']),
  );
  const wrong = randomBytes(12).toString('hex');
  const denied = await deployCheck(env(good, { IDP_DATABASE_URL: roleUrl(good, 'munshi_idp', wrong) }));
  expect(denied.problems).toEqual(['IDP_DATABASE_URL: cannot connect (28P01)']);
  clean(denied, [wrong]);
});

it('DEPLOY1 deploy-check refuses a demo config that names a channel credential, by name and never by value', async () => {
  const token = `EAAG-${randomBytes(16).toString('hex')}`;
  const r = await deployCheck(env(good, { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_APP_SECRET: randomBytes(32).toString('hex') }));
  expect(r.problems).toEqual(['a demo deployment names no channel credential, but these are set: WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET']);
  clean(r, [token]);
  expect((await deployCheck(env(good, { INSTAGRAM_ACCESS_TOKEN: token }))).problems).toEqual([
    'a demo deployment names no channel credential, but these are set: INSTAGRAM_ACCESS_TOKEN',
  ]);
  expect((await deployCheck(env(good, { WHATSAPP_ACCESS_TOKEN: '' }))).problems).toEqual([]);
});

it('DEPLOY1 deploy-check refuses a database whose deployment row is missing, of the other kind, hosted = false, live from the schema, or another build', async () => {
  expect((await deployCheck(env(bare))).problems).toEqual(['ops.deployment has no row: a hosted database names its deployment before any tenant (deploy/supabase.md)']);
  expect((await deployCheck(env(good, { MUNSHI_DEPLOYMENT: 'live' }))).problems).toEqual(["MUNSHI_DEPLOYMENT is not the database's ops.deployment (demo)"]);
  expect((await deployCheck(env(live))).problems).toEqual([
    "MUNSHI_DEPLOYMENT is not the database's ops.deployment (live)",
    'ops.deployment is live but ops.schema_version.source is not migrations (BOOT1)',
  ]);
  expect((await deployCheck(env(live, { MUNSHI_DEPLOYMENT: 'live' }))).problems).toEqual(['ops.deployment is live but ops.schema_version.source is not migrations (BOOT1)']);
  expect((await deployCheck(env(laptop))).problems).toEqual(['ops.deployment says hosted = false: a laptop database, never served by a hosted app']);
  const other = SCHEMA_SHA256.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  expect((await deployCheck(env(good), { schemaSha: other })).problems).toEqual(['ops.schema_version is not the checked-out db/schema: build the database from this commit']);
});

it('SUPA1 deploy-check refuses anon, authenticated, service_role or another BYPASSRLS role reaching a Munshi schema or table, the Data API exposing one, and a Munshi object in public', async () => {
  const r = await deployCheck(env(exposed));
  expect(r.problems).toEqual([
    'role anon holds USAGE on schema books',
    'role authenticated holds a privilege on ops.tenant',
    'role deploy_check_bypass holds a privilege on audit.checkpoint',
    'role service_role holds USAGE on schema ai',
    'the Data API exposes snap (pgrst.db_schemas on authenticator)',
    'schema public holds a Munshi object',
  ]);
  expect(r.notes).toEqual(['agent_large_objects=none']);
  // The same roles exist cluster-wide, but hold nothing in the clean clone.
  expect((await deployCheck(env(good))).problems).toEqual([]);
});

it('DEPLOY1 the CLI exits 1 on a refusal and 0 when clean, and never prints a URL, a password or a server message', async () => {
  const root = path.join(import.meta.dirname, '..', '..', '..', '..');
  const cli = (e: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', 'deploy-check.ts')], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ...e } });
  const ok = cli(env(good));
  expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining('deploy-check: ok')]);
  const wrong = randomBytes(12).toString('hex');
  const bad = cli(env(good, { DATABASE_URL: roleUrl(good, 'munshi_app', wrong) }));
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain('DATABASE_URL: cannot connect (28P01)');
  for (const out of [ok.stdout + ok.stderr, bad.stdout + bad.stderr]) {
    expect(out).not.toMatch(/postgres(ql)?:\/\/|password authentication/);
    expect(out).not.toContain(wrong);
  }
});
