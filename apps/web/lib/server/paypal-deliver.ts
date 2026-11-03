// After a person approves a PayPal link (server only, sandbox): from that approver's own request, the link goes to
// PayPal now (the jobs role's sweep for this shop only, never in the decision's transaction) and, once PayPal has made
// it, Munshi drafts the WhatsApp message carrying it (core's messagePaypalLink). The message is its own draft: it waits
// in the tray with its words in full until a person approves it, and only that approval writes it. A failed sweep never
// fails the approval: the link waits for the next tick, and the credit book offers "Draft the WhatsApp message" once
// it is made. Nothing here can leave anything half done: a draft that is not approved simply stays proposed.
import "server-only";
import { log, type Session } from "@munshi/core";
import { type LinkMessage, linkOfDraft, messagePaypalLink, sweepShopPaypal } from "@munshi/core/paypal";
import { appPool } from "./db";
import { jobsPool } from "./outbox";
import { wirePaypal } from "./paypal";

/** This shop's queued links to PayPal now, as the jobs role (a no-op where the jobs pool is not configured). */
export async function sweepNow(tenantId: string): Promise<void> {
  try {
    const jobs = jobsPool();
    if (!jobs) return;
    wirePaypal();
    await sweepShopPaypal(jobs, tenantId);
  } catch {
    log("paypal.sweep_failed", { code: "sweep_failed" }, "warn");
  }
}

/** The link's message drafted (or why not), from the person's own request. It is not sent until a person approves it. */
export async function messageLink(session: Session, linkId: string): Promise<LinkMessage> {
  return (await messagePaypalLink(await appPool(), session, linkId)).outcome;
}

/**
 * What a PayPal note may say: the message drafted or why not; "failed", the draft was refused (a reach that changed
 * under the request); "pending", the link's approval went through but its link could not be read back: never an error
 * over an approval that is done.
 */
export type MessageOutcome = LinkMessage | "failed" | "pending";

type LinkLookup = (session: Session, draftId: string) => Promise<string | null>;
const lookupLink: LinkLookup = async (session, draftId) => linkOfDraft(await appPool(), session, draftId);

/**
 * What follows an executed approval of a PayPal link (`command`, read before the decision; null for any other draft):
 * the sweep, then the message's draft. Called by the approver's own decide action, after decide() returned executed.
 * `lookup` finds the link the draft made (injectable so the "pending" path is tested without touching the database).
 */
export async function afterLinkApproved(session: Session, draftId: string, command: string | null, lookup: LinkLookup = lookupLink): Promise<MessageOutcome | null> {
  if (command !== "paypal.request") return null;
  let linkId: string | null;
  try {
    linkId = await lookup(session, draftId);
  } catch {
    log("paypal.link_unread", { code: "link_unread" }, "warn");
    return "pending";
  }
  if (!linkId) return "pending";
  await sweepNow(session.tenantId);
  try {
    return await messageLink(session, linkId);
  } catch {
    log("paypal.message_failed", { code: "message_failed" }, "warn");
    return "failed";
  }
}
