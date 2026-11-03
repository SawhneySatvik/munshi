// Pending shops over 03, 09, 02 and 08, on a live deployment: a real shop starts pending and is accepted only by an
// approved tenant_accept platform change; while pending it writes nothing but its creation and signs in only its owner;
// a pending sign-up expires after 14 days, is then never accepted, and the jobs purge frees its slug and erases its
// owner and logins; one identity holds one pending sign-up at a time. And an identity says how its email was vouched
// for. (The tenant class of sessions and deliveries: T1 and F7 in 03-tenancy, CH1 in 19-messaging.) The purge spares
// an operator's identity (PURGE-OP) and queues what it frees for the identity adapter (ERASEQ1); a self-asserted email
// is for a local or test database only (IDP3). A pending shop is granted no channel and stores no inbound message,
// whoever inserts it (PEND3); the purge revokes a lapsed sign-up's channel grants from before that rule, and an
// Instagram account a shop holds counts listed or not (PURGE3); the purge and an approval take the platform chain's lock
// before a shop's, so they never deadlock (LOCK2), and so does the owner's acceptance (LOCK3). Red-proofs: test/v2/sabotage/tenancy.ts, test/v2/sabotage/purge-router-and-push.ts and
// test/v2/sabotage/channel-grants-and-budgets.ts.
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
    const r = await c.query<{ id: string }>(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Operator One', $2) returning id`, [
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
async function signUpReal(slug: string, subject: string = randomUUID(), provider: 'supabase' | 'password' = 'supabase'): Promise<Real> {
  const tenant = randomUUID();
  const owner = randomUUID();
  await tx(app, { tenant_id: tenant, actor_id: owner }, async (c) => {
    await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Real shop', 'kirana', 'live')`, [tenant]);
    await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [slug, tenant]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, 'Owner', '+919800000001', 'owner')`, [tenant, owner]);
    await c.query(`insert into ops.login (provider, subject, tenant_id, member_id, first_owner) values ($4, $1, $2, $3, true)`, [subject, tenant, owner, provider]);
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

it('a pending real shop refuses every write but its creation and every session but its owner’s; accepted, the same writes and sessions go through', async () => {
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

it('a real shop is accepted only by an approved tenant_accept change for it, decided later by an operator, once and chained; never a sample shop or an expired sign-up', async () => {
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

it('the purge frees only an expired pending real shop’s slug and erases its owner and logins; a fresh pending, an accepted or a sample shop is untouched', async () => {
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

it('one identity holds one pending real sign-up: a second is refused until the first is accepted or expires', async () => {
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

it('an identity says how its email was vouched for (an invite, a verified email claim, the operator’s seed), and never changes it; only the owner role seeds', async () => {
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

it('a channel is granted only to a real shop: never proposed for a sample shop, never written once the sign-up is purged; a sample shop lists no recipient', async () => {
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
  // A sample shop's owner lists no test recipient: test recipients are a real shop's.
  const contact = await tx(app, { tenant_id: sample.tenant, actor_id: sample.owner }, async (c) =>
    (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Asha', '+919811100001') returning id`, [sample.tenant])).rows[0]?.id,
  );
  const listing = await refused(tx(app, { tenant_id: sample.tenant, actor_id: sample.owner }, (c) => c.query('insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2)', [sample.tenant, contact])));
  expect(listing.message).toBe("recipient refused: test recipients are a real shop's");
  // A pending real shop: no grant is proposed until the operator accepts it (PEND3). One proposed before that rule
  // (planted), then the sign-up expires and is purged before the approval: never written.
  const lapsed = await signUpReal('grant-lapsed');
  expect((await refused(propose(lapsed.tenant))).code).toBe('MS017');
  const change = randomUUID();
  await plant(
    db.admin,
    `insert into platform.change (id, kind, tenant_id, payload, proposed_by, proposed_at, proposed_txid) values ($1, 'channel_grant', $2, $3, $4, now() - interval '1 minute', 0)`,
    [change, lapsed.tenant, JSON.stringify(grant), operator],
  );
  await age(lapsed, 15);
  await tx(db.as('munshi_jobs'), {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  expect((await refused(decidedGrant(lapsed.tenant, change))).code).toBe('MS017');
  // An accepted real shop is granted.
  const real = await signUpReal('grant-real');
  await acceptByChange(real.tenant);
  await decidedGrant(real.tenant, await propose(real.tenant));
  expect((await db.admin.query('select granted from platform.channel_grant where tenant_id = $1', [real.tenant])).rows).toEqual([{ granted: true }]);
});

