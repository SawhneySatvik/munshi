// The stock list as the grid's base: each row from the items.list snapshot, the on-hand figure keeping the ref of the
// snapshot cell it came from. The page's StockRow carries only on-hand; the item, category and unit are read from the
// stored snapshot row itself.
import type { StockPage } from "../ops-types";
import type { CellValue } from "../types";
import type { ColumnDef } from "./columns";
import { type BaseRow, createStore, type Store } from "./store";

const text = (c: CellValue | undefined) => (c?.t === "text" ? c.v : "");

export function stockStore(data: StockPage): Store {
  const first = data.items[0]?.onHand;
  const snapshot = data.snapshots.find((s) => s.id === first?.snapshotId);
  const units = [...new Set(data.items.map((i) => i.unit).filter(Boolean))];
  const columns: ColumnDef[] = [
    { key: "item", kind: "text", label: { en: "Item", hi: "वस्तु" }, readOnly: true, required: true },
    { key: "category", kind: "text", label: { en: "Category", hi: "श्रेणी" }, readOnly: true },
    { key: "unit", kind: "choice", label: { en: "Unit", hi: "इकाई" }, readOnly: true, required: true, options: units },
    { key: "on_hand", kind: "qty", label: { en: "On hand", hi: "हाथ में" }, required: true },
  ];
  const base: BaseRow[] = data.items.flatMap((item) => {
    const row = snapshot?.rows[item.onHand.row - 1];
    const onHand = row?.on_hand;
    if (!row || onHand?.t !== "qty") return [];
    return [
      {
        key: item.id,
        cells: {
          item: { value: { t: "text", v: item.name }, ref: null },
          category: { value: { t: "text", v: text(row.category) }, ref: null },
          unit: { value: { t: "text", v: onHand.unit }, ref: null },
          on_hand: { value: onHand, ref: item.onHand },
        },
      },
    ];
  });
  return createStore(first?.snapshotId ?? "", columns, base);
}
