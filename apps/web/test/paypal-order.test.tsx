// Agentic commerce with PayPal on the demo shop, through the app's own pages and actions (recorded mode: no keys, no
// network): the seeded walk (db/seed/kirana-paypal-order.ts) shows in the inbox and on the order's card; the fresh
// message's "Draft order" runs the agent from a recorded response (apps/web/fixtures/inbox; rewrite with
// MUNSHI_WEB_FIXTURES=write); the order, its PayPal link, the link's WhatsApp message and PayPal's paid notice's payment
// are each a draft a person approves on the orders screen; every amount on it is a cited cell, in both languages.
import { sweepShopPaypal, wirePayPal } from "@munshi/core/paypal";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { recordedPayPal } from "../../../packages/adapters/payments/index.ts";
import { wordsIn } from "../../../packages/agent/src/intake.ts";
import { PAYPAL_ORDER_DEMO, seedKiranaPaypalOrder } from "../../../db/seed/kirana-paypal-order.ts";
import { askAction } from "../app/app/ask/actions";
import { draftOrderAction } from "../app/app/inbox/actions";
import InboxPage from "../app/app/inbox/page";
import {
  decideOrderAction,
  decideOrderPaypalAction,
  messageOrderPaypalAction,
  recordOrderPaypalAction,
  sendOrderPaypalAction,
} from "../app/app/orders/actions";
import { OrdersView } from "../components/app/OrdersView";
import { LangProvider } from "../components/LangProvider";
import type { AskTurn } from "../lib/hero-types";
import type { Flow } from "../lib/server/agent-port";
import type { InboxPage as Inbox } from "../lib/server/office";
import { loadOrders } from "../lib/server/orders";
import { resolveCell } from "../lib/snapshot";
import type { Lang } from "../lib/types";
import { dataOf } from "./helpers/app-render";
import { hideNavigatorWhileWriting, script, WRITING } from "./helpers/hero-script";
import { type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia, unsourced } from "./helpers/render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./helpers/hero-script");
  return { ...real, agentDeps: (flow: Flow) => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

let h: Home;
let seeded: Awaited<ReturnType<typeof seedKiranaPaypalOrder>>;
beforeAll(async () => {
  h = await openHome();
  seeded = await seedKiranaPaypalOrder({ app: h.db.app, jobs: h.db.jobs, pub: h.db.as("munshi_public") }, h.k);
  wirePayPal(recordedPayPal());
}, 240_000);
afterAll(async () => {
  wirePayPal(null);
  await h.close();
});
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]);
});

const pick = (text: string, phrase: string) => {
  const at = [...text.slice(0, text.indexOf(phrase))].length;
  const words = wordsIn(text);
  return { from: words.findIndex((w) => w.start === at), to: words.findIndex((w) => w.end === at + [...phrase].length) };
};
const key = (tag: string) => ({ key: `test-${tag}-${crypto.randomUUID()}` });
// The order's card, with the amount a ref on it shows, from the page's own snapshots.
const card = async (orderId: string) => {
  const page = await loadOrders(h.k.owner);
  const found = page?.cards.find((c) => c.id === orderId);
  return found && page ? { ...found, amount: (ref: Parameters<typeof resolveCell>[1] | null | undefined) => (ref ? resolveCell(page.snapshots, ref) : null) } : undefined;
};

// Ask, on a recorded response: the question is answered from the PayPal links read (paypal.links), its figures cells.
export const PAYPAL_QUESTION = "Which PayPal payments are not in the books yet?";

