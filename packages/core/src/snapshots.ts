// Snapshots: the only source of a shown number. mintSnapshot runs a NAMED read (queries.ts) read-only under the tenant's
// RLS and stores every declared column of every row as a typed cell, one snap.snapshot row holding them as JSON
// (BLUEPRINT §2.8); it is the only writer of snap.* (a gate scans for any other). recheck re-runs the reads behind a
// draft's cited refs and reports the cells whose value changed.
import pg from 'pg';
import { CoreError } from './errors.ts';
import { type Column, type NamedQuery, QUERIES } from './queries.ts';
import { COUNT_COL, type Cell, type CellRef, cellToJson, formatRef, type JsonColumn, readRow, resolveRef } from './read.ts';
import { refuseRead } from './read-roles.ts';
import { type Scope, withTx } from './session.ts';

export const MAX_ROWS = 500;

export type Snapshot = { id: string; name: string; rows: Record<string, Cell>[] };

// Dates come back as their text ('YYYY-MM-DD'); pg's default parses them into a local-midnight Date.
const RAW_DATES = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => (oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format)),
} as pg.CustomTypesConfig;

function namedQuery(name: string): NamedQuery {
  const q = QUERIES.get(name);
  if (!q) throw new CoreError('unknown_query');
  return q;
}

function parseParams(q: NamedQuery, params: unknown): Record<string, unknown> {
  const r = q.params.safeParse(params);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(params)') });
  return r.data as Record<string, unknown>;
}

// Runs the read inside a savepoint set READ ONLY, so even a registered query cannot write; rolling the savepoint back
// restores the transaction's read-write mode (and undoes any setting the read changed).
export async function runReadOnly(c: pg.PoolClient, sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  await c.query('savepoint named_read');
  try {
    await c.query('set transaction read only');
    return (await c.query({ text: sql, values, types: RAW_DATES })).rows;
  } finally {
    await c.query('rollback to savepoint named_read; release savepoint named_read');
  }
}

function integral(v: unknown): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  if (!/^-?\d+$/.test(s)) throw new CoreError('internal'); // a named read returned a non-integral number: a query bug
  return s;
}

function toCell(col: Column, row: Record<string, unknown>, name: string): Cell {
  const v = row[name];
  if (v === null || v === undefined) return { kind: 'null' };
  switch (col.kind) {
    case 'integer':
      return { kind: 'integer', num: integral(v) };
    case 'money':
      return { kind: 'money', num: integral(v), currency: String(row[col.currency as string]) };
    case 'quantity':
      return { kind: 'quantity', num: integral(v), unit: String(row[col.unit as string]) };
    case 'text':
      return { kind: 'text', txt: String(v) };
    case 'date':
      return { kind: 'date', day: String(v) };
    case 'timestamp':
      return { kind: 'timestamp', at: (v as Date).toISOString() };
  }
}

const JSON_KIND = { integer: 'int', money: 'money', quantity: 'qty', text: 'text', date: 'date', timestamp: 'ts' } as const;
const columnsOf = (q: NamedQuery): JsonColumn[] => Object.entries(q.columns).map(([n, col]) => ({ n, k: JSON_KIND[col.kind] }));

async function readCells(c: pg.PoolClient, q: NamedQuery, params: Record<string, unknown>): Promise<Record<string, Cell>[]> {
  const rows = await runReadOnly(c, q.sql, q.order.map((k) => params[k]));
  if (rows.length > MAX_ROWS) throw new CoreError('invalid');
  return rows.map((row) => Object.fromEntries(Object.entries(q.columns).map(([name, col]) => [name, toCell(col, row, name)])));
}

