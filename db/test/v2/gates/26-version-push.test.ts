// 26_version_push.sql: VER1 (a write in any covered table bumps the shop's version once per transaction, however many
// rows and tables it writes, a platform change for the shop too; a read bumps nothing; another shop's version stays),
// VER2 (the counter is written only by its triggers, rises by one, and is read by the app and the jobs role, never the
// agent), VER3 (every table holding a shop's book or ops state carries the deferred bump; the exclusions are exactly
// 26's list), PUSH1 (a member adds and revokes only their own subscription; the app never reads the sealed blobs; the
// sender reads them and revokes; nothing else changes) and PUSH2 (a member's deactivation revokes and their erasure
// erases their subscriptions, in the same update). Red-proofs: test/v2/sabotage/m6.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, rowsOf, sha, signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
let app: pg.Pool;
let jobs: pg.Pool;
let operator: string;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  a = await signUp(db, 'version-a');
  b = await signUp(db, 'version-b');
  const subject = randomUUID();
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(`insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, '{}', now())`, [
      subject,
      sha(subject),
      randomBytes(64),
      randomBytes(16),
    ]);
    const r = await c.query<{ id: string }>(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Founder', $2) returning id`, [
      subject,
      randomBytes(32),
    ]);
    operator = r.rows[0]?.id as string;
  } finally {
    await c.query('reset role');
    c.release();
  }
  await db.sabotage();
});
afterAll(() => db?.close());

const version = async (t: Tenant) => Number((await db.admin.query('select version from ops.tenant_version where tenant_id = $1', [t.tenant])).rows[0]?.version);
const owner = (t: Tenant, extra: Record<string, string> = {}) => ({ tenant_id: t.tenant, actor_id: t.owner, ...extra });

it('VER1 a write in any covered table bumps its shop’s version once per transaction, a platform change for the shop too; a read bumps nothing; another shop’s stays', async () => {
  const [a0, b0] = [await version(a), await version(b)];
  expect(a0).toBeGreaterThan(0); // its creation and its members already wrote
  // Three customers and a contact in one transaction: one bump.
  await tx(app, owner(a, { command: 'customer.create' }), async (c) => {
    for (let i = 0; i < 3; i++) await c.query('insert into books.customer (tenant_id) values ($1)', [a.tenant]);
    await c.query(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Asha', '+919811100201')`, [a.tenant]);
  });
  expect(await version(a)).toBe(a0 + 1);
  // A books row alone, an ops update, then a rename of the shop: one bump each.
  await tx(app, owner(a, { command: 'customer.create' }), (c) => c.query('insert into books.customer (tenant_id) values ($1)', [a.tenant]));
  await tx(app, owner(a), (c) => c.query(`update ops.shop set area = 'Ward 9' where tenant_id = $1`, [a.tenant]));
  await tx(app, owner(a), (c) => c.query(`update ops.tenant set name = 'Renamed' where tenant_id = $1`, [a.tenant]));
  const written = a0 + 4;
  expect(await version(a)).toBe(written);
  // Reads, a snapshot minted (a read's record) and an Ask answer: no bump.
  await tx(app, owner(a), async (c) => {
    await c.query('select * from books.customer');
    await c.query(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'sale.day', '{}', 'display', $2, $3, '\\x00', '\\x00', 0)`,
      [a.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('100'))],
    );
    // A whole Ask answer: its run, trace, usage and spend, its words and its answer row (the answer cache is keyed by
    // the version, so answering never moves it).
    const run = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'ask') returning id`, [a.tenant])).rows[0]?.id;
    await c.query(`insert into ai.trace (tenant_id, run_id, seq, kind, label) values ($1, $2, 1, 'route', 'ask')`, [a.tenant, run]);
    await c.query(`insert into ai.usage (tenant_id, day, role, calls) values ($1, current_date, 'reason', 1)`, [a.tenant]);
    await c.query(`insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out) values ($1, $2, 'reason', 'test-model', 10, 5)`, [a.tenant, run]);
    const words = (
      await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, run_id, body_sha256) values ($1, 'You sold tea today.', 'run', $2, '\\x00') returning id`, [
        a.tenant,
        run,
      ])
    ).rows[0]?.id;
    await c.query(`insert into ai.answer (tenant_id, run_id, kind, text_id, verdict) values ($1, $2, 'ask', $3, 'answered')`, [a.tenant, run, words]);
  });
  expect(await version(a)).toBe(written);
  // A refused write rolls its bump back with it.
  await refused(tx(app, owner(a, { command: 'customer.create' }), async (c) => {
    await c.query('insert into books.customer (tenant_id) values ($1)', [a.tenant]);
    await c.query('select 1/0');
  }));
  expect(await version(a)).toBe(written);
  // A platform change for the shop, written by the console with no shop context, bumps that shop.
  const platform = db.as('munshi_platform');
  const change = await tx(platform, { operator_id: operator }, async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('shop_features', $1, $2, $3, 0) returning id`, [
        a.tenant,
        JSON.stringify({ feature: 'voice', enabled: false }),
        operator,
      ])
    ).rows[0]?.id as string,
  );
  expect(await version(a)).toBe(written); // a proposal is nothing yet
  await tx(platform, { operator_id: operator, platform_change_id: change }, async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
    await c.query(`insert into platform.shop_feature (tenant_id, feature, enabled, change_id) values ($1, 'voice', false, $2)`, [a.tenant, change]);
  });
  expect(await version(a)).toBe(written + 1);
  // The jobs role's and the public's writes bump too.
  await tx(jobs, { tenant_id: a.tenant }, (c) =>
    c.query(`insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, first_run_id, last_run_id)
             select $1, 'stock', 'probe', 'probe:v', 'low', s.id, 0, '\\x00', r.id, r.id
               from snap.snapshot s, ai.run r where s.tenant_id = $1 and r.tenant_id = $1 limit 1`, [a.tenant]),
  );
  expect(await version(a)).toBe(written + 2);
  await tx(db.as('munshi_public'), { tenant_id: a.tenant }, (c) =>
    c.query(`insert into ops.inbound_message (tenant_id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, '919700000009', 'text', 'Hello', now())`, [
      a.tenant,
      `wamid.${randomUUID()}`,
    ]),
  );
  expect(await version(a)).toBe(written + 3);
  expect(await version(b)).toBe(b0);
});

