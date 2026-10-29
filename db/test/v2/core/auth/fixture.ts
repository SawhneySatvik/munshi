// Shared by the sign-in suites (test/v2/core/auth): a live-kind database with invented people (BLUEPRINT §6.2, "the gates
// build a live-kind test database"), the password identity on the idp role's own pool, and members joined the only way a
// person joins: an invite from the shop, opened and accepted through core. Never mock the database: the login, session
// and reset guards are under test.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { derive, type IdentityPort, passwordIdentity, SCRYPT, type ScryptParams } from '../../../../../packages/adapters/identity/index.ts';
import { acceptInvite, createInvite, ipHash } from '../../../../../packages/core/src/logins.ts';
import { type Opened, openSession, type Session } from '../../../../../packages/core/src/session.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { asOwner } from '../../gates/lib.ts';

export const IDENTITY_SECRET = 'identity-secret-for-the-v2-tests-only-0001';
export const RATE_SECRET = 'rate-secret-for-the-v2-tests-only-00000001';
// A cheap cost for the suites that are not about cost; the timing and storage gates use the production SCRYPT.
export const FAST: ScryptParams = { N: 2 ** 12, r: 8, p: 1, keylen: 64 };
export const PASSWORD = 'correct horse battery staple';

export async function liveDb(): Promise<TestDb> {
  const db = await openTestDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  return db;
}

// A live shop with an owner, a manager and a staff member, none of them signed up yet; a random slug unless one is given.
export const liveShop = (db: TestDb, slug = `auth-${randomBytes(5).toString('hex')}`) => signUp(db, slug, { dataClass: 'live' });
export const portOf = (db: TestDb, params: ScryptParams = FAST): IdentityPort =>
  passwordIdentity({ pool: db.as('munshi_idp'), identitySecret: IDENTITY_SECRET, params });
export const ctx = (ip = '203.0.113.7', botCheck = true) => ({ ipHash: ipHash(ip, RATE_SECRET), botCheck });
export const member = async (db: TestDb, tenantId: string, memberId: string) => (await openSession(db.as('munshi_app'), tenantId, memberId)) as Session;

// The shop invites `memberId` (as `by`, the owner by default) and the person accepts with this email and password.
export async function join(
  db: TestDb,
  port: IdentityPort,
  t: Tenant,
  memberId: string,
  email: string,
  password = PASSWORD,
  by = t.owner,
): Promise<Opened> {
  const app = db.as('munshi_app');
  const { token } = await createInvite(app, await member(db, t.tenant, by), memberId, email);
  const r = await acceptInvite(app, port, { slug: t.slug, token, email, password }, ctx());
  if (r.kind !== 'opened') throw new Error(`fixture: the invite was not accepted (${r.kind})`);
  return r.opened;
}

export async function timed<T>(p: () => Promise<T>): Promise<{ r: T; ms: number }> {
  const at = performance.now();
  const r = await p();
  return { r, ms: performance.now() - at };
}

// The timing bands (IDP1, LOCK1, AUTH3). Suites run in parallel, so a time is only ever slower than it would be alone:
// the fastest of a few scrypt runs at the production cost stands for one scrypt, and an answer that took a quarter of it
// skipped scrypt (a skipped path is a few milliseconds, two orders below). Two kinds of answer are in one band when
// their medians are within a factor of three.
export async function oneScrypt(runs = 3): Promise<number> {
  const times = [];
  for (let i = 0; i < runs; i++) times.push((await timed(() => derive(PASSWORD, randomBytes(16), SCRYPT))).ms);
  return Math.min(...times);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
export function band(one: number, kinds: Record<string, number[]>): string {
  const shown = `${Object.entries(kinds).map(([k, ms]) => `${k} ${ms.map((x) => x.toFixed(0)).join(', ')} ms`).join('; ')}; one scrypt ${one.toFixed(0)} ms`;
  const skipped = Object.values(kinds).flat().filter((ms) => ms < one / 4);
  const medians = Object.values(kinds).map(median);
  if (skipped.length) return `an answer skipped scrypt: ${shown}`;
  if (Math.max(...medians) > 3 * Math.min(...medians)) return `two kinds of answer are out of one band: ${shown}`;
  return `ok: ${shown}`;
}

export const emailFor = (label: string) => `${label}-${randomBytes(4).toString('hex')}@example.invalid`;

// Every row of every Munshi table, as text, for scans and for "writes nothing" (as the superuser, so RLS hides none).
export async function everyRow(admin: pg.Pool, skip: string[] = []): Promise<Map<string, string[]>> {
  const { rows } = await admin.query<{ rel: string }>(
    `select format('%I.%I', n.nspname, c.relname) as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'idp', 'platform') order by 1`,
  );
  const out = new Map<string, string[]>();
  for (const { rel } of rows) {
    if (skip.includes(rel)) continue;
    const r = await admin.query<{ t: string }>(`select t::text as t from ${rel} t order by 1`);
    out.set(rel, r.rows.map((x) => x.t));
  }
  return out;
}

export type { Tenant };
