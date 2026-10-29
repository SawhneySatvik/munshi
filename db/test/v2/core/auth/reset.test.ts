// Password resets (BLUEPRINT §6.2, review N1; RESET1): in the app only downward, in one shop, for an identity with one
// membership that is no owner and no operator; the link is used once on the public route, which raises the identity's
// epoch and so ends every session opened under the old one; the session it opens records the grant. An owner's, a
// two-shop or an operator's password is reset only by `pnpm identity:reset`, which ends every session of the identity,
// in each shop and the console. Red-proofs: test/v2/sabotage/core-auth.ts.
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { issueReset, openRealSession, resetIsOpen, redeemReset } from '../../../../../packages/core/src/logins.ts';
import { openOperatorSession } from '../../../../../packages/core/src/platform.ts';
import { resumeSession, type Session } from '../../../../../packages/core/src/session.ts';
import { main } from '../../../../src/identity-reset.ts';
import type { TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { failure, firstOperator, signIn } from '../platform/fixture.ts';
import { ctx, emailFor, IDENTITY_SECRET, join, liveDb, liveShop, member, PASSWORD, portOf } from './fixture.ts';

let db: TestDb;

beforeAll(async () => {
  db = await liveDb();
  await db.sabotage();
});
afterAll(() => db?.close());

const app = () => db.as('munshi_app');
const pub = () => db.as('munshi_public');
const claimOf = (s: Session) => ({ tenantId: s.tenantId, memberId: s.memberId, sessionId: s.sessionId as string, via: 'real' as const });
const subjectOf = async (memberId: string) => (await db.admin.query('select subject from ops.login where member_id = $1', [memberId])).rows[0].subject as string;

it('RESET1 an in-app reset is refused for an owner, for a peer or higher role, for an identity with a second membership, for an operator, and across shops', async () => {
  const port = portOf(db);
  const t = await liveShop(db);
  const elsewhere = await liveShop(db);
  await join(db, port, t, t.owner, emailFor('owner'));
  await join(db, port, t, t.manager, emailFor('manager'));
  const staffEmail = emailFor('staff');
  await join(db, port, t, t.staff, staffEmail);
  await join(db, port, elsewhere, elsewhere.staff, emailFor('elsewhere'));
  const as = async (by: string, target: string, shop = t) => failure(issueReset(app(), await member(db, shop.tenant, by), target));
  const refusals = [
    await as(t.manager, t.owner), // an owner, by a manager
    await as(t.owner, t.owner), // an owner, by an owner
    await as(t.manager, t.manager), // a peer
    await as(t.staff, t.staff), // staff reset no one
    await as(t.owner, elsewhere.staff), // another shop's member
  ];
  expect(refusals.map((e) => e.code)).toEqual(['refused', 'refused', 'refused', 'refused', 'not_found']);
  // Allowed until the staff identity has a second membership, or is marked an operator.
  const { grantId } = await issueReset(app(), await member(db, t.tenant, t.owner), t.staff);
  expect(grantId).toMatch(/^[0-9a-f-]{36}$/);
  const second = await liveShop(db);
  await join(db, port, second, second.staff, staffEmail);
  expect((await as(t.owner, t.staff)).code).toBe('refused');
  const third = await liveShop(db);
  const onlyOne = emailFor('operator');
  await join(db, port, third, third.manager, onlyOne);
  await plant(db.admin, `update ops.subject_summary set is_operator = true where subject = $1`, [await subjectOf(third.manager)]);
  expect((await failure(issueReset(app(), await member(db, third.tenant, third.owner), third.manager))).code).toBe('refused');
});

it('RESET1 a used reset ends every session opened under the older epoch and opens one that records its grant; the link is single-use and expires', async () => {
  const port = portOf(db);
  const t = await liveShop(db);
  const email = emailFor('staff');
  const phone = await join(db, port, t, t.staff, email);
  const subject = await subjectOf(t.staff);
  const laptop = await openRealSession(app(), { provider: 'password', subject }, t.tenant);
  expect(await resumeSession(app(), claimOf(phone.session))).not.toBeNull();
  expect(await resumeSession(app(), claimOf(laptop?.session as Session))).not.toBeNull();

  const { grantId, token } = await issueReset(app(), await member(db, t.tenant, t.owner), t.staff);
  expect(await resetIsOpen(app(), pub(), t.slug, token)).toBe(true);
  expect(await resetIsOpen(app(), pub(), t.slug, 'D'.repeat(43))).toBe(false);
  // A password the rules refuse spends nothing: the link still opens and no session has ended.
  expect(await redeemReset(app(), pub(), port, { slug: t.slug, token, password: 'short' })).toEqual({ kind: 'failed' });
  expect(await resumeSession(app(), claimOf(phone.session))).not.toBeNull();
  const used = await redeemReset(app(), pub(), port, { slug: t.slug, token, password: 'a brand new password' });
  if (used.kind !== 'opened') throw new Error(`the reset was not used (${used.kind})`);
  expect(await resumeSession(app(), claimOf(phone.session))).toBeNull();
  expect(await resumeSession(app(), claimOf(laptop?.session as Session))).toBeNull();
  expect(await resumeSession(app(), claimOf(used.opened.session))).toEqual(used.opened.session);
  const row = await db.admin.query('select reset_grant_id from ops.login_session where id = $1', [used.opened.session.sessionId]);
  expect(row.rows).toEqual([{ reset_grant_id: grantId }]);
  expect(await port.signIn({ email, password: PASSWORD }, ctx())).toBeNull();
  expect(await port.signIn({ email, password: 'a brand new password' }, ctx())).toEqual({ provider: 'password', subject });
  // Once; and a link past its 24 hours does not open.
  expect(await redeemReset(app(), pub(), port, { slug: t.slug, token, password: 'and once more again' })).toEqual({ kind: 'not_found' });
  expect(await resetIsOpen(app(), pub(), t.slug, token)).toBe(false);
  const late = await issueReset(app(), await member(db, t.tenant, t.owner), t.staff);
  await plant(db.admin, `update ops.reset_grant set issued_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where id = $1`, [late.grantId]);
  expect(await redeemReset(app(), pub(), port, { slug: t.slug, token: late.token, password: 'too late for this' })).toEqual({ kind: 'not_found' });
});

it('RESET1 pnpm identity:reset sets the password of an owner of two shops, and of an operator, and ends every session of each identity, in each shop and in the console', async () => {
  const port = portOf(db);
  const [a, b] = [await liveShop(db), await liveShop(db)];
  const email = emailFor('owner');
  const inA = await join(db, port, a, a.owner, email);
  const inB = await join(db, port, b, b.owner, email);
  // An operator's identity is never a member, so the console half is a second identity: the seeded operator's.
  const op = await firstOperator(db, 'Asha');
  const consoleSession = await signIn(db, op);
  expect(await openOperatorSession(db.as('munshi_platform'), consoleSession.sessionId)).not.toBeNull();
  const said: string[] = [];
  const answers = (lines: string[]) => async () => lines.shift() ?? null;
  const env = { MIGRATOR_DATABASE_URL: `postgres://munshi_migrator:munshi_migrator@127.0.0.1:${inject('pg17Port')}/${db.name}`, MUNSHI_IDENTITY_SECRET: IDENTITY_SECRET };
  const run = (lines: string[]) => main([], env, { out: (l) => said.push(l), ask: answers(lines) });
  expect(await run([email, 'the operator set this', 'not the same'])).toBe(1);
  expect(await run(['nobody@example.invalid', 'the operator set this', 'the operator set this'])).toBe(1);
  expect(await resumeSession(app(), claimOf(inA.session))).not.toBeNull();
  expect(await run([email.toUpperCase(), 'the operator set this', 'the operator set this'])).toBe(0);
  expect(said.at(-1)).toMatch(/^reset identity [0-9a-f-]{36}; 2 sessions ended$/);
  expect(await resumeSession(app(), claimOf(inA.session))).toBeNull();
  expect(await resumeSession(app(), claimOf(inB.session))).toBeNull();
  expect(await port.signIn({ email, password: 'the operator set this' }, ctx())).not.toBeNull();
  expect(said.join('\n')).not.toContain('the operator set this');
  // The operator's own identity, reset the same way: the console session ends.
  expect(await run(['asha@example.invalid', 'a new operator password', 'a new operator password'])).toBe(0);
  expect(said.at(-1)).toMatch(/; 1 sessions ended$/);
  expect(await openOperatorSession(db.as('munshi_platform'), consoleSession.sessionId)).toBeNull();
  expect(await port.signIn({ email: 'asha@example.invalid', password: 'a new operator password' }, ctx())).not.toBeNull();
});
