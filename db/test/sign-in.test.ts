// MS-19a, 0013: the database's part of real sign-in (§6.6). A Google login is bound only through an invite used in the
// same transaction (F4); a session is signed out once and a member deactivated once, never the last active owner (F5);
// no demo session on a live tenant, no email after an invite is used, and no race between two owners (F7); a login's
// subject and a member's name and phone are erased whole and never refilled (OE1); and a live staff member leaves no
// name, phone or email in the audit chain or a global table (PII3).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MANIFEST, openTestDb, refused, setCtx, type TestDb, tx } from './db.ts';

type Shop = { tenant: string; owner: string; manager: string; staff: string };
let demo: TestDb; // no deployment row: demo
let live: TestDb; // ops.deployment = live
let s: Shop; // synthetic, in demo
let l: Shop; // live, in live

const tenantOf = async (db: TestDb, dataClass: string): Promise<Shop> => {
  const t = { tenant: randomUUID(), owner: randomUUID(), manager: randomUUID(), staff: randomUUID() };
  await tx(db.app, { tenant: t.tenant, actor: t.owner }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name, data_class) values ($1, $2, $3)', [t.tenant, `A ${dataClass} shop`, dataClass]);
    for (const [id, role] of [
      [t.owner, 'owner'],
      [t.manager, 'manager'],
      [t.staff, 'staff'],
    ]) {
      await c.query('insert into ops.member (tenant_id, id, name, role) values ($1, $2, $3, $4)', [t.tenant, id, `${role} (synthetic)`, role]);
    }
  });
  return t;
};

beforeAll(async () => {
  [demo, live] = await Promise.all([openTestDb(), openTestDb()]);
  await live.admin.query("begin; set local role munshi_owner; insert into ops.deployment (kind) values ('live'); commit;");
  s = await tenantOf(demo, 'synthetic');
  l = await tenantOf(live, 'live');
  for (const db of [demo, live]) await db.sabotage();
});
afterAll(() => Promise.all([demo.close(), live.close()]));

// One transaction as `actor` (none: a system scope) in the shop's tenant; `;` separates statements sharing the params.
const as = (db: TestDb, t: Shop, actor: string | undefined, sql: string, params: unknown[] = []) =>
  tx(db.app, actor ? { tenant: t.tenant, actor } : { tenant: t.tenant }, async (c) => {
    let last = await c.query('select 1');
    for (const statement of sql.split(';').filter((x) => x.trim())) last = await c.query(statement, params);
    return last;
  });
const addMember = async (db: TestDb, t: Shop, role: string, name = `${role} (synthetic)`, phone: string | null = null) => {
  const id = randomUUID();
  await as(db, t, t.owner, 'insert into ops.member (tenant_id, id, name, phone, role) values ($1, $2, $3, $4, $5)', [t.tenant, id, name, phone, role]);
  return id;
};
const INVITE = 'insert into ops.member_invite (tenant_id, member_id, email, token_sha256) values ($1, $2, $3, $4) returning id';
const invite = async (db: TestDb, t: Shop, member: string, email = 'new.member@example.com', by = t.owner) =>
  (await as(db, t, by, INVITE, [t.tenant, member, email, randomBytes(32)])).rows[0].id as string;
const USE = 'update ops.member_invite set used_at = now(), email = null, erased_at = now() where id = $1';
const LOGIN = "insert into ops.member_login (provider, subject, tenant_id, member_id, invite_id) values ('google', $1, $2, $3, $4) returning id";
// The bind transaction, as the invited member: use the invite, then bind the login.
const bind = (db: TestDb, t: Shop, member: string, inviteId: string, subject: string) =>
  tx(db.app, { tenant: t.tenant, actor: member }, async (c) => {
    await c.query(USE, [inviteId]);
    return (await c.query(LOGIN, [subject, t.tenant, member, inviteId])).rows[0].id as string;
  });
