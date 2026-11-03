// 09_idp_platform.sql with the reset grant and subject summary of 03: IDP1's database part (only the idp role touches
// hashes; an identity's shape, password change and erasure; the lockout sweep), RESET1's database part (an in-app reset
// only downward for a one-shop identity, used once with its token, bumping the epoch; the idp side takes it once within 5
// minutes), F4's operator rule, and PLAT1 (no platform write without an approved change of this transaction for exactly
// that write; every step in the platform chain, which verifies). Red-proofs: test/v2/sabotage/platform.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { bindLogin, invite, sha, signUp, type Tenant } from './fixture.ts';
import { asOwner, plant, RUNTIME_ROLES, refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let idp: pg.Pool;
let platform: pg.Pool;
let operator: string;
let operatorSubject: string;

const identityRow = (subject: string = randomUUID()) => [subject, sha(randomUUID()), randomBytes(64), randomBytes(16), JSON.stringify({ N: 131072, r: 8, p: 1 })];
const INSERT_IDENTITY = `insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, $5, now())`;

beforeAll(async () => {
  db = await openTestDb();
  idp = db.as('munshi_idp');
  platform = db.as('munshi_platform');
  t = await signUp(db, 'platform-shop');
  // `pnpm platform:operator`: the first operator, seeded as the owner role while none exists.
  operatorSubject = randomUUID();
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(INSERT_IDENTITY, identityRow(operatorSubject));
    const r = await c.query<{ id: string }>(
      `insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Operator One', $2) returning id`,
      [operatorSubject, randomBytes(32)],
    );
    operator = r.rows[0]?.id as string;
  } finally {
    await c.query('reset role');
    c.release();
  }
  await db.sabotage();
});
afterAll(() => db?.close());

const op = (extra: Record<string, string> = {}) => ({ operator_id: operator, ...extra });
const fresh = () => new Date().toISOString();

it('no role but munshi_idp reads or writes an identity, an attempt or a reset use', async () => {
  let refusals = 0;
  for (const role of RUNTIME_ROLES.filter((r) => r !== 'munshi_idp')) {
    for (const rel of ['idp.identity', 'idp.attempt', 'idp.reset_use']) {
      const r = await refused(tx(db.as(role), { tenant_id: t.tenant }, (c) => c.query(`select * from ${rel}`)));
      expect(r.code, `${role} on ${rel}`).toBe('42501');
      refusals++;
    }
  }
  expect(refusals).toBe(15);
});

it('an identity is created verified with a 16-byte salt; a password changes with a fresh salt and its stamp; erasure nulls every secret and freezes the row', async () => {
  const subject = randomUUID();
  await tx(idp, {}, (c) => c.query(INSERT_IDENTITY, identityRow(subject)));
  const set = (s: string, params: unknown[] = []) => tx(idp, {}, (c) => c.query(`update idp.identity set ${s} where subject = $1`, [subject, ...params]));
  expect((await refused(set('password_hash = $2', [randomBytes(64)]))).code).toBe('MS010'); // the same salt
  await set('password_hash = $2, salt = $3', [randomBytes(64), randomBytes(16)]);
  expect((await refused(set('email_hmac = $2', [sha('other@example.invalid')]))).code).toBe('MS011');
  expect((await refused(set(`verified_at = now() - interval '1 day'`))).code).toBe('42501'); // never granted
  expect((await refused(tx(idp, {}, (c) => c.query(INSERT_IDENTITY, [randomUUID(), sha('x'), randomBytes(64), randomBytes(8), '{}'])))).code).toBe('23514');
  await set('email_hmac = null, password_hash = null, salt = null, params = null, erased_at = now()');
  const frozen = await refused(set('password_hash = $2, salt = $3, params = $4', [randomBytes(64), randomBytes(16), '{}']));
  expect(frozen.code).toBe('MS011');
  expect(frozen.message).toMatch(/an erased identity never changes/);
});

