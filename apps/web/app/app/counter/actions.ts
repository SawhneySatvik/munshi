"use server";

// Recording a counter sale, and pricing the bill as it is built. The person comes from sessionFrom(), never from the
// form; the form carries ids and what the person typed (quantities, the tender). Prices are never sent: quoteAction
// reads them (sale.quote) and sale.record re-derives them from the books under the session's member. A cash or UPI sale
// pays exactly the total of a fresh quote, read here on the server, never the browser's; if a price moved in between,
// the command refuses the mismatch and nothing is written. Cash and UPI are recorded, never processed.
import { counterShop, itemUnits, runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { CounterState, Quote } from "../../../lib/ops-types";
import { qtyToMilli } from "../../../lib/parse";
import { quotedTotal, quoteBill, receiptOf } from "../../../lib/server/counter";
import { appPool } from "../../../lib/server/db";
import { errorOf, page } from "../../../lib/server/ops";
import { UUID } from "../../../lib/parse";
import { keyOf } from "../../../lib/server/form-key";
import { sessionFrom } from "../../../lib/server/session";

type Line = { itemId: string; qtyMilli: number };

/** The typed bill as milli-units, or null when an id or a quantity is not one. */
async function linesOf(session: NonNullable<Awaited<ReturnType<typeof sessionFrom>>>, ids: unknown[], qtys: unknown[]): Promise<Line[] | null> {
  if (!ids.length || ids.length !== qtys.length || ids.length > 100 || ids.some((id) => typeof id !== "string" || !UUID.test(id))) return null;
  const units = await page(session, (c) => itemUnits(c, ids as string[]));
  const lines = ids.map((id, i) => ({ itemId: id as string, qtyMilli: qtyToMilli(String(qtys[i]), units.get(id as string) ?? "") }));
  return lines.every((l): l is Line => l.qtyMilli !== null) ? lines : null;
}

/** The bill so far, priced from the books (a snapshot), or null when it cannot be priced (no price, a bad quantity). */
export async function quoteAction(ids: string[], qtys: string[]): Promise<Quote | null> {
  const session = await sessionFrom(await cookies());
  if (!session || !Array.isArray(ids) || !Array.isArray(qtys)) return null;
  const lines = await linesOf(session, ids, qtys);
  if (!lines) return null;
  return quoteBill(session, ids.map((id, i) => `${id}:${qtys[i]}`).join(","), lines);
}

export async function recordSaleAction(_prev: CounterState, form: FormData): Promise<CounterState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const key = keyOf(form);
  if (!key) return { error: "other" };
  const tender = form.get("tender");
  if (tender !== "cash" && tender !== "upi" && tender !== "credit") return { error: "other" };
  const named = form.get("customer");
  // Cash and UPI may be a walk-in; a sale on credit needs the customer who owes it.
  if (typeof named !== "string" || (named !== "" && !UUID.test(named)) || (named === "" && tender === "credit")) return { error: "customer" };
  const customerId = named === "" ? null : named;
  const ids = form.getAll("item");
  if (!ids.length) return { error: "empty" };
  const qtys = form.getAll("qty");
  if (ids.length !== qtys.length || ids.length > 100 || ids.some((id) => typeof id !== "string" || !UUID.test(id))) return { error: "other" };
  const lines = await linesOf(session, ids, qtys);
  if (!lines) return { error: "qty" };
  const shopId = await page(session, (c) => counterShop(c));
  if (!shopId) return { error: "other" };

  let payments: Array<{ method: "cash" | "upi"; amountMinor: number }> = [];
  if (tender !== "credit") {
    const total = await quotedTotal(session, lines);
    if (total === null) return { error: "invalid" };
    payments = total > 0 ? [{ method: tender, amountMinor: total }] : [];
  }
  let saleId: string;
  try {
    const result = await runCommand(await appPool(), session, "sale.record", { shopId, ...(customerId ? { customerId } : {}), lines, payments }, key);
    saleId = result.saleId as string;
  } catch (err) {
    return { error: errorOf(err) };
  }
  revalidatePath("/app/counter");
  return { receipt: await receiptOf(session, saleId, customerId, lines.map((l) => l.itemId), tender) };
}
