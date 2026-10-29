// The owner home, read from the books (server only). Every figure on it is a ref into a stored snapshot cell: the
// watchers' findings point at their snapshot rows, the overdue-credit card at its credit.overdue_total snapshot, and a
// draft's quantity at its payload ref (the cell core checked holds it). The snapshots' rows travel with the page so the source drawer shows the very
// row. All of it is read by core's viewHome in one transaction under the signed-in member; the only write is minting the
// brief's credit.overdue_total once per business date (a snapshot, through core's mint).
import { type Cell, type CellRef, type HomeView, type Session, type StoredSnapshot, viewHome, withPage } from "@munshi/core";
import { DICT, type Dict, fillText } from "../i18n";
import type { CellValue, Column, Draft, Finding, Lang, Localized, OwnerHome, Snapshot, SourceRef } from "../types";
import { appPool } from "./db";
import { named } from "./ledger";

// The drawer's title and columns for each read the home shows: ids stay out, and every column a chip on the home points
// at is in (the drawer highlights it).
const DRAWER: Record<string, { title: keyof Dict; columns: string[]; simulatedSupplier?: boolean }> = {
  "watch.shrinkage": { title: "titleShrinkage", columns: ["item", "expected", "counted", "missing"] },
  "watch.price_creep": { title: "titlePriceCreep", columns: ["item", "baseline_cost", "latest_cost"], simulatedSupplier: true },
  "watch.expiry": { title: "titleExpiry", columns: ["item", "days_left", "remaining", "at_risk_value"] },
  "credit.overdue_total": { title: "titleOverdue", columns: ["customers", "overdue", "credit_days"] },
  "watch.short_settlement": { title: "titleShortSettlement", columns: ["business_date", "received", "settled", "short"] },
};
const KIND_ORDER = ["shrinkage", "price_creep", "overdue_credit", "expiry", "short_settlement"];
// The brief ranks findings by rupees at stake, read from the watcher's own money cell for the kind (the stored column, never
// computed): shrinkage `loss`, expiry `at_risk_value`, short settlement `short`; the overdue card's own `overdue` cell in its
// credit.overdue_total snapshot. price_creep has no such column (a per-unit cost and a percentage; the stake would need
// quantity x rise, a number no cell holds), so it ranks after every finding that has one.

// A line whose number has no source in the books: there is no bank statement import, so Munshi cannot say what the bank
// received.
const UNVERIFIED = [
  {
    what: { en: "UPI received yesterday", hi: "कल आया UPI भुगतान" },
    reason: { en: "the bank statement has not been imported", hi: "बैंक स्टेटमेंट अभी नहीं आया" },
  },
];

const label = (key: keyof Dict, slots: Record<Lang, Record<string, string>> = { en: {}, hi: {} }): Localized => ({
  en: fillText(DICT.en[key], slots.en),
  hi: fillText(DICT.hi[key], slots.hi),
});

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const supplierName = (name: string, simulated: boolean) => (simulated ? name.replace(/\s*\(simulated\)$/, "") : name);

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("home: a stored figure is out of range");
  return n;
}

