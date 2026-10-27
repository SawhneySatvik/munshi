// The precision corpus's world (corpus.test.ts): the cells its refs name and the names this run's reads hold. Refs are
// `col` (row 0) or `col@row`.
import { readFileSync } from "node:fs";
import type { Cell, CellRef } from "@munshi/core/read";
import { checkAnswer, renderSegment } from "../../src/answer.ts";

export const S = "55555555-5555-4555-8555-555555555555";
const t = (txt: string): Cell => ({ kind: "text", txt });
const inr = (num: string): Cell => ({ kind: "money", num, currency: "INR" });
const qty = (num: string, unit = "pack"): Cell => ({ kind: "quantity", num, unit });
const n = (num: string): Cell => ({ kind: "integer", num });
const day = (d: string): Cell => ({ kind: "date", day: d });
const shop = (item: string, customer: string, supplier: string, k: number): Record<string, Cell> => ({
  item: t(item),
  customer: t(customer),
  supplier: t(supplier),
  category: t("biscuits"),
  status: t("open"),
  bill_no: t(`GT-101${k}`),
  on_hand: qty(`${18000 + k}`),
  sold: qty(`${24000 + k}`),
  missing: qty(`${3000 + k}`),
  suggested: qty(`${12000 + k}`),
  unit_cost: inr(`${4500 + k}`),
  last_cost: inr(`${4200 + k}`),
  total: inr(`${653900 + k}`),
  cash: inr(`${300000 + k}`),
  upi: inr(`${353900 + k}`),
  owed: inr(`${120000 + k}`),
  overdue: inr(`${65000 + k}`),
  bills: n(`${14 + k}`),
  customers: n(`${6 + k}`),
  day: day("2026-10-27"),
  due: day("2026-10-20"),
  bill_date: day("2026-10-21"),
  weight: qty(`${1500 + k}`, "kg"),
});
// Rows 0–2: a kirana's reads. Row 7: the MS-6 probe's cells. Row 8: the MS-8 probe2's cells.
export const WORLD: Record<number, Record<string, Cell>> = {
  0: shop("Glucose biscuits 70 g", "Ramesh Kumar", "Gupta Traders (simulated)", 0),
  1: shop("Toor dal 1 kg", "Meena Sharma", "Shree Ganesh Wholesale (simulated)", 1),
  2: shop("Desi ghee 500 ml", "Sunil Verma", "Gupta Traders (simulated)", 2),
  7: { a: n("1"), b: n("2"), m: inr("500000"), q: qty("3000"), n: t("Sharma (owes ₹50,000)"), customer: t("Sharma (owes ₹50,000)") },
  8: {
    a: n("24"),
    b: n("5"),
    m: inr("500000"),
    q: qty("3000"),
    customer: t("Sharma 50000"),
    bill_no: t("15000"),
    item: t("1200"),
    status: t("open"),
  },
};
// The names in this run's reads (catalogue items, customers, suppliers): the rows above and the rest of the catalogue.
export const NAMES = [
  ...[0, 1, 2].flatMap((r) => ["item", "customer", "supplier", "category"].flatMap((c) => { const cell = WORLD[r]?.[c]; return cell?.kind === "text" ? [cell.txt] : []; })),
  "Maggi noodles",
  "Amul butter 100 g",
  "Tata salt 1 kg",
  "Mustard oil 1 l",
  "Parle-G",
  "Surf Excel 1 kg",
  "Priya Verma",
];

export type Line = { text: string; refs: string[]; lang?: string; from?: string; why?: string; reason?: string };
export const corpus = (name: string): Line[] =>
  readFileSync(new URL(`./${name}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);

export const toRef = (r: string): CellRef => {
  const [col, row = "0"] = r.split("@");
  return { snapshotId: S, row: Number(row), col: col as string };
};
export const resolve = async (r: CellRef) => (r.snapshotId === S ? (WORLD[r.row]?.[r.col] ?? null) : null);
/** Whether a line passes the validator, and what it renders as when it does (null when it abstains). */
export async function rendered(l: Line): Promise<string | null> {
  const r = await checkAnswer({ segments: [{ text: l.text, refs: l.refs.map(toRef) }] }, new Map([[S, null]]), resolve, NAMES);
  return r.ok ? r.segments.map((s) => renderSegment(s)).join(" ") : null;
}