const OFF = 'update ops.member set active = false where id = $1';
const ERASE = 'update ops.member set name = null, phone = null, erased_at = now() where id = $1';
const OPEN = "insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, $3, now() + $4::interval) returning id";
const FROZEN = (table: string) => ({ code: 'MS011', message: `erase refused: the ${table} row is erased, and an erased row never changes` });

it('F4 a login is bound only by the member, in the transaction that used the invite it names, and an invite binds once', async () => {
  const m = await addMember(demo, s, 'staff');
  const NO_INVITE = { code: 'MS007', message: 'login refused: no invite for this member was used in this transaction' };
  expect(await refused(as(demo, s, m, LOGIN, ['sub-f4', s.tenant, m, randomUUID()]))).toEqual(NO_INVITE);
  const earlier = await invite(demo, s, m);
  await as(demo, s, m, USE, [earlier]);
  expect(await refused(as(demo, s, m, LOGIN, ['sub-f4', s.tenant, m, earlier]))).toEqual(NO_INVITE);
  // Another invite used in this transaction does not stand in for the one the binding names.
  const used = await invite(demo, s, m);
  const standIn = tx(demo.app, { tenant: s.tenant, actor: m }, async (c) => {
    await c.query(USE, [used]);
    await c.query(LOGIN, ['sub-f4', s.tenant, m, earlier]);
  });
  expect(await refused(standIn)).toEqual(NO_INVITE);
  // Someone else binding it, inside the invite's own transaction; a binding into another tenant (no RLS on this table).
  const i2 = await invite(demo, s, m);
  const forged = tx(demo.app, { tenant: s.tenant, actor: m }, async (c) => {
    await c.query(USE, [i2]);
    await setCtx(c, { actor: s.owner });
    await c.query(LOGIN, ['sub-f4', s.tenant, m, i2]);
  });
  expect(await refused(forged)).toEqual({ code: 'MS007', message: 'login refused: a member binds their own login' });
  const other = await tenantOf(demo, 'synthetic');
  expect(await refused(as(demo, s, m, LOGIN, ['sub-f4', other.tenant, other.owner, randomUUID()]))).toEqual({
    code: 'MS007',
    message: 'login refused: the binding is not for the current tenant',
  });
  // A caller-supplied used_txid is replaced by the transaction's own, and the binding is audited by ids alone.
  const i3 = await invite(demo, s, m);
  const stamped = await tx(demo.app, { tenant: s.tenant, actor: m }, async (c) => {
    await c.query('update ops.member_invite set used_at = now(), used_txid = 1, email = null, erased_at = now() where id = $1', [i3]);
    const login = (await c.query(LOGIN, ['sub-f4', s.tenant, m, i3])).rows[0].id as string;
    const r = await c.query('select txid_current()::text as txid, (select used_txid::text from ops.member_invite where id = $1) as used', [i3]);
    return { login, ...r.rows[0] };
  });
  expect(stamped.used).toBe(stamped.txid);
  const { rows } = await demo.admin.query("select actor_id, action, payload from audit.audit_log where entity = 'ops.member_login' and entity_id = $1", [stamped.login]);
  expect(rows).toEqual([{ actor_id: m, action: 'member.login_bound', payload: { member_id: m, provider: 'google' } }]);
  // One live binding per member, and one live member per Google subject in a tenant.
  expect(await refused(bind(demo, s, m, await invite(demo, s, m), 'sub-f4-second'))).toMatchObject({ code: '23505', message: expect.stringContaining('member_login_member') });
  const n = await addMember(demo, s, 'staff');
  expect(await refused(bind(demo, s, n, await invite(demo, s, n), 'sub-f4'))).toMatchObject({ code: '23505', message: expect.stringContaining('member_login_subject') });
  // An invite binds once: bind, sign the binding out and bind again with the same invite, all in one transaction.
  const once = await invite(demo, s, n);
  const rebind = tx(demo.app, { tenant: s.tenant, actor: n }, async (c) => {
    await c.query(USE, [once]);
    const first = (await c.query(LOGIN, ['sub-f4-n', s.tenant, n, once])).rows[0].id as string;
    await c.query('update ops.member_login set revoked_at = now() where id = $1', [first]);
    await c.query(LOGIN, ['sub-f4-other', s.tenant, n, once]);
  });
  expect(await refused(rebind)).toMatchObject({ code: '23505', message: expect.stringContaining('member_login_invite') });
  // A signed-out binding frees its subject; binding it again still takes a new invite (above).
  await as(demo, s, m, 'update ops.member_login set revoked_at = now() where id = $1', [stamped.login]);
  expect((await bind(demo, s, n, await invite(demo, s, n), 'sub-f4')).length).toBe(36);
});

