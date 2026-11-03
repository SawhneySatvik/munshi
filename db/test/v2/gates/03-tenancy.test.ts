// 03_tenancy.sql: T1 (tenant class against the deployment, the fixed deployment row, the tenant and shop guards),
// SIGNUP1, SLUG1, G12 (members), F4 (invites and logins), F5 (sessions, deactivation, the member purge), F7 (the email
// rule, the via rule, two owners at once) and CAP4 (capability switches, with the race). Red-proofs:
// test/v2/sabotage/tenancy.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readSchema } from '../../../src/schema-files.ts';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { bindLogin, invite, signUp, type Tenant } from './fixture.ts';
import { asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let live: TestDb;
let t: Tenant;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  live = await openTestDb();
  await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  app = db.as('munshi_app');
  t = await signUp(db, 'tenancy-shop');
  await db.sabotage();
  await live.sabotage();
});
afterAll(async () => {
  await db?.close();
  await live?.close();
});

const as = (actor: string, tenant = t.tenant) => ({ tenant_id: tenant, actor_id: actor });
const addMember = (by: string, role: string, tenant = t.tenant, pool = app) =>
  tx(pool, as(by, tenant), async (c) => {
    const r = await c.query<{ id: string }>(`insert into ops.member (tenant_id, display_name, role) values ($1, 'New', $2) returning id`, [tenant, role]);
    return r.rows[0]?.id as string;
  });
const deactivate = (by: string, member: string, tenant = t.tenant) =>
  tx(app, as(by, tenant), (c) =>
    c.query(`update ops.member set active = false, deactivated_at = now() where tenant_id = $1 and id = $2`, [tenant, member]),
  );

// The sign-up transaction: tenant, directory row, first owner, and optionally the first-owner login.
async function newTenant(pool: pg.Pool, slug: string, dataClass = 'synthetic', opts: { firstOwnerLogin?: boolean } = {}) {
  const tenant = randomUUID();
  const owner = randomUUID();
  const head = (c: pg.PoolClient) =>
    c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'New shop', 'kirana', $2)`, [tenant, dataClass]);
  const rest = async (c: pg.PoolClient) => {
    await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [slug, tenant]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [tenant, owner]);
    if (opts.firstOwnerLogin) {
      await c.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ('password', $1, $2, $3, true)`, [
        randomUUID(),
        tenant,
        owner,
      ]);
    }
  };
  await tx(pool, as(owner, tenant), async (c) => {
    await head(c);
    await rest(c);
  });
  return { tenant, owner };
}

