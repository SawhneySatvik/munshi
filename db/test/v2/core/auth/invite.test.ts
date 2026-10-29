// Invites through core and the password identity (BLUEPRINT §6.2, §6.3; MERCHANTS-DESIGN §6.2, F4, F7; AUTH3; IDP1's
// "an identity not verified by its invite link cannot sign in"): the link is verified, and the email typed matched to the
// invite's, before any identity exists; an invite binds once, before it expires, and keeps no email after; the invite
// page's one form gives the same answers whether or not the email already has an account. Red-proofs:
// test/v2/sabotage/core-auth.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { emailHmac, passwordIdentity, SCRYPT } from '../../../../../packages/adapters/identity/index.ts';
import { acceptInvite, createInvite, inviteIsOpen } from '../../../../../packages/core/src/logins.ts';
import type { TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { band, ctx, emailFor, IDENTITY_SECRET, join, liveDb, liveShop, member, oneScrypt, PASSWORD, portOf, type Tenant, timed } from './fixture.ts';

let db: TestDb;
let t: Tenant;
let other: Tenant;

beforeAll(async () => {
  db = await liveDb();
  t = await liveShop(db, 'auth-invite');
  other = await liveShop(db, 'auth-invite-other');
  await db.sabotage();
});
afterAll(() => db?.close());

const app = () => db.as('munshi_app');
const identities = async (email: string) =>
  (await db.admin.query('select count(*)::int as n from idp.identity where email_hmac = $1', [emailHmac(email, IDENTITY_SECRET)])).rows[0].n as number;
const inviteFor = async (memberId: string, email: string, tenant = t) => createInvite(app(), await member(db, tenant.tenant, tenant.owner), memberId, email);

it('F4 an invite binds a login only through its own link, once, before it expires; a mismatched email, a used, an expired or another shop’s link is 404 and makes no identity', async () => {
  const port = portOf(db);
  const email = emailFor('staff');
  const { token } = await inviteFor(t.staff, email);
  const accept = (input: Partial<{ slug: string; token: string; email: string; password: string }>) =>
    acceptInvite(app(), port, { slug: t.slug, token, email, password: PASSWORD, ...input }, ctx());
  expect(await inviteIsOpen(app(), t.slug, token)).toBe(true);
  expect(await inviteIsOpen(app(), other.slug, token)).toBe(false);
  expect(await accept({ email: emailFor('someone-else') })).toEqual({ kind: 'not_found' });
  expect(await accept({ slug: other.slug })).toEqual({ kind: 'not_found' });
  expect(await accept({ token: 'A'.repeat(43) })).toEqual({ kind: 'not_found' });
  expect(await accept({ token: `${token}x` })).toEqual({ kind: 'not_found' });
  expect(await identities(email)).toBe(0);
  // The email folds: the person may type it in another case.
  const first = await accept({ email: email.toUpperCase() });
  expect(first.kind).toBe('opened');
  expect(await identities(email)).toBe(1);
  expect(await accept({})).toEqual({ kind: 'not_found' }); // once
  expect(await inviteIsOpen(app(), t.slug, token)).toBe(false);
  const logins = await db.admin.query('select member_id, first_owner, invite_id is not null as invited from ops.login where tenant_id = $1', [t.tenant]);
  expect(logins.rows).toEqual([{ member_id: t.staff, first_owner: false, invited: true }]);

  const lateEmail = emailFor('manager');
  const late = await inviteFor(t.manager, lateEmail);
  await plant(db.admin, `update ops.member_invite set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where tenant_id = $1 and token_sha256 = sha256($2::bytea)`, [
    t.tenant,
    Buffer.from(late.token),
  ]);
  expect(await inviteIsOpen(app(), t.slug, late.token)).toBe(false);
  expect(await acceptInvite(app(), port, { slug: t.slug, token: late.token, email: lateEmail, password: PASSWORD }, ctx())).toEqual({ kind: 'not_found' });
  expect(await identities(lateEmail)).toBe(0);
});

it('F7 no email survives a used invite, and the identity keeps only the email’s HMAC', async () => {
  const email = emailFor('manager');
  await join(db, portOf(db), t, t.manager, email);
  // The manager's earlier invite expired unused; it keeps its email until the jobs purge (F4's other half).
  const invites = await db.admin.query(
    'select email, erased_at is not null as erased from ops.member_invite where tenant_id = $1 and member_id = $2 and used_at is not null',
    [t.tenant, t.manager],
  );
  expect(invites.rows).toEqual([{ email: null, erased: true }]);
  const rows = await db.admin.query(`select count(*)::int as n from idp.identity i where i::text ilike '%' || $1 || '%'`, [email.split('@')[0]]);
  expect(rows.rows).toEqual([{ n: 0 }]);
});

it('IDP1 an identity is made only from an invite whose link and email were verified, stamped verified, and only that identity signs in', async () => {
  const port = portOf(db);
  const email = emailFor('verified');
  const { token } = await inviteFor(other.staff, email, other);
  // Not verified by its link: a wrong email at the right link, and the right email at a wrong one, make no identity at all.
  const all = async () => (await db.admin.query('select count(*)::int as n from idp.identity')).rows[0].n as number;
  const before = await all();
  const impostor = emailFor('impostor');
  await acceptInvite(app(), port, { slug: other.slug, token, email: impostor, password: PASSWORD }, ctx());
  await acceptInvite(app(), port, { slug: other.slug, token: 'B'.repeat(43), email, password: PASSWORD }, ctx());
  expect(await all()).toBe(before);
  expect(await port.signIn({ email: impostor, password: PASSWORD }, ctx())).toBeNull();
  expect(await port.signIn({ email, password: PASSWORD }, ctx())).toBeNull();
  const opened = await acceptInvite(app(), port, { slug: other.slug, token, email, password: PASSWORD }, ctx());
  expect(opened.kind).toBe('opened');
  const row = await db.admin.query('select verified_at = created_at as stamped from idp.identity where email_hmac = $1', [emailHmac(email, IDENTITY_SECRET)]);
  expect(row.rows).toEqual([{ stamped: true }]);
  expect(await port.signIn({ email, password: PASSWORD }, ctx())).not.toBeNull();
});

it('AUTH3 an invite for an email that already has an account and one for a new email take the same work and give the same answers: a right password opens a session, every failure the same answer', async () => {
  // The production cost, so the timing bands mean something.
  const port = passwordIdentity({ pool: db.as('munshi_idp'), identitySecret: IDENTITY_SECRET, params: SCRYPT });
  const known = emailFor('known');
  await join(db, port, t, t.owner, known); // the owner joins this shop first: the email now has an account
  const shop = await liveShop(db, 'auth-invite-third');
  const fresh = emailFor('fresh');
  const existing = await inviteFor(shop.manager, known, shop);
  const newcomer = await inviteFor(shop.staff, fresh, shop);
  const answer = (token: string, email: string, password: string) =>
    timed(() => acceptInvite(app(), port, { slug: shop.slug, token, email, password }, ctx('198.51.100.20')));
  // Every failure: a wrong password for the account, a password the rules refuse for either. One answer, one band.
  const account = [await answer(existing.token, known, 'not the right password'), await answer(existing.token, known, 'short')];
  const newcomers = [await answer(newcomer.token, fresh, 'short'), await answer(newcomer.token, fresh, fresh)];
  expect([...account, ...newcomers].map((f) => f.r)).toEqual(Array(4).fill({ kind: 'failed' }));
  expect(await identities(fresh)).toBe(0);
  account.push(await answer(existing.token, known, PASSWORD));
  newcomers.push(await answer(newcomer.token, fresh, 'a new password for this shop'));
  expect([account[2]?.r.kind, newcomers[2]?.r.kind]).toEqual(['opened', 'opened']);
  // One band: every answer ran one scrypt, and the account's answers and the newcomer's took alike.
  const verdict = band(await oneScrypt(), { account: account.map((x) => x.ms), newcomer: newcomers.map((x) => x.ms) });
  expect(verdict).toMatch(/^ok: /);
  console.info(`AUTH3 timing ${verdict}`);
});