test("Ask: which PayPal payments are not in the books yet is answered from the links read, each figure a cell equal to the link's amount", async () => {
  if (WRITING)
    script.turns = [
      { json: { desk: "credit" } },
      { tools: [{ name: "paypal_links", args: {} }] },
      { text: "Read 1, rows 0 and 1 are paid by PayPal and not yet in the books." },
      {
        json: {
          segments: [
            {
              text: "PayPal reports ⟦1⟧ paid ⟦2⟧ for an order, and ⟦3⟧ paid ⟦4⟧ toward credit; the books do not show these payments yet.",
              refs: [
                { read: 1, row: 0, col: "customer_id" },
                { read: 1, row: 0, col: "amount" },
                { read: 1, row: 1, col: "customer_id" },
                { read: 1, row: 1, col: "amount" },
              ],
            },
          ],
        },
      },
    ];
  const r = await askAction(null, formOf({ question: PAYPAL_QUESTION }));
  const turn = (r as { turn: AskTurn }).turn;
  expect(turn.reply.kind).toBe("answer");
  if (turn.reply.kind !== "answer") return;
  const parts = turn.reply.segments[0] ?? [];
  expect(parts.filter((x) => x.t === "name").map((x) => (x.t === "name" ? x.v : ""))).toEqual([PAYPAL_ORDER_DEMO.paid.name, "Sunita P."]);
  const amounts = parts.flatMap((x) => (x.t === "ref" ? [resolveCell(turn.snapshots, x.ref)] : []));
  const links = await rows<{ amount_minor: string }>(h, "select amount_minor::text from ops.paypal_link order by created_at desc, id");
  expect(amounts).toEqual(links.map((l) => ({ t: "money", minor: Number(l.amount_minor), currency: "INR" })));
  const reads = await rows<{ query_name: string }>(h, "select query_name from snap.snapshot where run_id = $1", [turn.id]);
  expect(reads.map((x) => x.query_name)).toContain("paypal.links");
});

test("the seeded walk: the inbox shows the order a message became and that PayPal says paid; the card offers to record it, and only its approval writes the order's advance", async () => {
  const inbox = dataOf<Inbox>(await InboxPage());
  const [order] = await rows<{ code: string }>(h, "select code from books.order where id = $1", [seeded.orderId]);
  const paid = inbox.messages.find((m) => m.text === PAYPAL_ORDER_DEMO.paidText);
  expect(paid?.order).toEqual({ code: order?.code, paypal: "paid" });
  expect(inbox.messages.find((m) => m.id === seeded.freshMessageId)?.order).toBeNull();

  const c = await card(seeded.orderId);
  expect(c?.paypal?.due).toBeNull(); // paid by PayPal, not yet in the books: no second link
  const [link] = c?.paypal?.links ?? [];
  expect(link).toMatchObject({ id: seeded.linkId, state: "paid", mode: "recorded", messaged: true });
  expect(c?.amount(link?.amount)).toMatchObject({ t: "money", currency: "INR" });
  const event = link?.unrecorded[0];
  expect(event?.sameCurrency).toBe(true);
  const before = await rows(h, "select 1 from books.payment where order_id = $1", [seeded.orderId]);
  expect(await recordOrderPaypalAction(null, formOf({ event: event?.id as string, ...key("rec") }))).toEqual({ done: true });
  expect(await rows(h, "select 1 from books.payment where order_id = $1", [seeded.orderId])).toEqual(before);
  const draft = (await card(seeded.orderId))?.paypal?.drafts.find((d) => d.command === "payment.record");
  expect(draft).toBeTruthy();
  expect(await decideOrderPaypalAction(null, formOf({ draft: draft?.id as string, verdict: "approved", ...key("ok") }))).toEqual({ done: true });
  const written = await rows<{ method: string; created_by: string }>(h, "select method, created_by::text from books.payment where order_id = $1", [seeded.orderId]);
  expect(written).toEqual([{ method: "paypal", created_by: h.k.owner.memberId }]);
  expect((await card(seeded.orderId))?.paypal?.links[0]?.state).toBe("recorded");
});