it('lockout rows are swept a day after their last attempt, unless still locked', async () => {
  const row = (lastAt: string, lockedUntil: string | null) =>
    plant(db.admin, `insert into idp.attempt (email_hmac, ip_hash, failures, locked_until, last_at) values ($1, $2, 5, $3, $4)`, [
      sha(randomUUID()),
      sha(randomUUID()),
      lockedUntil,
      lastAt,
    ]);
  const dayAgo = new Date(Date.now() - 25 * 3600_000).toISOString();
  await row(dayAgo, null);
  await row(dayAgo, new Date(Date.now() + 3600_000).toISOString());
  await row(new Date().toISOString(), null);
  const swept = await tx(idp, {}, (c) => c.query('delete from idp.attempt'));
  expect(swept.rowCount).toBe(1);
});

it('an in-app reset only downward for a one-shop identity; used once with its token it bumps the epoch; the idp side takes it once, within 5 minutes', async () => {
  const app = db.as('munshi_app');
  const staffSubject = randomUUID();
  const inv = await invite(db, t, t.owner, t.staff);
  await bindLogin(db, t, t.staff, inv.id, staffSubject);
  const managerInvite = await invite(db, t, t.owner, t.manager);
  await bindLogin(db, t, t.manager, managerInvite.id);
  const token = randomBytes(32).toString('base64url');
  const issue = (by: string, member: string, subject: string) =>
    tx(app, { tenant_id: t.tenant, actor_id: by }, async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into ops.reset_grant (tenant_id, member_id, subject, token_sha256, issued_by, expires_at) values ($1, $2, $3, $4, $5, now()) returning id`,
        [t.tenant, member, subject, sha(token), by],
      );
      return r.rows[0]?.id as string;
    });
  const managerSubject = (await db.admin.query(`select subject from ops.login where member_id = $1`, [t.manager])).rows[0].subject;
  expect((await refused(issue(t.staff, t.staff, staffSubject))).code).toBe('MS007'); // a peer
  expect((await refused(issue(t.manager, t.manager, managerSubject))).code).toBe('MS007'); // not downward
  const grant = await issue(t.owner, t.staff, staffSubject);
  // The same identity in a second shop: no in-app reset for it any more.
  const other = await signUp(db, 'platform-second');
  const otherInvite = await invite(db, other, other.owner, other.staff);
  await bindLogin(db, other, other.staff, otherInvite.id, staffSubject);
  expect((await refused(issue(t.owner, t.staff, staffSubject))).code).toBe('MS007');
  const epoch = async () => (await db.admin.query(`select epoch from ops.subject_summary where subject = $1`, [staffSubject])).rows[0].epoch as number;
  const before = await epoch();
  const use = (secret: string) =>
    tx(db.as('munshi_public'), { tenant_id: t.tenant, reset_token: secret }, (c) => c.query(`update ops.reset_grant set used_at = now() where id = $1`, [grant]));
  expect((await refused(use('not-the-token'))).code).toBe('MS018');
  expect((await refused(tx(app, { tenant_id: t.tenant, actor_id: t.owner, reset_token: token }, (c) => c.query(`update ops.reset_grant set used_at = now() where id = $1`, [grant])))).code).toBe('42501');
  await use(token);
  expect(await epoch()).toBe(before + 1);
  expect((await refused(use(token))).code).toBe('MS018'); // once
  const take = (grantId: string) =>
    tx(idp, { tenant_id: t.tenant }, (c) => c.query(`insert into idp.reset_use (grant_id, tenant_id, subject, used_txid) values ($1, $2, $3, 0)`, [grantId, t.tenant, staffSubject]));
  await take(grant);
  expect((await refused(take(grant))).code).toBe('23505');
  // A grant used more than 5 minutes ago is not taken.
  const stale = await tx(app, { tenant_id: t.tenant, actor_id: t.owner }, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into ops.reset_grant (tenant_id, member_id, subject, token_sha256, issued_by, expires_at) values ($1, $2, $3, $4, $5, now()) returning id`,
      [t.tenant, t.manager, managerSubject, sha(randomUUID()), t.owner],
    );
    return r.rows[0]?.id as string;
  });
  await plant(db.admin, `update ops.reset_grant set used_at = now() - interval '6 minutes', used_txid = 1 where id = $1`, [stale]);
  const late = await refused(
    tx(idp, { tenant_id: t.tenant }, (c) => c.query(`insert into idp.reset_use (grant_id, tenant_id, subject, used_txid) values ($1, $2, $3, 0)`, [stale, t.tenant, managerSubject])),
  );
  expect(late.code).toBe('MS007');
});

