// Sessions from a cookie's claim (BLUEPRINT §6.6, §6.7; MERCHANTS-DESIGN F1, F5–F7; AUTH1, AUTH2): resumeSession admits
// only a live row of this member and this via, an active member, the via rule against the tenant's class, and for a real session the live login and the identity's current epoch; the memberships lookup says id,
// name and role only; real sign-in is a real shop's, by its class, on any deployment (D-080); a sign-in that matches no membership writes
// nothing; and a session's via rides into the database. Red-proofs: test/v2/sabotage/core-auth.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { acceptInvite, createInvite, createSandbox, memberships, openDemoSession, openRealSession } from '../../../../../packages/core/src/logins.ts';
import { endSession, resumeSession, type Session, startSession, withTx } from '../../../../../packages/core/src/session.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp } from '../../gates/fixture.ts';
import { plant, refused } from '../../gates/lib.ts';
import { failure } from '../platform/fixture.ts';
import { ctx, emailFor, everyRow, join, liveDb, liveShop, member, PASSWORD, portOf } from './fixture.ts';

let live: TestDb;
let demo: TestDb;

beforeAll(async () => {
  live = await liveDb();
  demo = await openTestDb();
  await live.sabotage();
  await demo.sabotage();
});
afterAll(async () => {
  await live?.close();
  await demo?.close();
});

const claimOf = (s: Session) => ({ tenantId: s.tenantId, memberId: s.memberId, sessionId: s.sessionId as string, via: s.via as 'demo' | 'sandbox' | 'real' });
const subjectOf = async (db: TestDb, memberId: string) => (await db.admin.query('select subject from ops.login where member_id = $1', [memberId])).rows[0].subject as string;

it('F1 a demo-minted cookie for a live tenant gives no session: a demo or sandbox claim naming a real row is refused, and so is a demo row planted on a live tenant', async () => {
  const app = live.as('munshi_app');
  const t = await liveShop(live);
  const { session } = await join(live, portOf(live), t, t.staff, emailFor('f1'));
  expect(await resumeSession(app, claimOf(session))).toEqual(session);
  expect(await resumeSession(app, { ...claimOf(session), via: 'demo' })).toBeNull();
  expect(await resumeSession(app, { ...claimOf(session), via: 'sandbox' })).toBeNull();
  // The database refuses a demo row for a live tenant (session_via); one planted past it is still no session.
  expect((await refused(tx(app, { tenant_id: t.tenant, actor_id: t.manager }, (c) =>
    c.query(`insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, 'demo', now() + interval '1 hour')`, [t.tenant, t.manager]),
  ))).code).toBe('MS007');
  const planted = randomUUID();
  await plant(live.admin, `insert into ops.login_session (tenant_id, id, member_id, via, expires_at) values ($1, $2, $3, 'demo', now() + interval '1 hour')`, [t.tenant, planted, t.manager]);
  expect(await resumeSession(app, { tenantId: t.tenant, memberId: t.manager, sessionId: planted, via: 'demo' })).toBeNull();
});

it('F5 a revoked session, an expired one, another member’s, or a deactivated member’s has no session on the next request', async () => {
  const app = demo.as('munshi_app');
  const t = await signUp(demo, 'auth-f5');
  const opened = await openDemoSession(app, t.tenant, t.staff);
  if (!opened) throw new Error('no demo session');
  expect(opened.session.via).toBe('demo');
  expect(opened.expiresAt.getTime() - Date.now()).toBeGreaterThan(11.9 * 3600_000);
  expect(await resumeSession(app, claimOf(opened.session))).toEqual(opened.session);
  expect(await resumeSession(app, { ...claimOf(opened.session), memberId: t.manager })).toBeNull();
  await endSession(app, opened.session);
  expect(await resumeSession(app, claimOf(opened.session))).toBeNull();

  const expired = (await openDemoSession(app, t.tenant, t.staff))?.session as Session;
  await plant(demo.admin, `update ops.login_session set created_at = now() - interval '13 hours', expires_at = now() - interval '1 hour' where id = $1`, [expired.sessionId]);
  expect(await resumeSession(app, claimOf(expired))).toBeNull();

  const staff = (await openDemoSession(app, t.tenant, t.staff))?.session as Session;
  expect(await resumeSession(app, claimOf(staff))).not.toBeNull();
  await tx(app, { tenant_id: t.tenant, actor_id: t.owner }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [t.staff]));
  expect(await resumeSession(app, claimOf(staff))).toBeNull();
});