it('a pending real shop’s app inserts into no other tenant table (a_open on every one but the creation’s and the self-guarded); an open shop’s pass it', async () => {
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

it('a lapsed sign-up leaves no personal string anywhere: every row naming the tenant, and every global row, holds none of what its owner typed', async () => {
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
  // The tombstone: the tenant (its placeholder name), its shop, members and logins (erased), switches and entries, and
  // its data version (a counter, 26).
  expect(
    left.filter((rel) => !['ops.tenant', 'ops.shop', 'ops.member', 'ops.login', 'audit.audit_log', 'ops.capability_switch', 'ops.tenant_version'].includes(rel)),
  ).toEqual([]);
});

it('an acceptance and the purge of one sign-up never both commit: the purge waits on the tenant’s lock and re-reads the acceptance', async () => {
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

it('two sign-ups of one identity at once: the second waits on the identity’s lock and is refused', async () => {
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
it('the owner role (the operator’s provisioning) accepts a real shop with no change, chained as a seed', async () => {
  const r = await signUpReal('accept-seed');
  await acceptTenant(db.admin, r.tenant);
  const { rows } = await db.admin.query<{ action: string }>(
    `select action from platform.audit_log where entity = 'platform.tenant_acceptance' and entity_id = (select id from platform.tenant_acceptance where tenant_id = $1)`,
    [r.tenant],
  );
  expect(rows).toEqual([{ action: 'tenant_acceptance.seed' }]);
});

it('the purge never returns or queues an operator’s identity: its lapsed shop is purged, the identity is left whole', async () => {
  const subject = randomUUID();
  const r = await signUpReal('purge-operator', subject, 'password');
  await age(r, 15);
  // The identity became an operator's after it signed up (the operator seed marks the summary).
  await plant(db.admin, `update ops.subject_summary set is_operator = true where provider = 'password' and subject = $1`, [subject]);
  const freed = await tx(db.as('munshi_jobs'), {}, async (c) => (await c.query<{ subject: string }>('select subject from ops.purge_pending_signups()')).rows);
  expect(freed.map((x) => x.subject)).not.toContain(subject);
  expect((await db.admin.query('select 1 from ops.identity_erase where subject = $1', [subject])).rowCount).toBe(0);
  expect((await db.admin.query('select count(*)::int as n from ops.tenant_directory where tenant_id = $1', [r.tenant])).rows).toEqual([{ n: 0 }]);
  // The jobs role reads the operator flag it asks about.
  const { rows } = await tx(db.as('munshi_jobs'), {}, (c) => c.query(`select is_operator from ops.subject_summary where provider = 'password' and subject = $1`, [subject]));
  expect(rows).toEqual([{ is_operator: true }]);
});

it('the purge queues each password identity it frees; only the purge queues, never a held one; the identity adapter takes a row off only once its identity is erased or held', async () => {
  const idp = db.as('munshi_idp');
  const jobs = db.as('munshi_jobs');
  // The identity, as the password adapter made it.
  const subject = await tx(idp, {}, async (c) =>
    (
      await c.query<{ subject: string }>(`insert into idp.identity (email_hmac, password_hash, salt, params, verified_at, verified_via) values ($1, $2, $3, '{}', now(), 'email') returning subject::text`, [
        sha(randomUUID()),
        randomBytes(64),
        randomBytes(16),
      ])
    ).rows[0]?.subject as string,
  );
  const r = await signUpReal('eraseq-lapsed', subject, 'password');
  const held = await signUpReal('eraseq-held', randomUUID(), 'password');
  // Only the purge queues: not the app, not the jobs role with an actor, never an identity with a live membership.
  expect((await refused(tx(app, {}, (c) => c.query(`insert into ops.identity_erase (provider, subject) values ('password', $1)`, [subject]))))).toMatchObject({ code: '42501' });
  expect((await refused(tx(jobs, { actor_id: randomUUID() }, (c) => c.query(`insert into ops.identity_erase (provider, subject) values ('password', $1)`, [subject]))))).toMatchObject({ code: 'MS018' });
  expect((await refused(tx(jobs, {}, (c) => c.query(`insert into ops.identity_erase (provider, subject) values ('password', $1)`, [held.subject]))))).toMatchObject({ code: 'MS007' });
  await age(r, 15);
  const freed = await tx(jobs, {}, async (c) => (await c.query<{ provider: string; subject: string }>('select provider, subject from ops.purge_pending_signups()')).rows);
  expect(freed).toContainEqual({ provider: 'password', subject });
  const queued = async () => (await tx(jobs, {}, (c) => c.query('select provider from ops.identity_erase where subject = $1', [subject]))).rows;
  expect(await queued()).toEqual([{ provider: 'password' }]);
  // The jobs role deletes no row; the adapter's delete takes nothing while the identity is live and unheld.
  expect((await refused(tx(jobs, {}, (c) => c.query('delete from ops.identity_erase where subject = $1', [subject]))))).toMatchObject({ code: '42501' });
  expect((await tx(idp, {}, (c) => c.query('delete from ops.identity_erase where subject = $1', [subject]))).rowCount).toBe(0);
  // Erased, it comes off.
  await tx(idp, {}, async (c) => {
    await c.query('update idp.identity set email_hmac = null, password_hash = null, salt = null, params = null, erased_at = now() where subject = $1::uuid', [subject]);
    expect((await c.query('delete from ops.identity_erase where subject = $1', [subject])).rowCount).toBe(1);
  });
  expect(await queued()).toEqual([]);
  // Held again (its email signed up another shop meanwhile): the adapter leaves the identity and takes the row off.
  const again = await tx(idp, {}, async (c) =>
    (
      await c.query<{ subject: string }>(`insert into idp.identity (email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, '{}', now()) returning subject::text`, [
        sha(randomUUID()),
        randomBytes(64),
        randomBytes(16),
      ])
    ).rows[0]?.subject as string,
  );
  const r2 = await signUpReal('eraseq-again', again, 'password');
  await age(r2, 15);
  await tx(jobs, {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  expect((await tx(jobs, {}, (c) => c.query('select 1 from ops.identity_erase where subject = $1', [again]))).rowCount).toBe(1);
  await plant(db.admin, `update ops.subject_summary set memberships = 1 where provider = 'password' and subject = $1`, [again]);
  expect((await tx(idp, {}, (c) => c.query('delete from ops.identity_erase where subject = $1', [again]))).rowCount).toBe(1);
  // A password subject is a uuid.
  expect((await refused(tx(jobs, {}, (c) => c.query(`insert into ops.identity_erase (provider, subject) values ('password', 'not-a-uuid')`)))).code).toBe('23514');
});

it('a self-asserted email (verified_via self) is refused on a hosted or live deployment, and taken on a local or test one', async () => {
  const make = (pool: pg.Pool) =>
    tx(pool, {}, async (c) =>
      (
        await c.query<{ via: string }>(
          `insert into idp.identity (email_hmac, password_hash, salt, params, verified_at, verified_via) values ($1, $2, $3, '{}', now(), 'self') returning verified_via as via`,
          [sha(randomUUID()), randomBytes(64), randomBytes(16)],
        )
      ).rows[0]?.via,
    );
  const served = await refused(make(db.as('munshi_idp')));
  expect([served.code, served.message]).toEqual(['MS010', 'identity refused: a self-asserted email is for a local or test database only']);
  const local = await openTestDb(); // no deployment row: a laptop or test database
  try {
    expect(await make(local.as('munshi_idp'))).toBe('self');
  } finally {
    await local.close();
  }
});

it('an Instagram account routes to one shop: a granted Instagram grant names its account, and an account another live shop holds granted is refused at approval; once that shop withdraws, it may be granted', async () => {
  const grantIg = async (tenant: string, granted: boolean, account: string | null) => {
    const payload = { channel: 'instagram', granted, max_test_recipients: 0, account_ref: account };
    const change = await tx(platform, { operator_id: operator }, async (c) =>
      (
        await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('channel_grant', $1, $2, $3, 0) returning id`, [
          tenant,
          JSON.stringify(payload),
          operator,
        ])
      ).rows[0]?.id as string,
    );
    await tx(platform, { operator_id: operator, platform_change_id: change, totp_at: new Date().toISOString() }, async (c) => {
      await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
      await c.query(
        `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id) values ($1, 'instagram', $2, 0, $3, $4)`,
        [tenant, granted, account, randomUUID()],
      );
    });
  };
  const [one, two] = [await signUpReal('ig-route-one'), await signUpReal('ig-route-two')];
  await acceptByChange(one.tenant);
  await acceptByChange(two.tenant);
  expect((await refused(grantIg(one.tenant, true, null))).code, 'a granted Instagram grant names its account').toBe('MS017');
  await grantIg(one.tenant, true, 'ig_route_shop');
  const taken = await refused(grantIg(two.tenant, true, 'ig_route_shop'));
  expect([taken.code, taken.message]).toEqual(['MS017', 'grant refused: this Instagram account is already granted to another shop']);
  // The holder renews its own grant; another account is free; once the holder withdraws, the account can move.
  await grantIg(one.tenant, true, 'ig_route_shop');
  await grantIg(two.tenant, true, 'ig_route_other');
  await grantIg(one.tenant, false, 'ig_route_shop');
  await grantIg(two.tenant, true, 'ig_route_shop');
  const { rows } = await tx(db.as('munshi_public'), {}, (c) =>
    c.query(
      `select distinct on (g.tenant_id) g.tenant_id, g.granted from platform.channel_grant g
        where g.channel = 'instagram' and g.tenant_id = any($1) order by g.tenant_id, g.effective_from desc, g.id desc`,
      [[one.tenant, two.tenant]],
    ),
  );
  expect(rows.filter((r) => r.granted).map((r) => r.tenant_id)).toEqual([two.tenant]);
});

// A channel grant proposed in one transaction, then approved with a fresh code in a later one that writes it.
type Grant = { channel: 'whatsapp' | 'instagram'; granted: boolean; account: string | null; recipients?: number };
const grantPayload = (g: Grant) => ({ channel: g.channel, granted: g.granted, max_test_recipients: g.recipients ?? 0, account_ref: g.account });
const proposeGrant = (tenant: string, g: Grant) =>
  tx(platform, { operator_id: operator }, async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('channel_grant', $1, $2, $3, 0) returning id`, [
        tenant,
        JSON.stringify(grantPayload(g)),
        operator,
      ])
    ).rows[0]?.id as string,
  );
const approveGrant = (change: string, tenant: string, g: Grant) =>
  tx(platform, { operator_id: operator, platform_change_id: change, totp_at: new Date().toISOString() }, async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
    await c.query(`insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id) values ($1, $2, $3, $4, $5, $6)`, [
      tenant,
      g.channel,
      g.granted,
      g.recipients ?? 0,
      g.account,
      randomUUID(),
    ]);
  });
const grantChannel = async (tenant: string, g: Grant) => approveGrant(await proposeGrant(tenant, g), tenant, g);
const latestGrants = async (tenant: string) =>
  (
    await db.admin.query(
      `select distinct on (channel) id::text, channel, granted, max_test_recipients, account_ref, change_id from platform.channel_grant
        where tenant_id = $1 order by channel, effective_from desc, id desc`,
      [tenant],
    )
  ).rows;

// A grant a database written before the acceptance rule may still hold: planted, as a past state the guards now refuse.
const legacyGrant = (tenant: string, channel: 'whatsapp' | 'instagram', account: string | null) =>
  plant(
    db.admin,
    `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id, effective_from) values ($1, $2, true, 0, $3, $4, clock_timestamp())`,
    [tenant, channel, account, randomUUID()],
  );

it('a shop waiting for acceptance is granted no channel and stores no inbound message on either channel, even under a grant it holds from before; accepted, it is granted and the same messages are stored', async () => {
  const r = await signUpReal('pend3-kirana');
  const ig: Grant = { channel: 'instagram', granted: true, account: 'ig_pend3' };
  // No grant is proposed for it, nor written under a change proposed before the rule (planted): MS017 at both.
  expect((await refused(proposeGrant(r.tenant, ig))).code, 'proposal').toBe('MS017');
  const early = randomUUID();
  await plant(
    db.admin,
    `insert into platform.change (id, kind, tenant_id, payload, proposed_by, proposed_at, proposed_txid) values ($1, 'channel_grant', $2, $3, $4, now() - interval '1 minute', 0)`,
    [early, r.tenant, JSON.stringify(grantPayload(ig)), operator],
  );
  const write = await refused(approveGrant(early, r.tenant, ig));
  expect([write.code, write.message]).toEqual(['MS017', 'grant refused: a channel is granted only to a real shop']);
  expect(await latestGrants(r.tenant)).toEqual([]);
  // Defence in depth: holding a grant from before the rule, it still stores no message (MS020, whichever channel).
  await legacyGrant(r.tenant, 'instagram', 'ig_pend3');
  const inbound = (channel: 'whatsapp' | 'instagram') =>
    tx(db.as('munshi_public'), { tenant_id: r.tenant }, (c) =>
      c.query(
        `insert into ops.inbound_message (tenant_id, channel, provider_message_id, from_address, account_ref, kind, text, received_at)
         values ($1, $2, $3, $4, $5, 'text', 'Is the shop open today?', now())`,
        [r.tenant, channel, `${channel}.${randomUUID()}`, channel === 'whatsapp' ? '919800000777' : '17841400000000777', channel === 'instagram' ? 'ig_pend3' : null],
      ),
    );
  const stored = async () => (await db.admin.query<{ n: number }>('select count(*)::int as n from ops.inbound_message where tenant_id = $1', [r.tenant])).rows[0]?.n;
  for (const channel of ['whatsapp', 'instagram'] as const) {
    const e = await refused(inbound(channel));
    expect([e.code, e.message], channel).toEqual(['MS020', "inbound refused: the shop waits for the operator's acceptance"]);
  }
  expect(await stored()).toBe(0);
  // Only the webhook's role asks the open-shop door.
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_agent']) {
    expect((await refused(tx(db.as(role), { tenant_id: r.tenant }, (c) => c.query('select ops.inbound_open($1)', [r.tenant])))).code, role).toBe('42501');
  }
  await acceptByChange(r.tenant);
  await grantChannel(r.tenant, ig);
  for (const channel of ['whatsapp', 'instagram'] as const) await inbound(channel);
  expect(await stored()).toBe(2);
});

it('the purge revokes every channel a lapsed sign-up holds, chained as the purge’s with no operator or change; its Instagram account is then free, and an account counts as held whether or not its shop is listed', async () => {
  // A pending shop is never granted now (PEND3), so the purge's revocation is defence in depth: for grants from before
  // that rule, planted here.
  const lapsed = await signUpReal('purge3-lapsed');
  await legacyGrant(lapsed.tenant, 'whatsapp', null);
  await legacyGrant(lapsed.tenant, 'instagram', 'ig_purge3');
  const taker = await signUpReal('purge3-taker');
  await acceptByChange(taker.tenant);
  const taken = await refused(grantChannel(taker.tenant, { channel: 'instagram', granted: true, account: 'ig_purge3' }));
  expect([taken.code, taken.message]).toEqual(['MS017', 'grant refused: this Instagram account is already granted to another shop']);
  await age(lapsed, 15);
  // The revocation is the purge's alone: not the app's; not for a shop that has not lapsed, by the jobs role or the owner.
  const jobs = db.as('munshi_jobs');
  expect((await refused(tx(app, { tenant_id: lapsed.tenant }, (c) => c.query('select platform.purge_grants($1)', [lapsed.tenant])))).code).toBe('42501');
  expect((await refused(tx(jobs, { tenant_id: taker.tenant }, (c) => c.query('select platform.purge_grants($1)', [taker.tenant])))).code).toBe('MS017');
  expect((await refused(tx(jobs, { tenant_id: taker.tenant }, (c) => c.query('select platform.purge_grants($1)', [lapsed.tenant])))).code).toBe('MS017');
  const ownerRevoke = `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients) values ('${taker.tenant}', 'whatsapp', false, 0)`;
  expect((await refused(asOwner(db.admin, [ownerRevoke], taker.tenant))).code).toBe('MS017');
  // A grant with no change is one that grants nothing (the table's check, past every trigger).
  const unchanged = `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients) values ($1, 'whatsapp', true, 0)`;
  expect((await refused(asOwner(db.admin, [unchanged.replace('$1', `'${lapsed.tenant}'`)], lapsed.tenant))).code).toBe('MS017');
  expect((await refused(plant(db.admin, unchanged, [lapsed.tenant]))).code).toBe('23514');

  await tx(jobs, {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  const revoked = await latestGrants(lapsed.tenant);
  expect(revoked.map(({ id, ...g }) => g)).toEqual([
    { channel: 'instagram', granted: false, max_test_recipients: 0, account_ref: null, change_id: null },
    { channel: 'whatsapp', granted: false, max_test_recipients: 0, account_ref: null, change_id: null },
  ]);
  const chained = await db.admin.query(
    `select action, entity, operator_id, change_id, payload from platform.audit_log where entity_id = any($1::uuid[]) order by seq`,
    [revoked.map((g) => g.id)],
  );
  expect(chained.rows).toEqual([
    { action: 'channel_grant.purge', entity: 'platform.channel_grant', operator_id: null, change_id: null, payload: {} },
    { action: 'channel_grant.purge', entity: 'platform.channel_grant', operator_id: null, change_id: null, payload: {} },
  ]);
  expect((await tx(platform, { operator_id: operator }, (c) => c.query('select platform.verify_chain() as broken'))).rows).toEqual([{ broken: null }]);
  // A second run revokes nothing more; the account is free for another shop.
  await tx(jobs, {}, (c) => c.query('select * from ops.purge_pending_signups()'));
  expect((await db.admin.query<{ n: number }>('select count(*)::int as n from platform.channel_grant where tenant_id = $1', [lapsed.tenant])).rows[0]?.n).toBe(4);
  await grantChannel(taker.tenant, { channel: 'instagram', granted: true, account: 'ig_purge3' });
  // A standing grant of a shop no longer listed still holds its account (planted: a purge before this one left it so).
  await plant(
    db.admin,
    `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id, effective_from) values ($1, 'instagram', true, 0, 'ig_ghost', $2, clock_timestamp())`,
    [lapsed.tenant, randomUUID()],
  );
  const ghost = await refused(grantChannel(taker.tenant, { channel: 'instagram', granted: true, account: 'ig_ghost' }));
  expect([ghost.code, ghost.message]).toEqual(['MS017', 'grant refused: this Instagram account is already granted to another shop']);
});


it('the purge takes the platform chain’s lock before any shop’s, as an approval does, so they never deadlock: an acceptance racing the purge of a lapsed sign-up that holds a grant is refused, and the purge commits', async () => {
  const r = await signUpReal('lock2-kirana');
  await legacyGrant(r.tenant, 'whatsapp', null); // so the purge writes a revocation, and its chain entry
  const change = await tx(platform, { operator_id: operator }, async (c) =>
    (await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ('tenant_accept', $1, '{}', $2, 0) returning id`, [r.tenant, operator])).rows[0]?.id as string,
  );
  await age(r, 15);
  const a = await platform.connect();
  let purged: Promise<string> = Promise.resolve('not started');
  try {
    await a.query('begin');
    await a.query(`select set_config('munshi.operator_id', $1, true), set_config('munshi.platform_change_id', $2, true), set_config('munshi.tenant_id', $3, true)`, [operator, change, r.tenant]);
    // The approval's entry takes the chain's lock (class 10); the acceptance then takes the shop's (class 1).
    await a.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
    purged = tx(db.as('munshi_jobs'), {}, (c) => c.query('select * from ops.purge_pending_signups()')).then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );
    await new Promise((done) => setTimeout(done, 500));
    const accepted = await refused(a.query('insert into platform.tenant_acceptance (tenant_id) values ($1)', [r.tenant]));
    await a.query('rollback');
    expect(accepted.code, 'the acceptance of a lapsed sign-up, not a deadlock').toBe('MS017');
    expect(await purged, 'the purge, not a deadlock').toBe('ok');
  } finally {
    await purged;
    a.release();
  }
  expect((await latestGrants(r.tenant)).map(({ channel, granted, change_id }) => ({ channel, granted, change_id }))).toEqual([
    { channel: 'whatsapp', granted: false, change_id: null },
  ]);
});

it('the owner’s acceptance (a seed) takes the platform chain’s lock before the shop’s, as the purge does: while the purge holds the chain and reaches the shop, neither deadlocks', async () => {
  const r = await signUpReal('lock3-kirana');
  // Its slug is old enough for the purge to visit it (and take its lock), its sign-up young enough to accept.
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - interval '15 days' where tenant_id = $1`, [r.tenant]);
  const p = await db.as('munshi_jobs').connect();
  const o = await db.admin.connect();
  let accepted: Promise<string> = Promise.resolve('not started');
  try {
    await p.query('begin');
    await p.query('select pg_advisory_xact_lock(10, 0)'); // the purge's first step, taken here so the seed starts inside it
    await o.query('begin');
    await o.query('set local role munshi_owner');
    await o.query(`select set_config('munshi.tenant_id', $1, true)`, [r.tenant]);
    accepted = o.query('insert into platform.tenant_acceptance (tenant_id) values ($1)', [r.tenant]).then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );
    await new Promise((done) => setTimeout(done, 300));
    const purged = await p.query('select * from ops.purge_pending_signups()').then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );
    await p.query(purged === 'ok' ? 'commit' : 'rollback');
    expect(purged, 'the purge, not a deadlock').toBe('ok');
    const seeded = await accepted;
    await o.query(seeded === 'ok' ? 'commit' : 'rollback');
    expect(seeded, 'the seed, not a deadlock').toBe('ok');
  } finally {
    await accepted;
    p.release();
    o.release();
  }
  expect((await db.admin.query('select count(*)::int as n from platform.tenant_acceptance where tenant_id = $1', [r.tenant])).rows).toEqual([{ n: 1 }]);
});
