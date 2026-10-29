"use server";

// Recording a shelf count (stock.count) or waste (stock.waste) under the signed-in member. A count states what the books
// held when the person looked: the on-hand cell the page showed them (its snapshot and row, posted with the form) is
// read back here, never taken from the form as a number, and core executes the count only while the books still hold
// it; otherwise "conflict", and the page re-reads. Waste that would take the books below zero is refused by core.
import { runCommand, viewCountBasis } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { StockState } from "../../../lib/ops-types";
import { qtyToMilli } from "../../../lib/parse";
import { appPool } from "../../../lib/server/db";
import { errorOf, page, stampOf, UUID } from "../../../lib/server/ops";
import { keyOf } from "../../../lib/server/form-key";
import { sessionFrom } from "../../../lib/server/session";
import { onHandAfter } from "../../../lib/server/stock";

const SEEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,3})$/;

export async function recordStockAction(_prev: StockState, form: FormData): Promise<StockState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const key = keyOf(form);
  if (!key) return { error: "other" };
  const kind = form.get("kind");
  const itemId = form.get("item");
  if (kind !== "count" && kind !== "waste") return { error: "other" };
  if (typeof itemId !== "string" || !UUID.test(itemId)) return { error: "item" };

  const seen = SEEN.exec(String(form.get("seen") ?? ""));
  // The cell the person saw: an items.list row, for this very item, holding a quantity.
  const basis = kind === "count" && seen ? { snapshotId: seen[1] as string, row: Number(seen[2]) } : null;
  const { unit, expected } = await page(session, (c) => viewCountBasis(c, itemId, basis));
  if (!unit) return { error: "item" };
  const qtyMilli = qtyToMilli(String(form.get("qty") ?? ""), unit, kind === "count");
  if (qtyMilli === null) return { error: "qty" };
  if (kind === "count" && expected === null) return { error: "conflict" };

  let moveId: string | null;
  try {
    const pool = await appPool();
    const result =
      kind === "count"
        ? await runCommand(pool, session, "stock.count", { itemId, countedQtyMilli: qtyMilli, expectedQtyMilli: expected as number }, key)
        : await runCommand(pool, session, "stock.waste", { itemId, qtyMilli }, key);
    moveId = result.moveId ?? null;
  } catch (err) {
    return { error: errorOf(err) };
  } finally {
    revalidatePath("/app/stock"); // a conflict too: the page re-reads the books
  }
  const [stamp, after] = await Promise.all([moveId ? stampOf(session, "stock_move", moveId) : null, onHandAfter(session, itemId)]);
  return { done: { kind, stamp, ...after } };
}
