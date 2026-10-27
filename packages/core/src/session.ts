// Every core transaction runs through withTx, and withTx is the one place the database context is set — in particular
// the acting member, which the database trusts (CLAUDE.md, ruling (c)). Gate B3 checks that no other shipped source names
// that setting.
import type pg from 'pg';
import { toCoreError } from './errors.ts';

// The signed-in member. The app builds it from its authenticated session — never from a request body or model output.
export type Session = { readonly tenantId: string; readonly memberId: string };

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