it('one database holds sample and real shops: a sandbox is synthetic, and on a hosted or live deployment self-serve makes only a real shop or a sandbox', async () => {
  const tenant = (pool: pg.Pool, dataClass: string, sandbox = false) =>
    tx(pool, { tenant_id: randomUUID() }, (c) =>
      c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class, sandbox) values (current_setting('munshi.tenant_id')::uuid, 'X', 'kirana', $1, $2)`, [
        dataClass,
        sandbox,
      ]),
    );
  // A demo deployment: a real shop, a sandbox and a sample shop side by side; a sandbox is synthetic.
  await tenant(app, 'live');
  await tenant(app, 'synthetic', true);
  await tenant(app, 'synthetic');
  expect((await refused(tenant(app, 'showcase', true))).code).toBe('MS010');
  expect((await refused(tenant(app, 'live', true))).code).toBe('MS010');
  // A live deployment: self-serve makes a real shop or a sandbox; a listed sample shop is the operator's (the owner role).
  const liveApp = live.as('munshi_app');
  await tenant(liveApp, 'live');
  await tenant(liveApp, 'synthetic', true);
  expect((await refused(tenant(liveApp, 'synthetic'))).code).toBe('MS010');
  expect((await refused(tenant(liveApp, 'showcase'))).code).toBe('MS010');
  expect((await refused(tenant(liveApp, 'live', true))).code).toBe('MS010');
  await asOwner(live.admin, [`insert into ops.tenant (tenant_id, name, business_type, data_class) values (current_setting('munshi.tenant_id')::uuid, 'Sample', 'kirana', 'showcase')`], randomUUID());
  // A hosted demo deployment (the hosted database before the live freeze) holds the same rule.
  const hosted = await openTestDb();
  try {
    await asOwner(hosted.admin, [`insert into ops.deployment (kind, hosted) values ('demo', true)`]);
    await hosted.sabotage();
    const hostedApp = hosted.as('munshi_app');
    expect((await refused(tenant(hostedApp, 'synthetic'))).code).toBe('MS010');
    await tenant(hostedApp, 'live');
    await tenant(hostedApp, 'synthetic', true);
  } finally {
    await hosted.close();
  }
  const classes = await live.admin.query<{ data_class: string; sandbox: boolean; n: number }>(
    'select data_class, sandbox, count(*)::int as n from ops.tenant group by 1, 2 order by 1, 2',
  );
  expect(classes.rows).toEqual([
    { data_class: 'live', sandbox: false, n: 1 },
    { data_class: 'showcase', sandbox: false, n: 1 },
    { data_class: 'synthetic', sandbox: true, n: 1 },
  ]);
});

it('the deployment and schema rows are written only as the owner, before any tenant, and never change', async () => {
  const owner = (sql: string, on = db) => asOwner(on.admin, [sql]);
  expect((await refused(owner(`insert into ops.deployment (kind, hosted) values ('demo', true)`))).code).toBe('MS010'); // tenants exist
  const { rows } = await db.admin.query(`select octet_length(sha256) as n, encode(sha256, 'hex') as hex, source from ops.schema_version`);
  expect(rows).toEqual([{ n: 32, hex: readSchema().sha256, source: 'schema' }]); // the build's own sha, as its 32 bytes
  for (const sql of [`update ops.schema_version set source = 'migrations'`, 'delete from ops.schema_version', 'truncate ops.schema_version']) {
    expect((await refused(owner(sql))).code, sql).toBe('MS010');
  }
  for (const sql of [`update ops.deployment set kind = 'demo'`, 'delete from ops.deployment', 'truncate ops.deployment']) {
    expect((await refused(owner(sql, live))).code, sql).toBe('MS010');
  }
  expect((await refused(tx(app, {}, (c) => c.query(`insert into ops.deployment (kind, hosted) values ('live', true)`)))).code).toBe('42501');
});

it('only an active owner changes the tenant, only its name and count_max_age, audited; and only an active owner changes a shop', async () => {
  const set = (actor: string, sql: string) => tx(app, as(actor), (c) => c.query(sql, [t.tenant]));
  await set(t.owner, `update ops.tenant set name = 'Renamed', count_max_age = '2 hours' where tenant_id = $1`);
  expect((await refused(set(t.manager, `update ops.tenant set name = 'By manager' where tenant_id = $1`))).code).toBe('MS007');
  // The jobs role may set a name only as the purge's placeholder of a lapsed sign-up; here its guard refuses.
  expect((await refused(tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) => c.query(`update ops.tenant set name = 'x'`)))).code).toBe('MS007');
  await set(t.owner, `update ops.shop set area = 'Kirti Nagar' where tenant_id = $1`);
  expect((await refused(set(t.manager, `update ops.shop set area = 'Elsewhere' where tenant_id = $1`))).code).toBe('MS007');
  const { rows } = await tx(app, { tenant_id: t.tenant }, (c) =>
    c.query(`select action, actor_id, payload from audit.audit_log where action in ('tenant.update', 'shop.update') order by seq`),
  );
  expect(rows).toEqual([
    { action: 'tenant.update', actor_id: t.owner, payload: { tenant_id: t.tenant } },
    { action: 'shop.update', actor_id: t.owner, payload: { shop_id: t.shop } },
  ]);
  // Opening hours are set by an owner or a manager, never staff.
  const hours = (actor: string) =>
    tx(app, as(actor), (c) =>
      c.query(`insert into ops.shop_hours (tenant_id, shop_id, weekday, closed, effective_from, created_by) values ($1, $2, 7, true, current_date, $3)`, [
        t.tenant,
        t.shop,
        t.staff,
      ]),
    );
  await hours(t.manager);
  expect((await refused(hours(t.staff))).code).toBe('MS007');
});

it('a directory row or a first-owner login is accepted only in the transaction that created the tenant', async () => {
  await newTenant(app, 'signup-ok', 'synthetic', { firstOwnerLogin: true });
  // A tenant and its owner in one transaction, its directory row in the next.
  const tenant0 = randomUUID();
  const owner0 = randomUUID();
  await tx(app, as(owner0, tenant0), async (c) => {
    await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Late', 'kirana', 'synthetic')`, [tenant0]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [tenant0, owner0]);
  });
  const lateSlug = await refused(tx(app, as(owner0, tenant0), (c) => c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('signup-late', $1)`, [tenant0])));
  expect(lateSlug.code).toBe('MS007');
  expect(lateSlug.message).toMatch(/only in the transaction that created its tenant/);
  // A first-owner login a transaction later, after a directory row and an owner made in the creation transaction.
  const { tenant, owner } = await newTenant(app, 'signup-login');
  const late = await refused(
    tx(app, as(owner, tenant), (c) =>
      c.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ('password', $1, $2, $3, true)`, [randomUUID(), tenant, owner]),
    ),
  );
  expect(late.code).toBe('MS007');
});

