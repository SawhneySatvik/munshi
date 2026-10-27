// The read side, safe for packages/agent to import (the boundary gate allows only this entry point): snapshot refs, typed
// cells, resolving a ref to its stored cell, rendering a cell. Nothing here writes, sets context or holds a pool; the
// caller passes a client whose transaction already carries the tenant.
import type pg from 'pg';
import { toCoreError } from './errors.ts';
import { formatMoney, formatQuantity } from './money.ts';

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

// A stored snapshot_cell row (num as text, day as text) as a Cell.
export type CellRow = {
  kind: string;
  num: string | null;
  currency: string | null;
  unit: string | null;
  txt: string | null;
  day: string | null;
  at: Date | null;
};
export const CELL_COLUMNS = 'kind, num::text as num, currency, unit, txt, day::text as day, at';

export function cellFromRow(r: CellRow): Cell {
  switch (r.kind) {
    case 'integer':
      return { kind: 'integer', num: r.num as string };
    case 'money':
      return { kind: 'money', num: r.num as string, currency: r.currency as string };
    case 'quantity':
      return { kind: 'quantity', num: r.num as string, unit: r.unit as string };
    case 'text':
      return { kind: 'text', txt: r.txt as string };
    case 'date':
      return { kind: 'date', day: r.day as string };
    case 'timestamp':
      return { kind: 'timestamp', at: (r.at as Date).toISOString() };
    default:
      return { kind: 'null' };
  }
}

// The stored cell a ref names, or null ("Cannot verify") if it is malformed or not in this tenant's snapshots. The
// caller's client may be the agent's own (not a core transaction), so a database error is mapped here.
export async function resolveRef(q: Pick<pg.ClientBase, 'query'>, ref: CellRef | string): Promise<Cell | null> {
  const r = typeof ref === 'string' ? parseRef(ref) : ref;
  if (!r) return null;
  try {
    const { rows } = await q.query<CellRow>(
      `select ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = $1 and row_no = $2 and col = $3`,
      [r.snapshotId, r.row, r.col],
    );
    return rows[0] ? cellFromRow(rows[0]) : null;
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
