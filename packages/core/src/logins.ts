// Sign-in, invites, resets, the demo picker and the sample shops (BLUEPRINT §6.2–§6.7, MERCHANTS-DESIGN §6). The
// identity port proves who a person is; everything here decides what that person may open, from Munshi's own rows:
// ops.login binds an identity to a member, ops.login_session is what a cookie names, and the database's triggers check
// every binding and session again (03_tenancy.sql). Real sign-in is a real shop's, by the tenant's class, on any
// deployment (D-080); the demo picker and the sample shops are the sample shops' (§6.6). Tokens (an invite, a reset) are 32 random bytes, kept only as sha256,
// looked up by that hash and compared timing-safe; they are never logged.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  foldEmail,
  type Identity,
  type IdentityPort,
  type InviteProof,
  passwordAllowed,
  type RequestCtx,
  setPasswordAsOwner,
} from '@munshi/adapters/identity';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Opened, type Session, startSession, withTx } from './session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z][a-z0-9-]{2,39}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const newToken = () => randomBytes(32).toString('base64url');
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// A refusal by the database (a guard, a duplicate, a missing row) is a failed attempt; anything else is thrown.
const refusal = (err: unknown) => err instanceof CoreError && ['refused', 'conflict', 'invalid', 'not_found'].includes(err.code);
const nullOnRefusal = <T>(p: Promise<T>): Promise<T | null> => p.catch((err) => (refusal(err) ? null : Promise.reject(err)));

// What kind of database this is (ops.deployment; no row counts as demo). The demo picker answers 404 on live; real
// sign-in, invites and resets follow the shop's class instead (realShop).
export async function deploymentKind(pool: pg.Pool): Promise<'demo' | 'live'> {
  const { rows } = await pool.query<{ kind: 'demo' | 'live' }>(`select coalesce((select d.kind from ops.deployment d), 'demo') as kind`);
  return (rows[0] as { kind: 'demo' | 'live' }).kind;
}

const tenantOf = async (pool: pg.Pool, slug: string): Promise<string | null> => {
  if (!SLUG.test(slug)) return null;
  const { rows } = await pool.query<{ tenant: string }>('select tenant_id::text as tenant from ops.tenant_directory where slug = $1', [slug]);
  return rows[0]?.tenant ?? null;
};

// Whether a tenant is a real shop ('live', D-080), read under its own context by whichever pool asks (the app's, or the
// public role's on the reset link, which may read the class).
const realShop = async (pool: pg.Pool, tenantId: string): Promise<boolean> => {
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) => c.query<{ live: boolean }>(`select data_class = 'live' as live from ops.tenant`));
  return rows[0]?.live === true;
};

// ---- Limits ----

// A keyed hash of the request's IP (MUNSHI_RATE_SECRET): the only form an IP takes in the database.
export const ipHash = (ip: string, secret: string) => createHmac('sha256', secret).update(ip).digest();

const LIMITS = {
  'sign-in': { hits: 10, window: '10 minutes' },
  'sign-up': { hits: 5, window: '1 day' },
  'shop-sign-up': { hits: 5, window: '1 day' },
  'shop-sign-up-email': { hits: 3, window: '1 day' },
} as const;

// The limit of a route class (§6.2: ten sign-in attempts in 10 minutes; §6.3: five sample shops a day; a real shop's
// sign-up, five a day per IP and three per email), counted in ops.rate_counter as munshi_public. `ip` is the keyed hash
// the class counts by: the IP's, or for shop-sign-up-email the email's. True while it is within the limit.
export async function allowAttempt(publicPool: pg.Pool, route: keyof typeof LIMITS, ip: Buffer): Promise<boolean> {
  const limit = LIMITS[route];
  const bucket = createHash('sha256').update(route).update(ip).digest().subarray(0, 16);
  const { rows } = await publicPool.query<{ hits: number }>(
    `insert into ops.rate_counter as r (bucket, window_start, hits) values ($1, date_bin($2::interval, now(), timestamptz '2000-01-01'), 1)
     on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits`,
    [bucket, limit.window],
  );
  return (rows[0] as { hits: number }).hits <= limit.hits;
}