it('an operator identity is never bound to a shop, and an identity with a shop membership never becomes an operator', async () => {
  const member = await signUp(db, 'operator-shop');
  const inv = await invite(db, member, member.owner, member.staff);
  expect((await refused(bindLogin(db, member, member.staff, inv.id, operatorSubject))).code).toBe('MS007');
  const memberSubject = randomUUID();
  const inv2 = await invite(db, member, member.owner, member.manager);
  await bindLogin(db, member, member.manager, inv2.id, memberSubject);
  await asOwner(db.admin, [`insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ('${memberSubject}', '\\x${sha(memberSubject).toString('hex')}', '\\x${randomBytes(64).toString('hex')}', '\\x${randomBytes(16).toString('hex')}', '{}', now())`]);
  const r = await refused(
    proposeAndApprove('operator', null, { subject: memberSubject, display_name: 'Second' }, (c) =>
      c.query(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Second', $2)`, [memberSubject, randomBytes(32)]),
    ),
  );
  expect(r.code).toBe('MS007');
  expect(r.message).toMatch(/shop membership is never an operator/);
});

// A change proposed in one transaction; decided (and, when `write` is given, executed) in a later one.
async function proposeAndApprove(kind: string, tenant: string | null, payload: Record<string, unknown>, write?: (c: pg.PoolClient) => Promise<unknown>) {
  const id = await tx(platform, op(), async (c) => {
    const r = await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ($1, $2, $3, $4, 0) returning id`, [
      kind,
      tenant,
      JSON.stringify(payload),
      operator,
    ]);
    return r.rows[0]?.id as string;
  });
  await tx(platform, op({ totp_at: fresh(), platform_change_id: id }), async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [id, operator]);
    if (write) await write(c);
  });
  return { id };
}
const CONFIG = { ai_enabled: true, ai_daily_calls: 60, media_daily_calls: 20, site_verified: false };
const insertConfig = (c: pg.PoolClient, config = CONFIG) =>
  c.query(`insert into platform.shop_config (tenant_id, ai_enabled, ai_daily_calls, media_daily_calls, site_verified, change_id) values ($1, $2, $3, $4, $5, $6)`, [
    t.tenant,
    config.ai_enabled,
    config.ai_daily_calls,
    config.media_daily_calls,
    config.site_verified,
    randomUUID(),
  ]);

it('no platform table accepts a write without an approved change decided in this transaction, later than its proposal, by this operator, for exactly this write', async () => {
  expect((await refused(tx(platform, op(), (c) => insertConfig(c)))).code).toBe('MS017');
  // Proposed and decided in one transaction: refused.
  const sameTx = await refused(
    tx(platform, op(), async (c) => {
      const r = await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('shop_config', $1, $2, $3, 0) returning id`, [
        t.tenant,
        JSON.stringify(CONFIG),
        operator,
      ]);
      await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [r.rows[0]?.id, operator]);
    }),
  );
  expect(sameTx.code).toBe('MS017');
  // A write that is not exactly the approved payload: refused.
  const mismatch = await refused(proposeAndApprove('shop_config', t.tenant, CONFIG, (c) => insertConfig(c, { ...CONFIG, ai_daily_calls: 2000 })));
  expect(mismatch.code).toBe('MS017');
  const ok = await proposeAndApprove('shop_config', t.tenant, CONFIG, (c) => insertConfig(c));
  // The same change, a transaction later: refused.
  expect((await refused(tx(platform, op({ platform_change_id: ok.id }), (c) => insertConfig(c)))).code).toBe('MS017');
  // A channel grant approved without a fresh TOTP code: refused at the decision (a real shop's: no sample shop is granted).
  const real = await signUp(db, 'platform-real', { dataClass: 'live' });
  const grantChange = await tx(platform, op(), async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('channel_grant', $1, $2, $3, 0) returning id`, [
        real.tenant,
        JSON.stringify({ channel: 'whatsapp', granted: true, max_test_recipients: 2, account_ref: null }),
        operator,
      ])
    ).rows[0]?.id as string,
  );
  const noTotp = await refused(
    tx(platform, op(), (c) => c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [grantChange, operator])),
  );
  expect(noTotp.code).toBe('MS017');
  // A phone number never rides in a change's payload.
  const phone = await refused(
    tx(platform, op(), (c) =>
      c.query(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('channel_grant', $1, '{"recipient": "+919811000001"}', $2, 0)`, [t.tenant, operator]),
    ),
  );
  expect(phone.code).toBe('23514');
  for (const role of ['munshi_app', 'munshi_jobs']) {
    expect((await refused(tx(db.as(role), { tenant_id: t.tenant }, (c) => insertConfig(c)))).code, role).toBe('42501');
  }
  const { rows } = await tx(db.as('munshi_app'), { tenant_id: t.tenant }, (c) =>
    c.query(`select ai_daily_calls, change_id from platform.shop_config where tenant_id = $1 order by effective_from desc, id desc limit 1`, [t.tenant]),
  );
  expect(rows).toEqual([{ ai_daily_calls: 60, change_id: ok.id }]);
});