it('VER2 the counter is written only by its triggers, only upward by one; the app and the jobs role read it, the agent does not', async () => {
  for (const [pool, ctx] of [
    [app, owner(a)],
    [jobs, { tenant_id: a.tenant }],
  ] as const) {
    expect((await tx(pool, ctx, (c) => c.query('select version from ops.tenant_version'))).rows).toEqual([{ version: String(await version(a)) }]);
    const r = await refused(tx(pool, ctx, (c) => c.query('update ops.tenant_version set bumped_txid = txid_current()')));
    expect([r.code, r.message]).toEqual(['MS018', 'ops.tenant_version is written only by the version triggers']);
    expect((await refused(tx(pool, ctx, (c) => c.query('update ops.tenant_version set version = 0')))).code, 'version is no role’s column').toBe('42501');
  }
  // The public and platform roles may only set bumped_txid (their bumps read no column): they read nothing of it.
  for (const role of ['munshi_public', 'munshi_platform']) {
    expect((await refused(tx(db.as(role), { tenant_id: a.tenant }, (c) => c.query('select version from ops.tenant_version')))).code, role).toBe('42501');
  }
  expect((await refused(tx(app, owner(a), (c) => c.query('insert into ops.tenant_version (tenant_id) values ($1)', [a.tenant]))))).toMatchObject({ code: 'MS018' });
  expect((await refused(tx(db.as('munshi_agent'), { tenant_id: a.tenant }, (c) => c.query('select version from ops.tenant_version')))).code).toBe('42501');
  // Even as the owner role, outside a trigger: refused.
  const owned = await db.admin.connect();
  try {
    await owned.query('begin');
    await owned.query('set local role munshi_owner');
    await owned.query(`select set_config('munshi.tenant_id', $1, true)`, [a.tenant]);
    const r = await refused(owned.query('update ops.tenant_version set version = 0'));
    expect(r.code).toBe('MS018');
  } finally {
    await owned.query('rollback');
    owned.release();
  }
});