// ---- Real sign-in (a real shop's) ----

export type Membership = { id: string; name: string; role: 'owner' | 'manager' | 'staff' };

// The memberships lookup (F6): for each live login of the identity, the tenant's id and name and the member's role, read
// under that tenant's own context, and nothing else; an inactive member's shop is left out, and an identity bound to
// nothing gets nothing.
export async function memberships(pool: pg.Pool, identity: Identity): Promise<Membership[]> {
  const { rows } = await pool.query<{ tenant: string; member: string }>(
    `select tenant_id::text as tenant, member_id::text as member from ops.login
      where provider = $1 and subject = $2 and revoked_at is null and erased_at is null order by created_at`,
    [identity.provider, identity.subject],
  );
  const found: Membership[] = [];
  for (const l of rows) {
    const r = await withTx(pool, { kind: 'system', tenantId: l.tenant }, (c) =>
      c.query<{ name: string; role: Membership['role'] }>(
        'select t.name, m.role from ops.tenant t join ops.member m on m.tenant_id = t.tenant_id where m.id = $1 and m.active',
        [l.member],
      ),
    );
    const m = r.rows[0];
    if (m) found.push({ id: l.tenant, name: m.name, role: m.role });
  }
  return found;
}

// A verified identity into one of its shops: its live login there names the member; the session stores the identity's
// epoch. session_via refuses a sample shop and, while a real shop waits for acceptance, anyone but its owner (AUTH1,
// MS020): null either way, as for any refusal.
export async function openRealSession(pool: pg.Pool, identity: Identity, tenantId: string): Promise<Opened | null> {
  if (!UUID.test(tenantId)) return null;
  const { rows } = await pool.query<{ member: string }>(
    `select member_id::text as member from ops.login
      where provider = $1 and subject = $2 and tenant_id = $3 and revoked_at is null and erased_at is null`,
    [identity.provider, identity.subject, tenantId],
  );
  const member = rows[0]?.member;
  return member ? nullOnRefusal(startSession(pool, tenantId, member, 'real')) : null;
}

// ---- Invites (§6.3, MERCHANTS-DESIGN §6.2) ----

const email = z.string().trim().min(3).max(254).regex(/^[^@\s]+@[^@\s]+$/);

// An owner invites anyone, a manager invites staff (invite_guard). The token is shown once, for the issuer to send from
// their own WhatsApp; only its sha256 is kept, and the email only until the invite is used or expires.
export async function createInvite(pool: pg.Pool, session: Session, memberId: string, to: string): Promise<{ inviteId: string; token: string }> {
  const address = email.safeParse(to);
  if (!address.success || !UUID.test(memberId)) throw new CoreError('invalid', { fields: address.success ? ['memberId'] : ['email'] });
  const token = newToken();
  const { rows } = await withTx(pool, { kind: 'member', session }, (c) =>
    c.query<{ id: string }>(
      `insert into ops.member_invite (tenant_id, member_id, email, token_sha256, expires_at) values ($1, $2, $3, $4, now()) returning id`,
      [session.tenantId, memberId, foldEmail(address.data), sha256(token)],
    ),
  );
  return { inviteId: (rows[0] as { id: string }).id, token };
}

type OpenInvite = { tenantId: string; inviteId: string; memberId: string; email: string; shopName: string };

async function findInvite(pool: pg.Pool, slug: string, token: string): Promise<OpenInvite | null> {
  const tenantId = TOKEN.test(token) ? await tenantOf(pool, slug) : null;
  if (!tenantId) return null;
  const hash = sha256(token);
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) =>
    c.query<{ id: string; member: string; email: string; token_sha256: Buffer; name: string }>(
      `select i.id, i.member_id::text as member, i.email, i.token_sha256, t.name
         from ops.member_invite i join ops.tenant t on t.tenant_id = i.tenant_id
        where i.token_sha256 = $1 and i.used_at is null and i.erased_at is null and i.expires_at > now()`,
      [hash],
    ),
  );
  const r = rows[0];
  return r && same(r.token_sha256, hash) ? { tenantId, inviteId: r.id, memberId: r.member, email: r.email, shopName: r.name } : null;
}

