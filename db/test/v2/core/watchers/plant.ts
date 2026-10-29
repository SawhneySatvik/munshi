// Planting for the watcher tests. Rows another lane's command will write (orders, advances, packages, bookings) are
// written here through the database's own rules: a guarded insert as the member, under the command's label
// (munshi.command), in one transaction, so the book guard, the flow triggers and the audit chain admit each row exactly
// as they would that command's. A capability is switched as the owner (capability_guard). Findings are read back as
// their snapshot row's plain values, for hand-written expected rows.
import { type Session, withTx } from '@munshi/core';
import type pg from 'pg';

export type Client = pg.PoolClient;

/** One transaction as `session`, running `command` directly: what the guard admits from that command. */
export const asCommand = <T>(app: pg.Pool, session: Session, command: string, fn: (c: Client) => Promise<T>) =>
  withTx(app, { kind: 'member', session, command }, fn);

/** One transaction as `session`, with no command: ops rows a member writes (requests, holds, bookings, switches). */
export const asMember = <T>(app: pg.Pool, session: Session, fn: (c: Client) => Promise<T>) => withTx(app, { kind: 'member', session }, fn);

export const TENANT = `nullif(current_setting('munshi.tenant_id', true), '')::uuid`;

/** The owner switches a capability on or off (an audited ops row, never a book). */
export const setCapability = (app: pg.Pool, owner: Session, capability: string, on: boolean) =>
  asMember(app, owner, (c) => c.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values (${TENANT}, $1, $2)`, [capability, on]));

export const one = async <T = Record<string, unknown>>(c: Client, sql: string, values: unknown[] = []): Promise<T> => (await c.query(sql, values)).rows[0] as T;

export type Seen = { kind: string; key: string; status: string; shop: string | null; severity: string; v: Record<string, string | number | null> };

/** Every finding of the tenant with its snapshot row's values: text, dates and instants as text, numbers as numbers. */
export async function findings(pool: pg.Pool, tenantId: string, where = 'true'): Promise<Seen[]> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ kind: string; dedupe_key: string; status: string; shop_id: string | null; severity: string; columns: { n: string }[]; cells: { k: string; n?: string; t?: string; d?: string; a?: string }[] }>(
      `select f.kind, f.dedupe_key, f.status, f.shop_id::text, f.severity, s.columns, s.rows -> f.snapshot_row as cells
         from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
        where ${where} order by f.kind, f.dedupe_key, f.created_at`,
    );
    return rows.map((r) => ({
      kind: r.kind,
      key: r.dedupe_key,
      status: r.status,
      shop: r.shop_id,
      severity: r.severity,
      v: Object.fromEntries(r.columns.map((col, i) => {
        const cell = r.cells[i] as { k: string; n?: string; t?: string; d?: string; a?: string };
        return [col.n, cell.n !== undefined ? Number(cell.n) : (cell.t ?? cell.d ?? cell.a ?? null)];
      })),
    }));
  });
}

/** The named reads a watcher run minted, by name. */
export const runQueries = (pool: pg.Pool, tenantId: string, runId: string) =>
  withTx(pool, { kind: 'system', tenantId }, async (c) =>
    (await c.query<{ q: string }>('select query_name as q from snap.snapshot where run_id = $1 order by query_name', [runId])).rows.map((r) => r.q),
  );

/**
 * A superuser fixture: moves one of a finding's stamps (which the database writes, and a final finding never changes)
 * `days` into the past, with triggers off for this one transaction. Setting up a past, never the write under test.
 */
export async function age(admin: pg.Pool, id: string, col: 'closed_at' | 'snoozed_until' | 'first_seen_at', days: number): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update ai.finding set ${col} = ${col} - make_interval(days => $2) where id = $1`, [id, days]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

/** A day `n` days from `day` (YYYY-MM-DD), in plain calendar arithmetic. */
export const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
