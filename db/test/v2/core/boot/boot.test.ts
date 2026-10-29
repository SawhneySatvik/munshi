// The boot checks (BLUEPRINT §4.3, apps/web/lib/server/db.ts): the app refuses to serve unless every required setting is
// set, MUNSHI_DEPLOYMENT is ops.deployment's kind (no row counts as demo), ops.schema_version holds the sha the build
// compiled in (next.config.ts: readSchema() of the checked-out db/schema; no environment variable stands in), and each
// of the six pools connects as its own role, no superuser, no BYPASSRLS and no member of the owner. The request hook (apps/web/proxy.ts) holds every route behind boot. Red-proofs:
// test/v2/sabotage/core-boot.ts.
import { inspect } from 'node:util';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GET as health } from '../../../../../apps/web/app/api/health/route.ts';
import { BootError, boot, checkBoot, roleRefused } from '../../../../../apps/web/lib/server/db.ts';
import { ConfigError, POOL_URL, POOLS, type PoolName, webConfig } from '../../../../../packages/config/src/index.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { goodEnv, loadNext, type Next, restoreEnv, roleUrl, SCHEMA_SHA256, setEnv, signInKeys } from './lib.ts';

let db: TestDb; // as the template built it: no deployment row, the schema's own sha
let live: TestDb; // a clone given a live deployment row
let stale: TestDb; // a clone whose schema_version is tampered with
let next: Next;

