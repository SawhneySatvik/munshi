"use server";

// PayPal's actions (D-079, sandbox): "Send PayPal link", "Cancel link" and "Record this payment" each propose a draft
// as the signed-in member; "Approve" / "Reject" decide one as that member (decide(), under their own identity, in one
// transaction). Nothing here writes a book row or calls PayPal in a decision's transaction: an approved link or cancel
// reaches PayPal from the jobs role's sweep, run at once for this shop only (sweepShopPaypal; another shop's links wait
// for their own tick), and its failure never fails the approval. The amount is never posted: core mints the cell it is.
import { CoreError, decide, log } from "@munshi/core";
import { proposePaypalCancel, proposePaypalLink, proposeRecordPaypal, sweepShopPaypal } from "@munshi/core/paypal";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { OpsError } from "../../../lib/ops-types";
import { appPool } from "../../../lib/server/db";
import { errorOf, UUID } from "../../../lib/server/ops";
import { jobsPool } from "../../../lib/server/outbox";
import { wirePaypal } from "../../../lib/server/paypal";
import { sessionFrom } from "../../../lib/server/session";

export type PaypalActState = { error: OpsError } | { drafted: true } | { decided: "executed" | "rejected" | "stale" } | null;

const refresh = () => {
  revalidatePath("/app/credit");
  revalidatePath("/app/invoices/[id]", "page");
};

async function propose(make: (session: NonNullable<Awaited<ReturnType<typeof sessionFrom>>>) => Promise<string> | null): Promise<PaypalActState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  try {
    const p = make(session);
    if (!p) return { error: "other" };
    await p;
  } catch (err) {
    return { error: errorOf(err) };
  }
  refresh();
  return { drafted: true };
}

export async function sendPaypalLinkAction(_prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  const customerId = form.get("customer");
  const invoiceId = form.get("invoice");
  return propose(async (session) => {
    const target =
      typeof invoiceId === "string" && UUID.test(invoiceId) ? { invoiceId } : typeof customerId === "string" && UUID.test(customerId) ? { customerId } : null;
    if (!target) throw new CoreError("invalid", { fields: ["customerId"] });
    return proposePaypalLink(await appPool(), { session }, target);
  });
}

export async function cancelPaypalLinkAction(_prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  const linkId = form.get("link");
  return propose(async (session) => {
    if (typeof linkId !== "string" || !UUID.test(linkId)) throw new CoreError("invalid", { fields: ["linkId"] });
    return proposePaypalCancel(await appPool(), { session }, linkId);
  });
}

export async function recordPaypalAction(_prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  const eventId = form.get("event");
  return propose(async (session) => {
    if (typeof eventId !== "string" || !UUID.test(eventId)) throw new CoreError("invalid", { fields: ["eventId"] });
    return proposeRecordPaypal(await appPool(), { session }, eventId);
  });
}

export async function decidePaypalAction(_prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  const draftId = form.get("draft");
  const verdict = form.get("verdict");
  if (typeof draftId !== "string" || !UUID.test(draftId) || (verdict !== "approved" && verdict !== "rejected")) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  let status: "executed" | "rejected" | "stale";
  try {
    status = (await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined)).status;
  } catch (err) {
    return { error: errorOf(err) };
  }
  if (status === "executed") {
    // This shop's links only, now; never another shop's, and never a failed approval.
    try {
      const jobs = jobsPool();
      if (jobs) {
        wirePaypal();
        await sweepShopPaypal(jobs, session.tenantId);
      }
    } catch {
      log("paypal.sweep_failed", { code: "sweep_failed" }, "warn");
    }
  }
  refresh();
  return { decided: status };
}
