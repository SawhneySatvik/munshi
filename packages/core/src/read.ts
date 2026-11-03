// The read side, safe for packages/agent to import (the boundary gate allows only this entry point): snapshot refs, typed
// cells, resolving a ref to its stored cell, rendering a cell, and the one number detector and span parser
// (numbers.ts) that core and the agent share. Nothing here writes, sets context or holds a pool; the caller passes a
// client whose transaction already carries the tenant.
import type pg from 'pg';
import { toCoreError } from './errors.ts';
import { formatMoney, formatQuantity } from './money.ts';

export * from './numbers.ts';

export type CellRef = { snapshotId: string; row: number; col: string };

export type Cell =
  | { kind: 'integer'; num: string }
  | { kind: 'money'; num: string; currency: string }
  | { kind: 'quantity'; num: string; unit: string } // num in milli-units of unit
  | { kind: 'text'; txt: string }
  | { kind: 'date'; day: string }
  | { kind: 'timestamp'; at: string }
  | { kind: 'null' };

export const CANNOT_VERIFY = 'Cannot verify';

const REF = /^⟨snap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})·(\d{1,6})·([a-z_][a-z0-9_]{0,62})⟩$/;

export function parseRef(text: string): CellRef | null {
  const m = REF.exec(text);
  return m ? { snapshotId: m[1] as string, row: Number(m[2]), col: m[3] as string } : null;
}

export function formatRef(ref: CellRef): string {
  return `⟨snap:${ref.snapshotId}·${ref.row}·${ref.col}⟩`;
}

// A stored cell as snap.snapshot.rows holds it (snap_check, 02_shared.sql, refuses any other shape), and
// a column as snap.snapshot.columns holds it. Core's Cell is the same value with longer names.
export type JsonCell =
  | { k: 'int'; n: string }
  | { k: 'money'; n: string; c: string }
  | { k: 'qty'; n: string; u: string }
  | { k: 'text'; t: string }
  | { k: 'date'; d: string }
  | { k: 'ts'; a: string }
  | { k: 'null' };
export type JsonColumn = { n: string; k: Exclude<JsonCell['k'], 'null'> };

export function cellFromJson(v: JsonCell): Cell {
  switch (v.k) {
    case 'int':
      return { kind: 'integer', num: v.n };
    case 'money':
      return { kind: 'money', num: v.n, currency: v.c };
    case 'qty':
      return { kind: 'quantity', num: v.n, unit: v.u };
    case 'text':
      return { kind: 'text', txt: v.t };
    case 'date':
      return { kind: 'date', day: v.d };
    case 'ts':
      return { kind: 'timestamp', at: v.a };
    default:
      return { kind: 'null' };
  }
}

export function cellToJson(cell: Cell): JsonCell {
  switch (cell.kind) {
    case 'integer':
      return { k: 'int', n: cell.num };
    case 'money':
      return { k: 'money', n: cell.num, c: cell.currency };
    case 'quantity':
      return { k: 'qty', n: cell.num, u: cell.unit };
    case 'text':
      return { k: 'text', t: cell.txt };
    case 'date':
      return { k: 'date', d: cell.day };
    case 'timestamp':
      return { k: 'ts', a: cell.at };
    default:
      return { k: 'null' };
  }
}

// The column every snapshot answers at row 0: its row count, so an empty read is citable ("no overdue credit").
export const COUNT_COL = '_count';

// A ref as text and back through the one pattern, so a ref object with a negative row (jsonb's `-> -1` is the last
// row), a malformed id or column, resolves to nothing rather than to another cell.
const wellFormed = (ref: CellRef | string) => parseRef(typeof ref === 'string' ? ref : formatRef(ref));

// The stored cell a ref names, or null ("Cannot verify") if it is malformed or not in this tenant's snapshots. The
// caller's client may be the agent's own (not a core transaction), so a database error is mapped here.
export async function resolveRef(q: Pick<pg.ClientBase, 'query'>, ref: CellRef | string): Promise<Cell | null> {
  const r = wellFormed(ref);
  if (!r) return null;
  if (r.col === COUNT_COL) {
    if (r.row !== 0) return null;
    const { rows } = await query<{ n: number }>(q, 'select row_count as n from snap.snapshot where id = $1', [r.snapshotId]);
    return rows[0] ? { kind: 'integer', num: String(rows[0].n) } : null;
  }
  const { rows } = await query<{ cell: JsonCell | null }>(
    q,
    `select s.rows -> $2::int -> (select (c.i - 1)::int from jsonb_array_elements(s.columns) with ordinality c(v, i) where c.v ->> 'n' = $3) as cell
       from snap.snapshot s where s.id = $1`,
    [r.snapshotId, r.row, r.col],
  );
  return rows[0]?.cell ? cellFromJson(rows[0].cell) : null;
}

// Every cell of one stored row, by column; null if the snapshot or the row is not in this tenant's snapshots.
export async function readRow(q: Pick<pg.ClientBase, 'query'>, at: { snapshotId: string; row: number }): Promise<Record<string, Cell> | null> {
  const r = wellFormed({ ...at, col: COUNT_COL });
  if (!r) return null;
  const { rows } = await query<{ columns: JsonColumn[]; cells: JsonCell[] | null }>(
    q,
    'select columns, rows -> $2::int as cells from snap.snapshot where id = $1',
    [r.snapshotId, r.row],
  );
  const s = rows[0];
  return s?.cells ? Object.fromEntries(s.columns.map((col, i) => [col.n, cellFromJson(s.cells?.[i] as JsonCell)])) : null;
}

async function query<R extends pg.QueryResultRow>(q: Pick<pg.ClientBase, 'query'>, text: string, values: unknown[]) {
  try {
    return await q.query<R>(text, values);
  } catch (err) {
    throw toCoreError(err);
  }
}

// A cell renders with what it measures, so prose never has to add it (the agent's validator refuses a currency or unit
// beside a handle): money with its currency sign, a quantity with its unit ("24 packs", "1 pack", "1.5 kg"). A text
// cell renders without control or bidi characters, so a name cannot reorder the digits around it.
export function renderCell(cell: Cell | null, locale = 'en-IN'): string {
  if (!cell) return CANNOT_VERIFY;
  switch (cell.kind) {
    case 'integer':
      return new Intl.NumberFormat(locale).format(Number(cell.num));
    case 'money':
      return formatMoney({ minor: Number(cell.num), currency: cell.currency }, locale);
    case 'quantity': {
      const n = formatQuantity(Number(cell.num), cell.unit, locale);
      const counted = cell.unit === 'piece' || cell.unit === 'pack';
      return counted ? `${n} ${cell.unit}${Number(cell.num) === 1000 ? '' : 's'}` : n;
    }
    case 'text':
      return cell.txt.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
    case 'date':
      return cell.day;
    case 'timestamp':
      return cell.at;
    default:
      return '—';
  }
}