it('every proposal, decision and executed write is in the platform chain, which verifies; a tampered entry is found', async () => {
  const verify = () => tx(platform, op(), async (c) => (await c.query<{ broken: string | null }>('select platform.verify_chain() as broken')).rows[0]?.broken);
  const before = (await db.admin.query('select count(*)::int as n from platform.audit_log')).rows[0].n as number;
  const change = await proposeAndApprove('shop_config', t.tenant, { ...CONFIG, site_verified: true }, (c) => insertConfig(c, { ...CONFIG, site_verified: true }));
  const { rows } = await db.admin.query<{ action: string }>(`select action from platform.audit_log where change_id = $1 order by seq`, [change.id]);
  expect(rows.map((r) => r.action)).toEqual(['change.propose', 'change.approve', 'shop_config.insert']);
  expect((await db.admin.query('select count(*)::int as n from platform.audit_log')).rows[0].n).toBe(before + 3);
  const seeds = (await db.admin.query<{ action: string }>(`select action from platform.audit_log where seq <= 3 order by seq`)).rows.map((r) => r.action);
  expect(seeds).toEqual(['reserved_slug.seed', 'reserved_slug.seed', 'operator.seed']);
  expect(await verify()).toBeNull();
  await db.admin.query(`update platform.audit_log set payload = '{"kind": "operator"}' where seq = 2`);
  expect(await verify()).toBe('2');
});

it('an operator session needs an active operator and a TOTP code from the last 5 minutes, at its identity’s epoch, and is revoked once', async () => {
  const open = (extra: Record<string, string>, epoch = 0) =>
    tx(platform, op(extra), async (c) => {
      const r = await c.query<{ id: string }>(`insert into platform.operator_session (operator_id, subject_epoch, expires_at) values ($1, $2, now() + interval '1 hour') returning id`, [
        operator,
        epoch,
      ]);
      return r.rows[0]?.id as string;
    });
  expect((await refused(open({}))).code).toBe('MS017');
  expect((await refused(open({ totp_at: new Date(Date.now() - 6 * 60_000).toISOString() }))).code).toBe('MS017');
  expect((await refused(open({ totp_at: fresh() }, 1))).code).toBe('MS017');
  const session = await open({ totp_at: fresh() });
  const revoke = () => tx(platform, op(), (c) => c.query(`update platform.operator_session set revoked_at = now() where id = $1`, [session]));
  await revoke();
  expect((await refused(revoke())).code).toBe('MS017');
});

it('an operator’s own TOTP step is chained as operator.sign_in, ids only, with no change id even when the session names one', async () => {
  await tx(platform, op({ platform_change_id: randomUUID() }), (c) =>
    c.query('update platform.operator set totp_last_step = totp_last_step + 1 where id = $1', [operator]),
  );
  const { rows } = await db.admin.query(
    `select action, operator_id, change_id, payload from platform.audit_log where entity = 'platform.operator' and entity_id = $1 order by seq desc limit 1`,
    [operator],
  );
  expect(rows).toEqual([{ action: 'operator.sign_in', operator_id: operator, change_id: null, payload: {} }]);
});