it('F4 an invite is made by an active owner (or a manager, for staff), used once by the invited member before it expires; the purge erases only an expired one', async () => {
  const m = await addMember(demo, s, 'staff');
  const WHO = { code: 'MS007', message: 'invite refused: an active owner invites, or an active manager invites staff' };
  expect(await refused(invite(demo, s, s.manager, 'x@example.com', s.manager))).toEqual(WHO); // a manager, a manager
  expect(await refused(invite(demo, s, m, 'x@example.com', s.staff))).toEqual(WHO);
  expect(await invite(demo, s, m, 'by.manager@example.com', s.manager)).toMatch(/^[0-9a-f-]{36}$/);
  const i = await invite(demo, s, m, 'once@example.com');
  const stamped = await demo.admin.query('select extract(epoch from expires_at - created_at)::int as seconds, created_by from ops.member_invite where id = $1', [i]);
  expect(stamped.rows).toEqual([{ seconds: 24 * 3600, created_by: s.owner }]);
  expect(await refused(as(demo, s, s.owner, USE, [i]))).toEqual({ code: 'MS007', message: 'invite refused: only the invited member uses an invite' });
  await as(demo, s, m, USE, [i]);
  expect(await refused(as(demo, s, m, USE, [i]))).toEqual(FROZEN('ops.member_invite'));
  // Expired: backdated with the triggers off (only a superuser can), as if made a day ago.
  const late = await invite(demo, s, m, 'late@example.com');
  await demo.admin.query(
    `begin; set local session_replication_role = replica;
     update ops.member_invite set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where id = '${late}'; commit;`,
  );
  expect(await refused(as(demo, s, m, USE, [late]))).toEqual({ code: 'MS007', message: 'invite refused: the invite has expired' });
  const PURGE = 'update ops.member_invite set email = null, erased_at = now() where id = $1';
  const early = await invite(demo, s, m, 'early@example.com');
  expect(await refused(as(demo, s, undefined, PURGE, [early]))).toEqual({ code: 'MS007', message: 'invite refused: an unused invite is erased once it has expired' });
  await as(demo, s, undefined, PURGE, [late]);
  const { rows } = await demo.admin.query('select email, used_at is not null as used, erased_at is not null as erased from ops.member_invite where id = any($1::uuid[]) order by created_at', [
    [i, late, early],
  ]);
  expect(rows).toEqual([
    { email: null, used: false, erased: true }, // late (backdated, so first)
    { email: null, used: true, erased: true },
    { email: 'early@example.com', used: false, erased: false },
  ]);
});

it('F7 no email survives a used invite: using one without erasing its email is refused', async () => {
  const m = await addMember(demo, s, 'staff');
  const i = await invite(demo, s, m, 'kept.email@example.com');
  expect(await refused(as(demo, s, m, 'update ops.member_invite set used_at = now() where id = $1', [i]))).toEqual({
    code: 'MS007',
    message: 'invite refused: using an invite erases its email',
  });
  await bind(demo, s, m, i, 'sub-f7-email');
  const found = await demo.admin.query(
    `select (select count(*) from ops.member_invite t where to_jsonb(t)::text like '%kept.email%')::int as invites,
            (select count(*) from ops.member_login t where to_jsonb(t)::text like '%kept.email%')::int as logins,
            (select count(*) from audit.audit_log t where t.payload::text like '%kept.email%')::int as audit,
            (select count(*) from ops.member_invite t where t.member_id = $1 and t.used_at is not null)::int as used`,
    [m],
  );
  expect(found.rows).toEqual([{ invites: 0, logins: 0, audit: 0, used: 1 }]);
});

