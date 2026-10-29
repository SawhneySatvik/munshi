// Every core transaction runs through withTx, and withTx is the one place the database context is set — in particular
// the acting member, which the database trusts (CLAUDE.md, ruling (c)), and the session's via, by which the database
// keeps a demo or sandbox session from publishing a site or making a delivery real (14, 19). Gate B3 checks that no
// other shipped source names the acting-member setting.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { toCoreError } from './errors.ts';

declare const minted: unique symbol;

export type Via = 'demo' | 'sandbox' | 'real';

// The signed-in member. Only this module makes one: the brand is not exported, so a hand-built `{ tenantId, memberId }`
// does not typecheck as a Session — it cannot come from a request body or model output. A session from a cookie names
// its ops.login_session row (`sessionId`) and how it was opened (`via`); openSession's carries neither (seeds, tests,
// the dev script), so it sets no via and the database treats it as neither a demo nor a real session.
export type Session = { readonly tenantId: string; readonly memberId: string; readonly via?: Via; readonly sessionId?: string; readonly [minted]: true };

// `member`: a person's own request, optionally running a direct command. `system`: a watcher, or an agent run proposing
// a draft — a tenant and no actor, so it can never act as anyone.
export type Scope = { kind: 'member'; session: Session; command?: string } | { kind: 'system'; tenantId: string };

export async function withTx<T>(pool: pg.Pool, scope: Scope, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient | undefined;
  let broken = false;
  try {
    client = await pool.connect();
    await client.query('begin');
    const member = scope.kind === 'member' ? scope : undefined;
    await client.query(
      `select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', $3, true),
              set_config('munshi.via', $4, true)`,
      [
        member ? member.session.tenantId : (scope as { tenantId: string }).tenantId,
        member?.session.memberId ?? '',
        member?.command ?? '',
        member?.session.via ?? '',
      ],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    if (client) await client.query('rollback').catch(() => (broken = true));
    throw toCoreError(err);
  } finally {
    client?.release(broken);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mint = (tenantId: string, memberId: string, row?: { via: Via; sessionId: string }) =>
  (row ? { tenantId, memberId, via: row.via, sessionId: row.sessionId } : { tenantId, memberId }) as Session;

// The member ids a trusted caller already holds (a seed, a test, the dev script), if that member exists and is active
// in that tenant; null otherwise. A request never reaches this: the app's sessions come from resumeSession.
export async function openSession(pool: pg.Pool, tenantId: string, memberId: string): Promise<Session | null> {
  if (!UUID.test(tenantId) || !UUID.test(memberId)) return null;
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) => c.query('select 1 from ops.member where id = $1 and active', [memberId]));
  return rows.length === 1 ? mint(tenantId, memberId) : null;
}

// Sign-up's new owner, before their member row exists: fresh random ids, so it can name no one who exists.
export function signUpSession(): Session {
  return mint(randomUUID(), randomUUID());
}

// ---- Session rows (BLUEPRINT §6.7): what a cookie names ----

export type Opened = { session: Session; expiresAt: Date };
const LIFE: Record<Via, string> = { demo: '12 hours', sandbox: '7 days', real: '14 days' };

// Opens the ops.login_session row of `memberId`, as that member, after `before` has run in the same transaction (an
// invite's binding, a sample shop's creation). The database's session_via decides whether this via is allowed here; a
// real session stores the identity's epoch from the member's live login and, when a reset opened it, the grant. Called
// by logins.ts's sign-in paths, which prove who the person is first; no web source calls it (a scan holds that).
export async function startSession(
  pool: pg.Pool,
  tenantId: string,
  memberId: string,
  via: Via,
  opts: { resetGrantId?: string; before?: (c: pg.PoolClient) => Promise<unknown> } = {},
): Promise<Opened> {
  return withTx(pool, { kind: 'member', session: mint(tenantId, memberId) }, async (c) => {
    await opts.before?.(c);
    const { rows } = await c.query<{ id: string; expires_at: Date }>(
      `insert into ops.login_session (tenant_id, member_id, via, subject_epoch, reset_grant_id, expires_at)
       values ($1, $2, $3::text,
               case when $3::text = 'real' then (
                 select s.epoch from ops.login l join ops.subject_summary s on s.provider = l.provider and s.subject = l.subject
                  where l.tenant_id = $1 and l.member_id = $2 and l.revoked_at is null and l.erased_at is null) end,
               $4, now() + $5::interval)
       returning id, expires_at`,
      [tenantId, memberId, via, opts.resetGrantId ?? null, LIFE[via]],
    );
    const row = rows[0] as { id: string; expires_at: Date };
    return { session: mint(tenantId, memberId, { via, sessionId: row.id }), expiresAt: row.expires_at };
  });
}

export type Claim = { tenantId: string; memberId: string; sessionId: string; via: Via };

type Resumed = {
  member: string;
  via: Via;
  epoch: number | null;
  active: boolean;
  data_class: string;
  sandbox: boolean;
  deployed: string;
  current_epoch: number | null;
};

// The app's way to a Session from a verified cookie. The row it names must exist, be neither revoked nor expired, and be
// this member's and this via's; the member must be active (F5). A demo or sandbox session is never one for a live tenant
// or on a live deployment (F1); a sandbox session only on a sandbox, and no other session there. A real session needs
// the live deployment, a live login and the identity's current epoch, so a reset ends it (AUTH1, RESET1). Null for
// anything else.
export async function resumeSession(pool: pg.Pool, claim: Claim): Promise<Session | null> {
  if (![claim.tenantId, claim.memberId, claim.sessionId].every((id) => UUID.test(id))) return null;
  const { rows } = await withTx(pool, { kind: 'system', tenantId: claim.tenantId }, (c) =>
    c.query<Resumed>(
      `select s.member_id::text as member, s.via, s.subject_epoch as epoch, m.active, t.data_class, t.sandbox,
              coalesce((select d.kind from ops.deployment d), 'demo') as deployed,
              (select x.epoch from ops.login l join ops.subject_summary x on x.provider = l.provider and x.subject = l.subject
                where l.tenant_id = s.tenant_id and l.member_id = s.member_id and l.revoked_at is null and l.erased_at is null) as current_epoch
         from ops.login_session s
         join ops.member m on m.tenant_id = s.tenant_id and m.id = s.member_id
         join ops.tenant t on t.tenant_id = s.tenant_id
        where s.id = $1 and s.revoked_at is null and s.expires_at > now()`,
      [claim.sessionId],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  if (r.member !== claim.memberId || r.via !== claim.via) return null;
  if (!r.active) return null;
  if (r.via !== 'real' && (r.data_class === 'live' || r.deployed === 'live')) return null;
  if ((r.via === 'sandbox') !== r.sandbox) return null;
  if (r.via === 'real' && (r.deployed !== 'live' || r.current_epoch === null || r.epoch !== r.current_epoch)) return null;
  return mint(claim.tenantId, claim.memberId, { via: r.via, sessionId: claim.sessionId });
}

// Sign-out: the member revokes their own session row, once.
export async function endSession(pool: pg.Pool, session: Session): Promise<void> {
  if (!session.sessionId) return;
  await withTx(pool, { kind: 'member', session }, (c) =>
    c.query('update ops.login_session set revoked_at = now() where id = $1 and revoked_at is null', [session.sessionId]),
  );
}
