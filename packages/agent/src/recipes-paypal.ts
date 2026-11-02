// PayPal's recipes (D-079, sandbox), beside recipes.ts so a lane edits only its own: fixed mappings from a finding to a
// draft, run when a person taps "Draft the fix", never by a model. The agent has no write path and no PayPal key: a
// recipe only builds a proposal for core to check, and a person approves it.
//   overdue_credit → paypal.request: "Send a PayPal link to <customer> for <balance>", the figure the customer's current
//                    credit.balance cell (a ref string, so the payload holds no number). recipes.ts maps overdue_credit
//                    to the reminder; this is the second fix for the same finding (PAYPAL_LINK_RECIPE).
//   paypal_unrecorded → payment.record: "Record this payment" by PayPal, its amount and date the paypal.event cells of
//                    PayPal's stored notification, citing the customer's current balance so a payment in between makes it
//                    stale. A notification in another currency has no fix here.
import { type Cell, type CellRef, formatRef } from "@munshi/core/read";
import type { Recipe } from "./recipes.ts";

const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
const txt = (c: Cell | undefined) => (c?.kind === "text" ? c.txt : null);

export const paypalLink: Recipe = async (f, read) => {
  const customerId = txt(f.cells.customer_id);
  if (!customerId) return { none: "no_fix" };
  const balance = await read("credit.balance", { customer_id: customerId });
  const owed = balance.rows[0]?.balance;
  if (owed?.kind !== "money" || BigInt(owed.num) <= 0n) return { none: "no_fix" };
  const figure = ref(balance.snapshotId, 0, "balance");
  return {
    command: "paypal.request",
    payload: { purpose: "credit", customerId, figure: formatRef(figure) },
    payloadRefs: {},
    basedOn: [ref(f.snapshotId, f.row, "customer_id"), ref(f.snapshotId, f.row, "overdue"), figure],
  };
};

export const recordPaypal: Recipe = async (f, read) => {
  const eventId = txt(f.cells.event_id);
  if (!eventId) return { none: "no_fix" };
  const ev = await read("paypal.event", { event_id: eventId });
  const row = ev.rows[0];
  const customerId = txt(row?.customer_id);
  const reference = txt(row?.reference);
  const at = row?.received_at;
  if (!row || !customerId || !reference || txt(row.recorded) !== "no" || txt(row.same_currency) !== "yes" || row.amount?.kind !== "money" || at?.kind !== "timestamp")
    return { none: "no_fix" };
  const balance = await read("credit.balance", { customer_id: customerId });
  if (!balance.rows[0]) return { none: "no_fix" };
  return {
    command: "payment.record",
    payload: { direction: "in", customerId, method: "paypal", amountMinor: Number(row.amount.num), reference, paidAt: at.at },
    payloadRefs: { amountMinor: ref(ev.snapshotId, 0, "amount") },
    basedOn: [
      ref(f.snapshotId, f.row, "event_id"),
      ref(ev.snapshotId, 0, "amount"),
      ref(ev.snapshotId, 0, "reference"),
      ref(ev.snapshotId, 0, "received_at"),
      ref(balance.snapshotId, 0, "balance"),
    ],
  };
};

/** The finding kinds PayPal adds a recipe for (joined into RECIPES), and the commands they may propose. */
export const PAYPAL_RECIPES: Readonly<Record<string, Recipe>> = { paypal_unrecorded: recordPaypal };
export const PAYPAL_RECIPE_COMMANDS = ["paypal.request", "payment.record"] as const;
/** The second fix for an overdue_credit finding: a PayPal link instead of a reminder (for the finding card to offer). */
export const PAYPAL_LINK_RECIPE: Recipe = paypalLink;
