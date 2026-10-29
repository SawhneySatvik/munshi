// Stock (server only): what the books hold for every item (items.list) and what is running low (stock.below_reorder:
// under a week of cover at the last four weeks' sales), each figure a cell minted by core's viewStock in the page's one
// transaction. A low item is highlighted where its id appears in the low read; nothing is computed from the figures.
import { type Session, viewOnHand, viewStock } from "@munshi/core";
import { DICT } from "../i18n";
import { opsLabel } from "../i18n-ops";
import type { StockPage } from "../ops-types";
import type { Localized, Supplier } from "../types";
import { frame, minted, page, refTo, supplierName, textOf } from "./ops";

export const stockLedger = (): Localized => ({ en: DICT.en.labelStockLedger, hi: DICT.hi.labelStockLedger });

export async function loadStock(session: Session): Promise<StockPage> {
  const v = await page(session, (c) => viewStock(c, session));
  const floor = frame(v.viewer);
  const [list, low] = [minted(v.list), minted(v.low)];
  const suppliers = new Map<string, Supplier>(v.firms.map((s) => [s.id, { name: supplierName(s.name, s.simulated), simulated: s.simulated }]));
  const lowIds = new Set(low.cells.map((r) => textOf(r.item_id)));
  const ledger = stockLedger();
  const sales = opsLabel("labelRecentSales");
  return {
    member: floor.member,
    shop: floor.shop,
    items: list.cells.map((r, i) => {
      const onHand = r.on_hand;
      return {
        id: textOf(r.item_id),
        name: textOf(r.item),
        unit: onHand?.kind === "quantity" ? onHand.unit : "",
        onHand: refTo(list, i, "on_hand", ledger),
        low: lowIds.has(textOf(r.item_id)),
      };
    }),
    low: low.cells.map((r, i) => ({
      id: textOf(r.item_id),
      name: textOf(r.item),
      onHand: refTo(low, i, "on_hand", ledger),
      cover: refTo(low, i, "days_cover", sales),
      suggested: refTo(low, i, "suggested", sales),
      supplier: suppliers.get(textOf(r.supplier_id)) ?? null,
    })),
    snapshots: [list.snapshot, low.snapshot],
    canCount: floor.may.has("stock.count"),
    canWaste: floor.may.has("stock.waste"),
  };
}

/** An item's on-hand read after a write (stock.on_hand). */
export async function onHandAfter(session: Session, itemId: string) {
  const m = minted(await page(session, (c) => viewOnHand(c, itemId)));
  return { onHand: m.cells[0] ? refTo(m, 0, "on_hand", stockLedger()) : null, item: textOf(m.cells[0]?.item), snapshots: [m.snapshot] };
}
