// Suppliers' bills (server only): the month's bills from bills.recent; one bill with its lines; the form's catalogue;
// and an item's last bill price. Each figure is a ref into a snapshot minted here as the signed-in member and read
// back as stored. A recorded bill's lines have no read of their own, so each line is the row of its item's
// purchases.price_history (the bill's date, ninety days back) whose line_id is that line; the row before it is the
// earlier bill a price rise is cited against.
import type { Session } from "@munshi/core";
import type { BillFormData, BillLine, BillPage, BillRow, BillsPage, LastPrice } from "../books";
import type { Finding, Snapshot, Supplier } from "../types";
import { asOfDate, me, mint, readOnly, recentBills, refTo, stored, supplierBill, suppliers, textOf, words } from "./ledger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HISTORY_DAYS = 90;

const someSupplier = (name: string): Supplier => ({ name: name.replace(/\s*\(simulated\)$/, ""), simulated: true });

/** Row `r` of a bills.recent snapshot. A supplier the books no longer show is labelled simulated, never real. */
export function billRow(s: Snapshot, r: number, firms: Map<string, Supplier>): BillRow {
  const label = words("labelPurchaseBills");
  return {
    id: textOf(s, r, "purchase_id"),
    billNo: textOf(s, r, "bill_no"),
    supplier: firms.get(textOf(s, r, "supplier_id")) ?? someSupplier(textOf(s, r, "supplier")),
    date: refTo(label, s, r, "bill_date"),
    lines: refTo(label, s, r, "lines"),
    total: refTo(label, s, r, "total"),
  };
}

export async function loadBills(session: Session): Promise<BillsPage> {
  const { m, asOf, firms } = await readOnly(session, async (c) => {
    const m = await me(c, session);
    return { m, asOf: await asOfDate(c, m.timeZone), firms: await suppliers(c) };
  });
  const id = await mint(session, "bills.recent", recentBills(asOf));
  const [snap] = (await readOnly(session, (c) => stored(c, [id]))) as [Snapshot];
  return {
    shop: m.shop,
    member: m.member,
    asOf,
    snapshots: [snap],
    bills: snap.rows.map((_, r) => billRow(snap, r, firms)),
    canRecord: m.mayRun.has("purchase.record"),
  };
}

/** One live bill of this shop, or null (no such id here, or reversed). `recorded`: the request came from recording it. */
export async function loadBill(session: Session, purchaseId: string, recorded: boolean): Promise<BillPage | null> {
  if (!UUID.test(purchaseId)) return null;
  const found = await readOnly(session, async (c) => {
    const { rows } = await c.query<{ bill_date: string; created_by: string; by: string; at: Date }>(
      `select p.bill_date::text as bill_date, p.created_by::text as created_by, m.name as by, p.created_at as at
         from books.purchase p join ops.member m on m.tenant_id = p.tenant_id and m.id = p.created_by
        where p.id = $1 and p.reverses_id is null`,
      [purchaseId],
    );
    const p = rows[0];
    if (!p) return null;
    const { rows: lines } = await c.query<{ id: string; item_id: string }>(
      "select id::text, item_id::text from books.purchase_line where purchase_id = $1 order by line_no",
      [purchaseId],
    );
    return { p, lines, m: await me(c, session), firms: await suppliers(c) };
  });
  if (!found) return null;
  const { p, lines, m, firms } = found;

  const billId = await mint(session, "bills.recent", { days: 1, as_of: p.bill_date });
  const items = [...new Set(lines.map((l) => l.item_id))];
  const histIds = await Promise.all(items.map((item) => mint(session, "purchases.price_history", { item_id: item, days: HISTORY_DAYS, as_of: p.bill_date })));
  const snaps = await readOnly(session, (c) => stored(c, [billId, ...histIds]));
  const [billSnap, ...hists] = snaps as [Snapshot, ...Snapshot[]];
  const r = billSnap.rows.findIndex((_, i) => textOf(billSnap, i, "purchase_id") === purchaseId);
  if (r < 0) return null; // reversed between the two reads
  const bill = billRow(billSnap, r, firms);
  const thisBill = supplierBill(bill.supplier);
  const earlier = words("labelEarlierBills");

  const shown: BillLine[] = [];
  const rises: Finding[] = [];
  for (const line of lines) {
    const hist = hists[items.indexOf(line.item_id)] as Snapshot;
    const at = hist.rows.findIndex((_, i) => textOf(hist, i, "line_id") === line.id);
    if (at < 0) continue; // outside the read's window: not shown rather than shown without a cell
    const cost = hist.rows[at]?.unit_cost;
    const before = at > 0 ? hist.rows[at - 1]?.unit_cost : undefined;
    // Compared, never subtracted: the rise is shown as the two cells.
    const rise = cost?.t === "money" && before?.t === "money" && before.currency === cost.currency && cost.minor > before.minor;
    shown.push({ item: textOf(hist, at, "item"), qty: refTo(thisBill, hist, at, "qty"), cost: refTo(thisBill, hist, at, "unit_cost"), rise });
    if (rise) {
      rises.push({
        kind: "price_rise",
        id: line.id,
        item: textOf(hist, at, "item"),
        supplier: bill.supplier,
        was: refTo(earlier, hist, at - 1, "unit_cost"),
        now: refTo(thisBill, hist, at, "unit_cost"),
      });
    }
  }
  return {
    shop: m.shop,
    member: m.member,
    snapshots: snaps,
    bill,
    lines: shown,
    rises,
    entered: { by: p.by, at: p.at.toISOString() },
    justRecorded: recorded && p.created_by === session.memberId,
  };
}

export async function loadBillForm(session: Session): Promise<BillFormData> {
  return readOnly(session, async (c) => {
    const m = await me(c, session);
    const firms = await suppliers(c);
    const { rows: items } = await c.query<{ id: string; name: string; unit: string; category: string }>(
      "select id::text, name, unit, coalesce(category, '') as category from books.item order by category, name, id",
    );
    return {
      shop: m.shop,
      member: m.member,
      asOf: await asOfDate(c, m.timeZone),
      canRecord: m.mayRun.has("purchase.record"),
      suppliers: [...firms].map(([id, s]) => ({ id, ...s })),
      items,
    };
  });
}

/** The item's latest bill line (purchases.last_price), minted now: what a typed price is compared with on the form. */
export async function lastPriceFor(session: Session, itemId: string): Promise<LastPrice> {
  const id = await mint(session, "purchases.last_price", { item_id: itemId });
  const { snap, firms } = await readOnly(session, async (c) => ({ snap: (await stored(c, [id]))[0] as Snapshot, firms: await suppliers(c) }));
  if (!snap.rows.length) return { snapshot: null, cost: null };
  const firm = firms.get(textOf(snap, 0, "supplier_id")) ?? someSupplier(textOf(snap, 0, "supplier"));
  return { snapshot: snap, cost: refTo(supplierBill(firm), snap, 0, "unit_cost") };
}
