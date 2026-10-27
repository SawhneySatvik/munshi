"use server";

// Recording a counter sale. The person comes from sessionFrom(), never from the form; the form carries ids and what the
// person typed (quantities), and core's sale.record prices the lines from the books under the session's member. Only
// a sale on a customer's credit can be recorded: cash and UPI need the bill's total to tender, and no named read gives
// it yet (the screen offers them as "Coming soon"; posting one anyway is refused here, with nothing written).
import { runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { CounterState } from "../../lib/ops-types";
import { qtyToMilli } from "../../lib/parse";
import { receiptOf } from "../../lib/server/counter";
import { appPool } from "../../lib/server/db";
import { errorOf, readOnly, UUID } from "../../lib/server/ops";
import { sessionFrom } from "../../lib/server/session";

export async function recordSaleAction(_prev: CounterState, form: FormData): Promise<CounterState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const tender = form.get("tender");
  if (tender === "cash" || tender === "upi") return { error: "coming_soon" };
  if (tender !== "credit") return { error: "other" };
  const customerId = form.get("customer");
  if (typeof customerId !== "string" || !UUID.test(customerId)) return { error: "customer" };
  const ids = form.getAll("item");
  const qtys = form.getAll("qty");
  if (!ids.length) return { error: "empty" };
  if (ids.length !== qtys.length || ids.length > 100 || ids.some((id) => typeof id !== "string" || !UUID.test(id))) return { error: "other" };

  const { units, shopId } = await readOnly(session, async (c) => ({
    units: new Map(
      (await c.query<{ id: string; unit: string }>("select id::text as id, unit from books.item where id = any($1::uuid[])", [ids])).rows.map((r) => [
        r.id,
        r.unit,
      ]),
    ),
    shopId: (await c.query<{ id: string }>("select id::text as id from ops.shop order by created_at, id limit 1")).rows[0]?.id,
  }));
  const lines = ids.map((id, i) => ({ itemId: id as string, qtyMilli: qtyToMilli(String(qtys[i]), units.get(id as string) ?? "") }));
  if (lines.some((l) => l.qtyMilli === null)) return { error: "qty" };
  if (!shopId) return { error: "other" };

  let saleId: string;
  try {
    const result = await runCommand(await appPool(), session, "sale.record", { shopId, customerId, lines, payments: [] });
    saleId = result.saleId as string;
  } catch (err) {
    return { error: errorOf(err) };
  }
  revalidatePath("/counter");
  return { receipt: await receiptOf(session, saleId, customerId, lines.map((l) => l.itemId)) };
}
