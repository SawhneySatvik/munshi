// Suppliers' bills (server only): the month's bills from bills.recent; one bill with its lines; the form's catalogue;
// and an item's last bill price. Each figure is a ref into a snapshot minted here as the signed-in member and read
// back as stored. A recorded bill's lines are the rows of bill.lines_for, each with the unit cost of the same item on the
// bill before it, which a price rise is cited against.
import type { Session } from "@munshi/core";
import type { BillFormData, BillLine, BillPage, BillRow, BillsPage, LastPrice } from "../books";
import type { Finding, Snapshot, Supplier } from "../types";
import { asOfDate, me, mint, readOnly, recentBills, refTo, stored, supplierBill, suppliers, textOf, words } from "./ledger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    return p ? { p, m: await me(c, session), firms: await suppliers(c) } : null;
  });
  if (!found) return null;
  const { p, m, firms } = found;

  const [billId, linesId] = await Promise.all([
    mint(session, "bills.recent", { days: 1, as_of: p.bill_date }),
    mint(session, "bill.lines_for", { purchase_id: purchaseId }),
  ]);
  const snaps = await readOnly(session, (c) => stored(c, [billId, linesId]));
  const [billSnap, linesSnap] = snaps as [Snapshot, Snapshot];
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
