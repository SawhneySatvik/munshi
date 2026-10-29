// Recipes (BLUEPRINT §7.5): a finding becomes a draft by a fixed mapping, one function per kind, run when a person taps
// "Draft the fix" — never by a model. Each builds a payload whose every number is a cell of the finding's row or of an
// undated current-state read it mints now (so the approval's re-check sees today's books), maps each number to that
// cell by its JSON path (payloadRefs), cites what it relied on (basedOn), and returns the draft for draftFix to propose.
// A figure the command shows rather than computes with (a reminder's amount) rides as a ref string, not a number. A kind
// with no recipe here is explained only.
import { type Cell, type CellRef, formatRef } from "@munshi/core/read";
import type { DraftProposal, FindingRow } from "./port.ts";

export type Read = (query: string, params: Record<string, unknown>) => Promise<{ snapshotId: string; rows: Record<string, Cell>[] }>;
export type NoFix = { none: "no_fix" | "no_supplier" };
export type Recipe = (f: FindingRow, read: Read) => Promise<Omit<DraftProposal, "findingId"> | NoFix>;

const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
const num = (c: Cell | undefined) => (c && (c.kind === "integer" || c.kind === "money" || c.kind === "quantity") ? Number(c.num) : null);
const txt = (c: Cell | undefined) => (c?.kind === "text" ? c.txt : null);

// A shelf short of the books → reorder the item's usual quantity (its latest bill line) from that bill's supplier
// (simulated); cites the shortfall and the item's current stock.on_hand.
const reorder: Recipe = async (f, read) => {
  const itemId = txt(f.cells.item_id);
  if (!itemId) return { none: "no_fix" };
  const last = await read("purchases.last_price", { item_id: itemId });
  const held = await read("stock.on_hand", { item_id: itemId });
  const supplierId = txt(last.rows[0]?.supplier_id);
  const qty = num(last.rows[0]?.qty);
  if (!supplierId || !qty || qty <= 0 || !held.rows[0]) return { none: "no_supplier" };
  return {
    command: "reorder.place",
    payload: { supplierId, lines: [{ itemId, qtyMilli: qty }] },
    payloadRefs: { "lines[0].qtyMilli": ref(last.snapshotId, 0, "qty") },
    basedOn: [
      ...["item_id", "item", "missing"].map((col) => ref(f.snapshotId, f.row, col)),
      ...["supplier_id", "qty"].map((col) => ref(last.snapshotId, 0, col)),
      ref(held.snapshotId, 0, "on_hand"),
    ],
  };
};

// Udhaar past due → a reminder from the credit_due template; its figure is the customer's current credit.balance cell.
const remindCredit: Recipe = async (f, read) => {
  const customerId = txt(f.cells.customer_id);
  if (!customerId) return { none: "no_fix" };
  const balance = await read("credit.balance", { customer_id: customerId });
  if (!balance.rows[0]) return { none: "no_fix" };
  const figure = ref(balance.snapshotId, 0, "balance");
  return {
    command: "customer.remind",
    payload: { customerId, template: "credit_due", figure: formatRef(figure) },
    payloadRefs: {},
    basedOn: [ref(f.snapshotId, f.row, "customer_id"), ref(f.snapshotId, f.row, "overdue"), figure],
  };
};

// A package lapsing with value left → before its expiry date a reminder (package_expiring) whose figure is the value
// left; after it, package.expire, which clears the liability. Both cite the holding's current package.balance cell, so a
// redemption in between makes the draft stale.
const packageFix: Recipe = async (f, read) => {
  const holdingId = txt(f.cells.holding_id);
  const customerId = txt(f.cells.customer_id);
  const daysLeft = num(f.cells.days_left);
  if (!holdingId || !customerId || daysLeft === null) return { none: "no_fix" };
  const balance = await read("package.balance", { holding_id: holdingId });
  if (!balance.rows[0]) return { none: "no_fix" };
  const left = ref(balance.snapshotId, 0, "value_left");
  const basedOn = [ref(f.snapshotId, f.row, "holding_id"), ref(f.snapshotId, f.row, "value_left"), ref(f.snapshotId, f.row, "expires_on"), left];
  return daysLeft >= 0
    ? { command: "customer.remind", payload: { customerId, template: "package_expiring", figure: formatRef(left) }, payloadRefs: {}, basedOn }
    : { command: "package.expire", payload: { holdingId }, payloadRefs: {}, basedOn };
};

export const RECIPES: Readonly<Record<string, Recipe>> = { shrinkage: reorder, overdue_credit: remindCredit, package_expiry: packageFix };

/** The commands a recipe may propose: the trace labels draftFix may write. */
export const RECIPE_COMMANDS = ["reorder.place", "customer.remind", "package.expire"] as const;