it('VER3 every table holding a shop’s book or ops state carries the deferred bump; the exclusions are exactly 26’s list', async () => {
  const EXCLUDED = ['ai.answer', 'ai.run', 'ai.spend', 'ai.trace', 'ai.usage', 'ops.idempotency', 'ops.login_session', 'ops.message_text', 'ops.tenant_version', 'platform.change'];
  const { rows } = await db.admin.query<{ rel: string; bumped: boolean }>(
    `select c.oid::regclass::text as rel,
            exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'z_version' and g.tgdeferrable and g.tginitdeferred
                       and g.tgfoid = 'ops.version_bump()'::regprocedure and g.tgtype = 29) as bumped
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('ops', 'books', 'approval', 'ai', 'platform') and c.relkind = 'r'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 1`,
  );
  console.log(`VER3 ${rows.filter((r) => r.bumped).length} tables bump the version; ${EXCLUDED.length} excluded`);
  expect(rows.length).toBeGreaterThan(60);
  expect(rows.filter((r) => !r.bumped).map((r) => r.rel)).toEqual(EXCLUDED);
  // Nothing outside those schemas bumps (a read's snapshot, an audit entry).
  const { rows: stray } = await db.admin.query(
    `select g.tgrelid::regclass::text as rel from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where g.tgfoid = 'ops.version_bump()'::regprocedure and n.nspname not in ('ops', 'books', 'approval', 'ai', 'platform')`,
  );
  expect(stray).toEqual([]);
});

// Push subscriptions are a real shop's members' (a device registers from a real session): two accepted real shops.
let p: Tenant;
let q: Tenant;
const realShops = async () => {
  p ??= await signUp(db, 'push-p', { dataClass: 'live' });
  q ??= await signUp(db, 'push-q', { dataClass: 'live' });
};
const subscribe = (t: Tenant, member: string, asActor = member, hash: Buffer = sha(randomUUID()), via = 'real') =>
  tx(app, { tenant_id: t.tenant, actor_id: asActor, via }, async (c) =>
    (
      await c.query<{ id: string }>(
        `insert into ops.push_subscription (tenant_id, member_id, endpoint_hash, endpoint_enc, keys_enc) values ($1, $2, $3, $4, $5) returning id`,
        [t.tenant, member, hash, randomBytes(80), randomBytes(48)],
      )
    ).rows[0]?.id as string,
  );
const sub = async (id: string) =>
  (
    await db.admin.query(
      'select revoked_at is not null as revoked, erased_at is not null as erased, endpoint_enc is null and keys_enc is null as blank from ops.push_subscription where id = $1',
      [id],
    )
  ).rows[0];

it('PUSH1 a member adds and revokes only their own subscription, from a real session; the app never reads the sealed blobs; the sender reads them and revokes; nothing else changes', async () => {
  await realShops();
  const mine = await subscribe(p, p.staff);
  expect((await refused(subscribe(p, p.staff, p.owner))).code, 'another member’s').toBe('MS007');
  for (const via of ['demo', 'sandbox', '']) {
    const r = await refused(subscribe(p, p.staff, p.staff, sha(randomUUID()), via));
    expect([r.code, r.message], via || 'no via').toEqual(['MS007', 'push refused: a device is registered from a real session']);
  }
  expect((await refused(tx(jobs, { tenant_id: p.tenant }, (c) => c.query(
    `insert into ops.push_subscription (tenant_id, member_id, endpoint_hash, endpoint_enc, keys_enc) values ($1, $2, $3, $4, $5)`,
    [p.tenant, p.staff, sha(randomUUID()), randomBytes(80), randomBytes(48)],
  )))).code, 'the jobs role adds none').toBe('42501');
  expect((await refused(tx(app, owner(p), (c) => c.query('select endpoint_enc from ops.push_subscription')))).code).toBe('42501');
  expect((await tx(app, owner(p), (c) => c.query('select count(*)::int as n from ops.push_subscription where id = $1', [mine]))).rows).toEqual([{ n: 1 }]);
  expect((await tx(jobs, { tenant_id: p.tenant }, (c) => c.query('select count(*)::int as n from ops.push_subscription where endpoint_enc is not null and id = $1', [mine]))).rows).toEqual([{ n: 1 }]);
  // Another member revokes none of it; nothing but the revocation changes; the member revokes it once.
  expect((await refused(tx(app, owner(p), (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [mine])))).code).toBe('MS007');
  expect((await refused(tx(app, owner(p, { actor_id: p.staff }), (c) => c.query('update ops.push_subscription set erased_at = now(), endpoint_enc = null, keys_enc = null, revoked_at = now() where id = $1', [mine])))).code).toBe('MS007');
  await tx(app, owner(p, { actor_id: p.staff }), (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [mine]));
  expect((await refused(tx(app, owner(p, { actor_id: p.staff }), (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [mine])))).code).toBe('MS010');
  // The sender (no actor) revokes one the push service dropped.
  const other = await subscribe(p, p.owner);
  await tx(jobs, { tenant_id: p.tenant }, (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [other]));
  expect(await sub(other)).toEqual({ revoked: true, erased: false, blank: false });
  // Another shop sees none of it.
  expect((await tx(app, owner(q), (c) => c.query('select count(*)::int as n from ops.push_subscription where tenant_id <> $1', [q.tenant]))).rows).toEqual([{ n: 0 }]);
});

