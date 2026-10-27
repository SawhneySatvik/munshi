"use server";

// Recording a shelf count (stock.count) or waste (stock.waste) under the signed-in member. A count states what the books
// held when the person looked: the on-hand cell the page showed them (its snapshot and row, posted with the form) is
// read back here, never taken from the form as a number, and core executes the count only while the books still hold
// it; otherwise "conflict", and the page re-reads. Waste that would take the books below zero is refused by core.
import { resolveRef, runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { StockState } from "../../lib/ops-types";
import { qtyToMilli } from "../../lib/parse";
import { appPool } from "../../lib/server/db";
import { errorOf, readOnly, stampOf, UUID } from "../../lib/server/ops";
import { sessionFrom } from "../../lib/server/session";
import { onHandAfter } from "../../lib/server/stock";

const SEEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,3})$/;

export async function recordStockAction(_prev: StockState, form: FormData): Promise<StockState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const kind = form.get("kind");
  const itemId = form.get("item");
  if (kind !== "count" && kind !== "waste") return { error: "other" };
  if (typeof itemId !== "string" || !UUID.test(itemId)) return { error: "item" };

  const seen = SEEN.exec(String(form.get("seen") ?? ""));
  const { unit, expected } = await readOnly(session, async (c) => {
    const unit = (await c.query<{ unit: string }>("select unit from books.item where id = $1", [itemId])).rows[0]?.unit;
    if (kind !== "count" || !seen) return { unit, expected: null };
    // The cell the person saw: an items.list row, for this very item, holding a quantity.
    const ref = { snapshotId: seen[1] as string, row: Number(seen[2]) };
    const { rows } = await c.query<{ query_name: string }>("select query_name from snap.snapshot where id = $1", [ref.snapshotId]);
    const [item, onHand] = await Promise.all([resolveRef(c, { ...ref, col: "item_id" }), resolveRef(c, { ...ref, col: "on_hand" })]);
    const fits = rows[0]?.query_name === "items.list" && item?.kind === "text" && item.txt === itemId && onHand?.kind === "quantity";
    return { unit, expected: fits ? Number(onHand.num) : null };
  });
  if (!unit) return { error: "item" };
  const qtyMilli = qtyToMilli(String(form.get("qty") ?? ""), unit, kind === "count");
  if (qtyMilli === null) return { error: "qty" };
  if (kind === "count" && expected === null) return { error: "conflict" };

  let moveId: string | null;
  try {
    const pool = await appPool();
    const result =
      kind === "count"
        ? await runCommand(pool, session, "stock.count", { itemId, countedQtyMilli: qtyMilli, expectedQtyMilli: expected as number })
        : await runCommand(pool, session, "stock.waste", { itemId, qtyMilli });
    moveId = result.moveId ?? null;
  } catch (err) {
    return { error: errorOf(err) };
  } finally {
    revalidatePath("/stock"); // a conflict too: the page re-reads the books
  }
  const [stamp, after] = await Promise.all([moveId ? stampOf(session, "books.stock_move", moveId) : null, onHandAfter(session, itemId)]);
  return { done: { kind, stamp, ...after } };
}
