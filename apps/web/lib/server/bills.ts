// Suppliers' bills (server only): the month's bills from bills.recent; one bill with its lines; the form's catalogue;
// and an item's last bill price. Each figure is a ref into a snapshot core's bill views mint as the signed-in member, in
// the page's one transaction. A recorded bill's lines are the rows of bill.lines_for, each with the unit cost of the same
// item on the bill before it, which a price rise is cited against.
import { type Session, viewBill, viewBillForm, viewBills, viewLastPrice } from "@munshi/core";
import type { BillFormData, BillLine, BillPage, BillRow, BillsPage, LastPrice } from "../books";
import type { Finding, Snapshot, Supplier } from "../types";
import { type Client, me, page, refTo, stored, supplierBill, suppliers, textOf, words } from "./ledger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A supplier the books no longer show: no name, and labelled simulated, never real.
const NO_FIRM: Supplier = { name: "", simulated: true };

/** Row `r` of a bills.recent snapshot, its supplier named from the books (a name is not a cell). */
export function billRow(s: Snapshot, r: number, firms: Map<string, Supplier>): BillRow {
  const label = words("labelPurchaseBills");
  return {
    id: textOf(s, r, "purchase_id"),
    billNo: textOf(s, r, "bill_no"),
    supplier: firms.get(textOf(s, r, "supplier_id")) ?? NO_FIRM,
    date: refTo(label, s, r, "bill_date"),
    lines: refTo(label, s, r, "lines"),
    total: refTo(label, s, r, "total"),
  };
}

/** The month's bills; `on`: the page's own transaction, when the page reads more than this. */
export async function loadBills(session: Session, on?: Client): Promise<BillsPage> {
  const v = on ? await viewBills(on, session) : await page(session, (c) => viewBills(c, session));
  const m = me(v.viewer);
  const firms = suppliers(v.firms);
  const snap = stored(v.bills);
  return {
    shop: m.shop,
    member: m.member,
    asOf: v.asOf,
    snapshots: [snap],
    bills: snap.rows.map((_, r) => billRow(snap, r, firms)),
    canRecord: m.mayRun.has("purchase.record"),
  };
}

/** One live bill of this shop, or null (no such id here, or reversed). `recorded`: the request came from recording it. */
export async function loadBill(session: Session, purchaseId: string, recorded: boolean): Promise<BillPage | null> {
  if (!UUID.test(purchaseId)) return null;
  const v = await page(session, (c) => viewBill(c, session, purchaseId));
  if (!v) return null;
  const m = me(v.viewer);
  const firms = suppliers(v.firms);
  const [billSnap, linesSnap] = [stored(v.bill), stored(v.lines)];
  const r = billSnap.rows.findIndex((_, i) => textOf(billSnap, i, "purchase_id") === purchaseId);
  if (r < 0) return null; // reversed between the two reads
  const bill = billRow(billSnap, r, firms);
  const thisBill = supplierBill(bill.supplier);
  const earlier = words("labelEarlierBills");

  const shown: BillLine[] = [];
  const rises: Finding[] = [];
  linesSnap.rows.forEach((row, at) => {
    const cost = row.unit_cost;
    const before = row.prev_unit_cost;
    // Compared, never subtracted: the rise is shown as the two cells.
    const rise = cost?.t === "money" && before?.t === "money" && before.currency === cost.currency && cost.minor > before.minor;
    const item = textOf(linesSnap, at, "item");
    shown.push({ item, qty: refTo(thisBill, linesSnap, at, "qty"), cost: refTo(thisBill, linesSnap, at, "unit_cost"), rise });
    if (rise) {
      rises.push({
        kind: "price_rise",
        id: textOf(linesSnap, at, "line_id"),
        item,
        supplier: bill.supplier,
        was: refTo(earlier, linesSnap, at, "prev_unit_cost"),
        now: refTo(thisBill, linesSnap, at, "unit_cost"),
      });
    }
  });
  return {
    shop: m.shop,
    member: m.member,
    snapshots: [billSnap, linesSnap],
    bill,
    lines: shown,
    rises,
    entered: { by: v.entered.by, at: v.entered.at.toISOString() },
    justRecorded: recorded && v.entered.createdBy === session.memberId,
  };
}

export async function loadBillForm(session: Session): Promise<BillFormData> {
  const v = await page(session, (c) => viewBillForm(c, session));
  const m = me(v.viewer);
  return {
    shop: m.shop,
    member: m.member,
    asOf: v.asOf,
    canRecord: m.mayRun.has("purchase.record"),
    suppliers: [...suppliers(v.firms)].map(([id, s]) => ({ id, ...s })),
    items: v.items.map(({ id, name, unit, category }) => ({ id, name, unit, category })),
  };
}

/** The item's latest bill line (purchases.last_price), minted now: what a typed price is compared with on the form. */
export async function lastPriceFor(session: Session, itemId: string): Promise<LastPrice> {
  const v = await page(session, (c) => viewLastPrice(c, itemId));
  const snap = stored(v.price);
  if (!snap.rows.length) return { snapshot: null, cost: null };
  const firm = suppliers(v.firms).get(textOf(snap, 0, "supplier_id")) ?? NO_FIRM;
  return { snapshot: snap, cost: refTo(supplierBill(firm), snap, 0, "unit_cost") };
}