it('F5 a session is opened by its own member, signed out once by that member or an active owner, and never signed back in', async () => {
  const m = await addMember(demo, s, 'staff');
  expect(await refused(as(demo, s, s.owner, OPEN, [s.tenant, m, 'demo', '12 hours']))).toEqual({
    code: 'MS007',
    message: 'session refused: a member opens their own session',
  });
  expect((await refused(as(demo, s, m, OPEN, [s.tenant, m, 'demo', '13 hours']))).code).toBe('23514'); // a demo session lasts 12 hours
  const session = (await as(demo, s, m, OPEN, [s.tenant, m, 'demo', '12 hours'])).rows[0].id as string;
  const REVOKE = 'update ops.login_session set revoked_at = now() where id = $1';
  const ONCE = { code: 'MS007', message: 'session refused: the member or an active owner signs a session out, once' };
  expect(await refused(as(demo, s, s.staff, REVOKE, [session]))).toEqual(ONCE); // another staff member
  await as(demo, s, m, REVOKE, [session]);
  expect(await refused(as(demo, s, m, REVOKE, [session]))).toEqual(ONCE); // signed out again, later
  expect(await refused(as(demo, s, s.owner, 'update ops.login_session set revoked_at = null where id = $1', [session]))).toEqual(ONCE);
  const second = (await as(demo, s, m, OPEN, [s.tenant, m, 'demo', '12 hours'])).rows[0].id as string;
  await as(demo, s, s.owner, REVOKE, [second]); // the owner signs out another member's session
  const { rows } = await demo.admin.query('select count(*)::int as n from ops.login_session where member_id = $1 and revoked_at is not null', [m]);
  expect(rows[0].n).toBe(2);
});

it('F5 a member is deactivated once, by an active owner, never the last active owner, and never re-activated', async () => {
  const t = await tenantOf(demo, 'synthetic');
  const ONE_WAY = { code: 'MS007', message: 'member refused: an active owner deactivates a member, and a member is never re-activated' };
  const LAST = { code: 'MS007', message: 'member refused: the last active owner cannot be deactivated' };
  expect(await refused(as(demo, t, t.manager, OFF, [t.staff]))).toEqual(ONE_WAY);
  await as(demo, t, t.owner, OFF, [t.staff]);
  expect(await refused(as(demo, t, t.owner, 'update ops.member set active = true where id = $1', [t.staff]))).toEqual(ONE_WAY);
  expect(await refused(as(demo, t, t.owner, OFF, [t.owner]))).toEqual(LAST);
  const second = await addMember(demo, t, 'owner');
  await as(demo, t, second, OFF, [t.owner]); // an owner deactivates another owner
  expect(await refused(as(demo, t, second, OFF, [second]))).toEqual(LAST);
  const { rows } = await demo.admin.query(
    "select entity_id, actor_id, payload from audit.audit_log where tenant_id = $1 and action = 'member.deactivate' order by seq",
    [t.tenant],
  );
  expect(rows).toEqual([
    { entity_id: t.staff, actor_id: t.owner, payload: { member_id: t.staff } },
    { entity_id: t.owner, actor_id: second, payload: { member_id: t.owner } },
  ]);
});

