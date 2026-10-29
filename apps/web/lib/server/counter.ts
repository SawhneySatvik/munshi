// The counter (server only). The page's figures: today's counter sales (sales.by_day), each a cell. The quick tiles are
// the best sellers of the last four weeks (sales.by_item), shown by name only. The bill's prices, amounts and total are
// cells of sale.quote; the receipt's are cells of sale.receipt, read after the commit with the customer's balance
// (credit.balances) and what is left of each item (stock.on_hand). sale.record re-derives every amount from the books.
// Core's counter views read and mint all of it, each page in one transaction.
import { type Session, viewCounter, viewQuote, viewReceipt } from "@munshi/core";
import { DICT } from "../i18n";
import { opsLabel } from "../i18n-ops";
import type { CounterPage, Quote, Receipt } from "../ops-types";
import type { Localized } from "../types";
import { frame, type Minted, minted, page, refTo, rowOf, textOf } from "./ops";

const both = (key: keyof typeof DICT.en): Localized => ({ en: DICT.en[key], hi: DICT.hi[key] });

export async function loadCounter(session: Session): Promise<CounterPage> {
  const v = await page(session, (c) => viewCounter(c, session));
  const floor = frame(v.viewer);
  const [day, best] = [minted(v.day), minted(v.best)];
  const sales = opsLabel("labelCounterSales");
  return {
    member: floor.member,
    shop: floor.shop,
    items: v.items,
    quick: best.cells.map((r) => textOf(r.item_id)).filter(Boolean),
    customers: v.customers,
    today: day.cells[0]
      ? { bills: refTo(day, 0, "bills", sales), total: refTo(day, 0, "total", sales), onCredit: refTo(day, 0, "on_credit", sales) }
      : null,
    snapshots: [day.snapshot],
    canSell: floor.may.has("sale.record"),
  };
}

/** The bill as the books would price it now: one sale.quote, every price, amount and the total a ref into it. */
export async function quoteBill(session: Session, key: string, lines: Array<{ itemId: string; qtyMilli: number }>): Promise<Quote> {
  const m = minted(await page(session, (c) => viewQuote(c, lines)));
  const label = opsLabel("labelPriceList");
  return {
    key,
    snapshot: m.snapshot,
    lines: m.cells.map((_, i) => ({ price: refTo(m, i, "unit_price", label), amount: refTo(m, i, "amount", label) })),
    total: m.cells[0] ? refTo(m, 0, "total", label) : null,
  };
}

/** The total of a quote as the books hold it (for the tender: cash or UPI pays exactly the quoted total). */
export async function quotedTotal(session: Session, lines: Array<{ itemId: string; qtyMilli: number }>): Promise<number | null> {
  const total = (await page(session, (c) => viewQuote(c, lines))).rows[0]?.total;
  return total?.kind === "money" ? Number(total.num) : null;
}

/** The receipt of a sale just recorded: its stamp, sale.receipt's cells, and the figures it moved, each minted after the commit. */
export async function receiptOf(
  session: Session,
  saleId: string,
  customerId: string | null,
  itemIds: string[],
  tender: "cash" | "upi" | "credit",
): Promise<Receipt> {
  const v = await page(session, (c) => viewReceipt(c, session, saleId, customerId, itemIds));
  const [sale, balances] = [minted(v.sale), v.balances ? minted(v.balances) : null];
  const onHand = v.onHand.map(minted);
  const owesRow = balances && customerId ? rowOf(balances, "customer_id", customerId) : -1;
  const stock = both("labelStockLedger");
  const label = opsLabel("labelReceipt");
  const sold = sale.cells[0]?.sold_at;
  const itemOn = new Map([...new Set(itemIds)].map((id, i) => [id, onHand[i] as Minted]));
  return {
    customer: v.customer,
    by: v.stamp.by,
    at: sold?.kind === "timestamp" ? sold.at : v.stamp.at,
    tender,
    paid: refTo(sale, 0, tender === "credit" ? "on_credit" : tender, label),
    total: refTo(sale, 0, "total", label),
    lines: sale.cells.map((r, i) => {
      const m = itemOn.get(itemIds[i] as string) as Minted;
      return {
        item: textOf(r.item),
        qty: refTo(sale, i, "qty", label),
        price: refTo(sale, i, "unit_price", label),
        amount: refTo(sale, i, "amount", label),
        left: m.cells[0] ? refTo(m, 0, "on_hand", stock) : null,
      };
    }),
    owes: balances && owesRow >= 0 ? refTo(balances, owesRow, "balance", both("labelCreditBook")) : null,
    snapshots: [sale.snapshot, ...(balances ? [balances.snapshot] : []), ...onHand.map((m) => m.snapshot)],
  };
}
