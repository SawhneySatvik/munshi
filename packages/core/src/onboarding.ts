// A real shop's way in (D-079, D-080; platform design §1, §8): self-serve sign-up makes a real ('live') shop that waits
// for the superadmin's acceptance; its owner signs in to a waiting page until then; once accepted, Home carries a
// "Getting started" checklist that finishes itself from the books. And the console's list of shops waiting.
//
// While a shop is pending the database refuses every app write but its creation and the owner's session (MS020), and
// every snapshot, so nothing here shows a number: the waiting page reads the shop's name, its state and the owner's own
// member row; how long is left is a fixed bucket, rendered as words. "Open" and "lapsed" are the database's own
// functions (ops.tenant_open, ops.tenant_lapsed, 03_tenancy.sql), never re-derived here.
import type { IdentityPort, RequestCtx } from '@munshi/adapters/identity';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { createTenant } from './members.ts';
import { mayReadIn } from './read-roles.ts';
import { type Opened, type Session, startSession, withTx } from './session.ts';

export type ShopState = 'open' | 'pending' | 'expired';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A shop as its sign-in sees it: open (a sample shop, or a real one accepted), pending, or expired unaccepted. */
export async function shopState(pool: pg.Pool, tenantId: string): Promise<ShopState> {
  if (!UUID.test(tenantId)) throw new CoreError('invalid', { fields: ['tenantId'] });
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) =>
    c.query<{ open: boolean; lapsed: boolean }>('select ops.tenant_open($1) as open, ops.tenant_lapsed($1) as lapsed', [tenantId]),
  );
  const r = rows[0] as { open: boolean; lapsed: boolean };
  return r.open ? 'open' : r.lapsed ? 'expired' : 'pending';
}

// ---- Sign-up ----

export const BUSINESS_TYPES = ['kirana', 'salon', 'apparel'] as const;
const realShop = z.strictObject({
  shopName: z.string().trim().min(1).max(80),
  businessType: z.enum(BUSINESS_TYPES),
  city: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/),
  email: z.string().trim().min(3).max(254).regex(/^[^@\s]+@[^@\s]+$/),
  password: z.string().min(1).max(128),
});
// As a form posts it: every field text, checked here.
export type RealShopInput = Record<keyof z.input<typeof realShop>, string>;

/** The fields a real shop's sign-up would refuse, before anything is sent or written; none when it would take them. */
export function validRealShop(input: RealShopInput): string[] {
  const r = realShop.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.') || '(input)');
}

/** Whether no shop holds this web address now (the directory's look-alike rule is the database's, at sign-up). */
export async function slugFree(pool: pg.Pool, slug: string): Promise<boolean> {
  return (await pool.query('select 1 from ops.tenant_directory where slug = $1', [slug])).rowCount === 0;
}

/**
 * Whether this database serves the public: a live deployment, or a hosted one (ops.deployment). There a real shop's
 * owner must have verified their email (D-080): self-asserted sign-up is for a laptop or a test database only.
 */
export async function servedDeployment(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query<{ served: boolean }>(`select coalesce((select d.kind = 'live' or d.hosted from ops.deployment d), false) as served`);
  return rows[0]?.served === true;
}

export type RealSignUp =
  | { kind: 'opened'; opened: Opened }
  | { kind: 'invalid'; fields: string[] }
  | { kind: 'closed' } // a served deployment takes no unverified email
  | { kind: 'taken' } // the web address is taken or reserved (a conflict on the directory)
  | { kind: 'waiting' } // this identity already has a real shop waiting for acceptance
  | { kind: 'refused' } // the database refused the shop for any other reason
  | { kind: 'failed' }; // the identity port refused: an email with an account and a wrong password, a weak password, a lock

/**
 * A real shop's sign-up. The identity port makes the owner's identity (`via`: 'email' when the app has a verified email
 * claim, else 'invite', stamped 'self': self-asserted, local and test only) or, for an email that already has one, proves
 * its password; then one
 * transaction makes the tenant ('live', pending), its directory row, the owner, the first-owner login, the shop (its
 * city as the area) and the pack's switches (createTenant), and the owner's real session opens. The identity lives in
 * another database role's schema, so it cannot share that transaction: if the shop is refused, an identity made a
 * moment ago for it is erased again, and an existing one is left as it was.
 */