beforeAll(async () => {
  next = await loadNext();
  [db, live, stale] = await Promise.all([openTestDb(), openTestDb(), openTestDb()]);
  // A fresh clone has no tenant, so the deployment row may still be written, as the owner (03's build_row).
  await live.admin.query("set role munshi_owner; insert into ops.deployment (one, kind, hosted) values (true, 'live', false); reset role;");
  setEnv(goodEnv(db)); // the build's schema sha, which checkBoot reads by default
  await Promise.all([db.sabotage(), live.sabotage(), stale.sabotage()]);
});
afterAll(async () => {
  restoreEnv();
  await Promise.all([db?.close(), live?.close(), stale?.close()]);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refusal = (p: Promise<unknown>) => p.then(() => new Error('boot accepted'), (err: unknown) => err as Error);
const renderings = (err: Error) => [err.message, err.stack ?? '', String(err), inspect(err), JSON.stringify(err)];

it('BOOT-SET boot refuses a missing required setting, naming it and never printing a value', async () => {
  const env = goodEnv(db);
  const values = Object.values(env).filter((v) => v.length >= 8); // the URLs (with their passwords) and the secrets
  for (const name of Object.keys(env)) {
    for (const value of [undefined, '']) {
      setEnv({ ...env, [name]: value });
      const err = await refusal(boot());
      expect(err, name).toBeInstanceOf(ConfigError);
      expect([(err as ConfigError).code, (err as ConfigError).names], name).toEqual(['config_missing', [name]]);
      expect(err.message, name).toContain(name);
      for (const text of renderings(err)) for (const v of values) expect(text, name).not.toContain(v);
    }
  }
  setEnv(env);
  await expect(boot()).resolves.toMatchObject({ deployment: 'demo' });
});

it('BOOT-DEPLOY boot refuses a MUNSHI_DEPLOYMENT that is not ops.deployment (no row counts as demo)', async () => {
  const kind = async (t: TestDb) => (await t.admin.query<{ kind: string }>('select kind from ops.deployment')).rows.map((r) => r.kind);
  expect([await kind(db), await kind(live)]).toEqual([[], ['live']]);
  const check = (t: TestDb, deployment: string) => checkBoot(webConfig({ ...goodEnv(t), ...signInKeys(), MUNSHI_DEPLOYMENT: deployment }));
  for (const [t, wrong] of [[db, 'live'], [live, 'demo']] as const) {
    const err = await refusal(check(t, wrong));
    expect(err, wrong).toBeInstanceOf(BootError);
    expect([(err as BootError).code, (err as BootError).pool], wrong).toEqual(['wrong_deployment', undefined]);
  }
  await expect(check(db, 'demo')).resolves.toMatchObject({ deployment: 'demo' });
  await expect(check(live, 'live')).resolves.toMatchObject({ deployment: 'live' });
});

it("BOOT-SCHEMA boot refuses a database whose ops.schema_version.sha256 is not the checked-out db/schema's, or that has none", async () => {
  const stored = async (t: TestDb) =>
    (await t.admin.query<{ sha: string; source: string }>("select encode(sha256, 'hex') as sha, source from ops.schema_version")).rows;
  expect(await stored(db)).toEqual([{ sha: SCHEMA_SHA256, source: 'schema' }]);
  const check = (t: TestDb, built = SCHEMA_SHA256) => checkBoot(webConfig(goodEnv(t)), built);
  const stale_ = (err: Error) => [(err as BootError).code, (err as BootError).pool];

  await expect(check(stale)).resolves.toMatchObject({ schema: SCHEMA_SHA256.slice(0, 12) });
  // The app was built from other files than the database.
  const other = SCHEMA_SHA256.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  expect(stale_(await refusal(check(stale, other)))).toEqual(['stale_schema', undefined]);
  // The database was built from other files than the app (its row rewritten, as an older build would have left it).
  const tamper = (sql: string) => stale.admin.query(`alter table ops.schema_version disable trigger fixed; ${sql}; alter table ops.schema_version enable trigger fixed;`);
  await tamper(`update ops.schema_version set sha256 = decode('${other}', 'hex')`);
  expect(stale_(await refusal(check(stale)))).toEqual(['stale_schema', undefined]);
  // No row at all.
  await tamper('delete from ops.schema_version');
  expect(await stored(stale)).toEqual([]);
  expect(stale_(await refusal(check(stale)))).toEqual(['stale_schema', undefined]);
});

// Each pool pointed at a role that is not its own: another Munshi login, and the superuser.
const WRONG: Record<PoolName, string> = { app: 'munshi_public', jobs: 'munshi_app', agent: 'munshi_app', platform: 'munshi_app', public: 'munshi_app', idp: 'munshi_app' };
const ROLE: Record<PoolName, string> = {
  app: 'munshi_app',
  jobs: 'munshi_jobs',
  agent: 'munshi_agent',
  platform: 'munshi_platform',
  public: 'munshi_public',
  idp: 'munshi_idp',
};

for (const pool of POOLS) {
  it(`BOOT-ROLE the ${pool} pool must connect as ${ROLE[pool]}`, async () => {
    const env = goodEnv(db);
    expect(env[POOL_URL[pool]]).toBe(roleUrl(db, ROLE[pool]));
    for (const url of [roleUrl(db, WRONG[pool]), roleUrl(db, 'postgres', 'postgres')]) {
      const err = await refusal(checkBoot(webConfig({ ...env, [POOL_URL[pool]]: url })));
      expect(err, url).toBeInstanceOf(BootError);
      expect([(err as BootError).code, (err as BootError).pool], url).toEqual(['wrong_role', pool]);
    }
    await expect(checkBoot(webConfig(env))).resolves.toMatchObject({ deployment: 'demo' });
  });
}

it("BOOT-BUILD boot expects the build's schema sha: next.config compiles in readSchema()'s, and no environment variable stands in for it", async () => {
  // Independent of next.config: the sha the harness's own build stored in the database.
  const stored = (await db.admin.query<{ sha: string }>("select encode(sha256, 'hex') as sha from ops.schema_version")).rows[0]?.sha ?? '';
  expect(stored).toMatch(/^[0-9a-f]{64}$/);
  const compiler = (next.nextConfig as { compiler?: { defineServer?: Record<string, unknown> } }).compiler;
  expect(compiler?.defineServer).toEqual({ MUNSHI_BUILD_SCHEMA_SHA256: stored });
  const env = goodEnv(db);
  const other = stored.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const code = (err: Error) => [(err as BootError).code, (err as BootError).pool];
  // The environment names the database's sha, the build another: refused.
  setEnv({ ...env, MUNSHI_SCHEMA_SHA256: stored }, other);
  expect(code(await refusal(boot()))).toEqual(['stale_schema', undefined]);
  // No build value at all, the environment naming the database's sha: refused.
  setEnv({ ...env, MUNSHI_SCHEMA_SHA256: stored }, null);
  expect(code(await refusal(boot()))).toEqual(['stale_schema', undefined]);
  // The build's sha, whatever the environment says: served.
  setEnv({ ...env, MUNSHI_SCHEMA_SHA256: other });
  await expect(boot()).resolves.toMatchObject({ schema: stored.slice(0, 12) });
});

// Roles are cluster-wide and other test files run beside this one, so no Munshi role is altered here: the superuser,
// BYPASSRLS and owner clauses are shown on munshi_app's real catalog row with one attribute set.
it('BOOT-ROLE a superuser, a BYPASSRLS role or a member of munshi_owner is refused even under the right name', async () => {
  const me = async (p: pg.Pool) =>
    (
      await p.query<{ role: string; superuser: boolean; bypass: boolean; owner: boolean }>(
        "select rolname as role, rolsuper as superuser, rolbypassrls as bypass, pg_has_role(rolname, 'munshi_owner', 'MEMBER') as owner from pg_roles where rolname = current_user",
      )
    ).rows[0];
  const app = await me(db.as('munshi_app'));
  expect(app).toEqual({ role: 'munshi_app', superuser: false, bypass: false, owner: false });
  expect(roleRefused('munshi_app', app)).toBe(false);
  for (const flag of ['superuser', 'bypass', 'owner'] as const) {
    expect(roleRefused('munshi_app', { ...app!, [flag]: true }), flag).toBe(true);
  }
  expect(roleRefused('munshi_app', undefined)).toBe(true);
  // The owner clause is live: the migrator is a member of the owner, the superuser bypasses everything.
  expect(await me(db.admin)).toMatchObject({ superuser: true, bypass: true });
  const migrator = await db.migrator();
  try {
    expect((await migrator.query("select pg_has_role(current_user, 'munshi_owner', 'MEMBER') as owner")).rows).toEqual([{ owner: true }]);
  } finally {
    await migrator.end();
  }
});

it('BOOT-WIRE while boot refuses, the request hook answers 503 with the code and no route runs; health reports the code', async () => {
  const env = goodEnv(db);
  setEnv({ ...env, ...signInKeys(), MUNSHI_DEPLOYMENT: 'live' });
  for (const path of ['/', '/counter', '/api/internal/tick', '/api/health']) {
    const res = await next.proxy(next.request(`http://localhost${path}`));
    expect(res.status, path).toBe(503);
    expect(res.headers.get('x-middleware-next'), path).toBeNull();
    expect(await res.json(), path).toEqual({ ok: false, code: 'wrong_deployment' });
    expect(res.headers.get('x-request-id'), path).toMatch(UUID);
    expect(res.headers.get('content-security-policy'), path).toMatch(/^default-src /);
  }
  const refused = await health();
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ ok: false, code: 'wrong_deployment' });

  setEnv(env);
  const served = await next.proxy(next.request('http://localhost/counter'));
  expect(served.status).toBe(200);
  expect(served.headers.get('x-middleware-next')).toBe('1');
  expect((await health()).status).toBe(200);
});
