import { calendarDate } from "./time";
import type { CellValue, Finding, Lang, Snapshot, SourceRef } from "./types";

const SYMBOL: Record<string, string> = { INR: "₹" };
const grouped = (digits: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Money in minor units. "short" drops whole-rupee paise for the card (₹2,350); "exact" keeps them for the ledger. */
export function formatMoney(minor: number, currency: string, style: "short" | "exact"): string {
  const digits = style === "exact" || minor % 100 !== 0 ? 2 : 0;
  return `${minor < 0 ? "−" : ""}${SYMBOL[currency] ?? `${currency} `}${grouped(digits).format(Math.abs(minor) / 100)}`;
}

/** Quantities are milli-units: counted units (pack, piece) show the count, measured ones carry the unit ("1.5 kg"). */
export function formatQty(milli: number, unit: string): string {
  const n = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(milli / 1000);
  return unit === "pack" || unit === "piece" ? n : `${n} ${unit}`;
}

export function findSnapshot(snapshots: Snapshot[], id: string): Snapshot | undefined {
  return snapshots.find((s) => s.id === id);
}

export function resolveCell(snapshots: Snapshot[], ref: SourceRef): CellValue | undefined {
  return findSnapshot(snapshots, ref.snapshotId)?.rows[ref.row - 1]?.[ref.col];
}

/** The figure a card shows for a ref, or null when the ref does not land on a figure cell ("Cannot verify"). */
export function resolveNumber(snapshots: Snapshot[], ref: SourceRef, lang: Lang = "en"): string | null {
  const cell = resolveCell(snapshots, ref);
  if (cell?.t === "int") return grouped(0).format(cell.v);
  if (cell?.t === "money") return formatMoney(cell.minor, cell.currency, "short");
  if (cell?.t === "qty") return formatQty(cell.milli, cell.unit);
  if (cell?.t === "date") return calendarDate(cell.v, lang);
  return null;
}

/** A cell as the source drawer's ledger table prints it (the stored row, in English). */
export function formatTableCell(cell: CellValue | undefined): string {
  if (!cell) return "";
  switch (cell.t) {
    case "int":
      return grouped(0).format(cell.v);
    case "money":
      return formatMoney(cell.minor, cell.currency, "exact");
    case "qty":
      return formatQty(cell.milli, cell.unit);
    case "date":
      return calendarDate(cell.v, "en");
    case "time":
    case "text":
      return cell.v;
    case "null":
      return "—";
  }
}

export const sameRef = (a: SourceRef | null, b: SourceRef | null) =>
  a !== null && b !== null && a.snapshotId === b.snapshotId && a.row === b.row && a.col === b.col;

/** The number a finding is about: the one ringed when its source is open. */
export function keyRef(finding: Finding): SourceRef {
  switch (finding.kind) {
    case "shelf_gap":
      return finding.shelf;
    case "price_rise":
      return finding.now;
    case "overdue_credit":
      return finding.owed;
    case "expiry":
      return finding.value;
    case "short_settlement":
      return finding.short;
  }
}
