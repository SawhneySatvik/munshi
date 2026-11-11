"use server";

// Orders. Confirming a waiting site request is order.confirm, the person's own direct command: core
// re-prices every line from the books now and fixes the promised price. Each step is order.step, the person's own tap,
// admitted only if ref.order_flow allows it from the current step. An agent's order.confirm draft is decided only by
// decide() as the signed-in member, so it executes under the approver's identity with its audit entry. Every form
// carries its key; the commands pass it to runCommand.
// PayPal on an order (sandbox): "Send PayPal link", "Draft the WhatsApp message" and "Record this payment" each propose
// a draft as the signed-in member, core minting the cell the amount is (nothing is posted but ids); "Approve" decides
// one as that member. An approved link reaches PayPal from the jobs role's sweep for this shop, and its message is then
// drafted for its own approval (paypal-deliver.ts); nothing here calls PayPal in a decision's transaction.
import { decide } from "@munshi/core";
import { draftCommand, proposePaypalLink, proposeRecordPaypal } from "@munshi/core/paypal";
import { revalidatePath } from "next/cache";
import type { ActState } from "../../../lib/app-types";
import { act, command, dayOf, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { flushOutbox } from "../../../lib/server/outbox";
import { afterLinkApproved, messageLink, sweepNow } from "../../../lib/server/paypal-deliver";

const PATH = "/app/orders";
const STEPS = new Set(["packed", "cutting", "stitching", "trial", "ready", "out_for_delivery"]);

export async function confirmRequestAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const requestId = idOf(form, "request");
    const customerId = idOf(form, "customer");
    const dueOn = dayOf(form, "due");
    if (!requestId || !customerId) return invalid();
    await command(session, "order.confirm", { requestId, customerId, ...(dueOn ? { dueOn } : {}) }, key);
    await flushOutbox();
    return undefined;
  });
}

export async function stepAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const orderId = idOf(form, "order");
    const step = field(form, "step");
    if (!orderId || !STEPS.has(step)) return invalid();
    await command(session, "order.step", { orderId, step }, key);
    await flushOutbox();
    return undefined;
  });
}

// The key is required like every form's; decide() takes none: a decided draft cannot be decided twice (not_proposed).
export async function decideOrderAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const draftId = idOf(form, "draft");
    const verdict = field(form, "verdict");
    if (!draftId || (verdict !== "approved" && verdict !== "rejected")) return invalid();
    const d = await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined);
    if (d.status === "stale") return { error: "stale" };
    if (d.status === "executed") await flushOutbox();
    return undefined;
  });
}

export async function sendOrderPaypalAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const orderId = idOf(form, "order");
    if (!orderId) return invalid();
    await proposePaypalLink(await appPool(), { session }, { orderId });
    return undefined;
  });
}

export async function messageOrderPaypalAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const linkId = idOf(form, "link");
    if (!linkId) return invalid();
    const outcome = await messageLink(session, linkId);
    if (outcome === "drafted") return undefined;
    return { error: outcome === "waiting" || outcome === "messaged" || outcome === "not_made" ? "conflict" : "refused" };
  });
}

export async function recordOrderPaypalAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const eventId = idOf(form, "event");
    if (!eventId) return invalid();
    await proposeRecordPaypal(await appPool(), { session }, eventId);
    return undefined;
  });
}

// A PayPal draft on an order, decided by the signed-in member. An approved link goes to PayPal now (this shop's only)
// and its WhatsApp message is drafted for its own approval; an approved message goes out through the outbox.
export async function decideOrderPaypalAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const draftId = idOf(form, "draft");
    const verdict = field(form, "verdict");
    if (!draftId || (verdict !== "approved" && verdict !== "rejected")) return invalid();
    const pool = await appPool();
    const which = await draftCommand(pool, session, draftId);
    const d = await decide(pool, session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined);
    if (d.status === "stale") return { error: "stale" };
    if (d.status === "executed" && (await afterLinkApproved(session, draftId, which)) === null) {
      await sweepNow(session.tenantId);
      await flushOutbox();
    }
    revalidatePath("/app/inbox");
    return undefined;
  });
}