// Whether an invite link opens its page (a real shop's): its token's hash names an unused, unexpired invite of that shop.
export async function inviteIsOpen(pool: pg.Pool, slug: string, token: string): Promise<boolean> {
  const inv = await findInvite(pool, slug, token);
  return inv !== null && (await realShop(pool, inv.tenantId));
}

export type Attempt = { kind: 'not_found' } | { kind: 'failed' } | { kind: 'opened'; opened: Opened };
const NOT_FOUND: Attempt = { kind: 'not_found' };
const FAILED: Attempt = { kind: 'failed' };

// The invite page's one form (§6.2, AUTH3). The link is verified first, and the email typed must be the invite's
// (folded, timing-safe), or the answer is 404 and nothing is written (F4). Then the identity port creates the identity
// or verifies the existing one, and one transaction as the invited member uses the invite (its email erased), binds the
// login and opens the session; the database admits the login only with the invite used in that transaction. Every
// failure after the link checks out is the same `failed`.
export async function acceptInvite(
  pool: pg.Pool,
  port: IdentityPort,
  input: { slug: string; token: string; email: string; password: string },
  ctx: RequestCtx,
): Promise<Attempt> {
  const inv = await findInvite(pool, input.slug, input.token);
  if (!inv || !(await realShop(pool, inv.tenantId)) || !same(sha256(foldEmail(input.email)), sha256(foldEmail(inv.email)))) return NOT_FOUND;
  const proof = { tenantId: inv.tenantId, inviteId: inv.inviteId, shopName: inv.shopName } as InviteProof;
  const identity = await port.acceptInvite(proof, { email: input.email, password: input.password }, ctx);
  if (!identity) return FAILED;
  const opened = await nullOnRefusal(
    startSession(pool, inv.tenantId, inv.memberId, 'real', {
      before: async (c) => {
        const used = await c.query('update ops.member_invite set used_at = now(), email = null, erased_at = now() where id = $1 and used_at is null', [
          inv.inviteId,
        ]);
        if (used.rowCount !== 1) throw new CoreError('conflict');
        await c.query('insert into ops.login (provider, subject, tenant_id, member_id, invite_id) values ($1, $2, $3, $4, $5)', [
          identity.provider,
          identity.subject,
          inv.tenantId,
          inv.memberId,
          inv.inviteId,
        ]);
      },
    }),
  );
  return opened ? { kind: 'opened', opened } : FAILED;
}

// ---- Resets (§6.2, review N1) ----

// An in-app reset link for a member of this shop: the database admits it only downward (an owner for a manager or staff
// member, a manager for staff), for an identity with exactly one membership that has never been an owner and is not an
// operator (reset_guard, RESET1). The token is shown once, for the issuer to send from their own WhatsApp.
export async function issueReset(pool: pg.Pool, session: Session, memberId: string): Promise<{ grantId: string; token: string }> {
  if (!UUID.test(memberId)) throw new CoreError('invalid', { fields: ['memberId'] });
  const token = newToken();
  const { rows } = await withTx(pool, { kind: 'member', session }, async (c) => {
    const login = await c.query<{ subject: string }>(
      'select subject from ops.login where tenant_id = $1 and member_id = $2 and revoked_at is null and erased_at is null',
      [session.tenantId, memberId],
    );
    if (!login.rows[0]) throw new CoreError('not_found');
    return c.query<{ id: string }>(
      `insert into ops.reset_grant (tenant_id, member_id, subject, token_sha256, issued_by, expires_at)
       values ($1, $2, $3, $4, $5, now()) returning id`,
      [session.tenantId, memberId, login.rows[0].subject, sha256(token), session.memberId],
    );
  });
  return { grantId: (rows[0] as { id: string }).id, token };
}

