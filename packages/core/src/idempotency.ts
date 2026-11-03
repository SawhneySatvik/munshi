// Idempotency for core's direct commands (the public API has its own, site-api.ts): a direct command that carries a key
// claims (tenant, member:<id>, key) first, inside the command's own transaction. A fresh key proceeds, and the
// command's ids are stored once it has run, in that same transaction. A key already used waits on the primary key until
// the first transaction ends; then the same request gets the stored ids back and writes nothing, and a different one is
// refused as a conflict.
import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { CommandResult } from './commands.ts';
import { CoreError } from './errors.ts';

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

// Keys sorted at every depth, so one request always hashes the same.
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export type Claim = { replay: CommandResult } | { fill: (result: CommandResult) => Promise<void> };

export async function claimKey(c: pg.PoolClient, memberId: string, key: string, command: string, input: unknown): Promise<Claim> {
  const scope = `member:${memberId}`;
  const sha = createHash('sha256').update(canonical({ command, input })).digest();
  const claimed = await c.query(
    `insert into ops.idempotency (tenant_id, scope, key, command, request_sha256)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4) on conflict do nothing`,
    [scope, key, command, sha],
  );
  if (claimed.rowCount === 1) {
    return {
      // The stored result holds ids only (the table's check refuses anything else), so a null id is left out.
      fill: async (result) => {
        const ids = Object.fromEntries(Object.entries(result).filter(([, v]) => v !== null));
        await c.query('update ops.idempotency set result = $1 where scope = $2 and key = $3', [ids, scope, key]);
      },
    };
  }
  const { rows } = await c.query<{ command: string; request_sha256: Buffer; result: Record<string, string> | null }>(
    'select command, request_sha256, result from ops.idempotency where scope = $1 and key = $2',
    [scope, key],
  );
  const prior = rows[0];
  if (!prior?.result || prior.command !== command || !prior.request_sha256.equals(sha)) throw new CoreError('conflict', { fields: ['key'] });
  return { replay: prior.result };
}
