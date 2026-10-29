"use server";

// Recording in the credit book: a payment received (payment.record, recorded, never processed) or credit given
// (credit.record). The person comes from sessionFrom(); the database refuses a command the member's role does not hold
// (counter staff record payments, not credit given), so the screen's disabled option is a courtesy, not the rule.
import { customerList, runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { CreditState } from "../../lib/ops-types";
import { rupeesToMinor } from "../../lib/parse";
import { balanceAfter } from "../../lib/server/credit";
import { appPool } from "../../lib/server/db";
import { errorOf, page, stampOf, UUID } from "../../lib/server/ops";
import { sessionFrom } from "../../lib/server/session";

export async function recordCreditAction(_prev: CreditState, form: FormData): Promise<CreditState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const kind = form.get("kind");
  const customerId = form.get("customer");
  const method = form.get("method");
  if (kind !== "payment" && kind !== "credit") return { error: "other" };
  if (typeof customerId !== "string" || !UUID.test(customerId)) return { error: "customer" };
  const amountMinor = rupeesToMinor(String(form.get("amount") ?? ""));
  if (amountMinor === null) return { error: "amount" };
  if (kind === "payment" && method !== "cash" && method !== "upi") return { error: "other" };

  let written: ["payment" | "credit_entry", string];
  try {
    const pool = await appPool();
    written =
      kind === "payment"
        ? ["payment", (await runCommand(pool, session, "payment.record", { direction: "in", customerId, method, amountMinor })).paymentId as string]
        : ["credit_entry", (await runCommand(pool, session, "credit.record", { customerId, amountMinor })).creditId as string];
  } catch (err) {
    return { error: errorOf(err) };
  }
  revalidatePath("/credit");
  const [stamp, after, customer] = await Promise.all([
    stampOf(session, ...written),
    balanceAfter(session, customerId),
    page(session, async (c) => (await customerList(c, [customerId]))[0]?.name ?? ""),
  ]);
  return { done: { kind, stamp, customer, ...after } };
}