it('a reserved slug, a look-alike of a reserved or taken slug, or a route word is refused at self-serve sign-up; the owner role takes a reserved slug', async () => {
  for (const slug of ['elite', 'e1ite', 'prabhav-e', 'tenancy-sh0p', 'sign-in', 'api', 'signin']) {
    expect((await refused(newTenant(app, slug))).code, slug).toBe('MS007');
  }
  // The operator's provisioning: as the owner role, no actor, in the creation transaction.
  const c = await db.admin.connect();
  const tenant = randomUUID();
  try {
    await c.query('begin');
    await c.query('set local role munshi_owner');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenant]);
    await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Elite', 'salon', 'showcase')`, [tenant]);
    await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('elite', $1)`, [tenant]);
    await c.query(`insert into ops.member (tenant_id, display_name, role) values ($1, 'Owner', 'owner')`, [tenant]);
    await c.query('commit');
  } finally {
    c.release();
  }
  expect((await db.admin.query(`select skeleton from ops.tenant_directory where slug = 'elite'`)).rows).toEqual([{ skeleton: 'eiite' }]);
});

it('the first member is the owner adding themself; then only an active owner adds an owner or a manager, and owners or managers add staff', async () => {
  expect((await refused(addMember(t.manager, 'owner'))).code).toBe('MS007');
  expect((await refused(addMember(t.manager, 'manager'))).code).toBe('MS007');
  expect((await refused(addMember(t.staff, 'staff'))).code).toBe('MS007');
  await addMember(t.manager, 'staff');
  await addMember(t.owner, 'manager');
  await addMember(t.owner, 'owner');
  // A first member that is not an owner, or not the actor, is refused even in the creation transaction.
  const tenant = randomUUID();
  const r = await refused(
    tx(app, as(randomUUID(), tenant), async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'X', 'kirana', 'synthetic')`, [tenant]);
      await c.query(`insert into ops.member (tenant_id, display_name, role) values ($1, 'Someone', 'owner')`, [tenant]);
    }),
  );
  expect(r.code).toBe('MS007');
});

it('every member added is audited under the member who added them, with ids and the role only', async () => {
  const id = await addMember(t.owner, 'staff');
  const { rows } = await tx(app, { tenant_id: t.tenant }, (c) =>
    c.query(`select actor_id, payload from audit.audit_log where action = 'member.add' and entity_id = $1`, [id]),
  );
  expect(rows).toEqual([{ actor_id: t.owner, payload: { member_id: id, role: 'staff' } }]);
});

it('an invite is made by an active owner, or a manager for staff, used once by the invited member before it expires; the purge erases only an expired one', async () => {
  const mgr = await addMember(t.owner, 'manager');
  expect((await refused(invite(db, t, t.manager, mgr))).code).toBe('MS007');
  expect((await refused(invite(db, t, t.staff, t.staff))).code).toBe('MS007');
  const inv = await invite(db, t, t.manager, t.staff);
  const use = (actor: string) =>
    tx(app, as(actor), (c) => c.query(`update ops.member_invite set used_at = now(), email = null, erased_at = now() where id = $1`, [inv.id]));
  expect((await refused(use(t.owner))).code).toBe('MS018');
  const purge = () =>
    tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) => c.query(`update ops.member_invite set email = null, erased_at = now() where id = $1`, [inv.id]));
  expect((await refused(purge())).code).toBe('MS007'); // not expired yet
  await db.admin.query(`update ops.member_invite set expires_at = now() - interval '1 minute', created_at = now() - interval '1441 minutes' where id = $1`, [inv.id]);
  expect((await refused(use(t.staff))).code).toBe('MS007'); // expired
  await purge();
});

