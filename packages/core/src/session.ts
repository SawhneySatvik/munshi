// Every core transaction runs through withTx, and withTx is the one place the database context is set — in particular
// the acting member, which the database trusts (CLAUDE.md, ruling (c)). Gate B3 checks that no other shipped source names
// that setting.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { toCoreError } from './errors.ts';

declare const minted: unique symbol;

// The signed-in member. Only this module makes one (openSession, signUpSession): the brand is not exported, so a
// hand-built `{ tenantId, memberId }` does not typecheck as a Session — it cannot come from a request body or model output.
export type Session = { readonly tenantId: string; readonly memberId: string; readonly [minted]: true };

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
      `select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', $3, true)`,
      [member ? member.session.tenantId : (scope as { tenantId: string }).tenantId, member?.session.memberId ?? '', member?.command ?? ''],
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
const mint = (tenantId: string, memberId: string) => ({ tenantId, memberId }) as Session;

// The app's way to a Session: the tenant and member ids its authenticated sign-in carries (a verified cookie), if that
// member exists and is active in that tenant; null otherwise.
export async function openSession(pool: pg.Pool, tenantId: string, memberId: string): Promise<Session | null> {
  if (!UUID.test(tenantId) || !UUID.test(memberId)) return null;
  const { rows } = await withTx(pool, { kind: 'system', tenantId }, (c) => c.query('select 1 from ops.member where id = $1 and active', [memberId]));
  return rows.length === 1 ? mint(tenantId, memberId) : null;
}

// Sign-up's new owner, before their member row exists: fresh random ids, so it can name no one who exists.
export function signUpSession(): Session {
  return mint(randomUUID(), randomUUID());
}