it('PUSH3 one device is one live subscription in a shop: a newer one for the same endpoint, another member’s or the same member’s, revokes the older in its own insert', async () => {
  await realShops();
  const device = sha(randomUUID());
  const managers = await subscribe(p, p.manager, p.manager, device);
  // The staff member signs in on the same device: the manager's subscription ends, the staff member's is the live one.
  const staffs = await subscribe(p, p.staff, p.staff, device);
  expect([await sub(managers), await sub(staffs)]).toEqual([
    { revoked: true, erased: false, blank: false },
    { revoked: false, erased: false, blank: false },
  ]);
  // The same member again: the older one ends too.
  const again = await subscribe(p, p.staff, p.staff, device);
  expect([await sub(staffs), await sub(again)]).toEqual([
    { revoked: true, erased: false, blank: false },
    { revoked: false, erased: false, blank: false },
  ]);
  const { rows } = await db.admin.query('select count(*)::int as n from ops.push_subscription where tenant_id = $1 and endpoint_hash = $2 and revoked_at is null', [p.tenant, device]);
  expect(rows).toEqual([{ n: 1 }]);
  // Another shop's subscription of the same device is its own.
  const elsewhere = await subscribe(q, q.staff, q.staff, device);
  expect(await sub(elsewhere)).toEqual({ revoked: false, erased: false, blank: false });
  expect(await sub(again)).toEqual({ revoked: false, erased: false, blank: false });
  // A member's own revoke rule is not widened: a plain update of another's row, even naming the device, is refused.
  const r = await refused(
    tx(app, owner(p, { actor_id: p.manager }), (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [again])),
  );
  expect(r.code).toBe('MS007');
});

it('PUSH2 a member’s deactivation revokes, and their erasure erases, their subscriptions in the same update; never otherwise', async () => {
  await realShops();
  const member = randomUUID();
  await tx(app, owner(q), (c) => c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Leaving', 'staff')`, [q.tenant, member]));
  const [one, two] = [await subscribe(q, member), await subscribe(q, member)];
  await tx(app, owner(q, { actor_id: member }), (c) => c.query('update ops.push_subscription set revoked_at = now() where id = $1', [two]));
  await tx(app, owner(q), (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [member]));
  expect([await sub(one), await sub(two)]).toEqual([
    { revoked: true, erased: false, blank: false },
    { revoked: true, erased: false, blank: false },
  ]);
  // Not erased while the member is not: the jobs role cannot blank it alone.
  expect((await refused(tx(jobs, { tenant_id: q.tenant }, (c) => c.query('update ops.push_subscription set endpoint_enc = null, keys_enc = null, erased_at = now() where id = $1', [one])))).code).toBe('MS007');
  await tx(app, owner(q), (c) => c.query('update ops.member set display_name = null, phone_e164 = null, erased_at = now() where id = $1', [member]));
  expect([await sub(one), await sub(two)]).toEqual([
    { revoked: true, erased: true, blank: true },
    { revoked: true, erased: true, blank: true },
  ]);
});
