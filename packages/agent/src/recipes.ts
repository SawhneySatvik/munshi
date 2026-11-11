// Recipes: a finding becomes a draft by a fixed mapping, one function per kind, run when a person taps
// "Draft the fix" — never by a model. Each builds a payload whose every number is a cell of the finding's row or of an
// undated current-state read it mints now (so the approval's re-check sees today's books), maps each number to that
// cell by its JSON path (payloadRefs), cites what it relied on (basedOn), and returns the draft for draftFix to propose.
// A figure the command shows rather than computes with (a reminder's amount) rides as a ref string, not a number. A kind
// with no recipe here is explained only.
import { type Cell, type CellRef, formatRef } from "@munshi/core/read";
import type { DraftProposal, FindingRow } from "./port.ts";

export type Read = (query: string, params: Record<string, unknown>) => Promise<{ snapshotId: string; rows: Record<string, Cell>[] }>;
export type NoFix = { none: "no_fix" | "no_supplier" | "no_recipient" };
/** What the person picked beside the tap, where a recipe offers a choice (Offer it: which recipient; overdue udhaar:
 * the reminder, or `fix: "paypal"` for a PayPal link, sandbox). */
export type Choice = { recipientId?: string; fix?: "paypal" };
export type Recipe = (f: FindingRow, read: Read, choice?: Choice) => Promise<Omit<DraftProposal, "findingId"> | NoFix>;

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

