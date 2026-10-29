"use server";

// The bills page's server actions. The person always comes from sessionFrom(), never from the form. recordBill runs
// purchase.record as that member's own direct command (core's runCommand: the database admits the rows only if the
// member's role holds the command, and audits each one under them); the bill's total and every amount are re-derived by
// core from the lines, so the form sends none. lastPrice mints the item's last bill price for the form to compare with.
import { CoreError, itemUnits, runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type LastPrice, parseQty, parseRupees } from "../../../lib/books";
import { lastPriceFor } from "../../../lib/server/bills";
import { appPool } from "../../../lib/server/db";
import { page } from "../../../lib/server/ledger";
import { sessionFrom } from "../../../lib/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^\d{1,3}$/;

export type RecordError = "invalid" | "conflict" | "refused" | "signed_out" | "other";
/** `fields`: the form's own field names (supplier, billNo, billDate, item-<k>, qty-<k>, cost-<k>, expires-<k>). */
export type RecordState = { error: RecordError; fields?: string[] } | null;

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

export async function recordBill(_prev: RecordState, form: FormData): Promise<RecordState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };

  const keys = form.getAll("line").filter((k): k is string => typeof k === "string" && KEY.test(k));
  const supplierId = text(form, "supplier");
  const billNo = text(form, "billNo");
  const billDate = text(form, "billDate");
  const bad: string[] = [];
  if (!UUID.test(supplierId)) bad.push("supplier");
  if (!billNo || billNo.length > 64) bad.push("billNo");
  if (!DAY.test(billDate)) bad.push("billDate");
  if (!keys.length) bad.push("item-0");
  const items = keys.map((k) => text(form, `item-${k}`));
  for (const [i, k] of keys.entries()) if (!UUID.test(items[i] as string)) bad.push(`item-${k}`);
  // Quantities are read in the item's own unit (packs and pieces whole, weighed goods to the gram).
  const units = await page(session, (c) => itemUnits(c, items.filter((i) => UUID.test(i))));
  const lines = keys.map((k, i) => {
    const itemId = items[i] as string;
    const qtyMilli = parseQty(text(form, `qty-${k}`), units.get(itemId) ?? "pack");
    const unitCostMinor = parseRupees(text(form, `cost-${k}`));
    const expiresOn = text(form, `expires-${k}`);
    if (UUID.test(itemId) && !units.has(itemId)) bad.push(`item-${k}`);
    if (qtyMilli === null) bad.push(`qty-${k}`);
    if (unitCostMinor === null) bad.push(`cost-${k}`);
    if (expiresOn && !DAY.test(expiresOn)) bad.push(`expires-${k}`);
    return { itemId, qtyMilli, unitCostMinor, ...(expiresOn ? { expiresOn } : {}) };
  });
  if (bad.length) return { error: "invalid", fields: [...new Set(bad)] };

  let purchaseId: string | null | undefined;
  try {
    ({ purchaseId } = await runCommand(await appPool(), session, "purchase.record", { supplierId, billNo, billDate, lines }));
  } catch (err) {
    // CoreError carries a code and input paths only; the screen shows its own words for them.
    if (!(err instanceof CoreError)) return { error: "other" };
    if (err.code === "invalid") return { error: "invalid", fields: formFields(err.fields ?? [], keys) };
    return { error: err.code === "refused" || err.code === "conflict" ? err.code : "other" };
  }
  revalidatePath("/app/bills");
  redirect(`/app/bills/${purchaseId}?recorded=1`);
}

// The command's input paths (lines.0.unitCostMinor) as the form's field names (cost-<key>).
function formFields(paths: string[], keys: string[]): string[] {
  const FIELD: Record<string, string> = { itemId: "item", qtyMilli: "qty", unitCostMinor: "cost", expiresOn: "expires" };
  return paths.flatMap((p) => {
    const line = /^lines\.(\d+)\.(\w+)$/.exec(p);
    if (line) {
      const key = keys[Number(line[1])];
      const field = FIELD[line[2] as string];
      return key !== undefined && field ? [`${field}-${key}`] : [];
    }
    return ["supplierId", "billNo", "billDate"].includes(p) ? [p === "supplierId" ? "supplier" : p] : [];
  });
}

// Only a read that ran may say "no earlier bill": a bad id, no session or a failure is an error, which the form shows as
// Cannot verify.
export async function lastPrice(itemId: string): Promise<LastPrice> {
  if (typeof itemId !== "string" || !UUID.test(itemId)) throw new Error("lastPrice: not an item id");
  const session = await sessionFrom(await cookies());
  if (!session) throw new Error("lastPrice: not signed in");
  return lastPriceFor(session, itemId);
}