it('F6 the memberships lookup returns id, name and role only, and nothing for an unbound subject; a revoked login or an inactive member is left out', async () => {
  const app = live.as('munshi_app');
  const port = portOf(live);
  const [a, b] = [await liveShop(live), await liveShop(live)];
  const email = emailFor('f6');
  await join(live, port, a, a.manager, email);
  await join(live, port, b, b.staff, email);
  const subject = await subjectOf(live, a.manager);
  const found = await memberships(app, { provider: 'password', subject });
  expect(found).toEqual([
    { id: a.tenant, name: `Shop ${a.slug}`, role: 'manager' },
    { id: b.tenant, name: `Shop ${b.slug}`, role: 'staff' },
  ]);
  expect(found.every((m) => Object.keys(m).sort().join() === 'id,name,role')).toBe(true);
  expect(await memberships(app, { provider: 'password', subject: randomUUID() })).toEqual([]);
  await tx(app, { tenant_id: b.tenant, actor_id: b.owner }, (c) => c.query('update ops.login set revoked_at = now() where tenant_id = $1 and member_id = $2', [b.tenant, b.staff]));
  await tx(app, { tenant_id: a.tenant, actor_id: a.owner }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [a.manager]));
  expect(await memberships(app, { provider: 'password', subject })).toEqual([]);
});

it('AUTH1 real sign-in is refused for a sample shop on any deployment: no real session, no identity made from an invite, and the database refuses a real row; a real shop on the demo deployment signs in (D-080)', async () => {
  const app = demo.as('munshi_app');
  const port = portOf(demo);
  // One database for real and sample shops (D-080): a real shop's invite opens a real session on the demo deployment too.
  const real = await signUp(demo, 'auth-demo-realshop', { dataClass: 'live' });
  const joined = await join(demo, port, real, real.staff, emailFor('auth1-real'));
  expect(joined.session.via).toBe('real');
  const before = (await demo.admin.query('select count(*)::int as n from idp.identity')).rows[0].n as number;
  const t = await signUp(demo, 'auth-demo-real');
  const email = emailFor('auth1');
  const { token } = await createInvite(app, await member(demo, t.tenant, t.owner), t.staff, email);
  expect(await acceptInvite(app, port, { slug: t.slug, token, email, password: PASSWORD }, ctx())).toEqual({ kind: 'not_found' });
  expect((await demo.admin.query('select count(*)::int as n from idp.identity')).rows).toEqual([{ n: before }]);
  // An identity and a login planted on the demo database still open no real session.
  const subject = randomUUID();
  await plant(demo.admin, `insert into ops.login (provider, subject, tenant_id, member_id, first_owner, created_txid) values ('password', $1, $2, $3, true, 0)`, [subject, t.tenant, t.owner]);
  await plant(demo.admin, `insert into ops.subject_summary (provider, subject, memberships, highest_role) values ('password', $1, 1, 'owner')`, [subject]);
  expect(await openRealSession(app, { provider: 'password', subject }, t.tenant)).toBeNull();
  const direct = await failure(startSession(app, t.tenant, t.owner, 'real'));
  expect([direct.code, direct.sqlstate]).toEqual(['refused', 'MS007']);
});

it('AUTH2 a sign-in with no matching invite or membership writes nothing', async () => {
  const app = live.as('munshi_app');
  const port = portOf(live);
  const t = await liveShop(live);
  const email = emailFor('auth2');
  await join(live, port, t, t.staff, email);
  await tx(app, { tenant_id: t.tenant, actor_id: t.owner }, (c) => c.query('update ops.login set revoked_at = now() where tenant_id = $1 and member_id = $2', [t.tenant, t.staff]));
  const before = await everyRow(live.admin);
  // The identity is proved, but it has no live membership: nothing to open, and nothing written.
  const identity = await port.signIn({ email, password: PASSWORD }, ctx('192.0.2.77'));
  expect(identity).not.toBeNull();
  expect(await memberships(app, identity as { provider: 'password'; subject: string })).toEqual([]);
  expect(await openRealSession(app, identity as { provider: 'password'; subject: string }, t.tenant)).toBeNull();
  // An invite link that names nothing: 404, before the identity port runs.
  expect(await acceptInvite(app, port, { slug: t.slug, token: 'C'.repeat(43), email: emailFor('nobody'), password: PASSWORD }, ctx('192.0.2.77'))).toEqual({ kind: 'not_found' });
  const after = await everyRow(live.admin);
  const changed = [...after].filter(([rel, rows]) => JSON.stringify(rows) !== JSON.stringify(before.get(rel))).map(([rel]) => rel);
  expect(changed).toEqual([]);
  expect(after.size).toBeGreaterThan(40);
});

it('F7 a session’s via rides into its transactions as munshi.via, which the release and delivery rules read; openSession’s carries none', async () => {
  const app = demo.as('munshi_app');
  const t = await signUp(demo, 'auth-f7-via');
  const opened = await openDemoSession(app, t.tenant, t.owner);
  if (!opened) throw new Error('no demo session');
  const via = (s: Session) => withTx(app, { kind: 'member', session: s }, (c) => c.query<{ via: string }>(`select current_setting('munshi.via', true) as via`));
  expect((await via(opened.session)).rows).toEqual([{ via: 'demo' }]);
  expect((await via(await member(demo, t.tenant, t.owner))).rows).toEqual([{ via: '' }]);
  const sandbox = await createSandbox(app, { businessType: 'kirana', name: 'Via sample', slug: 'auth-f7-sandbox', ownerName: 'Judge' });
  expect((await via(sandbox.session)).rows).toEqual([{ via: 'sandbox' }]);
});