it('F7 a demo sign-in opens no session on a live tenant; a Google one needs the live deployment and a live binding', async () => {
  expect(await refused(as(live, l, l.owner, OPEN, [l.tenant, l.owner, 'demo', '12 hours']))).toEqual({
    code: 'MS007',
    message: 'session refused: a demo sign-in opens no session on a live tenant',
  });
  const GOOGLE = { code: 'MS007', message: 'session refused: a Google session needs the live deployment and a live binding' };
  expect(await refused(as(live, l, l.owner, OPEN, [l.tenant, l.owner, 'google', '14 days']))).toEqual(GOOGLE); // no binding yet
  await bind(live, l, l.owner, await invite(live, l, l.owner, 'owner@example.com'), 'sub-f7-owner');
  expect((await as(live, l, l.owner, OPEN, [l.tenant, l.owner, 'google', '14 days'])).rowCount).toBe(1);
  expect((await refused(as(live, l, l.owner, OPEN, [l.tenant, l.owner, 'google', '15 days']))).code).toBe('23514'); // 14 days, absolute
  // On the demo database a binding is not enough: every session there is a demo one, so munshi.via is always demo.
  const d = await addMember(demo, s, 'staff');
  await bind(demo, s, d, await invite(demo, s, d), 'sub-f7-demo');
  expect(await refused(as(demo, s, d, OPEN, [s.tenant, d, 'google', '14 days']))).toEqual(GOOGLE);
  const showcase = await tenantOf(demo, 'showcase');
  for (const t of [s, showcase]) expect((await as(demo, t, t.owner, OPEN, [t.tenant, t.owner, 'demo', '12 hours'])).rowCount).toBe(1);
  const { rows } = await live.admin.query("select via, count(*)::int as n from ops.login_session where tenant_id = $1 group by via", [l.tenant]);
  expect(rows).toEqual([{ via: 'google', n: 1 }]);
});