test("chat to order to PayPal from the screens: Draft order, approve it, Send PayPal link for the order's due cell, approve it, its WhatsApp message, approve that", async () => {
  // 1. The agent reads the fresh message and drafts the order (a recorded response).
  const text = PAYPAL_ORDER_DEMO.freshText;
  if (WRITING) script.turns = [{ json: { lines: [{ item: pick(text, "Wheat flour 5 kg"), quantity: pick(text, "1") }, { item: pick(text, "Butter 100 g"), quantity: pick(text, "2") }] } }];
  expect(await draftOrderAction(null, formOf({ message: seeded.freshMessageId }))).toEqual({ note: "orderDrafted", ok: true });
  const page = await loadOrders(h.k.owner);
  const drafted = page?.drafts.find((d) => d.message === text);
  expect(drafted).toBeTruthy();
  // 2. The owner approves the order.
  expect(await decideOrderAction(null, formOf({ draft: drafted?.id as string, verdict: "approved", ...key("order") }))).toEqual({ done: true });
  const [made] = await rows<{ id: string }>(h, "select id::text from books.order where customer_id = $1", [seeded.freshCustomerId]);
  const orderId = made?.id as string;

  // 3. Send PayPal link: offered with the order's due cell (one flour, two butter at the books' prices).
  const offered = await card(orderId);
  expect(offered?.amount(offered.paypal?.due)).toEqual({ t: "money", minor: 24_000 + 2 * 6_200, currency: "INR" });
  expect(await sendOrderPaypalAction(null, formOf({ order: orderId, ...key("send") }))).toEqual({ done: true });
  expect(await rows(h, "select 1 from ops.paypal_link where order_id = $1", [orderId])).toEqual([]); // nothing at PayPal before approval
  const asked = await card(orderId);
  expect(asked?.paypal?.due).toBeNull();
  const linkDraft = asked?.paypal?.drafts.find((d) => d.command === "paypal.request");
  expect(asked?.amount(linkDraft?.amount)).toEqual({ t: "money", minor: 24_000 + 2 * 6_200, currency: "INR" });
  // Counter staff may not decide it.
  signInAs(h.k.staff[0] as { tenantId: string; memberId: string });
  expect(await decideOrderPaypalAction(null, formOf({ draft: linkDraft?.id as string, verdict: "approved", ...key("staff") }))).toEqual({ error: "refused" });
  signInAs(h.k.owner);
  expect(await decideOrderPaypalAction(null, formOf({ draft: linkDraft?.id as string, verdict: "approved", ...key("link") }))).toEqual({ done: true });
  const [link] = await rows<{ id: string; created_by: string }>(h, "select id::text, created_by::text from ops.paypal_link where order_id = $1", [orderId]);
  expect(link?.created_by).toBe(h.k.owner.memberId);
  await sweepShopPaypal(h.db.jobs, h.k.tenantId); // the jobs role's tick (this test's app has no jobs pool)

  // 4. Its WhatsApp message: drafted on its own, sent only on its own approval.
  expect((await card(orderId))?.paypal?.links[0]?.state).toBe("sent");
  expect(await messageOrderPaypalAction(null, formOf({ link: link?.id as string, ...key("msg") }))).toEqual({ done: true });
  const message = (await card(orderId))?.paypal?.drafts.find((d) => d.command === "customer.remind");
  expect(message).toBeTruthy();
  expect(await rows(h, "select 1 from books.outbound_message where template_code = 'paypal_link' and recipient_id = $1", [seeded.freshCustomerId])).toEqual([]);
  expect(await decideOrderPaypalAction(null, formOf({ draft: message?.id as string, verdict: "approved", ...key("send-msg") }))).toEqual({ done: true });
  expect(await rows(h, "select 1 from books.outbound_message where template_code = 'paypal_link' and recipient_id = $1", [seeded.freshCustomerId])).toHaveLength(1);
  expect((await card(orderId))?.paypal?.links[0]).toMatchObject({ state: "sent", messaged: true });

  // The card in both languages: labelled PayPal sandbox (recorded: nothing is sent), every digit a source chip.
  const data = (await loadOrders(h.k.owner)) as NonNullable<Awaited<ReturnType<typeof loadOrders>>>;
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <OrdersView data={data} />
      </LangProvider>,
    );
    expect(screen.getAllByText(/PayPal sandbox/).length).toBeGreaterThan(0);
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
});