// Inside the caller's transaction (a watcher writes its findings in the same one; a page mints in its one transaction).
// The purpose follows who mints, as snap_check admits: the jobs role's read is a watcher's (`watch`); a member's read
// for an agent run is `evidence` and always a new row, since the validator refuses a cell of another run; a member's
// own read is `display`, and returns the newest identical display snapshot of the last day instead of a new one (reuse,
// BLUEPRINT §2.8). The hashes, row count, actor and created_txid are stamped by the database; the lookup hashes the same
// jsonb text the same way, so "identical" is the database's own sha256 of rows::text and params::text.
// `release`: the snapshot a site release publishes (publishRelease): a site.* read only, minted fresh (never reused), as
// an active owner on live or the owner role off it (snap_check and release_check hold who).
// A member's read passes the read gate first (read-roles.ts, D-082): their role may make it and its capability is on.
export async function mintIn(c: pg.PoolClient, name: string, params: unknown, runId?: string, release = false): Promise<Snapshot> {
  if (release && (!name.startsWith('site.') || runId !== undefined)) throw new CoreError('invalid', { fields: ['name'] });
  const q = namedQuery(name);
  const p = parseParams(q, params);
  await refuseRead(c, name, p);
  const rows = await readCells(c, q, p);
  const values = [name, JSON.stringify(p), JSON.stringify(columnsOf(q)), JSON.stringify(rows.map((row) => Object.values(row).map(cellToJson))), runId ?? null];
  const { rows: looked } = await c.query<{ purpose: string; reused: string | null }>(
    `with x as (select case when $6::boolean then 'release' when current_user = 'munshi_jobs' then 'watch' when $5::uuid is not null then 'evidence' else 'display' end as purpose)
     select x.purpose,
            (select s.id::text from snap.snapshot s
              where x.purpose = 'display' and s.purpose = 'display' and s.run_id is null and s.query_name = $1
                and s.params_sha256 = sha256(convert_to($2::jsonb::text, 'UTF8')) and s.rows_sha256 = sha256(convert_to($4::jsonb::text, 'UTF8'))
                and s.columns = $3::jsonb and s.created_at > now() - interval '1 day'
              order by s.created_at desc limit 1) as reused
       from x`,
    [...values, release],
  );
  const { purpose, reused } = looked[0] as { purpose: string; reused: string | null };
  if (reused) return { id: reused, name, rows };
  const { rows: made } = await c.query<{ id: string }>(
    `insert into snap.snapshot (tenant_id, query_name, params, columns, rows, run_id, purpose, params_sha256, rows_sha256, row_count)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, '\\x00', '\\x00', 0)
     returning id`,
    [...values, purpose],
  );
  return { id: (made[0] as { id: string }).id, name, rows };
}

export function mintSnapshot(pool: pg.Pool, scope: Scope, name: string, params: unknown, runId?: string): Promise<Snapshot> {
  return withTx(pool, scope, (c) => mintIn(c, name, params, runId));
}

const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

// The refs whose cell no longer holds: the stored snapshot is gone from view, its query is no longer registered, its row
// (matched by the query's key) is gone, or the re-run value differs; a cited row count holds while the re-run returns as
// many rows. Each ref is reported once. Runs in the caller's transaction.
export async function recheck(c: pg.PoolClient, cited: CellRef[]): Promise<string[]> {
  const refs = [...new Map(cited.map((r) => [formatRef(r), r])).values()];
  const changed: string[] = [];
  for (const snapshotId of new Set(refs.map((r) => r.snapshotId))) {
    const mine = refs.filter((r) => r.snapshotId === snapshotId);
    const { rows: snaps } = await c.query<{ query_name: string; params: Record<string, unknown> }>(
      'select query_name, params from snap.snapshot where id = $1',
      [snapshotId],
    );
    const snap = snaps[0];
    const q = snap ? QUERIES.get(snap.query_name) : undefined;
    if (!snap || !q) {
      changed.push(...mine.map(formatRef));
      continue;
    }
    const now = await readCells(c, q, parseParams(q, snap.params));
    for (const ref of mine) {
      if (ref.col === COUNT_COL) {
        if (!sameCell(await resolveRef(c, ref), { kind: 'integer', num: String(now.length) })) changed.push(formatRef(ref));
        continue;
      }
      const stored = await readRow(c, ref);
      const match = stored && now.find((row) => q.key.every((k) => sameCell(row[k], stored[k])));
      if (!match || !sameCell(match[ref.col], stored[ref.col])) changed.push(formatRef(ref));
    }
  }
  return changed;
}
