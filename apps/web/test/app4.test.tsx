// BP-APP-4, the orders screen (BLUEPRINT §8.12), on Prabhave's books as the showcase seed builds them: a site cart
// waiting, a stitching order at cutting past its due date, a goods order ready and one confirmed from a cart. The
// screen renders from viewOrders in one transaction: each waiting line's quantity, price and amount, each card's due
// date, lines, total and advance, and a stitching line's measurements are <Figure>s whose refs land on stored cells;
// no digit without a source in either language; absent once orders is switched off. Confirming a request is
// order.confirm and each step order.step, both under the signed-in member with the form's key; a step the flow does not
// allow is refused with nothing written; a keyless form is refused; an agent's draft is decided by decide() as the
// approver, executing under their identity.
import { cleanup } from "@testing-library/react";
import { createHash } from "node:crypto";
import { intakeWhatsapp, mintSnapshot, proposeDraft, runCommand, switchCapability, takeMeasurement, withTx } from "@munshi/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { confirmRequestAction, decideOrderAction, stepAction } from "../app/app/orders/actions";
import OrdersPage from "../app/app/orders/page";
import { PIECES } from "../../../db/seed/prabhave.ts";
import { inbound } from "../../../db/test/v2/core/orders/lib.ts";
import { appPool } from "../lib/server/db";
import type { OrdersPage as Data } from "../lib/server/orders";
import { dataOf, isAbsent, resolves, sourcedInBoth } from "./app-render";
import { formOf } from "./ops-db";
import { fakeMatchMedia } from "./render";
import { openShowcase, type Shows, showRows, signInShow } from "./showcase-db";

let h: Shows;
beforeAll(async () => {
  h = await openShowcase();
}, 300_000);
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const p = () => h.s.prabhave;
const keyless = (fields: Record<string, string>) => {
  const form = formOf(fields);
  form.delete("key");
  return form;
};
const steps = (orderId: string) =>
  showRows<{ step: string; created_by: string }>(h, p().tenantId, "select step, created_by::text from books.order_step where order_id = $1 order by step_no", [orderId]);

// Orders are the office's (D-082): counter staff confirm and step no order. Each refusal reaches the form as refused
// (the database's MS001), not as a failure of another kind, and writes nothing.
test("ORD-OFFICE-WEB counter staff confirm and step no order: each action answers refused and writes nothing", async () => {
  const request = p().requests.get("waiting") as string;
  const late = p().orders.get("late") as string;
  const before = await steps(late);
  await signInShow(h, p().counter);
  const fields = { key: "order-confirm-key-0000", request, customer: p().customers.get("Rashmi T.") as string, due: "2027-01-15" };
  expect(await confirmRequestAction(null, formOf(fields))).toEqual({ error: "refused" });
  expect(await stepAction(null, formOf({ order: late, step: "stitching" }))).toEqual({ error: "refused" });
  expect(await showRows(h, p().tenantId, "select 1 from books.order where request_id = $1", [request])).toEqual([]);
  expect(await steps(late)).toEqual(before);
});

describe("the screen", () => {
  test("the waiting cart, priced now, and the board's cards: every figure a cell; every digit sourced in both languages", async () => {
    await signInShow(h, p().manager);
    const el = await OrdersPage();
    const data = dataOf<Data>(el);
    expect(data.waiting).toHaveLength(1);
    expect(data.waiting[0]?.priced).toBe(true);
    expect(data.waiting[0]?.lines).toHaveLength(1);
    expect(data.cards.map((c) => c.step).sort()).toEqual(["confirmed", "cutting", "ready"]);
    const late = data.cards.find((c) => c.id === p().orders.get("late"));
    expect(late?.kind).toBe("stitching");
    expect(late?.next).toEqual(["stitching"]);
    expect(resolves(el)).toBeGreaterThan(15);
    const text = sourcedInBoth(el);
    expect(text).toContain("Meenakshi P.");
    expect(text).not.toContain("Cannot verify");
  });

  test("switched off (its dependants first), the screen is absent", async () => {
    const owner = await signInShow(h, p().owner);
    const pool = await appPool();
    for (const cap of ["stitching", "cart", "orders"] as const) await switchCapability(pool, owner, cap, false);
    try {
      await isAbsent(() => OrdersPage());
    } finally {
      for (const cap of ["orders", "stitching", "cart"] as const) await switchCapability(pool, owner, cap, true);
    }
  });
});