it('F7 two owners deactivating each other at once leave one active owner', async () => {
  const t = await tenantOf(demo, 'synthetic');
  const second = await addMember(demo, t, 'owner');
  const [c1, c2] = [await demo.app.connect(), await demo.app.connect()];
  try {
    await c1.query('begin');
    await setCtx(c1, { tenant: t.tenant, actor: t.owner });
    await c1.query(OFF, [second]);
    await c2.query('begin');
    await setCtx(c2, { tenant: t.tenant, actor: second });
    const pid = (await c2.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    let settled = false;
    const racing = c2.query(OFF, [t.owner]).then(
      () => null,
      (err: { code?: string; message: string }) => err,
    );
    void racing.then(() => (settled = true));
    // The second deactivation must be checked while the first is still open: wait until it blocks on the first's lock
    // (or finishes without waiting, which is the bug), then commit the first.
    let waited = false;
    for (let i = 0; i < 1500 && !settled && !waited; i++) {
      const { rows } = await demo.admin.query('select wait_event_type, wait_event from pg_stat_activity where pid = $1', [pid]);
      waited = rows[0]?.wait_event_type === 'Lock' && rows[0]?.wait_event === 'advisory';
      if (!waited) await new Promise((r) => setTimeout(r, 10));
    }
    await c1.query('commit');
    const err = await racing;
    await c2.query(err ? 'rollback' : 'commit');
    const { rows } = await demo.admin.query("select id from ops.member where tenant_id = $1 and role = 'owner' and active", [t.tenant]);
    expect(rows).toEqual([{ id: t.owner }]);
    expect(err).toMatchObject({ code: 'MS007' });
    expect(waited).toBe(true);
  } finally {
    c1.release();
    c2.release();
  }
});

it("OE1 a login's Google subject is never refilled: emptying it and filling another account is refused, and an erased binding stays erased", async () => {
  const m = await addMember(demo, s, 'staff');
  const login = await bind(demo, s, m, await invite(demo, s, m), 'sub-oe1-a');
  for (const sql of [
    'update ops.member_login set subject = null where id = $1',
    "update ops.member_login set subject = null where id = $1; update ops.member_login set subject = 'sub-oe1-b' where id = $1",
    "update ops.member_login set subject = 'sub-oe1-b' where id = $1",
  ]) {
    expect(await refused(as(demo, s, m, sql, [login])), sql).toEqual({
      code: 'MS011',
      message: 'erase refused: ops.member_login.subject changes only to NULL, in the UPDATE that sets erased_at',
    });
  }
  expect(await refused(as(demo, s, s.staff, 'update ops.member_login set revoked_at = now() where id = $1', [login]))).toEqual({
    code: 'MS007',
    message: 'login refused: the member or an active owner revokes or erases a binding',
  });
  // The table is global (no RLS): another tenant's owner cannot touch this tenant's binding.
  const other = await tenantOf(demo, 'synthetic');
  expect(await refused(as(demo, other, other.owner, 'update ops.member_login set revoked_at = now() where id = $1', [login]))).toEqual({
    code: 'MS007',
    message: 'login refused: the binding is not for the current tenant',
  });
  await as(demo, s, s.owner, 'update ops.member_login set subject = null, erased_at = now() where id = $1', [login]);
  for (const sql of ["update ops.member_login set subject = 'sub-oe1-b' where id = $1", 'update ops.member_login set revoked_at = now() where id = $1']) {
    expect(await refused(as(demo, s, s.owner, sql, [login])), sql).toEqual(FROZEN('ops.member_login'));
  }
  const { rows } = await demo.admin.query('select subject, erased_at is not null as erased from ops.member_login where id = $1', [login]);
  expect(rows).toEqual([{ subject: null, erased: true }]);
});

it('OE1 a member is erased whole: name and phone with erased_at, once deactivated, by an active owner, and the row then never changes', async () => {
  const m = await addMember(demo, s, 'staff', 'Sunil (synthetic)', '+919800000701');
  expect(await refused(as(demo, s, s.owner, ERASE, [m]))).toEqual({ code: 'MS007', message: 'member refused: a member is erased only once deactivated' });
  await as(demo, s, s.owner, OFF, [m]);
  for (const sql of [
    'update ops.member set name = null where id = $1',
    'update ops.member set phone = null where id = $1',
    'update ops.member set name = null, erased_at = now() where id = $1', // the phone kept
    "update ops.member set phone = '+919800000702' where id = $1",
    "update ops.member set name = 'Someone else' where id = $1",
  ]) {
    expect(await refused(as(demo, s, s.owner, sql, [m])), sql).toMatchObject({ code: 'MS011' });
  }
  expect(await refused(as(demo, s, s.manager, ERASE, [m]))).toEqual({ code: 'MS007', message: 'member refused: an active owner erases a member' });
  await as(demo, s, s.owner, ERASE, [m]);
  expect(await refused(as(demo, s, s.owner, "update ops.member set name = 'Sunil (synthetic)' where id = $1", [m]))).toEqual(FROZEN('ops.member'));
  const { rows } = await demo.admin.query(
    "select m.name, m.phone, a.actor_id, a.payload from ops.member m join audit.audit_log a on a.entity_id = m.id and a.action = 'member.erase' where m.id = $1",
    [m],
  );
  expect(rows).toEqual([{ name: null, phone: null, actor_id: s.owner, payload: { member_id: m } }]);
});

it('F5 the purge erases a member only a year after deactivation and with no live login, leaving no audit entry', async () => {
  const t = await tenantOf(demo, 'synthetic');
  const EARLY = { code: 'MS007', message: 'member refused: the purge erases a member only a year after deactivation, with no live login' };
  // A year on: the chain's entry backdated by a superuser (this tenant's chain no longer verifies; nothing else reads it).
  const aYearOn = (m: string) =>
    demo.admin.query(
      "update audit.audit_log set created_at = now() - interval '366 days' where tenant_id = $1 and entity_id = $2 and action = 'member.deactivate'",
      [t.tenant, m],
    );
  // The age alone: a member who never had a login.
  const young = await addMember(demo, t, 'staff', 'Left last week (synthetic)', '+919800000801');
  expect(await refused(as(demo, t, undefined, ERASE, [young]))).toEqual({ code: 'MS007', message: 'member refused: a member is erased only once deactivated' });
  await as(demo, t, t.owner, OFF, [young]);
  expect(await refused(as(demo, t, undefined, ERASE, [young]))).toEqual(EARLY); // deactivated today
  await aYearOn(young);
  await as(demo, t, undefined, ERASE, [young]);
  // The login alone: deactivated over a year ago, still bound to a Google account.
  const bound = await addMember(demo, t, 'staff', 'Left last year (synthetic)', '+919800000802');
  const login = await bind(demo, t, bound, await invite(demo, t, bound), 'sub-purge');
  await as(demo, t, t.owner, OFF, [bound]);
  await aYearOn(bound);
  expect(await refused(as(demo, t, undefined, ERASE, [bound]))).toEqual(EARLY);
  await as(demo, t, t.owner, 'update ops.member_login set revoked_at = now() where id = $1', [login]);
  await as(demo, t, undefined, ERASE, [bound]);
  const { rows } = await demo.admin.query(
    `select m.name, m.phone, (select count(*)::int from audit.audit_log a where a.entity_id = m.id and a.action = 'member.erase') as entries
       from ops.member m where m.id = any($1::uuid[]) order by m.created_at`,
    [[young, bound]],
  );
  expect(rows).toEqual([
    { name: null, phone: null, entries: 0 },
    { name: null, phone: null, entries: 0 },
  ]);
});

it('PII3 a live staff member added, invited, bound, deactivated and erased leaves no name, phone or email in the audit chain or a global table', async () => {
  const NAME = 'Kavya Planted-Q7';
  const PHONE = '+919811100777';
  const EMAIL = 'kavya.planted.q7@example.com';
  const m = await addMember(live, l, 'staff', NAME, PHONE);
  const contact = (await as(live, l, l.owner, 'insert into ops.contact (tenant_id, name, phone_e164) values ($1, $2, $3) returning id', [l.tenant, NAME, PHONE]))
    .rows[0].id as string;
  await tx(live.app, { tenant: l.tenant, actor: l.owner, command: 'staff.create' }, (c) =>
    c.query('insert into books.staff (tenant_id, contact_id, member_id) values ($1, $2, $3)', [l.tenant, contact, m]),
  );
  await bind(live, l, m, await invite(live, l, m, EMAIL), 'google-subject-q7');
  await as(live, l, m, OPEN, [l.tenant, m, 'google', '14 days']);
  await as(live, l, l.owner, OFF, [m]);
  await as(live, l, l.owner, ERASE, [m]);
  await as(
    live,
    l,
    l.owner,
    "update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1",
    [contact, l.owner],
  );
  const texts: string[] = (await live.admin.query<{ t: string }>('select payload::text as t from audit.audit_log')).rows.map((r) => r.t);
  const audited = texts.length;
  for (const rel of MANIFEST.globalTables) {
    texts.push(...(await live.admin.query<{ t: string }>(`select to_jsonb(g)::text as t from ${rel} g`)).rows.map((r) => r.t));
  }
  console.log(`PII3 scanned ${audited} audit payloads and ${texts.length - audited} global rows for a planted name, phone and email`);
  expect(texts.filter((t) => t.includes(m)).length).toBeGreaterThanOrEqual(5); // the positive control: add, contact's staff row, bound, deactivate, erase
  expect(texts.filter((t) => [NAME, PHONE, PHONE.slice(1), EMAIL].some((p) => t.includes(p)))).toEqual([]);
  const { rows } = await live.admin.query(
    `select (select row(name, phone)::text from ops.member where id = $1) as member,
            (select email from ops.member_invite where member_id = $1) as email,
            (select row(name, phone_e164)::text from ops.contact where id = $2) as contact`,
    [m, contact],
  );
  expect(rows).toEqual([{ member: '(,)', email: null, contact: '(,)' }]);
});