// Udhaar past due → one of two fixes, the person's pick: a reminder from the credit_due template (the default), or a
// PayPal payment link (sandbox: paypal.request, which core holds to one live link per customer). Either carries
// the customer's current credit.balance cell as a ref string (the payload holds no number) and cites the finding's
// overdue cell. A PayPal link asks only for a positive balance; PayPal holds and moves the money, never Munshi.
const creditFix: Recipe = async (f, read, choice) => {
  const customerId = txt(f.cells.customer_id);
  if (!customerId) return { none: "no_fix" };
  const balance = await read("credit.balance", { customer_id: customerId });
  if (!balance.rows[0]) return { none: "no_fix" };
  const figure = ref(balance.snapshotId, 0, "balance");
  const basedOn = [ref(f.snapshotId, f.row, "customer_id"), ref(f.snapshotId, f.row, "overdue"), figure];
  if (choice?.fix === "paypal") {
    const owed = balance.rows[0].balance;
    if (owed?.kind !== "money" || BigInt(owed.num) <= 0n) return { none: "no_fix" };
    return { command: "paypal.request", payload: { purpose: "credit", customerId, figure: formatRef(figure) }, payloadRefs: {}, basedOn };
  }
  return { command: "customer.remind", payload: { customerId, template: "credit_due", figure: formatRef(figure) }, payloadRefs: {}, basedOn };
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

// Stock expiring before it will sell → "Offer it": give what is at risk of the lot (the finding's at_risk cell) to a
// recipient, the one the person picked or else the first listed; every recipient is simulated. Cites the lot's finding
// row, the recipient's row and the item's current stock.on_hand (a sale before approval stales it). No recipient listed:
// no draft.
const offerIt: Recipe = async (f, read, choice) => {
  const lotId = txt(f.cells.lot_id);
  const itemId = txt(f.cells.item_id);
  const qty = num(f.cells.at_risk);
  if (!lotId || !itemId || !qty || qty <= 0) return { none: "no_fix" };
  const listed = await read("surplus.recipients", {});
  const want = choice?.recipientId;
  const at = want ? listed.rows.findIndex((r) => txt(r.id) === want) : 0;
  const recipientId = at >= 0 ? txt(listed.rows[at]?.id) : null;
  if (!recipientId) return { none: "no_recipient" };
  const held = await read("stock.on_hand", { item_id: itemId });
  if (!held.rows[0]) return { none: "no_fix" };
  const atRisk = ref(f.snapshotId, f.row, "at_risk");
  return {
    command: "surplus.give",
    payload: { lotId, itemId, qtyMilli: qty, recipientId },
    payloadRefs: { qtyMilli: atRisk },
    basedOn: [
      ...["lot_id", "item_id", "item", "expires_on"].map((col) => ref(f.snapshotId, f.row, col)),
      atRisk,
      ref(listed.snapshotId, at, "id"),
      ref(listed.snapshotId, at, "name"),
      ref(held.snapshotId, 0, "on_hand"),
    ],
  };
};

// PayPal reports a payment the books do not show → "record this payment": payment.record by PayPal, its amount
// and date the paypal.event cells of PayPal's stored notification (the amount is its cell, by value), its reference
// PayPal's invoice id, citing the customer's current balance so a payment recorded in between makes it stale. A link
// for an order still open records the order's advance instead (the payment names the order), citing the advance the
// order holds now; once the order is delivered or cancelled, the payment repays the customer's credit. Only a person's
// approval writes the payment. A notification in another currency, or one a live payment records,
// has no fix.
const recordPaypal: Recipe = async (f, read) => {
  const eventId = txt(f.cells.event_id);
  if (!eventId) return { none: "no_fix" };
  const ev = await read("paypal.event", { event_id: eventId });
  const row = ev.rows[0];
  const customerId = txt(row?.customer_id);
  const reference = txt(row?.reference);
  const at = row?.received_at;
  if (!row || !customerId || !reference || txt(row.recorded) !== "no" || txt(row.same_currency) !== "yes" || row.amount?.kind !== "money" || at?.kind !== "timestamp")
    return { none: "no_fix" };
  const paid = { direction: "in", method: "paypal", amountMinor: Number(row.amount.num), reference, paidAt: at.at };
  const cited = [ref(f.snapshotId, f.row, "event_id"), ref(ev.snapshotId, 0, "amount"), ref(ev.snapshotId, 0, "reference"), ref(ev.snapshotId, 0, "received_at")];
  const orderId = txt(row.order_id);
  const due = orderId ? await read("order.due", { order_id: orderId }) : null;
  if (orderId && due && txt(due.rows[0]?.open) === "yes") {
    return {
      command: "payment.record",
      payload: { orderId, ...paid },
      payloadRefs: { amountMinor: ref(ev.snapshotId, 0, "amount") },
      basedOn: [...cited, ref(ev.snapshotId, 0, "order_id"), ref(due.snapshotId, 0, "advance")],
    };
  }
  const balance = await read("credit.balance", { customer_id: customerId });
  if (!balance.rows[0]) return { none: "no_fix" };
  return {
    command: "payment.record",
    payload: { customerId, ...paid },
    payloadRefs: { amountMinor: ref(ev.snapshotId, 0, "amount") },
    basedOn: [...cited, ref(balance.snapshotId, 0, "balance")],
  };
};

export const RECIPES: Readonly<Record<string, Recipe>> = {
  shrinkage: reorder,
  overdue_credit: creditFix,
  package_expiry: packageFix,
  expiry: offerIt,
  paypal_unrecorded: recordPaypal,
};

/** The named reads each recipe mints: a person whose scope lacks any of them is not offered the fix. */
export const RECIPE_READS: Readonly<Record<string, readonly string[]>> = {
  shrinkage: ["purchases.last_price", "stock.on_hand"],
  overdue_credit: ["credit.balance"],
  package_expiry: ["package.balance"],
  expiry: ["surplus.recipients", "stock.on_hand"],
  paypal_unrecorded: ["paypal.event", "order.due", "credit.balance"],
};

/** The finding kinds with a recipe ("Draft the fix"); any other kind is explained only. */
export const RECIPE_KINDS: readonly string[] = Object.keys(RECIPES);

/** The commands a recipe may propose: the trace labels draftFix may write. */
export const RECIPE_COMMANDS = ["reorder.place", "customer.remind", "package.expire", "surplus.give", "paypal.request", "payment.record"] as const;

/** The kinds whose fix the person picks beside the tap: overdue udhaar offers a reminder or a PayPal link (sandbox). */
export const PAYPAL_FIX_KINDS: readonly string[] = ["overdue_credit"];

export { creditFix, recordPaypal };
