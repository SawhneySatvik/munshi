"use server";

// Orders. Confirming a waiting site request is order.confirm, the person's own direct command: core
// re-prices every line from the books now and fixes the promised price. Each step is order.step, the person's own tap,
// admitted only if ref.order_flow allows it from the current step. An agent's order.confirm draft is decided only by
// decide() as the signed-in member, so it executes under the approver's identity with its audit entry. Every form
// carries its key; the commands pass it to runCommand.
import { decide } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, command, dayOf, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { flushOutbox } from "../../../lib/server/outbox";

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
