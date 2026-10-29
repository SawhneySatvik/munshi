// The password identity end to end (BLUEPRINT §6.2, IDP1, LOCK1): scrypt with a per-identity salt and its parameters on
// the row, compatible with `pnpm platform:operator`'s seed; a wrong password, an unknown email and a locked pair take
// one path, one time band and one null; failures lock only the (identity, IP) pair, for 15 minutes doubling to a day;
// three failures from anywhere ask for the bot check; per-IP limits on the route; and no password or hash anywhere but
// idp.identity — not in a table, a log line or an error. Red-proofs: test/v2/sabotage/core-auth.ts.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { derive, emailHmac, passwordIdentity, SCRYPT } from '../../../../../packages/adapters/identity/index.ts';
import { allowAttempt, issueReset, memberships, openRealSession, redeemReset } from '../../../../../packages/core/src/logins.ts';
import { seedOperator } from '../../../../src/platform-operator.ts';
import type { TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { band, ctx, emailFor, everyRow, IDENTITY_SECRET, join, liveDb, liveShop, member, oneScrypt, PASSWORD, portOf, type Tenant, timed } from './fixture.ts';

let db: TestDb;
let t: Tenant;

beforeAll(async () => {
  db = await liveDb();
  t = await liveShop(db, 'auth-password');
  await db.sabotage();
});
afterAll(() => db?.close());

const production = () => passwordIdentity({ pool: db.as('munshi_idp'), identitySecret: IDENTITY_SECRET, params: SCRYPT });
const pair = async (email: string, ip: string) =>
  (
    await db.admin.query<{ failures: number; locked_for: number | null }>(
      `select failures, round(extract(epoch from locked_until - last_at) / 60)::int as locked_for from idp.attempt where email_hmac = $1 and ip_hash = $2`,
      [emailHmac(email, IDENTITY_SECRET), ctx(ip).ipHash],
    )
  ).rows[0];

it('IDP1 passwords are scrypt with a per-identity salt and their parameters on the row; a seeded operator’s identity signs in through the adapter', async () => {
  const port = production();
  const [a, b] = [emailFor('salt-a'), emailFor('salt-b')];
  await join(db, port, t, t.manager, a);
  await join(db, port, t, t.staff, b);
  const { rows } = await db.admin.query<{ password_hash: Buffer; salt: Buffer; params: unknown; verified: boolean }>(
    'select password_hash, salt, params, verified_at is not null as verified from idp.identity where email_hmac = any($1) order by created_at',
    [[emailHmac(a, IDENTITY_SECRET), emailHmac(b, IDENTITY_SECRET)]],
  );
  expect(rows.length).toBe(2);
  const [x, y] = rows as [(typeof rows)[0], (typeof rows)[0]];
  expect(x.salt.length).toBe(16);
  expect(x.salt.equals(y.salt)).toBe(false);
  expect(x.password_hash.equals(y.password_hash)).toBe(false); // the same password, two salts
  expect(x.params).toEqual({ N: 2 ** 17, r: 8, p: 1, keylen: 64 });
  expect((await derive(PASSWORD, x.salt, SCRYPT)).equals(x.password_hash)).toBe(true);
  expect([x.verified, y.verified]).toEqual([true, true]);

  const c = await db.migrator();
  const seeded = await seedOperator(c, { email: 'Operator@Example.invalid ', password: 'an operator password', displayName: 'Asha' }, {
    identitySecret: IDENTITY_SECRET,
    platformSecret: 'platform-secret-for-the-v2-tests-only-0001',
  }).finally(() => c.end());
  expect(await port.signIn({ email: 'operator@example.invalid', password: 'an operator password' }, ctx())).toEqual({ provider: 'password', subject: seeded.subject });
});

it('IDP1 a wrong password and an unknown email take the same path and time band, and return the same null', async () => {
  const port = production();
  const t = await liveShop(db);
  const known = emailFor('known');
  const opened = await join(db, port, t, t.owner, known);
  expect(opened.session.via).toBe('real');
  const unknown = emailFor('nobody');
  const wrong = [];
  const missing = [];
  for (let i = 0; i < 3; i++) {
    wrong.push(await timed(() => port.signIn({ email: known, password: 'a wrong password' }, ctx('192.0.2.10'))));
    missing.push(await timed(() => port.signIn({ email: unknown, password: 'a wrong password' }, ctx('192.0.2.10'))));
  }
  expect([...wrong, ...missing].map((x) => x.r)).toEqual(Array(6).fill(null));
  const verdict = band(await oneScrypt(), { wrong: wrong.map((x) => x.ms), unknown: missing.map((x) => x.ms) });
  expect(verdict).toMatch(/^ok: /);
  // The same path: each counted against its (email, IP) pair, whether or not the email has an account.
  expect(await pair(known, '192.0.2.10')).toEqual({ failures: 3, locked_for: null });
  expect(await pair(unknown, '192.0.2.10')).toEqual({ failures: 3, locked_for: null });
  console.info(`IDP1 timing ${verdict}`);
});

it('IDP1 five failures lock the pair for 15 minutes, doubling up to a day; the right password is refused while it is locked', async () => {
  const port = portOf(db);
  const t = await liveShop(db);
  const email = emailFor('lock');
  await join(db, port, t, t.owner, email);
  const ip = '192.0.2.20';
  const wrong = () => port.signIn({ email, password: 'a wrong password' }, ctx(ip));
  for (let i = 0; i < 5; i++) await wrong();
  expect(await pair(email, ip)).toEqual({ failures: 5, locked_for: 15 });
  expect(await port.signIn({ email, password: PASSWORD }, ctx(ip))).toBeNull();
  // The lock runs out; five more failures lock it for twice as long, and so on, never past a day.
  const unlock = () => plant(db.admin, `update idp.attempt set locked_until = now() - interval '1 second' where email_hmac = $1`, [emailHmac(email, IDENTITY_SECRET)]);
  await unlock();
  for (let i = 0; i < 4; i++) await wrong();
  expect(await pair(email, ip)).toEqual({ failures: 10, locked_for: 30 });
  await plant(db.admin, `update idp.attempt set failures = 49, locked_until = null where email_hmac = $1`, [emailHmac(email, IDENTITY_SECRET)]);
  await wrong();
  expect(await pair(email, ip)).toEqual({ failures: 50, locked_for: 24 * 60 });
  await unlock();
  expect(await port.signIn({ email, password: PASSWORD }, ctx(ip))).not.toBeNull();
  expect(await pair(email, ip)).toEqual({ failures: 0, locked_for: null }); // a success resets the pair
});

it('LOCK1 five failures from one IP lock only that (identity, IP) pair: the owner signs in from another IP at once; three failures across IPs require the bot check', async () => {
  const port = portOf(db);
  const t = await liveShop(db);
  const owner = emailFor('owner');
  await join(db, port, t, t.owner, owner);
  for (let i = 0; i < 5; i++) await port.signIn({ email: owner, password: 'an attacker guess' }, ctx('198.51.100.66'));
  expect(await port.signIn({ email: owner, password: PASSWORD }, ctx('198.51.100.66'))).toBeNull();
  expect(await port.signIn({ email: owner, password: PASSWORD }, ctx('203.0.113.99'))).not.toBeNull();
  // Three failures from two IPs within the hour: the next attempt from anywhere needs the bot check, then succeeds.
  const other = emailFor('bot');
  await join(db, port, t, t.manager, other);
  await port.signIn({ email: other, password: 'guess one' }, ctx('198.51.100.1'));
  await port.signIn({ email: other, password: 'guess two' }, ctx('198.51.100.2'));
  expect(await port.signIn({ email: other, password: PASSWORD }, ctx('198.51.100.3', false))).not.toBeNull(); // two: no check yet
  await port.signIn({ email: other, password: 'guess three' }, ctx('198.51.100.1'));
  await port.signIn({ email: other, password: 'guess four' }, ctx('198.51.100.2'));
  await port.signIn({ email: other, password: 'guess five' }, ctx('198.51.100.2'));
  expect(await port.signIn({ email: other, password: PASSWORD }, ctx('198.51.100.4', false))).toBeNull();
  expect(await port.signIn({ email: other, password: PASSWORD }, ctx('198.51.100.4', true))).not.toBeNull();
});

it('LOCK1 a locked or unknown email still runs scrypt (timing band asserted)', async () => {
  const port = production();
  const t = await liveShop(db);
  const email = emailFor('locked');
  await join(db, port, t, t.staff, email);
  const ip = '192.0.2.30';
  await plant(db.admin, `insert into idp.attempt (email_hmac, ip_hash, failures, locked_until, last_at) values ($1, $2, 5, now() + interval '15 minutes', now())`, [
    emailHmac(email, IDENTITY_SECRET),
    ctx(ip).ipHash,
  ]);
  const locked = await timed(() => port.signIn({ email, password: PASSWORD }, ctx(ip)));
  const unknown = await timed(() => port.signIn({ email: emailFor('unknown'), password: PASSWORD }, ctx(ip)));
  expect([locked.r, unknown.r]).toEqual([null, null]);
  const verdict = band(await oneScrypt(), { locked: [locked.ms], unknown: [unknown.ms] });
  expect(verdict).toMatch(/^ok: /);
  console.info(`LOCK1 timing ${verdict}`);
});

it('IDP1 per-IP limits: the eleventh sign-in attempt from one IP within 10 minutes is refused, another IP’s is not, and a sixth sample shop from one IP in a day', async () => {
  const pub = db.as('munshi_public');
  const ip = ctx('192.0.2.40').ipHash;
  const tries = [];
  for (let i = 0; i < 11; i++) tries.push(await allowAttempt(pub, 'sign-in', ip));
  expect(tries).toEqual([...Array(10).fill(true), false]);
  expect(await allowAttempt(pub, 'sign-in', ctx('192.0.2.41').ipHash)).toBe(true);
  const signUps = [];
  for (let i = 0; i < 6; i++) signUps.push(await allowAttempt(pub, 'sign-up', ip));
  expect(signUps).toEqual([...Array(5).fill(true), false]);
  // The buckets are keyed hashes: no IP is stored.
  const { rows } = await db.admin.query(`select count(*)::int as n from ops.rate_counter r where r::text like '%192.0.2.4%'`);
  expect(rows).toEqual([{ n: 0 }]);
});

it('IDP1 no password or hash in any log, error, trace or other table (a scan)', async () => {
  const secret = `Zq${randomBytes(9).toString('hex')}-scan`;
  const said: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...args: unknown[]) => void said.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))),
  );
  const errors: string[] = [];
  const keep = (e: unknown) => void errors.push(`${(e as Error).message} ${JSON.stringify(e)}`);
  try {
    const port = portOf(db);
    const shop = await liveShop(db);
    const email = emailFor('scan');
    const opened = await join(db, port, shop, shop.staff, email, secret);
    await port.signIn({ email, password: `${secret}-wrong` }, ctx()).catch(keep);
    await port.signIn({ email, password: secret }, ctx()).catch(keep);
    await port.signIn({ email, password: secret }, { ipHash: Buffer.alloc(3), botCheck: true }).catch(keep); // an error path
    const subject = (await db.admin.query('select subject from ops.login where member_id = $1', [shop.staff])).rows[0].subject as string;
    expect(await memberships(db.as('munshi_app'), { provider: 'password', subject })).toHaveLength(1);
    expect(await openRealSession(db.as('munshi_app'), { provider: 'password', subject }, shop.tenant)).not.toBeNull();
    const { token } = await issueReset(db.as('munshi_app'), await member(db, shop.tenant, shop.owner), shop.staff);
    await redeemReset(db.as('munshi_app'), db.as('munshi_public'), port, { slug: shop.slug, token, password: `${secret}-next` }).catch(keep);
    expect(opened.session.via).toBe('real');
  } finally {
    for (const s of spies) s.mockRestore();
  }
  const { rows } = await db.admin.query<{ password_hash: Buffer }>('select password_hash from idp.identity where password_hash is not null');
  const hashes = rows.flatMap((r) => [r.password_hash.toString('hex'), r.password_hash.toString('base64')]);
  expect(hashes.length).toBeGreaterThan(0);
  const tables = await everyRow(db.admin, ['idp.identity']);
  expect(tables.size).toBeGreaterThan(40);
  const needles = [secret, ...hashes];
  const found = [...tables].flatMap(([rel, texts]) => texts.filter((x) => needles.some((n) => x.includes(n))).map(() => rel));
  expect(found, 'tables holding a password or a hash').toEqual([]);
  expect(said.filter((line) => needles.some((n) => line.includes(n)) || line.includes(secret.slice(0, 12))), 'log lines').toEqual([]);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.filter((e) => needles.some((n) => e.includes(n))), 'errors').toEqual([]);
});