// Whether a reset link opens its page (a real shop's): an unused, unexpired grant of that shop has its token's hash.
// Read as munshi_public, the role that uses it.
export async function resetIsOpen(_pool: pg.Pool, publicPool: pg.Pool, slug: string, token: string): Promise<boolean> {
  const tenantId = TOKEN.test(token) ? await tenantOf(publicPool, slug) : null;
  if (!tenantId || !(await realShop(publicPool, tenantId))) return false;
  const hash = sha256(token);
  const { rows } = await withTx(publicPool, { kind: 'system', tenantId }, (c) =>
    c.query<{ token_sha256: Buffer }>('select token_sha256 from ops.reset_grant where token_sha256 = $1 and used_at is null and expires_at > now()', [hash]),
  );
  return rows[0] !== undefined && same(rows[0].token_sha256, hash);
}

// The reset link's form. The new password is checked before the grant is spent. Using the grant is the public shape
// (munshi_public, the link's token as munshi.reset_token, once, before expiry), and it raises the identity's epoch in
// that transaction, so every session the identity holds, in every shop and the console, ends (RESET1). The identity
// port then sets the password for that grant, once, within 5 minutes; the session it opens records the grant
// (reset_grant_id), the start of "signed in through a reset X issued" (no decision row names its session yet). A link
// that is not open is 404; a password refused, `failed`. If the port fails after the grant is used, the sessions have
// ended and the old password stands: the issuer issues another link.
export async function redeemReset(
  pool: pg.Pool,
  publicPool: pg.Pool,
  port: IdentityPort,
  input: { slug: string; token: string; password: string },
): Promise<Attempt> {
  const tenantId = TOKEN.test(input.token) ? await tenantOf(publicPool, input.slug) : null;
  if (!tenantId || !(await realShop(publicPool, tenantId))) return NOT_FOUND;
  const name = await withTx(publicPool, { kind: 'system', tenantId }, (c) => c.query<{ name: string }>('select name from ops.tenant'));
  const shopName = (name.rows[0] as { name: string }).name;
  if (!passwordAllowed(input.password, [shopName])) return FAILED;
  const used = await nullOnRefusal(
    withTx(publicPool, { kind: 'system', tenantId }, async (c) => {
      await c.query(`select set_config('munshi.reset_token', $1, true)`, [input.token]);
      const r = await c.query<{ id: string; member: string; subject: string }>(
        `update ops.reset_grant set used_at = now() where token_sha256 = $1 and used_at is null and expires_at > now()
         returning id, member_id::text as member, subject`,
        [sha256(input.token)],
      );
      return r.rows[0] ?? null;
    }),
  );
  if (!used) return NOT_FOUND;
  if (!(await port.setPasswordFromReset({ tenantId, grantId: used.id, subject: used.subject }, input.password, shopName))) return FAILED;
  const opened = await nullOnRefusal(startSession(pool, tenantId, used.member, 'real', { resetGrantId: used.id }));
  return opened ? { kind: 'opened', opened } : FAILED;
}

// `pnpm identity:reset` (no route): the operator, after checking the person out of band, sets a new password for an
// identity no in-app reset reaches (an owner's, a multi-shop one, an operator's). `c` is the operator's connection, in a
// transaction as the owner role. The epoch cannot rise here — ops.subject_summary takes writes only from its triggers,
// and the reset grant's use only from the public role — so every session of the identity, in each shop (under that
// shop's context) and the console, is deleted instead: the interim way to end them, filed as a schema wish.
export async function resetIdentityAsOperator(
  c: pg.ClientBase,
  input: { email: string; password: string },
  identitySecret: string,
): Promise<{ subject: string; sessionsEnded: number } | null> {
  if (!passwordAllowed(input.password, [input.email])) throw new CoreError('invalid', { fields: ['password'] });
  const subject = await setPasswordAsOwner(c, input.email, input.password, identitySecret);
  if (!subject) return null;
  const logins = await c.query<{ tenant: string; member: string }>(
    `select tenant_id::text as tenant, member_id::text as member from ops.login where provider = 'password' and subject = $1`,
    [subject],
  );
  let sessionsEnded = 0;
  for (const l of logins.rows) {
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [l.tenant]);
    sessionsEnded += (await c.query('delete from ops.login_session where tenant_id = $1 and member_id = $2', [l.tenant, l.member])).rowCount ?? 0;
  }
  const consoleSessions = await c.query('delete from platform.operator_session s using platform.operator o where o.id = s.operator_id and o.subject = $1', [subject]);
  return { subject, sessionsEnded: sessionsEnded + (consoleSessions.rowCount ?? 0) };
}

