// The suppliers page (server only). The reorder drafts and the price-rise findings are the home's own (core's viewHome,
// read in this page's transaction: the same drafts, payload refs checked against their cells, stamps from the audit
// log, offered only to a role that holds the command). Each supplier's last bill comes from bills.recent, and the last
// price of every item on that bill from purchases.last_prices (one read for the whole catalogue), all minted by core's
// viewSuppliers as the signed-in member. Null for a role suppliers are not for (core's map, D-082): the page's 404.
import { type Session, viewSuppliers } from "@munshi/core";
import type { SuppliersPage, SupplierCard } from "../books";
import { billRow } from "./bills";
import { homeOf } from "./home";
import { me, page, refTo, stored, supplierBill, suppliers, textOf } from "./ledger";

export async function loadSuppliers(session: Session): Promise<SuppliersPage | null> {
  const v = await page(session, (c) => viewSuppliers(c, session));
  if (!v) return null;
  const home = homeOf(v.home);
  const m = me(v.viewer);
  const firms = suppliers(v.firms);
  const bills = stored(v.bills);
  // bills.recent is newest first: each supplier's first row is its last bill.
  const last = new Map<string, number>();
  bills.rows.forEach((_, r) => {
    const firm = textOf(bills, r, "supplier_id");
    if (!last.has(firm)) last.set(firm, r);
  });
  const prices = stored(v.prices);
  const priceRow = (itemId: string) => prices.rows.findIndex((_, r) => textOf(prices, r, "item_id") === itemId);

  const cards: SupplierCard[] = [...firms].map(([id, supplier]) => {
    const r = last.get(id);
    const lastBill = r === undefined ? null : billRow(bills, r, firms);
    const label = supplierBill(supplier);
    return {
      id,
      supplier,
      lastBill,
      prices: v.onBill
        .filter((l) => l.purchaseId === lastBill?.id)
        .flatMap((l) => {
          const r = priceRow(l.itemId);
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
