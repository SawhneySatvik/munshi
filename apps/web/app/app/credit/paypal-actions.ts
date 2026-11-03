"use server";

// PayPal's actions (D-079, sandbox): "Send PayPal link", "Cancel link" and "Record this payment" each propose a draft
// as the signed-in member; "Approve" / "Reject" decide one as that member (decide(), under their own identity, in one
// transaction). Nothing here writes a book row or calls PayPal in a decision's transaction: an approved link or cancel
// reaches PayPal from the jobs role's sweep, run at once for this shop only (sweepShopPaypal; another shop's links wait
// for their own tick), and its failure never fails the approval. Once PayPal has made an approved link, the same
// request drafts the WhatsApp message carrying it (a paypal_link customer.remind, paypal-deliver.ts), which waits in
// the tray for its own approval; "Draft the WhatsApp message" does the same later for a made link no message carried
// or waits for. The amount is never posted: core mints the cell it is.
import { CoreError, decide } from "@munshi/core";
import { draftCommand, proposePaypalCancel, proposePaypalLink, proposeRecordPaypal } from "@munshi/core/paypal";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { OpsError } from "../../../lib/ops-types";
import { appPool } from "../../../lib/server/db";
import { errorOf, UUID } from "../../../lib/server/ops";
import { flushOutbox } from "../../../lib/server/outbox";
import { afterLinkApproved, type MessageOutcome, messageLink, sweepNow } from "../../../lib/server/paypal-deliver";
import { sessionFrom } from "../../../lib/server/session";

export type PaypalActState =
  | { error: OpsError }
  | { drafted: true }
  | { decided: "executed" | "rejected" | "stale"; message?: MessageOutcome | null }
  | { message: MessageOutcome }
  | null;

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
  let command: string | null;
  try {
    command = await draftCommand(await appPool(), session, draftId);
    status = (await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined)).status;
  } catch (err) {
    return { error: errorOf(err) };
  }
  // A link: to PayPal now (this shop's links only, never a failed approval), then its WhatsApp message drafted. A
  // cancel: to PayPal now. An approved message: out through the outbox now (recorded on a sample shop).
  let message: MessageOutcome | null = null;
  if (status === "executed") {
    message = await afterLinkApproved(session, draftId, command);
    if (message === null) {
      await sweepNow(session.tenantId);
      await flushOutbox();
    }
  }
  refresh();
  return message ? { decided: status, message } : { decided: status };
}

/** "Draft the WhatsApp message": a made link's message drafted for a person to approve, from this person's own request. */
export async function messagePaypalLinkAction(_prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  const linkId = form.get("link");
  if (typeof linkId !== "string" || !UUID.test(linkId)) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  let message: MessageOutcome;
  try {
    message = await messageLink(session, linkId);
  } catch (err) {
    return { error: errorOf(err) };
  }
  refresh();
  return { message };
}
