// Snapshots: the only source of a shown number. mintSnapshot runs a NAMED read (queries.ts) read-only under the tenant's
// RLS and stores every declared column of every row as a typed cell; it is the only writer of snap.* (a gate scans for
// any other). recheck re-runs the reads behind a draft's based_on refs and reports the cells whose value changed.
import pg from 'pg';
import { CoreError } from './errors.ts';
import { type Column, type NamedQuery, QUERIES } from './queries.ts';
import { CELL_COLUMNS, type Cell, type CellRef, type CellRow, cellFromRow, formatRef } from './read.ts';
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

async function readCells(c: pg.PoolClient, q: NamedQuery, params: Record<string, unknown>): Promise<Record<string, Cell>[]> {
  const rows = await runReadOnly(c, q.sql, q.order.map((k) => params[k]));
  if (rows.length > MAX_ROWS) throw new CoreError('invalid');
  return rows.map((row) => Object.fromEntries(Object.entries(q.columns).map(([name, col]) => [name, toCell(col, row, name)])));
}

// Inside the caller's transaction (a watcher writes its findings in the same one). The snapshot's tenant, actor and
// created_txid are stamped by the database from the transaction's context.
export async function mintIn(c: pg.PoolClient, name: string, params: unknown, runId?: string): Promise<Snapshot> {
  const q = namedQuery(name);
  const p = parseParams(q, params);
  const rows = await readCells(c, q, p);
  const { rows: made } = await c.query<{ id: string }>(
    `insert into snap.snapshot (tenant_id, query_name, params, run_id, row_count)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4) returning id`,
    [name, p, runId ?? null, rows.length],
  );
  const id = (made[0] as { id: string }).id;
  const cells = rows.flatMap((row, i) => Object.entries(row).map(([col, cell]) => ({ i, col, ...cell })));
  if (cells.length) {
    const pick = <K extends string>(k: K) => cells.map((x) => (x as Record<string, unknown>)[k] ?? null);
    await c.query(
      `insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num, currency, unit, txt, day, at)
       select nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, x.*
         from unnest($2::int[], $3::text[], $4::text[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::date[], $10::timestamptz[]) as x`,
      [id, pick('i'), pick('col'), pick('kind'), pick('num'), pick('currency'), pick('unit'), pick('txt'), pick('day'), pick('at')],
    );
  }
  return { id, name, rows };
}

export function mintSnapshot(pool: pg.Pool, scope: Scope, name: string, params: unknown, runId?: string): Promise<Snapshot> {
  return withTx(pool, scope, (c) => mintIn(c, name, params, runId));
}

const sameCell = (a: Cell | undefined, b: Cell | undefined) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

// The refs whose cell no longer holds: the stored snapshot is gone from view, its query is no longer registered, its row
// (matched by the query's key) is gone, or the re-run value differs. Runs in the caller's transaction.
export async function recheck(c: pg.PoolClient, refs: CellRef[]): Promise<string[]> {
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
    const { rows: stored } = await c.query<CellRow & { row_no: number; col: string }>(
      `select row_no, col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = $1`,
      [snapshotId],
    );
    const cell = (row: number, col: string) => {
      const r = stored.find((s) => s.row_no === row && s.col === col);
      return r ? cellFromRow(r) : undefined;
    };
    const now = await readCells(c, q, parseParams(q, snap.params));
    for (const ref of mine) {
      const match = now.find((row) => q.key.every((k) => sameCell(row[k], cell(ref.row, k))));
      if (!match || !sameCell(match[ref.col], cell(ref.row, ref.col))) changed.push(formatRef(ref));
    }
  }
  return changed;
}