export async function signUpRealShop(
  pool: pg.Pool,
  port: IdentityPort,
  input: RealShopInput,
  ctx: RequestCtx,
  via: 'invite' | 'email',
): Promise<RealSignUp> {
  // Before anything is read or written: an unverified email never makes an identity on a served deployment.
  if (via === 'invite' && (await servedDeployment(pool))) return { kind: 'closed' };
  const r = realShop.safeParse(input);
  if (!r.success) return { kind: 'invalid', fields: r.error.issues.map((i) => i.path.join('.') || '(input)') };
  const i = r.data;
  if (!(await slugFree(pool, i.slug))) return { kind: 'taken' };
  const made = await port.signUpOwner({ email: i.email, password: i.password, avoid: [i.shopName] }, ctx, via === 'email' ? 'email' : 'self');
  if (!made) return { kind: 'failed' };
  let created: { session: Session };
  try {
    created = await createTenant(pool, {
      kind: 'real',
      name: i.shopName,
      slug: i.slug,
      businessType: i.businessType,
      shopName: i.shopName,
      area: i.city,
      ownerName: i.ownerName,
      identity: made.identity,
    });
  } catch (err) {
    // Only an identity made for this sign-up, and only while no shop's login is bound to it (a second submit of the same
    // email may have bound it meanwhile): the adapter re-checks under the identity's lock.
    if (made.created) await port.eraseUnbound(made.identity.subject);
    if (!(err instanceof CoreError)) throw err;
    if (err.sqlstate === 'MS020') return { kind: 'waiting' };
    // A slug conflict: the directory's unique slug or skeleton (23505), or its reserved-name rule (MS007; in this
    // transaction no other guard raises MS007, the rest holding by construction).
    if ((err.code === 'conflict' && err.constraint?.startsWith('tenant_directory')) || err.sqlstate === 'MS007') return { kind: 'taken' };
    if (err.code === 'refused' || err.code === 'conflict') return { kind: 'refused' };
    throw err;
  }
  const opened = await startSession(pool, created.session.tenantId, created.session.memberId, 'real');
  return { kind: 'opened', opened };
}

// ---- The waiting page ----

/** How long a pending sign-up has left, as a bucket the page words (never a count). */
export type TimeLeft = 'two_weeks' | 'one_week' | 'few_days' | 'last_day';
export type Waiting = { shopName: string; state: ShopState; left: TimeLeft | null; owner: { name: string | null; role: 'owner' | 'manager' | 'staff' } };

/** What the waiting page reads, as the signed-in member, and nothing more: the shop's name, its state, their own row.
 * Gated by the role map's screen.waiting (D-082): null for a role it is not for. */
export async function waitingView(pool: pg.Pool, session: Session): Promise<Waiting | null> {
  const rows = await withTx(pool, { kind: 'member', session }, async (c) => {
    if (!(await mayReadIn(c, 'screen.waiting'))) return null;
    const r = await c.query<{ name: string; open: boolean; lapsed: boolean; left: TimeLeft; member: string | null; role: Waiting['owner']['role'] }>(
      `select t.name, ops.tenant_open(t.tenant_id) as open, ops.tenant_lapsed(t.tenant_id) as lapsed,
              case when t.created_at > now() - interval '4 days' then 'two_weeks'
                   when t.created_at > now() - interval '9 days' then 'one_week'
                   when t.created_at > now() - interval '13 days' then 'few_days'
                   else 'last_day' end as left,
              m.display_name as member, m.role
         from ops.tenant t join ops.member m on m.tenant_id = t.tenant_id and m.id = $1 and m.active`,
      [session.memberId],
    );
    return r.rows;
  });
  if (!rows) return null;
  const r = rows[0];
  if (!r) throw new CoreError('not_found');
  const state: ShopState = r.open ? 'open' : r.lapsed ? 'expired' : 'pending';
  return { shopName: r.name, state, left: state === 'pending' ? r.left : null, owner: { name: r.member, role: r.role } };
}

// ---- Getting started (Home) ----

/** `channels` is null for a manager: the operator grants a channel, and asking Munshi for one is the owner's. */
export type Checklist = { items: boolean; stock: boolean; staff: boolean; channels: boolean | null };

