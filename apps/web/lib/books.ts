// What the bills, suppliers and day-report pages read (built on the server in lib/server/{bills,suppliers,reports}.ts):
// every figure a ref into a stored snapshot cell, the snapshots' rows travelling with the page for the source drawer.
// Plain data, so it crosses to the client as is. Also the parsing of a person's typed bill figures, shared by the form
// (to compare a typed price with the last bill's cell) and the server action (to build the command's input).
import type { Draft, Finding, Member, Snapshot, SourceRef, Supplier } from "./types";

export type Viewer = { shop: string; member: Member };

/** A bill as bills.recent stored it. bill_no and the supplier's name are the row's text cells. */
export type BillRow = { id: string; billNo: string; supplier: Supplier; date: SourceRef; lines: SourceRef; total: SourceRef };

export type BillsPage = Viewer & { asOf: string; snapshots: Snapshot[]; bills: BillRow[]; canRecord: boolean };

/** One line of a recorded bill, read from purchases.price_history for its item; `rise` when its cost is above the line
 *  before it (that earlier cell is then cited in `rises`). */
export type BillLine = { item: string; qty: SourceRef; cost: SourceRef; rise: boolean };

export type BillPage = Viewer & {
  snapshots: Snapshot[];
  bill: BillRow;
  lines: BillLine[];
  rises: Finding[];
  /** Who entered the bill and when: the books' created_by and created_at. */
  entered: { by: string; at: string };
  /** The signed-in member recorded this bill on the request that led here. */
  justRecorded: boolean;
};

export type BillFormData = Viewer & {
  asOf: string;
  canRecord: boolean;
  suppliers: Array<{ id: string } & Supplier>;
  items: Array<{ id: string; name: string; unit: string; category: string }>;
};

/** The last bill price for an item (purchases.last_price), minted when the person picks the item on the form. */
export type LastPrice = { snapshot: Snapshot; cost: SourceRef } | { snapshot: null; cost: null };

export type SupplierCard = {
  id: string;
  supplier: Supplier;
  lastBill: BillRow | null;
  /** The items on that bill, each at its last price (purchases.last_price). */
  prices: Array<{ item: string; cost: SourceRef }>;
};

export type SuppliersPage = Viewer & { snapshots: Snapshot[]; drafts: Draft[]; rises: Finding[]; suppliers: SupplierCard[] };

export const REPORT_VIEWS = ["yesterday", "today", "week"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export type DayRow = {
  /** The row's own date cell ('YYYY-MM-DD'), for <time>. */
  day: string;
  bills: SourceRef;
  total: SourceRef;
  cash: SourceRef;
  upi: SourceRef;
  card: SourceRef;
  onCredit: SourceRef;
};

export type ItemRow = { item: string; sold: SourceRef; revenue: SourceRef; bills: SourceRef };

export type ReportPage = Viewer & { view: ReportView; from: string; to: string; snapshots: Snapshot[]; days: DayRow[]; items: ItemRow[] };

// ---- a person's typed figures --------------------------------------------------------------------------------------
// Read from the text as typed, digit by digit: no float arithmetic, so "56.10" is exactly 5610 paise.

/** Rupees as typed ("56", "56.5", "56.50") in paise; null for anything else. */
export function parseRupees(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A quantity as typed, in milli-units of the item's unit. Packs and pieces are whole; weighed goods take up to three
 *  decimals ("1.25" kg). Zero is not a quantity on a bill. */
export function parseQty(text: string, unit: string): number | null {
  const whole = unit === "pack" || unit === "piece";
  const m = (whole ? /^(\d{1,6})$/ : /^(\d{1,6})(?:\.(\d{1,3}))?$/).exec(text.trim());
  if (!m) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return milli > 0 ? milli : null;
}