describe("its actions", () => {
  test("a manager confirms the waiting cart: order.confirm under them with the form's key; a replay records once", async () => {
    const request = p().requests.get("waiting") as string;
    const key = "order-confirm-key-0001";
    const fields = { key, request, customer: p().customers.get("Rashmi T.") as string, due: "2027-01-15" };
    const taker = await signInShow(h, p().manager);
    expect(await confirmRequestAction(null, keyless({ request, customer: fields.customer }))).toEqual({ error: "other" });
    expect(await confirmRequestAction(null, formOf(fields))).toEqual({ done: true });
    expect(await confirmRequestAction(null, formOf(fields))).toEqual({ done: true });
    const orders = await showRows<{ id: string; created_by: string }>(h, p().tenantId, "select id::text, created_by::text from books.order where request_id = $1", [request]);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.created_by).toBe(taker.memberId);
    const [claim] = await showRows<{ command: string }>(h, p().tenantId, "select command from ops.idempotency where key = $1", [key]);
    expect(claim?.command).toBe("order.confirm");
    // The orders page is the office's (D-082): it answers counter staff 404, and a manager sees nothing left waiting.
    await signInShow(h, p().counter);
    await isAbsent(() => OrdersPage());
    await signInShow(h, p().manager);
    expect(dataOf<Data>(await OrdersPage()).waiting).toEqual([]);
  });

  test("a step is the person's own tap (order.step); one the flow does not allow is refused and nothing is written", async () => {
    const late = p().orders.get("late") as string;
    const before = await steps(late);
    const taker = await signInShow(h, p().manager);
    expect(await stepAction(null, formOf({ order: late, step: "packed" }))).toMatchObject({ error: expect.any(String) });
    expect(await stepAction(null, keyless({ order: late, step: "stitching" }))).toEqual({ error: "other" });
    expect(await steps(late)).toEqual(before);
    expect(await stepAction(null, formOf({ order: late, step: "stitching" }))).toEqual({ done: true });
    expect((await steps(late)).at(-1)).toEqual({ step: "stitching", created_by: taker.memberId });
    // The board is the office's (D-082): a manager reads the card the step moved.
    const card = dataOf<Data>(await OrdersPage()).cards.find((c) => c.id === late);
    expect(card?.step).toBe("stitching");
    expect(card?.next.sort()).toEqual(["ready", "trial"]);
  });

  test("a stitching card shows its measurements as cells of measurement.values", async () => {
    const manager = await signInShow(h, p().manager);
    const customerId = p().customers.get("Kavita N.") as string;
    const [contact] = await showRows<{ id: string }>(
      h,
      p().tenantId,
      "select contact_id::text as id from books.party_contact where customer_id = $1 order by effective_from desc limit 1",
      [customerId],
    );
    const measurementId = await takeMeasurement(await appPool(), manager, { contactId: contact?.id as string, values: { chest: 920, waist: 760 } });
    const item = p().items.values().next().value as string;
    const { orderId } = await runCommand(await appPool(), manager, "order.confirm", {
      shopId: p().shopId,
      customerId,
      kind: "stitching",
      dueOn: "2027-01-20",
      lines: [{ itemId: item, qtyMilli: 1000, measurementId }],
    });
    const el = await OrdersPage();
    const card = dataOf<Data>(el).cards.find((c) => c.id === orderId);
    expect(card?.measurements[0]?.points.map((x) => x.point)).toEqual(["chest", "waist"]);
    resolves(el);
    const text = sourcedInBoth(el);
    expect(text).toContain("Waist");
  });

  test("an order.confirm draft waits on the screen, its quantity a cell beside the customer's words; decide() as the approver executes it", async () => {
    // A WhatsApp message asking for a piece, its request, and a run's spans the database re-parses (ops.inbound_extract),
    // then the draft citing them and the piece's price in effect, as the agent's order recipe proposes it.
    const owner = await signInShow(h, p().owner);
    const pool = await appPool();
    const piece = p().items.get(PIECES.confirmed) as string;
    const text = "Please send 2 of the yellow kurta";
    const message = await inbound(h.db, p().tenantId, "text", text);
    const { requestId } = await withTx(h.db.as("munshi_public"), { kind: "system", tenantId: p().tenantId }, (c) =>
      intakeWhatsapp(c, { shopId: p().shopId, inboundMessageId: message }),
    );
    const span = (phrase: string) => {
      const start = text.indexOf(phrase);
      return [start, start + phrase.length, createHash("sha256").update(phrase).digest()] as const;
    };
    const run = await withTx(pool, { kind: "member", session: owner }, async (c) => {
      const id = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'inbox', 'orders') returning id`, [p().tenantId])).rows[0]?.id as string;
      const put = (field: string, phrase: string, num: number | null, item: string | null) =>
        c.query(
          `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, item_id, span_start, span_end, span_sha256, parsed_as)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [p().tenantId, message, id, field, num, item, ...span(phrase), num === null ? "words" : "digits"],
        );
      await put("quantity", "2", 2000, null);
      await put("item", "yellow kurta", null, piece);
      return id;
    });
    const member = { kind: "member" as const, session: owner };
    const read = await mintSnapshot(pool, member, "order.extracts", { message_id: message, run_id: run }, run);
    const price = await mintSnapshot(pool, member, "items.price", { item_id: piece }, run);
    const draftId = await proposeDraft(pool, { session: owner, runId: run }, {
      command: "order.confirm",
      payload: { requestId, customerId: p().customers.get("Farah Q.") as string, lines: [{ itemId: piece, qtyMilli: 2000 }] },
      basedOn: [{ snapshotId: read.id, row: 0, col: "qty" }, { snapshotId: price.id, row: 0, col: "price" }],
      payloadRefs: { "lines[0].qtyMilli": { snapshotId: read.id, row: 0, col: "qty" } },
    });
    await withTx(pool, member, (c) => c.query("update ops.order_request set state = 'drafted', draft_id = $2 where id = $1", [requestId, draftId]));
    const el = await OrdersPage();
    const drafts = dataOf<Data>(el).drafts;
    expect(drafts.map((d) => d.id)).toEqual([draftId]);
    expect(drafts[0]?.message).toBe(text);
    resolves(el);
    const shown = sourcedInBoth(el);
    expect(shown).toContain("Waiting for your approval");
    cleanup();

    const manager = await signInShow(h, p().manager);
    expect(await decideOrderAction(null, keyless({ draft: draftId, verdict: "approved" }))).toEqual({ error: "other" });
    expect(await decideOrderAction(null, formOf({ draft: draftId, verdict: "approved" }))).toEqual({ done: true });
    const [order] = await showRows<{ created_by: string; decided_by: string }>(
      h,
      p().tenantId,
      `select o.created_by::text, d.decided_by::text from books.order o join approval.decision d on d.tenant_id = o.tenant_id and d.id = o.decision_id
        where o.request_id = $1`,
      [requestId],
    );
    expect(order).toEqual({ created_by: manager.memberId, decided_by: manager.memberId });
    // Decided once: a second approval of the same draft is refused.
    expect(await decideOrderAction(null, formOf({ draft: draftId, verdict: "approved" }))).toEqual({ error: "conflict" });
  });
});
