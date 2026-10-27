// Stock (server only): what the books hold for every item (items.list) and what is running low (stock.below_reorder:
// under a week of cover at the last four weeks' sales), each figure a cell. A low item is highlighted where its id
// appears in the low read; nothing is computed from the figures.
import type { Session } from "@munshi/core";
import { DICT } from "../i18n";
import { opsLabel } from "../i18n-ops";
import type { StockPage } from "../ops-types";
import type { Localized, Supplier } from "../types";
import { floorOf, mint, readOnly, refTo, supplierName, textOf } from "./ops";

export const stockLedger = (): Localized => ({ en: DICT.en.labelStockLedger, hi: DICT.hi.labelStockLedger });

export async function loadStock(session: Session): Promise<StockPage> {
  const floor = await floorOf(session);
  const [list, low] = await Promise.all([mint(session, "items.list", {}), mint(session, "stock.below_reorder", { as_of: floor.today })]);
  const supplierIds = [...new Set(low.cells.map((r) => textOf(r.supplier_id)).filter(Boolean))];
  const suppliers = await readOnly(session, async (c) => {
    const { rows } = await c.query<{ id: string; name: string; is_simulated: boolean }>(
      "select id::text, name, is_simulated from books.supplier where id = any($1::uuid[])",
      [supplierIds],
    );
    return new Map<string, Supplier>(rows.map((s) => [s.id, { name: supplierName(s.name, s.is_simulated), simulated: s.is_simulated }]));
  });
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
  const m = await mint(session, "stock.on_hand", { item_id: itemId });
  return { onHand: m.cells[0] ? refTo(m, 0, "on_hand", stockLedger()) : null, item: textOf(m.cells[0]?.item), snapshots: [m.snapshot] };
}