function cellValue(cell: Cell): CellValue {
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

export async function loadHome(session: Session): Promise<OwnerHome> {
  return homeOf(await withPage(await appPool(), session, (c) => viewHome(c, session)));
}

/** The home as the screen shows it, from core's viewHome (the suppliers page reads the same view in its own page). */
export function homeOf(v: HomeView): OwnerHome {
  const { viewer: me, brief, findings, drafts } = v;
  const byId = new Map(v.snapshots.map((s) => [s.id, s]));
  const cell = (snapshotId: string, row: number, col: string): Cell | undefined => byId.get(snapshotId)?.rows[row]?.[col];
  const text = (snapshotId: string, row: number, col: string) => {
    const c = cell(snapshotId, row, col);
    return c?.kind === "text" ? c.txt : "";
  };
  const suppliers = new Map([...v.suppliers].map(([id, s]) => [id, { name: supplierName(s.name, s.simulated), simulated: s.simulated }]));
  const ref = (l: Localized, snapshotId: string, row: number, col: string): SourceRef => ({ label: l, snapshotId, row: row + 1, col });
  const shown: { finding: Finding; stake: bigint | null }[] = [];
  const stakeOf = (snapshotId: string, row: number, col: string) => {
    const c = cell(snapshotId, row, col);
    return c?.kind === "money" ? BigInt(c.num) : null; // compared, never added or multiplied
  };
  let overdueShown = false;
  const ordered = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const f of ordered) {
    const [s, r] = [f.snapshotId, f.snapshotRow];
    switch (f.kind) {
      case "shrinkage":
        shown.push({
          stake: stakeOf(s, r, "loss"),
          finding: {
            kind: "shelf_gap",
            id: f.id,
            item: text(s, r, "item"),
            books: ref(label("labelStockLedger"), s, r, "expected"),
            shelf: ref(label("labelStockCount"), s, r, "counted"),
          },
        });
        break;
      case "price_creep": {
        const supplier = suppliers.get(text(s, r, "supplier_id")) ?? { name: "", simulated: true };
        shown.push({
          stake: null,
          finding: {
            kind: "price_rise",
            id: f.id,
            item: text(s, r, "item"),
            supplier,
            was: ref(label("labelEarlierBills"), s, r, "baseline_cost"),
            now: ref(label("labelSupplierBill", { en: { supplier: possessive(supplier.name) }, hi: { supplier: supplier.name } }), s, r, "latest_cost"),
          },
        });
        break;
      }
      case "overdue_credit": // one card for all overdue customers, its figures from the brief's credit.overdue_total
        if (overdueShown || !brief?.totalId) break;
        overdueShown = true;
        shown.push({
          stake: stakeOf(brief.totalId, 0, "overdue"),
          finding: {
            kind: "overdue_credit",
            id: f.id,
            customers: ref(label("labelCreditBook"), brief.totalId, 0, "customers"),
            owed: ref(label("labelCreditBook"), brief.totalId, 0, "overdue"),
            days: ref(label("labelCreditBook"), brief.totalId, 0, "credit_days"),
          },
        });
        break;
      case "expiry":
        shown.push({
          stake: stakeOf(s, r, "at_risk_value"),
          finding: {
            kind: "expiry",
            id: f.id,
            item: text(s, r, "item"),
            left: ref(label("labelStockLedger"), s, r, "remaining"),
            days: ref(label("labelPurchaseBill"), s, r, "days_left"),
            value: ref(label("labelStockLedger"), s, r, "at_risk_value"),
          },
        });
        break;
      case "short_settlement":
        shown.push({
          stake: stakeOf(s, r, "short"),
          finding: {
            kind: "short_settlement",
            id: f.id,
            day: ref(label("labelUpiSettlement"), s, r, "business_date"),
            short: ref(label("labelUpiSettlement"), s, r, "short"),
          },
        });
        break;
    }
  }
  // Most rupees first, those with no money cell last; the sort is stable, so ties keep the kind order above.
  shown.sort((a, b) => (a.stake === b.stake ? 0 : a.stake === null ? 1 : b.stake === null ? -1 : a.stake > b.stake ? -1 : 1));

  const cards: Draft[] = drafts.map((d) => ({
    id: d.id,
    command: "reorder.place",
    status: d.status as Draft["status"],
    lines: d.payload.lines.map((line, i) => ({
      item: v.items.get(line.itemId) ?? "",
      qty: qtyRef(d.payloadRefs[`lines[${i}].qtyMilli`], line.qtyMilli, cell, byId, ref),
    })),
    supplier: suppliers.get(d.payload.supplierId) ?? { name: "", simulated: true },
    decision: v.stamps.get(d.id) ?? null,
    canDecide: me.mayRun.has("reorder.place"),
  }));

  const snapshots: Snapshot[] = v.snapshots.map((s) => {
    const view = DRAWER[s.query];
    const rows = s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, c]) => [col, cellValue(c)])), s.names));
    const first = rows[0] ?? {};
    const columns: Column[] = (view?.columns ?? Object.keys(first)).map((key) => {
      const c = first[key];
      return { key, numeric: c?.t === "int" || c?.t === "money" || c?.t === "qty" };
    });
    return {
      id: s.id,
      query: s.query,
      readAt: s.readAt,
      title: view ? label(view.title) : { en: s.query, hi: s.query },
      ...(view?.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows,
    };
  });

  const synthetic = /\s*\(synthetic\)$/;
  return {
    shop: { name: me.tenantName.replace(synthetic, ""), synthetic: synthetic.test(me.tenantName) },
    member: me.member as OwnerHome["member"],
    briefAt: brief ? brief.startedAt.toISOString() : null,
    snapshots,
    findings: shown.map((x) => x.finding),
    unverified: UNVERIFIED,
    drafts: cards,
  };
}

// A reorder line's quantity is shown from its payload ref (the cell core checked holds it when the draft was proposed),
// and only while that stored cell still holds the very quantity the draft would order; otherwise null, and the card says
// "Cannot verify" rather than print the payload.
function qtyRef(
  r: CellRef | undefined,
  qtyMilli: number,
  cell: (snapshotId: string, row: number, col: string) => Cell | undefined,
  byId: Map<string, StoredSnapshot>,
  ref: (l: Localized, snapshotId: string, row: number, col: string) => SourceRef,
): SourceRef | null {
  const v = r && cell(r.snapshotId, r.row, r.col);
  if (!r || v?.kind !== "quantity" || v.num !== String(qtyMilli)) return null;
  return ref(label(byId.get(r.snapshotId)?.query === "watch.shrinkage" ? "labelStockCount" : "labelStockLedger"), r.snapshotId, r.row, r.col);
}