// ---- The demo (§6.6) ----

export type DemoShop = { tenantId: string; slug: string; name: string };

// The demo picker's shops (F3): the directory's tenants that read as synthetic or showcase and are not sandboxes, each
// read under its own context (ops.tenant forces RLS). A live tenant or a sandbox is never listed.
export async function listDemoShops(pool: pg.Pool): Promise<DemoShop[]> {
  const { rows } = await pool.query<{ slug: string; tenant: string }>('select slug, tenant_id::text as tenant from ops.tenant_directory order by created_at, slug');
  const shops: DemoShop[] = [];
  for (const d of rows) {
    const t = await withTx(pool, { kind: 'system', tenantId: d.tenant }, (c) =>
      c.query<{ name: string; data_class: string; sandbox: boolean }>('select name, data_class, sandbox from ops.tenant'),
    );
    const r = t.rows[0];
    if (r && (r.data_class === 'synthetic' || r.data_class === 'showcase') && !r.sandbox) shops.push({ tenantId: d.tenant, slug: d.slug, name: r.name });
  }
  return shops;
}

// A demo session (12 hours) for an active member of a listed demo shop; session_via refuses it for anything else.
export async function openDemoSession(pool: pg.Pool, tenantId: string, memberId: string): Promise<Opened | null> {
  if (!UUID.test(tenantId) || !UUID.test(memberId)) return null;
  return nullOnRefusal(startSession(pool, tenantId, memberId, 'demo'));
}

const person = z.string().trim().min(1).max(80);
const sampleShop = z.strictObject({
  businessType: z.enum(['kirana', 'apparel', 'salon']),
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(SLUG),
  ownerName: person,
});

// A judge's sample shop (§6.6, a Must): one transaction as its new owner creates a synthetic tenant with sandbox = true,
// its directory row, the owner, the first shop and the pack's capability switches, then opens a 7-day sandbox session.
// No email, no password and no login: the session cookie is its only key, and no platform config row is written, so AI
// takes the demo's default and the site stays hidden. On a live deployment tenant_class refuses it (SANDBOX1).
// createTenant (members.ts) always binds a first-owner login, which a sandbox has none of, hence this transaction.
export async function createSandbox(pool: pg.Pool, input: z.input<typeof sampleShop>): Promise<Opened> {
  const r = sampleShop.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  const i = r.data;
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  return startSession(pool, tenantId, ownerId, 'sandbox', {
    before: async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class, sandbox) values ($1, $2, $3, 'synthetic', true)`, [
        tenantId,
        i.name,
        i.businessType,
      ]);
      await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [i.slug, tenantId]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, $3, 'owner')`, [tenantId, ownerId, i.ownerName]);
      await c.query('insert into ops.shop (tenant_id, name) values ($1, $2)', [tenantId, i.name.slice(0, 80)]);
      // A capability is switched on only after those it requires, which require nothing themselves (01_ref.sql).
      await c.query(
        `insert into ops.capability_switch (tenant_id, capability, is_on)
         select $1, p.capability, true from ref.pack_capability p where p.business_type = $2
          order by exists (select 1 from ref.capability_requires r where r.capability = p.capability), p.capability`,
        [tenantId, i.businessType],
      );
    },
  });
}