/**
 * A real shop's first steps, each done once the books say so: an item in the catalogue, opening stock (an opening
 * entry, a bill's stock or a count's adjustment, or a shelf count; never a sale), a staff record, a channel the operator
 * granted. Null for a sample shop, and for counter staff (D-082: the office's, screen.getting_started in the role map).
 * Flags only, read as the member: no figure leaves here.
 */
export function gettingStarted(pool: pg.Pool, session: Session): Promise<Checklist | null> {
  return withTx(pool, { kind: 'member', session }, (c) => gettingStartedIn(c, session.tenantId));
}

/** gettingStarted in the caller's member transaction (a page's one transaction). */
export async function gettingStartedIn(c: pg.ClientBase, tenantId: string): Promise<Checklist | null> {
  const rows = await (async () => {
    if (!(await mayReadIn(c, 'screen.getting_started'))) return [];
    const r = await c.query<{ real: boolean; owner: boolean; items: boolean; stock: boolean; staff: boolean; channels: boolean }>(
      `select (select t.data_class = 'live' from ops.tenant t) as real,
              exists (select 1 from ops.member m where m.id = nullif(current_setting('munshi.actor_id', true), '')::uuid and m.role = 'owner' and m.active) as owner,
              exists (select 1 from books.item) as items,
              (exists (select 1 from books.stock_move s where s.kind in ('opening', 'purchase', 'count_adjust')) or exists (select 1 from ops.shelf_count)) as stock,
              exists (select 1 from books.staff) as staff,
              exists (select 1 from (select distinct on (g.channel) g.granted from platform.channel_grant g
                                      where g.tenant_id = $1 order by g.channel, g.effective_from desc, g.id desc) x where x.granted) as channels`,
      [tenantId],
    );
    return r.rows;
  })();
  const r = rows[0];
  if (!r?.real) return null;
  return { items: r.items, stock: r.stock, staff: r.staff, channels: r.owner ? r.channels : null };
}

// ---- The console: shops waiting for acceptance ----

/** A pending sign-up's age, as a bucket the console words. */
export type SignupAge = 'today' | 'this_week' | 'last_week';
export type WaitingShop = { tenantId: string; slug: string; name: string; businessType: string; city: string | null; age: SignupAge };
export type SignupBoard = { waiting: WaitingShop[]; counts: { waiting: number; accepted: number; expired: number; samples: number } };

/**
 * For the console (munshi_platform, in the operator's transaction): every real shop waiting for acceptance, oldest
 * first, each read under its own context with no actor, and the directory's counts of shops waiting, accepted,
 * expired (lapsed, not yet purged: the purge frees the slug) and sample shops. The platform role reads a shop's area
 * (its city at sign-up) and nothing else of ops.shop, so the list shows kind, city, slug and age.
 */
export async function consoleSignups(c: pg.ClientBase): Promise<SignupBoard> {
  const { rows } = await c.query<{ tenant_id: string; slug: string; live: boolean; accepted: boolean }>(
    `select d.tenant_id::text, d.slug, d.live, exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id) as accepted
       from ops.tenant_directory d order by d.created_at, d.slug`,
  );
  const counts = { waiting: 0, accepted: 0, expired: 0, samples: 0 };
  const waiting: WaitingShop[] = [];
  for (const d of rows) {
    if (!d.live) counts.samples++;
    else if (d.accepted) counts.accepted++;
    if (!d.live || d.accepted) continue;
    // Under the shop's own context: ops.tenant forces RLS, and tenant_lapsed reads it as the caller.
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [d.tenant_id]);
    const t = await c.query<{ name: string; business_type: string; city: string | null; lapsed: boolean; age: SignupAge }>(
      `select t.name, t.business_type, (select s.area from ops.shop s where s.tenant_id = t.tenant_id limit 1) as city,
              ops.tenant_lapsed(t.tenant_id) as lapsed,
              case when t.created_at > now() - interval '1 day' then 'today'
                   when t.created_at > now() - interval '7 days' then 'this_week' else 'last_week' end as age
         from ops.tenant t where t.tenant_id = $1`,
      [d.tenant_id],
    );
    const row = t.rows[0];
    if (!row) continue;
    if (row.lapsed) {
      counts.expired++;
      continue;
    }
    counts.waiting++;
    waiting.push({ tenantId: d.tenant_id, slug: d.slug, name: row.name, businessType: row.business_type, city: row.city, age: row.age });
  }
  await c.query(`select set_config('munshi.tenant_id', '', true)`);
  return { waiting, counts };
}
