// What the bills, suppliers and day-report pages share on the server: the page's one transaction under the signed-in
// member (core's withPage, around the screen's core view), the drawer's view of each read the views mint, the member as
// the pages show them, and the suppliers. Every figure is a cell of a snapshot a core view minted in that transaction;
// the only writes are those snapshots.
import { type Cell, type Firm, type Session, type StoredSnapshot, type Viewer, withPage } from "@munshi/core";
import { BOOKS, type BooksDict } from "../i18n-books";
import { DICT, type Dict, fillText } from "../i18n";
import type { CellValue, Column, Lang, Localized, Member, Snapshot, SourceRef, Supplier } from "../types";
import { appPool } from "./db";

export type Client = Parameters<Parameters<typeof withPage>[2]>[0];

/** Runs a page's core views in its one transaction, as the signed-in member. */
export async function page<T>(session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withPage(await appPool(), session, fn);
}

// The drawer's title and columns for each read these pages show: ids stay out; every column a figure points at is in.
const VIEWS: Record<string, { title: keyof BooksDict; columns: string[]; simulatedSupplier?: true }> = {
  "bills.recent": { title: "titleBillsRecent", columns: ["bill_no", "bill_date", "lines", "total"], simulatedSupplier: true },
  "purchases.price_history": {
    title: "titlePriceHistory",
    columns: ["item", "bill_date", "bill_no", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "purchases.last_price": {
    title: "titleLastPrice",
    columns: ["item", "bill_no", "bill_date", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "bill.lines_for": {
    title: "titleBillLines",
    columns: ["line_no", "item", "qty", "unit_cost", "amount", "prev_unit_cost", "expires_on"],
    simulatedSupplier: true,
  },
  "purchases.last_prices": {
    title: "titleLastPrices",
    columns: ["item", "bill_no", "bill_date", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "sales.week_total": { title: "titleWeekTotal", columns: ["bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_day": { title: "titleSalesByDay", columns: ["day", "bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_item": { title: "titleSalesByItem", columns: ["item", "sold", "revenue", "bills"] },
};

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("ledger: a stored figure is out of range");
  return n;
}

export function cellValue(cell: Cell): CellValue {
  switch (cell.kind) {
    case "integer":
      return { t: "int", v: safe(cell.num) };
    case "money":
      return { t: "money", minor: safe(cell.num), currency: cell.currency };
    case "quantity":
      return { t: "qty", milli: safe(cell.num), unit: cell.unit };
    case "text":
      return { t: "text", v: cell.txt };
    case "date":
      return { t: "date", v: cell.day };
    case "timestamp":
      return { t: "time", v: cell.at };
    case "null":
      return { t: "null" };
  }
}

/**
 * A drawer row with each person its cells name by id shown beside them: `customer` beside customer_id, `supplier` beside
 * supplier_id, the name core read from people.ts (a name is a word, never a cell, so it carries no ref).
 */
export function named(row: Record<string, CellValue>, names: Record<string, string>): Record<string, CellValue> {
  const out = { ...row };
  for (const party of ["customer", "supplier"] as const) {
    const id = row[`${party}_id`];
    if (id?.t === "text") out[party] = { t: "text", v: names[id.v] ?? "" };
  }
  return out;
}

/** A Localized from a key of the pages' own dictionary or the shared one. */
export function words(key: keyof BooksDict | keyof Dict, slots: Record<Lang, Record<string, string>> = { en: {}, hi: {} }): Localized {
  const pick = (lang: Lang) => (key in BOOKS[lang] ? BOOKS[lang][key as keyof BooksDict] : DICT[lang][key as keyof Dict]);
  return { en: fillText(pick("en"), slots.en), hi: fillText(pick("hi"), slots.hi) };
}

/** A snapshot as the drawer shows it, with every stored cell (the drawer shows the very row). */
export function stored(s: StoredSnapshot): Snapshot {
  const view = VIEWS[s.query];
  if (!view) throw new Error(`ledger: no drawer view for ${s.query}`);
  const rows = s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, c]) => [col, cellValue(c)])), s.names));
  const first = rows[0] ?? {};
  const columns: Column[] = view.columns.map((key) => {
    const v = first[key];
    return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
  });
  return {
    id: s.id,
    query: s.query,
    readAt: s.readAt,
    title: words(view.title),
    ...(view.simulatedSupplier ? { simulatedSupplier: true } : {}),
    columns,
    rows,
  };
}

/** A text cell's value ('' when the cell is not text). Names and bill numbers on these pages come from here. */
export function textOf(s: Snapshot, row: number, col: string): string {
  const v = s.rows[row]?.[col];
  return v?.t === "text" ? v.v : v?.t === "date" ? v.v : "";
}

/** A ref to a stored cell; `row` is the 0-based stored row (SourceRef rows are 1-based, as the drawer shows them). */
export const refTo = (label: Localized, s: Snapshot, row: number, col: string): SourceRef => ({ label, snapshotId: s.id, row: row + 1, col });

const SYNTHETIC = /\s*\(synthetic\)$/;
const SIMULATED = /\s*\(simulated\)$/;

export type Me = { shop: string; member: Member; mayRun: Set<string>; timeZone: string };

export const me = (v: Viewer): Me => ({ shop: v.tenantName.replace(SYNTHETIC, ""), member: v.member as Member, mayRun: v.mayRun, timeZone: v.timeZone });

/** Every supplier of the shop, its "(simulated)" suffix dropped from the name and carried as a flag instead. */
export const suppliers = (firms: Firm[]): Map<string, Supplier> =>
  new Map(firms.map((s) => [s.id, { name: s.simulated ? s.name.replace(SIMULATED, "") : s.name, simulated: s.simulated }]));

export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The plain name of a supplier's bill as a source: "Gupta Traders' bill" · "Gupta Traders का बिल". */
export const supplierBill = (supplier: Supplier) =>
  words("labelSupplierBill", { en: { supplier: possessive(supplier.name) }, hi: { supplier: supplier.name } });
