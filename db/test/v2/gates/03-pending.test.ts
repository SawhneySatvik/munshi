// D-079 and D-080 over 03, 09, 02 and 08, on a live deployment: a real shop starts pending and is accepted only by an
// approved tenant_accept platform change; while pending it writes nothing but its creation and signs in only its owner;
// a pending sign-up expires after 14 days, is then never accepted, and the jobs purge frees its slug and erases its
// owner and logins; one identity holds one pending sign-up at a time. And an identity says how its email was vouched
// for. (The tenant class of sessions and deliveries: T1 and F7 in 03-tenancy, CH1 in 19-messaging.) Red-proofs:
// test/v2/sabotage/tenancy.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, plantProbeCommand, rowsOf, sha, signUp } from './fixture.ts';
import { acceptTenant, asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let platform: pg.Pool;
let operator: string;

beforeAll(async () => {
  db = await openTestDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  platform = db.as('munshi_platform');
  // `pnpm platform:operator`: the first operator, seeded as the owner role while none exists.
  const subject = randomUUID();
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(`insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, '{}', now())`, [
      subject,
      sha(randomUUID()),
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

type Real = { tenant: string; owner: string; subject: string; slug: string };

// Self-serve sign-up of a real shop: the tenant, its slug, the owner adding themself and the first-owner login, in one
// transaction as munshi_app with the new owner as the actor.
async function signUpReal(slug: string, subject: string = randomUUID()): Promise<Real> {
  const tenant = randomUUID();
  const owner = randomUUID();
  await tx(app, { tenant_id: tenant, actor_id: owner }, async (c) => {
    await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Real shop', 'kirana', 'live')`, [tenant]);
    await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [slug, tenant]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, 'Owner', '+919800000001', 'owner')`, [tenant, owner]);
    await c.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ('supabase', $1, $2, $3, true)`, [subject, tenant, owner]);
    await c.query(`insert into ops.shop (tenant_id, name) values ($1, 'Main')`, [tenant]);
  });
  return { tenant, owner, subject, slug };
}

// A platform change proposed in one transaction, decided in a later one, whose write runs in the deciding transaction.
async function decided(kind: string, tenant: string | null, payload: Record<string, unknown>, write: (c: pg.PoolClient) => Promise<unknown>, ctxTenant = tenant) {
  const id = await tx(platform, { operator_id: operator }, async (c) => {
    const r = await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ($1, $2, $3, $4, 0) returning id`, [
      kind,
      tenant,
      JSON.stringify(payload),
      operator,
    ]);
    return r.rows[0]?.id as string;
  });
  await tx(platform, { operator_id: operator, platform_change_id: id, ...(ctxTenant ? { tenant_id: ctxTenant } : {}) }, async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [id, operator]);
    await write(c);
  });
  return id;
}
const accept = (tenant: string) => (c: pg.PoolClient) => c.query('insert into platform.tenant_acceptance (tenant_id) values ($1)', [tenant]);
const acceptByChange = (tenant: string, ctxTenant = tenant) => decided('tenant_accept', tenant, {}, accept(tenant), ctxTenant);

// Back-dates a sign-up by `days` (the tenant and its slug), as the superuser with triggers off: setting up a past.
async function age(r: Real, days: number) {
  await plant(db.admin, `update ops.tenant set created_at = now() - make_interval(days => $2) where tenant_id = $1`, [r.tenant, days]);
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - make_interval(days => $2) where tenant_id = $1`, [r.tenant, days]);
}

const session = (r: { tenant: string }, member: string, epoch = 0) =>
  tx(app, { tenant_id: r.tenant, actor_id: member }, (c) =>
    c.query(`insert into ops.login_session (tenant_id, member_id, via, subject_epoch, expires_at) values ($1, $2, 'real', $3, now() + interval '1 hour')`, [
      r.tenant,
      member,
      epoch,
    ]),
  );
// A member with a live login and an identity summary, planted (setting up a member a pending shop could not add).
async function plantedMember(r: Real, role: string): Promise<string> {
  const member = randomUUID();
  const subject = randomUUID();
  await plant(db.admin, `insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Planted', $3)`, [r.tenant, member, role]);
  await plant(db.admin, `insert into ops.login (provider, subject, tenant_id, member_id, first_owner, created_txid) values ('supabase', $1, $2, $3, true, 0)`, [
    subject,
    r.tenant,
    member,
  ]);
  await plant(db.admin, `insert into ops.subject_summary (provider, subject, memberships, highest_role) values ('supabase', $1, 1, $2)`, [subject, role]);
  return member;
}

// Every kind of write an owner makes, each in its own transaction; the code each one ends with (or 'ok').
async function writes(r: Real): Promise<Record<string, string>> {
  const owner = { tenant_id: r.tenant, actor_id: r.owner };
  const draft = await tx(app, owner, (c) =>
    c.query<{ id: string }>(`select id from approval.draft where tenant_id = $1 limit 1`, [r.tenant]).then((x) => x.rows[0]?.id ?? randomUUID()),
  );
  const run: Record<string, [Record<string, string>, string, unknown[]]> = {
    book: [{ ...owner, command: 'customer.create' }, 'insert into books.customer (tenant_id) values ($1)', [r.tenant]],
    draft: [
      owner,
      `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', 0)`,
      [r.tenant, JSON.stringify([{ snapshotId: randomUUID(), row: 0, col: 'amount' }])],
    ],
    decision: [owner, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0)`, [r.tenant, draft, r.owner]],
    snapshot: [
      owner,
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count) values ($1, 'sale.day', '{}', 'display', $2, $3, '\\x00', '\\x00', 0)`,
      [r.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('100'))],
    ],
    member: [owner, `insert into ops.member (tenant_id, display_name, role) values ($1, 'Manager', 'manager')`, [r.tenant]],
    invite: [
      owner,
      `insert into ops.member_invite (tenant_id, member_id, email, token_sha256, expires_at) values ($1, $2, 'p@example.invalid', $3, now())`,
      [r.tenant, r.owner, sha(randomUUID())],
    ],
    switch: [owner, `insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'stock', true)`, [r.tenant]],
    tenant: [owner, `update ops.tenant set name = 'Renamed' where tenant_id = $1`, [r.tenant]],
    shop: [owner, `update ops.shop set area = 'Kirti Nagar' where tenant_id = $1`, [r.tenant]],
    hours: [
      owner,
      `insert into ops.shop_hours (tenant_id, shop_id, weekday, closed, effective_from, created_by) select $1, s.id, 7, true, current_date, $2 from ops.shop s where s.tenant_id = $1`,
      [r.tenant, r.owner],
    ],
  };
  const out: Record<string, string> = {};
  for (const [name, [ctx, sql, params]] of Object.entries(run)) {
    out[name] = await tx(app, ctx, (c) => c.query(sql, params)).then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );
  }
  return out;
}

it('PEND1 a pending real shop refuses every write but its creation and every session but its owner’s; accepted, the same writes and sessions go through', async () => {
  const r = await signUpReal('pending-kirana');
  const manager = await plantedMember(r, 'manager');
  const pending = await writes(r);
  expect(pending).toEqual({
    book: 'MS020',
    draft: 'MS020',
    decision: 'MS020',
    snapshot: 'MS020',
    member: 'MS020',
    invite: 'MS020',
    switch: 'MS020',
    tenant: 'MS020',
    shop: 'MS020',
    hours: 'MS020',
  });
  // The owner signs in, to the waiting page; nobody else does.
  await session(r, r.owner);
  expect((await refused(session(r, manager))).code).toBe('MS020');
  await acceptByChange(r.tenant);
  const open = await writes(r);
  // The draft cites an invented snapshot (23503, its pin) and the decision names no draft awaiting one (MS002): both are
  // past the acceptance rule, which is what is proved here.
  expect(open).toEqual({ book: 'ok', draft: '23503', decision: 'MS002', snapshot: 'ok', member: 'ok', invite: 'ok', switch: 'ok', tenant: 'ok', shop: 'ok', hours: 'ok' });
  await session(r, manager);
  // A sample shop never waits: the same writes on a synthetic shop go through without any acceptance.
  const sample = await signUp(db, 'pending-sample', { sandbox: true });
  expect((await tx(app, { tenant_id: sample.tenant, actor_id: sample.owner, command: 'customer.create' }, (c) => c.query('insert into books.customer (tenant_id) values ($1)', [sample.tenant]))).rowCount).toBe(1);
});

it('ACCEPT1 a real shop is accepted only by an approved tenant_accept change for it, decided later by an operator, once and chained; never a sample shop or an expired sign-up', async () => {
  const r = await signUpReal('accept-kirana');
  const other = await signUpReal('accept-other');
  const insert = (pool: pg.Pool, ctx: Record<string, string> = {}) =>
    tx(pool, { tenant_id: r.tenant, ...ctx }, (c) => c.query('insert into platform.tenant_acceptance (tenant_id) values ($1)', [r.tenant]));
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_public', 'munshi_agent', 'munshi_idp']) {
    expect((await refused(insert(db.as(role), { actor_id: r.owner }))).code, role).toBe('42501');
  }
  // As the platform role: with no change, an undecided one, another kind's, or another shop's.
  expect((await refused(insert(platform, { operator_id: operator }))).code).toBe('MS017');
  const undecided = await tx(platform, { operator_id: operator }, async (c) =>
    (await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('tenant_accept', $1, '{}', $2, 0) returning id`, [r.tenant, operator])).rows[0]?.id as string,
  );
  expect((await refused(insert(platform, { operator_id: operator, platform_change_id: undecided }))).code).toBe('MS017');
  const config = { ai_enabled: false, ai_daily_calls: 0, media_daily_calls: 0, site_verified: false };
  expect((await refused(decided('shop_config', r.tenant, config, accept(r.tenant)))).code).toBe('MS017');
  expect((await refused(decided('tenant_accept', other.tenant, {}, accept(r.tenant), r.tenant))).code).toBe('MS017');
  // A payload that is not empty is not this write.
  expect((await refused(decided('tenant_accept', r.tenant, { note: 'ok' }, accept(r.tenant)))).code).toBe('MS017');
  // The console reads the shop under its own context; without it, nothing is accepted.
  expect((await refused(acceptByChange(r.tenant, other.tenant))).code).toBe('MS017');
  // A sample shop is never accepted, and nor is an expired sign-up.
  const sample = await signUp(db, 'accept-sample', { sandbox: true });
  expect((await refused(acceptByChange(sample.tenant))).code).toBe('MS017');
  const expired = await signUpReal('accept-expired');
  await age(expired, 15);
  expect((await refused(acceptByChange(expired.tenant))).code).toBe('MS017');
  expect((await db.admin.query('select count(*)::int as n from platform.tenant_acceptance where tenant_id = any($1)', [[r.tenant, sample.tenant, expired.tenant]])).rows).toEqual([
    { n: 0 },
  ]);
  // The approved change for this shop: accepted, chained, once.
  const id = await acceptByChange(r.tenant);
  const { rows } = await db.admin.query<{ action: string }>('select action from platform.audit_log where change_id = $1 order by seq', [id]);
  expect(rows.map((x) => x.action)).toEqual(['change.propose', 'change.approve', 'tenant_acceptance.insert']);
  expect((await tx(platform, { operator_id: operator }, (c) => c.query<{ broken: string | null }>('select platform.verify_chain() as broken'))).rows[0]?.broken).toBeNull();
  expect((await refused(acceptByChange(r.tenant))).code).toBe('23505');
  for (const sql of ['update platform.tenant_acceptance set accepted_at = now()', 'delete from platform.tenant_acceptance']) {
    expect((await refused(tx(platform, { operator_id: operator }, (c) => c.query(sql)))).code, sql).toBe('42501');
  }
});

it('PURGE1 the purge frees only an expired pending real shop’s slug and erases its owner and logins; a fresh pending, an accepted or a sample shop is untouched', async () => {
  const expired = await signUpReal('purge-expired');
  const fresh = await signUpReal('purge-fresh');
  const accepted = await signUpReal('purge-accepted');
  await acceptByChange(accepted.tenant);
  await age(accepted, 30);
  const sample = await signUp(db, 'purge-sample', { sandbox: true });
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - interval '30 days' where tenant_id = $1`, [sample.tenant]);
  await age(expired, 15);
  // Expired: its owner signs in no more, even before the purge.
  expect((await refused(session(expired, expired.owner))).code).toBe('MS020');
  const jobs = db.as('munshi_jobs');
  // Only the jobs role runs it, with no actor; raw writes outside it touch no other shop.
  expect((await refused(tx(app, {}, (c) => c.query('select ops.purge_pending_signups()')))).code).toBe('42501');
  expect((await refused(tx(jobs, { actor_id: randomUUID() }, (c) => c.query('select ops.purge_pending_signups()')))).code).toBe('MS018');
  for (const r of [fresh, accepted]) {
    expect((await refused(tx(jobs, { tenant_id: r.tenant }, (c) => c.query('delete from ops.tenant_directory where tenant_id = $1', [r.tenant])))).code).toBe('MS010');
    expect((await refused(tx(jobs, { tenant_id: r.tenant }, (c) => c.query('update ops.login set revoked_at = now() where tenant_id = $1', [r.tenant])))).code).toBe('MS018');
    expect((await refused(tx(jobs, { tenant_id: r.tenant }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where tenant_id = $1', [r.tenant])))).code).toBe('MS007');
  }
  // The purge names each identity it left with no live membership, for the identity adapter to erase.
  const freed = await tx(jobs, {}, async (c) => (await c.query<{ provider: string; subject: string }>('select provider, subject from ops.purge_pending_signups()')).rows);
  expect(freed).toContainEqual({ provider: 'supabase', subject: expired.subject });
  for (const r of [fresh, accepted]) expect(freed.map((x) => x.subject)).not.toContain(r.subject);
  const state = async (r: { tenant: string }) =>
    (
      await db.admin.query(
        `select (select name from ops.tenant where tenant_id = $1) as tenant,
                (select count(*)::int from ops.tenant_directory where tenant_id = $1) as slug,
                (select count(*)::int from ops.login where tenant_id = $1 and revoked_at is null and erased_at is null and subject is not null) as logins,
                (select count(*)::int from ops.member where tenant_id = $1 and active and display_name is not null) as members`,
        [r.tenant],
      )
    ).rows[0];
  expect(await state(expired)).toEqual({ tenant: 'Lapsed sign-up', slug: 0, logins: 0, members: 0 });
  for (const r of [fresh, accepted]) expect(await state(r)).toEqual({ tenant: 'Real shop', slug: 1, logins: 1, members: 1 });
  expect((await state(sample)).slug).toBe(1);
  expect((await db.admin.query('select memberships from ops.subject_summary where provider = $1 and subject = $2', ['supabase', expired.subject])).rows).toEqual([
    { memberships: 0 },
  ]);
  // A second run purges nothing; the freed slug is taken by a new sign-up, by the same identity.
  expect((await tx(jobs, {}, (c) => c.query('select * from ops.purge_pending_signups()'))).rows).toEqual([]);
  await signUpReal('purge-expired', expired.subject);
});

it('SQUAT1 one identity holds one pending real sign-up: a second is refused until the first is accepted or expires', async () => {
  const subject = randomUUID();
  const first = await signUpReal('squat-first', subject);
  expect((await refused(signUpReal('squat-second', subject))).code).toBe('MS020');
  // Revoking or erasing its own first-owner login would free the identity for a second slug: refused while pending.
  for (const sql of ['update ops.login set revoked_at = now() where tenant_id = $1', 'update ops.login set subject = null, erased_at = now() where tenant_id = $1']) {
    expect((await refused(tx(app, { tenant_id: first.tenant, actor_id: first.owner }, (c) => c.query(sql, [first.tenant])))).code, sql).toBe('MS020');
  }
  expect((await db.admin.query(`select count(*)::int as n from ops.tenant_directory where slug = 'squat-second'`)).rows).toEqual([{ n: 0 }]);
  await signUpReal('squat-other'); // another identity
  await acceptByChange(first.tenant);
  const second = await signUpReal('squat-second', subject);
  expect((await refused(signUpReal('squat-third', subject))).code).toBe('MS020');
  await age(second, 15);
  await signUpReal('squat-third', subject);
});

it('IDP2 an identity says how its email was vouched for (an invite, a verified email claim, the operator’s seed), and never changes it; only the owner role seeds', async () => {
  const idp = db.as('munshi_idp');
  const make = (pool: pg.Pool, via: string | null) =>
    tx(pool, {}, async (c) =>
      (
        await c.query<{ subject: string }>(
          `insert into idp.identity (email_hmac, password_hash, salt, params, verified_at${via ? ', verified_via' : ''}) values ($1, $2, $3, '{}', now()${via ? ', $4' : ''})
           returning subject::text`,
          [sha(randomUUID()), randomBytes(64), randomBytes(16), ...(via ? [via] : [])],
        )
      ).rows[0]?.subject as string,
    );
  const via = async (subject: string) => (await db.admin.query('select verified_via from idp.identity where subject = $1', [subject])).rows[0]?.verified_via;
  expect(await via(await make(idp, null))).toBe('invite');
  const emailed = await make(idp, 'email');
  expect(await via(emailed)).toBe('email');
  expect((await refused(make(idp, 'seed'))).code).toBe('MS018');
  const [seeded] = await asOwner(db.admin, [
    `insert into idp.identity (email_hmac, password_hash, salt, params, verified_at, verified_via) values ('\\x${sha(randomUUID()).toString('hex')}', '\\x${randomBytes(64).toString('hex')}', '\\x${randomBytes(16).toString('hex')}', '{}', now(), 'email') returning subject::text`,
  ]);
  expect(await via(seeded?.rows[0].subject)).toBe('seed');
  expect((await refused(tx(idp, {}, (c) => c.query(`update idp.identity set verified_via = 'invite' where subject = $1`, [emailed])))).code).toBe('42501');
  expect((await refused(asOwner(db.admin, [`update idp.identity set verified_via = 'invite' where subject = '${emailed}'`]))).code).toBe('MS010');
});

it('GRANT1 a channel is granted only to a real shop: never proposed for a sample shop, never written once the sign-up is purged; a sample shop lists no recipient', async () => {
  const grant = { channel: 'whatsapp', granted: true, max_test_recipients: 5, account_ref: null };
  const write = (tenant: string) => (c: pg.PoolClient) =>
    c.query(`insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id) values ($1, 'whatsapp', true, 5, null, $2)`, [
      tenant,
      randomUUID(),
    ]);
  // TOTP: a channel grant's approval needs a fresh code (the change guard reads munshi.totp_at).
  const decidedGrant = async (tenant: string, change: string) =>
    tx(platform, { operator_id: operator, platform_change_id: change, totp_at: new Date().toISOString() }, async (c) => {
      await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
      await write(tenant)(c);
    });
  const propose = (tenant: string, payload = grant) =>
    tx(platform, { operator_id: operator }, async (c) =>
      (await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('channel_grant', $1, $2, $3, 0) returning id`, [
        tenant,
        JSON.stringify(payload),
        operator,
      ])).rows[0]?.id as string,
    );
  const sample = await signUp(db, 'grant-sample', { sandbox: true });
  expect((await refused(propose(sample.tenant))).code).toBe('MS017');
  await propose(sample.tenant, { ...grant, granted: false, max_test_recipients: 0 }); // a withdrawal is any shop's
  // A sample shop's owner lists no test recipient: no grant, no cap.
  const contact = await tx(app, { tenant_id: sample.tenant, actor_id: sample.owner }, async (c) =>
    (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Asha', '+919811100001') returning id`, [sample.tenant])).rows[0]?.id,
  );
  const listing = await refused(tx(app, { tenant_id: sample.tenant, actor_id: sample.owner }, (c) => c.query('insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2)', [sample.tenant, contact])));
  expect(listing.message).toMatch(/grant allows 0 test recipients/);
  // A pending real shop: the grant is proposed, then the sign-up expires and is purged before the approval.
  const lapsed = await signUpReal('grant-lapsed');
  const change = await propose(lapsed.tenant);
  await age(lapsed, 15);
  await tx(db.as('munshi_jobs'), {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  expect((await refused(decidedGrant(lapsed.tenant, change))).code).toBe('MS017');
  // An accepted real shop is granted.
  const real = await signUpReal('grant-real');
  await acceptByChange(real.tenant);
  await decidedGrant(real.tenant, await propose(real.tenant));
  expect((await db.admin.query('select granted from platform.channel_grant where tenant_id = $1', [real.tenant])).rows).toEqual([{ granted: true }]);
});

it('PEND2 a pending real shop’s app inserts into no other tenant table (a_open on every one but the creation’s and the self-guarded); an open shop’s pass it', async () => {
  const pending = await signUpReal('pend2-kirana');
  const sample = await signUp(db, 'pend2-sample', { sandbox: true });
  const { rows } = await db.admin.query<{ rel: string }>(
    `select c.oid::regclass::text as rel from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'a_open' order by 1`,
  );
  // The tables a person's data could land in are among them (the seal holds that no app table escapes).
  for (const rel of ['ops.contact', 'ops.message_text', 'ops.document', 'ops.campaign', 'ops.channel_recipient', 'ops.site', 'ops.site_look', 'ops.booking', 'ops.order_request', 'ops.delivery']) {
    expect(rows.map((r) => r.rel), rel).toContain(rel);
  }
  // Before a_open's check nothing else runs (it is the first trigger), so a bare insert reaches it.
  const outcome = (tenant: string, actor: string, rel: string) =>
    tx(app, { tenant_id: tenant, actor_id: actor }, (c) => c.query(`insert into ${rel} (tenant_id) values ($1)`, [tenant])).then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );
  const wrong: string[] = [];
  for (const { rel } of rows) {
    if ((await outcome(pending.tenant, pending.owner, rel)) !== 'MS020') wrong.push(`${rel} pending`);
    if ((await outcome(sample.tenant, sample.owner, rel)) === 'MS020') wrong.push(`${rel} open`);
  }
  expect(wrong).toEqual([]);
  expect(rows.length).toBeGreaterThan(25);
});

it('PURGE2 a lapsed sign-up leaves no personal string anywhere: every row naming the tenant, and every global row, holds none of what its owner typed', async () => {
  const marks = { tenant: 'Sentinel Tenant Qx', shop: 'Sentinel Store Qx', area: 'Sentinel Nagar Qx', address: 'Sentinel Road Qx', owner: 'Sentinel Owner Qx', phone: '+919811177731' };
  const subject = randomUUID();
  const tenant = randomUUID();
  const owner = randomUUID();
  await tx(app, { tenant_id: tenant, actor_id: owner }, async (c) => {
    await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, $2, 'kirana', 'live')`, [tenant, marks.tenant]);
    await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('sentinel-qx', $1)`, [tenant]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, $3, $4, 'owner')`, [tenant, owner, marks.owner, marks.phone]);
    await c.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ('supabase', $1, $2, $3, true)`, [subject, tenant, owner]);
    await c.query(`insert into ops.shop (tenant_id, name, area, address) values ($1, $2, $3, $4)`, [tenant, marks.shop, marks.area, marks.address]);
  });
  await session({ tenant }, owner); // the owner signs in to the waiting page
  await age({ tenant, owner, subject, slug: 'sentinel-qx' }, 15);
  await tx(db.as('munshi_jobs'), {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  const { rows: rels } = await db.admin.query<{ rel: string; tenanted: boolean }>(
    `select c.oid::regclass::text as rel, exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenanted
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'idp', 'platform') and c.relkind = 'r' order by 1`,
  );
  const leaks: string[] = [];
  const left: string[] = [];
  for (const { rel, tenanted } of rels) {
    const { rows } = await db.admin.query<{ t: string }>(`select to_jsonb(x)::text as t from ${rel} x${tenanted ? ' where x.tenant_id = $1' : ''}`, tenanted ? [tenant] : []);
    for (const { t } of rows) for (const [k, v] of Object.entries(marks)) if (t.includes(v)) leaks.push(`${rel}: ${k}`);
    if (tenanted && rows.length) left.push(rel);
    if (rows.some((r) => r.t.includes('sentinel-qx'))) leaks.push(`${rel}: slug`);
  }
  expect(leaks).toEqual([]);
  // The tombstone: the tenant (its placeholder name), its shop, members and logins (erased), switches and entries.
  expect(left.filter((rel) => !['ops.tenant', 'ops.shop', 'ops.member', 'ops.login', 'audit.audit_log', 'ops.capability_switch'].includes(rel))).toEqual([]);
});

it('LOCK1 an acceptance and the purge of one sign-up never both commit: the purge waits on the tenant’s lock and re-reads the acceptance', async () => {
  const r = await signUpReal('lock-kirana');
  // 14 days less 3 seconds old: still acceptable now, lapsed for a purge that starts 4 seconds later.
  await plant(db.admin, `update ops.tenant set created_at = now() - interval '14 days' + interval '3 seconds' where tenant_id = $1`, [r.tenant]);
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - interval '14 days' + interval '3 seconds' where tenant_id = $1`, [r.tenant]);
  const change = await tx(platform, { operator_id: operator }, async (c) =>
    (await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('tenant_accept', $1, '{}', $2, 0) returning id`, [r.tenant, operator])).rows[0]?.id as string,
  );
  const a = await platform.connect();
  try {
    await a.query('begin');
    await a.query(`select set_config('munshi.operator_id', $1, true), set_config('munshi.platform_change_id', $2, true), set_config('munshi.tenant_id', $3, true)`, [operator, change, r.tenant]);
    await a.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
    await a.query('insert into platform.tenant_acceptance (tenant_id) values ($1)', [r.tenant]);
    await new Promise((done) => setTimeout(done, 4_000));
    let settled = false;
    const purge = tx(db.as('munshi_jobs'), {}, (c) => c.query('select * from ops.purge_pending_signups()')).finally(() => {
      settled = true;
    });
    await new Promise((done) => setTimeout(done, 500));
    const waited = !settled;
    await a.query('commit');
    await purge;
    expect(waited).toBe(true);
  } finally {
    a.release();
  }
  const { rows } = await db.admin.query(
    `select (select count(*)::int from platform.tenant_acceptance where tenant_id = $1) as accepted, (select count(*)::int from ops.tenant_directory where tenant_id = $1) as slug`,
    [r.tenant],
  );
  expect(rows).toEqual([{ accepted: 1, slug: 1 }]);
});

it('SQUAT2 two sign-ups of one identity at once: the second waits on the identity’s lock and is refused', async () => {
  const subject = randomUUID();
  const first = await app.connect();
  try {
    const tenant = randomUUID();
    const owner = randomUUID();
    await first.query('begin');
    await first.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [tenant, owner]);
    await first.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Real shop', 'kirana', 'live')`, [tenant]);
    await first.query(`insert into ops.tenant_directory (slug, tenant_id) values ('squat2-first', $1)`, [tenant]);
    await first.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [tenant, owner]);
    await first.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ('supabase', $1, $2, $3, true)`, [subject, tenant, owner]);
    const second = signUpReal('squat2-second', subject).then(
      () => 'signed up',
      (e: { code?: string }) => e.code ?? 'error',
    );
    await new Promise((done) => setTimeout(done, 500));
    await first.query('commit');
    expect(await second).toBe('MS020');
  } finally {
    first.release();
  }
});

// The gates' own fixture accepts a real shop through the owner role's seed path, chained.
it('ACCEPT2 the owner role (the operator’s provisioning) accepts a real shop with no change, chained as a seed', async () => {
  const r = await signUpReal('accept-seed');
  await acceptTenant(db.admin, r.tenant);
  const { rows } = await db.admin.query<{ action: string }>(
    `select action from platform.audit_log where entity = 'platform.tenant_acceptance' and entity_id = (select id from platform.tenant_acceptance where tenant_id = $1)`,
    [r.tenant],
  );
  expect(rows).toEqual([{ action: 'tenant_acceptance.seed' }]);
});
