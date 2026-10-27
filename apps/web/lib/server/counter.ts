// The counter (server only). The page's figures: today's counter sales (sales.by_day), each a cell. The quick tiles are
// the best sellers of the last four weeks (sales.by_item), shown by name only. There is no named read of selling
// prices or of one sale, so neither the bill's amounts nor its total can be a cell: the page says "Cannot verify", and
// a sale is recorded on a customer's credit (sale.record re-derives the amount from the books' prices). The receipt's
// figures are read after the commit: the customer's balance (credit.balances) and what is left of each item
// (stock.on_hand).
import { addDays, type Session } from "@munshi/core";
import { DICT } from "../i18n";
import { opsLabel } from "../i18n-ops";
import type { CounterPage, Named, Receipt } from "../ops-types";
import type { Localized } from "../types";
import { floorOf, type Minted, mint, readOnly, refTo, rowOf, stampOf, textOf } from "./ops";

const QUICK_TILES = 8;
const QUICK_DAYS = 28;
const both = (key: keyof typeof DICT.en): Localized => ({ en: DICT.en[key], hi: DICT.hi[key] });

export async function loadCounter(session: Session): Promise<CounterPage> {
  const floor = await floorOf(session);
  const [day, best] = await Promise.all([
    mint(session, "sales.by_day", { from: floor.today, to: floor.today }),
    mint(session, "sales.by_item", { from: addDays(floor.today, 1 - QUICK_DAYS), to: floor.today, limit: QUICK_TILES }),
  ]);
  const { items, customers } = await readOnly(session, async (c) => ({
    items: (await c.query<Named & { unit: string }>("select id::text as id, name, unit from books.item order by name, id")).rows,
    customers: (await c.query<Named>("select id::text as id, name from books.customer order by name, id")).rows,
  }));
  const sales = opsLabel("labelCounterSales");
  return {
    member: floor.member,
    shop: floor.shop,
    items,
    quick: best.cells.map((r) => textOf(r.item_id)).filter(Boolean),
    customers,
    today: day.cells[0]
      ? { bills: refTo(day, 0, "bills", sales), total: refTo(day, 0, "total", sales), onCredit: refTo(day, 0, "on_credit", sales) }
      : null,
    snapshots: [day.snapshot],
    canSell: floor.may.has("sale.record"),
  };
}

/** The receipt of a sale just recorded: its stamp, and the figures it moved, each minted after the commit. */
export async function receiptOf(session: Session, saleId: string, customerId: string, itemIds: string[]): Promise<Receipt> {
  const floor = await floorOf(session);
  const distinct = [...new Set(itemIds)];
  const [stamp, balances, onHand] = await Promise.all([
    stampOf(session, "books.sale", saleId),
    mint(session, "credit.balances", { as_of: floor.today }),
    Promise.all(distinct.map((id) => mint(session, "stock.on_hand", { item_id: id }))),
  ]);
  const names = await readOnly(session, async (c) => {
    const { rows } = await c.query<Named>(
      "select id::text as id, name from books.item where id = any($1::uuid[]) union all select id::text, name from books.customer where id = $2",
      [distinct, customerId],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  });
  const owesRow = rowOf(balances, "customer_id", customerId);
  const stock = both("labelStockLedger");
  return {
    customer: names.get(customerId) ?? "",
    by: stamp.by,
    at: stamp.at,
    lines: distinct.map((id, i) => {
      const m = onHand[i] as Minted;
      return { item: names.get(id) ?? "", left: m.cells[0] ? refTo(m, 0, "on_hand", stock) : null };
    }),
    owes: owesRow >= 0 ? refTo(balances, owesRow, "balance", both("labelCreditBook")) : null,
    snapshots: [balances.snapshot, ...onHand.map((m) => m.snapshot)],
  };
}