it('no email survives a used invite: using one without erasing its email is refused', async () => {
  const inv = await invite(db, t, t.owner, t.staff);
  const r = await refused(tx(app, as(t.staff), (c) => c.query(`update ops.member_invite set used_at = now() where id = $1`, [inv.id])));
  expect(r.code).toBe('MS007');
});

it('a login is bound only by the member, in the transaction that used the invite it names, and an invite binds once', async () => {
  const member = await addMember(t.owner, 'staff');
  const inv = await invite(db, t, t.owner, member);
  // another member cannot bind with it, and a login naming an invite not used in this transaction is refused
  const other = await refused(
    tx(app, as(t.staff), (c) =>
      c.query(`insert into ops.login (provider, subject, tenant_id, member_id, invite_id) values ('password', $1, $2, $3, $4)`, [randomUUID(), t.tenant, member, inv.id]),
    ),
  );
  expect(other.code).toBe('MS007');
  const unused = await refused(
    tx(app, as(member), (c) =>
      c.query(`insert into ops.login (provider, subject, tenant_id, member_id, invite_id) values ('password', $1, $2, $3, $4)`, [randomUUID(), t.tenant, member, inv.id]),
    ),
  );
  expect(unused.code).toBe('MS007');
  await bindLogin(db, t, member, inv.id);
  const again = await refused(
    tx(app, as(member), (c) =>
      c.query(`insert into ops.login (provider, subject, tenant_id, member_id, invite_id) values ('password', $1, $2, $3, $4)`, [randomUUID(), t.tenant, member, inv.id]),
    ),
  );
  expect(['MS007', '23505']).toContain(again.code);
  const { rows } = await db.admin.query(
    `select s.memberships, s.highest_role from ops.subject_summary s join ops.login l on l.provider = s.provider and l.subject = s.subject
      where l.tenant_id = $1 and l.member_id = $2`,
    [t.tenant, member],
  );
  expect(rows).toEqual([{ memberships: 1, highest_role: 'staff' }]);
});

