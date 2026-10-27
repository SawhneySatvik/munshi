// The suppliers page (server only). The reorder drafts and the price-rise findings are the home's own (loadHome: the
// same drafts, payload refs checked against their cells, stamps from the audit log, offered only to a role that holds
// the command). Each supplier's last bill comes from bills.recent, and the last price of every item on that bill from
// purchases.last_prices (one read for the whole catalogue), all minted as the signed-in member.
import type { Session } from "@munshi/core";
import type { SuppliersPage, SupplierCard } from "../books";
import type { Snapshot } from "../types";
import { billRow } from "./bills";
import { loadHome } from "./home";
import { asOfDate, me, mint, readOnly, recentBills, refTo, stored, supplierBill, suppliers, textOf } from "./ledger";

export async function loadSuppliers(session: Session): Promise<SuppliersPage> {
  const home = await loadHome(session);
  const { m, asOf, firms } = await readOnly(session, async (c) => {
    const m = await me(c, session);
    return { m, asOf: await asOfDate(c, m.timeZone), firms: await suppliers(c) };
  });
  const billsId = await mint(session, "bills.recent", recentBills(asOf));
  const [bills] = (await readOnly(session, (c) => stored(c, [billsId]))) as [Snapshot];
  // bills.recent is newest first: each supplier's first row is its last bill.
  const last = new Map<string, number>();
  bills.rows.forEach((_, r) => {
    const firm = textOf(bills, r, "supplier_id");
    if (!last.has(firm)) last.set(firm, r);
  });
  const lastBills = [...last.values()].map((r) => textOf(bills, r, "purchase_id"));
  const onBill = await readOnly(session, async (c) => {
    const { rows } = await c.query<{ purchase_id: string; item_id: string }>(
      "select purchase_id::text, item_id::text from books.purchase_line where purchase_id = any($1::uuid[]) order by purchase_id, line_no",
      [lastBills],
    );
    return rows;
  });
  const pricesId = await mint(session, "purchases.last_prices", {});
  const [prices] = (await readOnly(session, (c) => stored(c, [pricesId]))) as [Snapshot];
  const priceRow = (itemId: string) => prices.rows.findIndex((_, r) => textOf(prices, r, "item_id") === itemId);

  const cards: SupplierCard[] = [...firms].map(([id, supplier]) => {
    const r = last.get(id);
    const lastBill = r === undefined ? null : billRow(bills, r, firms);
    const label = supplierBill(supplier);
    return {
      id,
      supplier,
      lastBill,
      prices: onBill
        .filter((l) => l.purchase_id === lastBill?.id)
        .flatMap((l) => {
          const r = priceRow(l.item_id);
          // The item's last price is this supplier's only while its latest bill line is theirs.
          if (r < 0 || textOf(prices, r, "supplier_id") !== id) return [];
          return [{ item: textOf(prices, r, "item"), cost: refTo(label, prices, r, "unit_cost") }];
        }),
    };
  });
  return {
    shop: m.shop,
    member: m.member,
    snapshots: [...home.snapshots, bills, prices],
    drafts: home.drafts,
    rises: home.findings.filter((f) => f.kind === "price_rise"),
    suppliers: cards,
  };
}