it('IDP1 the reset sets the password once, for a grant used on its link within 5 minutes; a change with no used grant, or a second one, is refused', async () => {
  const port = portOf(db);
  const shop = await liveShop(db);
  const email = emailFor('reset');
  await join(db, port, shop, shop.staff, email);
  const subject = (await db.admin.query('select subject from ops.login where member_id = $1', [shop.staff])).rows[0].subject as string;
  const app = db.as('munshi_app');
  const { grantId } = await issueReset(app, await member(db, shop.tenant, shop.owner), shop.staff);
  const grant = { tenantId: shop.tenant, grantId, subject };
  expect(await port.setPasswordFromReset(grant, 'set without a used grant', 'Shop')).toBe(false);
  await plant(db.admin, `update ops.reset_grant set used_at = now(), used_txid = 1 where id = $1`, [grantId]);
  expect(await port.setPasswordFromReset(grant, 'short', 'Shop')).toBe(false);
  expect(await port.setPasswordFromReset(grant, 'the password set by the reset', 'Shop')).toBe(true);
  expect(await port.setPasswordFromReset(grant, 'a second password, refused', 'Shop')).toBe(false);
  expect(await port.signIn({ email, password: 'the password set by the reset' }, ctx())).toEqual({ provider: 'password', subject });
  expect(await port.signIn({ email, password: 'a second password, refused' }, ctx())).toBeNull();
  // A grant used more than 5 minutes ago is refused.
  const late = await issueReset(app, await member(db, shop.tenant, shop.owner), shop.staff);
  await plant(db.admin, `update ops.reset_grant set used_at = now() - interval '6 minutes', used_txid = 1 where id = $1`, [late.grantId]);
  expect(await port.setPasswordFromReset({ ...grant, grantId: late.grantId }, 'too late for this grant', 'Shop')).toBe(false);
});