it('a session is opened by its own member, signed out once by that member or an active owner, and never signed back in', async () => {
  const open = (actor: string, member: string) =>
    tx(app, as(actor), async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, 'demo', now() + interval '1 hour') returning id`,
        [t.tenant, member],
      );
      return r.rows[0]?.id as string;
    });
  expect((await refused(open(t.owner, t.staff))).code).toBe('MS007');
  const session = await open(t.staff, t.staff);
  const signOut = (actor: string, set = 'revoked_at = now()') =>
    tx(app, as(actor), (c) => c.query(`update ops.login_session set ${set} where id = $1`, [session]));
  expect((await refused(signOut(t.manager))).code).toBe('MS007');
  await signOut(t.owner);
  expect((await refused(signOut(t.staff))).code).toBe('MS007');
  expect((await refused(signOut(t.staff, 'revoked_at = null'))).code).toBe('MS007');
  // The sweep reaches only sessions 30 days past expiry.
  const swept = await tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) => c.query('delete from ops.login_session'));
  expect(swept.rowCount).toBe(0);
});

it('a member is deactivated once, by an active owner, never the last active owner, and never re-activated', async () => {
  const solo = await signUp(db, 'solo-owner');
  expect((await refused(deactivate(solo.manager, solo.staff, solo.tenant))).code).toBe('MS007');
  expect((await refused(deactivate(solo.owner, solo.owner, solo.tenant))).code).toBe('MS007'); // the last active owner
  await deactivate(solo.owner, solo.staff, solo.tenant);
  const back = await refused(
    tx(app, as(solo.owner, solo.tenant), (c) =>
      c.query(`update ops.member set active = true, deactivated_at = null where tenant_id = $1 and id = $2`, [solo.tenant, solo.staff]),
    ),
  );
  expect(back.code).toBe('MS007');
});

it('the purge erases a member only a year after deactivation, with no live login, leaving no audit entry', async () => {
  const leaver = await addMember(t.owner, 'staff');
  await deactivate(t.owner, leaver);
  const purge = () =>
    tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) =>
      c.query(`update ops.member set display_name = null, phone_e164 = null, erased_at = now() where tenant_id = $1 and id = $2`, [t.tenant, leaver]),
    );
  expect((await refused(purge())).code).toBe('MS007'); // deactivated today
  await db.admin.query(`update audit.audit_log set created_at = now() - interval '366 days' where action = 'member.deactivate' and entity_id = $1`, [leaver]);
  // as the app, with no actor, the same erasure is not the purge
  const byApp = await refused(
    tx(app, { tenant_id: t.tenant }, (c) =>
      c.query(`update ops.member set display_name = null, phone_e164 = null, erased_at = now() where tenant_id = $1 and id = $2`, [t.tenant, leaver]),
    ),
  );
  expect(byApp.code).toBe('MS018');
  await purge();
  const { rows } = await db.admin.query(`select count(*)::int as n from audit.audit_log where entity_id = $1 and action = 'member.erase'`, [leaver]);
  expect(rows[0].n).toBe(0);
});

it('a session follows the tenant class on any deployment: demo only on a sample shop, sandbox only on a sandbox, real only on a real shop with a live login at the current epoch', async () => {
  const sandbox = await signUp(db, 'tenancy-sandbox', { sandbox: true });
  const open = (pool: pg.Pool, tenant: string, member: string, via: string, epoch: number | null = null) =>
    tx(pool, as(member, tenant), (c) =>
      c.query(`insert into ops.login_session (tenant_id, member_id, via, subject_epoch, expires_at) values ($1, $2, $3, $4, now() + interval '1 hour')`, [
        tenant,
        member,
        via,
        epoch,
      ]),
    );
  expect((await refused(open(app, sandbox.tenant, sandbox.owner, 'demo'))).code).toBe('MS007');
  expect((await refused(open(app, t.tenant, t.owner, 'sandbox'))).code).toBe('MS007');
  await open(app, sandbox.tenant, sandbox.owner, 'sandbox');
  // A sample shop takes a demo session; even with a live login planted on it, no real one: its class, not the deployment.
  const sample = await signUp(db, 'tenancy-sample-real');
  await open(app, sample.tenant, sample.owner, 'demo');
  const planted = randomUUID();
  await plant(db.admin, `insert into ops.login (provider, subject, tenant_id, member_id, first_owner, created_txid) values ('password', $1, $2, $3, true, 0)`, [
    planted,
    sample.tenant,
    sample.owner,
  ]);
  await plant(db.admin, `insert into ops.subject_summary (provider, subject, memberships, highest_role) values ('password', $1, 1, 'owner')`, [planted]);
  expect((await refused(open(app, sample.tenant, sample.owner, 'real', 0))).code).toBe('MS007');
  // A real shop on this demo deployment takes a real session and no demo or sandbox one.
  const real = await newTenant(app, 'real-on-demo', 'live', { firstOwnerLogin: true });
  expect((await refused(open(app, real.tenant, real.owner, 'demo'))).code).toBe('MS007');
  expect((await refused(open(app, real.tenant, real.owner, 'sandbox'))).code).toBe('MS007');
  await open(app, real.tenant, real.owner, 'real', 0);
  // On a live deployment the same: a sandbox takes its session, a real shop a real one.
  const liveApp = live.as('munshi_app');
  const shop = await newTenant(liveApp, 'live-shop', 'live', { firstOwnerLogin: true });
  expect((await refused(open(liveApp, shop.tenant, shop.owner, 'demo'))).code).toBe('MS007');
  expect((await refused(open(liveApp, shop.tenant, shop.owner, 'real', 1))).code).toBe('MS007'); // an epoch the identity does not have
  await open(liveApp, shop.tenant, shop.owner, 'real', 0);
  const liveSandbox = await signUp(live, 'live-sandbox', { sandbox: true });
  await open(liveApp, liveSandbox.tenant, liveSandbox.owner, 'sandbox');
  expect((await refused(open(liveApp, liveSandbox.tenant, liveSandbox.owner, 'real', 0))).code).toBe('MS007');
});

it('two owners deactivating each other at once leave one active owner', async () => {
  const pair = await signUp(db, 'two-owners');
  const second = await addMember(pair.owner, 'owner', pair.tenant);
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    const begin = async (c: pg.PoolClient, actor: string) => {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [pair.tenant, actor]);
    };
    await begin(c1, pair.owner);
    await begin(c2, second);
    await c1.query(`update ops.member set active = false, deactivated_at = now() where id = $1`, [second]);
    const racing = c2.query(`update ops.member set active = false, deactivated_at = now() where id = $1`, [pair.owner]).then(
      () => 'passed',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 200));
    await c1.query('commit');
    expect(await racing).toBe('MS007');
    await c2.query('rollback');
  } finally {
    c1.release();
    c2.release();
  }
  const { rows } = await db.admin.query(`select count(*)::int as n from ops.member where tenant_id = $1 and role = 'owner' and active`, [pair.tenant]);
  expect(rows[0].n).toBe(1);
});

const sw = (actor: string | undefined, capability: string, on: boolean, pool = app, tenant = t.tenant) =>
  tx(pool, actor ? as(actor, tenant) : { tenant_id: tenant }, (c) =>
    c.query('insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, $2, $3)', [tenant, capability, on]),
  );
const isOn = async (tenant: string, capability: string) =>
  (
    await db.admin.query(
      `select is_on from ops.capability_switch where tenant_id = $1 and capability = $2 order by at desc, id desc limit 1`,
      [tenant, capability],
    )
  ).rows[0]?.is_on as boolean | undefined;

it('a switch-on with a requirement off and a switch-off while a dependant is on are refused; only an active owner switches; no actor only at creation', async () => {
  const shop = await signUp(db, 'cap-rules'); // the kirana pack: counter, credit, gst, offers and orders on; stitching off
  expect(await isOn(shop.tenant, 'credit')).toBe(true);
  expect((await refused(sw(shop.owner, 'counter', false, app, shop.tenant))).code).toBe('MS019'); // credit, gst, offers require it
  await sw(shop.owner, 'orders', false, app, shop.tenant); // nothing on requires orders
  expect((await refused(sw(shop.owner, 'stitching', true, app, shop.tenant))).code).toBe('MS019'); // requires orders, now off
  expect((await refused(sw(shop.manager, 'orders', true, app, shop.tenant))).code).toBe('MS007');
  expect((await refused(sw(shop.staff, 'orders', true, app, shop.tenant))).code).toBe('MS007');
  expect((await refused(sw(undefined, 'orders', true, app, shop.tenant))).code).toBe('MS018'); // no actor, after creation
  expect((await refused(sw(undefined, 'orders', true, db.as('munshi_jobs'), shop.tenant))).code).toBe('42501');
  await sw(shop.owner, 'orders', true, app, shop.tenant);
  await sw(shop.owner, 'stitching', true, app, shop.tenant);
  expect(await isOn(shop.tenant, 'stitching')).toBe(true);
  const { rows } = await tx(app, { tenant_id: shop.tenant }, (c) =>
    c.query(`select actor_id, payload from audit.audit_log where action = 'capability.switch' order by seq`),
  );
  // The pack's eleven switches at sign-up, then the owner's three, each under the owner, with the capability and flag only.
  expect(rows.length).toBe(14);
  expect(rows.slice(0, 11).every((r) => r.actor_id === shop.owner && r.payload.is_on === true)).toBe(true);
  expect(rows.slice(-3)).toEqual([
    { actor_id: shop.owner, payload: { capability: 'orders', is_on: false } },
    { actor_id: shop.owner, payload: { capability: 'orders', is_on: true } },
    { actor_id: shop.owner, payload: { capability: 'stitching', is_on: true } },
  ]);
});

it("two switches of one tenant at once never both pass against each other's old state", async () => {
  const shop = await signUp(db, 'cap-race');
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [shop.tenant, shop.owner]);
    }
    await c1.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'orders', false)`, [shop.tenant]);
    const racing = c2.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'stitching', true)`, [shop.tenant]).then(
      () => 'passed',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 200));
    await c1.query('commit');
    expect(await racing).toBe('MS019');
    await c2.query('rollback');
  } finally {
    c1.release();
    c2.release();
  }
  expect(await isOn(shop.tenant, 'orders')).toBe(false);
  expect(await isOn(shop.tenant, 'stitching')).toBeUndefined();
});
