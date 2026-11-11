// PayPal for an order (sandbox, recorded mode: no network), against the real guards, RLS and roles: a customer's
// WhatsApp message becomes an order the agent drafts and a person approves; a PayPal link for what that order still
// needs is its own draft, its amount the order's order.due cell; the WhatsApp message carrying the link is another;
// PayPal's paid notice is a finding whose fix records the order's advance by PayPal, a fourth. Each is a separate
// approval with a person's name on it. Every test makes its own customers and orders (the red-proof harness runs each
// alone). What is proved:
//   PP-ORD1 end to end: chat → order draft → approval → link draft citing order.due → approval → sweep → message draft →
//           approval → paid notice → finding → payment.record of the order's advance by PayPal → approval; the inbox
//           shows the order and where its link stands; the order owes nothing after;
//   PP-ORD2 nothing reaches PayPal or the books before approval; counter staff can neither ask for an order's link nor
//           approve one;
//   PP-ORD3 the amount is the order's due cell: a typed amount, another order's due, the order's total, another
//           customer or a closed order are each refused;
//   PP-ORD4 the link table's guard binds the order: an approved draft's link naming another order is refused;
//   PP-ORD5 the PayPal links read (Ask's) is the office's and the shop's own: staff are refused, another shop sees
//           none, and the agent's database role reads no link table;
//   PP-ORD6 a payment PayPal reports for an order cancelled since repays the customer's credit, not the closed order.
// Red-proofs: test/v2/sabotage/paypal-commerce.ts.
import { createHash } from 'node:crypto';
import {
  type CellRef,
  type CoreError,
  decide,
  intakeWhatsapp,
  proposeDraft,
  requestDrafted,
  resolveRef,
  runCommand,
  runWatchers,
  switchCapability,
  viewInbox,
  withPage,
} from '@munshi/core';
import { linkOfDraft, messagePaypalLink, ordersPaypal, proposePaypalLink, receivePaypalPaid, sweepShopPaypal, wirePayPal } from '@munshi/core/paypal';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type LinkRequest, type PayPal, recordedPayPal } from '../../../../../packages/adapters/payments/index.ts';
import { draftOrder } from '../../../../../packages/agent/src/order-draft.ts';
import { draftFix } from '../../../../../packages/agent/src/run.ts';
import { prepare, scripted } from '../../../../../packages/agent/test/script.ts';
import { formatRef, parseRef } from '../../../../../packages/core/src/read.ts';
import { mintIn } from '../../../../../packages/core/src/snapshots.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { inboxRun, pick } from '../agent/lib.ts';
import { asPublic, inbound, type OrderShop, orderShop, TEA } from '../orders/lib.ts';

const SUITE = 'paypal-commerce';
const MESSAGE = "Namaste, please send 2 Assam tea 250 g today. I'll pay online.";

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: OrderShop;
let b: OrderShop; // another shop
const calls: LinkRequest[] = [];

const recorded = recordedPayPal();
const spy: PayPal = {
  mode: recorded.mode,
  label: recorded.label,
  invoice: (id) => recorded.invoice(id),
  verifyWebhook: (raw, h) => recorded.verifyWebhook(raw, h),
  createLink: async (r) => {
    calls.push(r);
    return recorded.createLink(r);
  },
  cancel: (id, requestId) => recorded.cancel(id, requestId),
};

beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = db.as('munshi_jobs');
  wirePayPal(spy);
  s = await orderShop(app, 'PayPal orders');
  b = await orderShop(app, 'Other orders');
  for (const shop of [s, b]) for (const cap of ['credit', 'messaging', 'orders'] as const) await switchCapability(app, shop.owner, cap, true).catch(() => {});
  await db.sabotage();
}, 240_000);
afterAll(async () => {
  wirePayPal(null);
  await db?.close();
});

const q = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await tx(app, { tenant_id: s.tenantId }, (c) => c.query(sql, values))).rows as T[];
type Counts = { books: number; payments: number; messages: number; drafts: number; links: number; events: number };
const counts = async () =>
  (
    await q<Counts>(
      `select (select count(*) from books.payment)::int + (select count(*) from books.credit_entry)::int + (select count(*) from books.journal_entry)::int
                + (select count(*) from books.outbound_message)::int + (select count(*) from books.order)::int as books,
              (select count(*) from books.payment)::int as payments, (select count(*) from books.outbound_message)::int as messages,
              (select count(*) from approval.draft)::int as drafts, (select count(*) from ops.paypal_link)::int as links,
              (select count(*) from ops.payment_event)::int as events`,
    )
  )[0] as Counts;
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as CoreError & { code: string; fields?: string[]; sqlstate?: string });
const sqlstate = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? 'no code');
const sha = createHash('sha256').update('recorded order notice').digest('hex');
let phones = 0;

/** A customer reachable on WhatsApp: a number, and service consent given in person. */
async function customer(shop: OrderShop, name: string): Promise<string> {
  const phone = `+9198000004${String(++phones).padStart(2, '0')}`;
  const id = (await runCommand(app, shop.owner, 'customer.create', { name, phone })).customerId as string;
  await runCommand(app, shop.owner, 'consent.record', { customerId: id, channel: 'whatsapp', purpose: 'service', granted: true, source: 'in_person', noticeVersion: 'v1' });
  return id;
}

/** An order a manager takes for `packs` of tea, with `advance` paid in cash: its id. */
async function order(shop: OrderShop, customerId: string, packs: number, advance = 0): Promise<string> {
  const orderId = (await runCommand(app, shop.manager, 'order.confirm', { shopId: shop.shopId, customerId, lines: [{ itemId: shop.tea, qtyMilli: packs * 1000 }] }))
    .orderId as string;
  if (advance) await runCommand(app, shop.manager, 'payment.record', { orderId, direction: 'in', method: 'cash', amountMinor: advance });
  return orderId;
}

const dueCell = (shop: OrderShop, orderId: string) =>
  withPage(app, shop.owner, async (c) => {
    const due = await mintIn(c, 'order.due', { order_id: orderId });
    return { snapshotId: due.id, row: 0, col: 'due' } as CellRef;
  });

it('chat to order to PayPal: the agent drafts the order, a person approves it, the link asks for the order’s due cell, and its message and its payment are each their own approval', async () => {
  const who = await customer(s, 'Pays online (synthetic)');
  // The customer's message, stored as the webhook stores it, and the request it makes.
  const messageId = await inbound(db, s.tenantId, 'text', MESSAGE);
  const { requestId } = await asPublic(db, s.tenantId, (c) => intakeWhatsapp(c, { shopId: s.shopId, inboundMessageId: messageId }));
  // 1. The agent reads it and drafts the order (the model points at words; core reads the quantity and the item).
  const run = await inboxRun(db, s.manager);
  const script = scripted(SUITE, [{ json: { lines: [{ item: pick(MESSAGE, 'Assam tea 250 g'), quantity: pick(MESSAGE, '2') }] } }]);
  const drafted = await draftOrder({ requestId, messageId, customer: { customerId: who } }, { port: run.port, deps: script.deps });
  expect(script.left()).toBe(0);
  expect(drafted.kind).toBe('drafted');
  if (drafted.kind !== 'drafted') return;
  await requestDrafted(app, s.manager, requestId, drafted.draftId);
  // 2. The owner approves the order.
  const confirmed = await decide(app, s.owner, drafted.draftId, 'approved');
  if (confirmed.status !== 'executed') throw new Error(`the order was ${confirmed.status}`);
  const orderId = confirmed.result.orderId as string;

  // 3. A PayPal link for what the order still needs, proposed by the manager: its figure the order's order.due cell.
  const before = await counts();
  const called = calls.length;
  const linkDraft = await proposePaypalLink(app, { session: s.manager }, { orderId });
  const [d] = await q<{ payload: Record<string, string>; based_on: CellRef[]; payload_refs: Record<string, unknown> }>(
    'select payload, based_on, payload_refs from approval.draft where id = $1',
    [linkDraft],
  );
  expect(d?.payload).toMatchObject({ purpose: 'order', orderId, customerId: who });
  expect(d?.payload_refs).toEqual({});
  const figure = parseRef(d?.payload.figure as string) as CellRef;
  expect(d?.based_on).toContainEqual(figure);
  const [snap] = await q<{ query_name: string; order_id: string }>(`select query_name, params ->> 'order_id' as order_id from snap.snapshot where id = $1`, [figure.snapshotId]);
  expect([snap, figure.col]).toEqual([{ query_name: 'order.due', order_id: orderId }, 'due']);
  expect(await withPage(app, s.owner, (c) => resolveRef(c, figure))).toEqual({ kind: 'money', num: String(2 * TEA), currency: 'INR' });
  expect(await counts()).toEqual({ ...before, drafts: before.drafts + 1 });
  expect(calls.length).toBe(called);

  // The board shows the waiting link draft on the order's card, and no second "Send PayPal link".
  const board = await withPage(app, s.owner, (c) => ordersPaypal(c, s.owner.memberId, [{ orderId, customerId: who }]));
  expect(board?.byOrder[orderId]).toMatchObject({ due: null, links: [], drafts: [{ id: linkDraft, command: 'paypal.request', figure }] });

  // Approved by the owner: one link for this order, under the owner, for the cell's amount; PayPal is asked by the sweep.
  expect((await decide(app, s.owner, linkDraft, 'approved')).status).toBe('executed');
  const linkId = (await linkOfDraft(app, s.owner, linkDraft)) as string;
  const [link] = await q<{ purpose: string; order_id: string; amount_minor: string; created_by: string; status: string }>(
    'select purpose, order_id::text, amount_minor::text, created_by::text, status from ops.paypal_link where id = $1',
    [linkId],
  );
  expect(link).toEqual({ purpose: 'order', order_id: orderId, amount_minor: String(2 * TEA), created_by: s.owner.memberId, status: 'queued' });
  expect(calls.length).toBe(called);
  expect((await counts()).books).toBe(before.books);
  await sweepShopPaypal(jobs, s.tenantId);
  expect(calls.slice(called)).toEqual([{ requestId: linkDraft, amountMinor: 2 * TEA, currency: 'INR', reference: linkId }]);

  // 4. The WhatsApp message carrying it is its own draft, and goes only on its own approval; its words speak of the order.
  const message = await messagePaypalLink(app, s.owner, linkId);
  expect(message.outcome).toBe('drafted');
  expect((await counts()).messages).toBe(before.messages);
  expect((await decide(app, s.owner, message.draftId as string, 'approved')).status).toBe('executed');
  const [sent] = await q<{ body: string }>(
    `select t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id
      where m.template_code = 'paypal_link' and m.recipient_id = $1`,
    [who],
  );
  expect(sent?.body).toMatch(/is due for your order; pay it by PayPal \(sandbox\): PayPal sandbox link REC-/);

  // 5. PayPal's paid notice: stored, no book row; the watcher raises it; its fix records the order's advance by PayPal.
  const [made] = await q<{ paypal_id: string }>('select paypal_id from ops.paypal_link where id = $1', [linkId]);
  const mid = await counts();
  expect(
    await receivePaypalPaid(pub, { eventId: `WH-ORD-${linkId}`, paypalId: made?.paypal_id as string, status: 'PAID', paidMinor: 2 * TEA, currency: 'INR' }, sha),
  ).toBe('stored');
  expect(await counts()).toEqual({ ...mid, events: mid.events + 1 });
  const w = await runWatchers(jobs, s.tenantId);
  const finding = w.raised.find((f) => f.kind === 'paypal_unrecorded');
  expect(finding).toBeTruthy();
  const r = agentPort({ app, agent: db.as('munshi_agent') }, s.owner, await startRun({ app, agent: db.as('munshi_agent') }, s.owner));
  const fix = await draftFix(finding?.findingId as string, { port: r.port, asOf: new Date().toISOString().slice(0, 10) });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'payment.record', payload: { orderId, direction: 'in', method: 'paypal', amountMinor: 2 * TEA } });
  if (fix.kind !== 'proposed') return;
  expect((await counts()).payments).toBe(mid.payments);
  expect((await refusal(decide(app, s.staff, fix.draftId, 'approved')))?.code).toBe('refused');
  expect((await decide(app, s.owner, fix.draftId, 'approved')).status).toBe('executed');
  const paid = await q<{ order_id: string; method: string; created_by: string; amount_minor: string }>(
    'select order_id::text, method, created_by::text, amount_minor::text from books.payment where reference = $1',
    [made?.paypal_id],
  );
  expect(paid).toEqual([{ order_id: orderId, method: 'paypal', created_by: s.owner.memberId, amount_minor: String(2 * TEA) }]);
  // An advance, not a credit repayment: no credit entry, and the order now needs nothing.
  expect(await q('select 1 from books.credit_entry where customer_id = $1', [who])).toEqual([]);
  expect(await withPage(app, s.owner, async (c) => (await mintIn(c, 'order.due', { order_id: orderId })).rows[0]?.due)).toEqual({ kind: 'money', num: '0', currency: 'INR' });
  expect((await runWatchers(jobs, s.tenantId)).resolved).toContain(finding?.findingId);

  // The inbox shows the order the message became, and where its PayPal link stands.
  const inbox = await withPage(app, s.owner, (c) => viewInbox(c, s.owner));
  const [code] = await q<{ code: string }>('select code from books.order where id = $1', [orderId]);
  expect(inbox?.messages.find((m) => m.id === messageId)?.order).toEqual({ code: code?.code, paypal: 'recorded' });
});

it('nothing reaches PayPal or the books before approval; counter staff can neither ask for an order’s link nor approve one', async () => {
  const who = await customer(s, 'Staff case (synthetic)');
  const orderId = await order(s, who, 3, 5_000);
  const before = await counts();
  const called = calls.length;
  // Refused before anything is drafted: what an order still needs is the office's read.
  expect((await refusal(proposePaypalLink(app, { session: s.staff }, { orderId })))?.code).toBe('not_for_role');
  const draftId = await proposePaypalLink(app, { session: s.manager }, { orderId });
  expect(await withPage(app, s.owner, async (c) => resolveRef(c, parseRef((await c.query(`select payload ->> 'figure' as f from approval.draft where id = $1`, [draftId])).rows[0].f) as CellRef)))
    .toEqual({ kind: 'money', num: String(3 * TEA - 5_000), currency: 'INR' });
  expect((await refusal(decide(app, s.staff, draftId, 'approved')))?.code).toBe('refused');
  expect((await q<{ status: string }>('select status from approval.draft where id = $1', [draftId]))[0]?.status).toBe('proposed');
  expect(await counts()).toEqual({ ...before, drafts: before.drafts + 1 });
  expect(calls.length).toBe(called);
  // Staff see no PayPal on the board at all.
  expect(await withPage(app, s.staff, (c) => ordersPaypal(c, s.staff.memberId, [{ orderId, customerId: who }]))).toBeNull();
  await decide(app, s.owner, draftId, 'rejected', 'not_now');
  expect(await counts()).toEqual({ ...before, drafts: before.drafts + 1 });
  expect(calls.length).toBe(called);
});

it('the amount is the order’s due cell: a typed amount is refused, and so is another order’s due, the order’s total, another customer, or a closed order', async () => {
  const who = await customer(s, 'Amount case (synthetic)');
  const other = await customer(s, 'Amount case two (synthetic)');
  const orderId = await order(s, who, 1);
  const elsewhere = await order(s, other, 2);
  const own = await dueCell(s, orderId);
  const theirs = await dueCell(s, elsewhere);
  const total = await withPage(app, s.owner, async (c) => ({ snapshotId: (await mintIn(c, 'order.lines', { order_id: orderId })).id, row: 0, col: 'total' }) as CellRef);
  const propose = (payload: Record<string, unknown>, basedOn: CellRef[], payloadRefs: Record<string, CellRef> = {}) =>
    refusal(proposeDraft(app, { session: s.owner }, { command: 'paypal.request', payload, basedOn, payloadRefs }));
  const before = (await counts()).drafts;
  const typed = await propose({ purpose: 'order', orderId, customerId: who, figure: formatRef(own), amountMinor: TEA }, [own], { amountMinor: own });
  expect(typed?.code).toBe('invalid');
  const another = await propose({ purpose: 'order', orderId, customerId: who, figure: formatRef(theirs) }, [theirs]);
  expect([another?.code, another?.fields?.includes('figure')]).toEqual(['invalid', true]);
  const lines = await propose({ purpose: 'order', orderId, customerId: who, figure: formatRef(total) }, [total]);
  expect([lines?.code, lines?.fields?.includes('figure')]).toEqual(['invalid', true]);
  const stranger = await propose({ purpose: 'order', orderId, customerId: other, figure: formatRef(own) }, [own]);
  expect([stranger?.code, stranger?.fields?.includes('customerId')]).toEqual(['invalid', true]);
  // A cancelled order takes no link, and a draft made before the cancel is stale at approval.
  const waiting = await proposePaypalLink(app, { session: s.manager }, { orderId });
  await runCommand(app, s.manager, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  expect((await decide(app, s.owner, waiting, 'approved')).status).toBe('stale');
  const closed = await refusal(proposePaypalLink(app, { session: s.manager }, { orderId }));
  expect([closed?.code, closed?.fields?.includes('orderId')]).toEqual(['invalid', true]);
  expect((await counts()).drafts).toBe(before + 1);
  expect(await q('select 1 from ops.paypal_link where order_id = $1', [orderId])).toEqual([]);
});

it('the link guard binds the order: an approved draft’s link naming another order is refused by the database', async () => {
  const who = await customer(s, 'Guard case (synthetic)');
  const orderId = await order(s, who, 1);
  const elsewhere = await order(s, who, 1);
  const draftId = await proposePaypalLink(app, { session: s.manager }, { orderId });
  const [d] = await q<{ figure: string }>(`select payload ->> 'figure' as figure from approval.draft where id = $1`, [draftId]);
  const attempt = (forOrder: string) =>
    tx(app, { tenant_id: s.tenantId, actor_id: s.owner.memberId }, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into approval.decision (tenant_id, draft_id, verdict, decided_by) values ($1, $2, 'approved', $3) returning id::text`,
        [s.tenantId, draftId, s.owner.memberId],
      );
      await c.query(`select set_config('munshi.decision_id', $1, true)`, [rows[0]?.id]);
      await c.query(
        `insert into ops.paypal_link (tenant_id, draft_id, decision_id, purpose, customer_id, order_id, amount_minor, currency, figure, created_by)
         values ($1, $2, nullif(current_setting('munshi.decision_id', true), '')::uuid, 'order', $3, $4, $5, 'INR', $6, $7)`,
        [s.tenantId, draftId, who, forOrder, TEA, d?.figure, s.owner.memberId],
      );
      throw new Error('rolled back');
    });
  expect((await refusal(attempt(orderId)))?.message).toBe('rolled back'); // the draft's own order is admitted
  expect(await sqlstate(attempt(elsewhere))).toBe('MS007');
  await decide(app, s.owner, draftId, 'rejected', 'not_now');
});

it('the PayPal links read is the office’s and the shop’s own: staff are refused, another shop sees none, the agent role reads no link table', async () => {
  const who = await customer(s, 'Read case (synthetic)');
  const orderId = await order(s, who, 1);
  const draftId = await proposePaypalLink(app, { session: s.manager }, { orderId });
  expect((await decide(app, s.owner, draftId, 'approved')).status).toBe('executed');
  const linkId = (await linkOfDraft(app, s.owner, draftId)) as string;
  const mine = await withPage(app, s.owner, (c) => mintIn(c, 'paypal.links', {}));
  const row = mine.rows.find((r) => r.link_id?.kind === 'text' && r.link_id.txt === linkId);
  expect(row).toMatchObject({
    customer_id: { kind: 'text', txt: who },
    purpose: { kind: 'text', txt: 'order' },
    state: { kind: 'text', txt: 'asked' },
    amount: { kind: 'money', num: String(TEA), currency: 'INR' },
  });
  expect((await refusal(withPage(app, s.staff, (c) => mintIn(c, 'paypal.links', {}))))?.code).toBe('not_for_role');
  // Another shop's owner reads their own links only.
  const theirs = await withPage(app, b.owner, (c) => mintIn(c, 'paypal.links', {}));
  expect(theirs.rows.some((r) => r.link_id?.kind === 'text' && r.link_id.txt === linkId)).toBe(false);
  // The agent's runs read it as their member (an evidence snapshot) and only as that member may: staff are refused.
  const staffRun = agentPort({ app, agent: db.as('munshi_agent') }, s.staff, await startRun({ app, agent: db.as('munshi_agent') }, s.staff));
  expect((await refusal(staffRun.port.read('paypal.links', {})))?.code).toBe('not_for_role');
  const ownerRun = agentPort({ app, agent: db.as('munshi_agent') }, s.owner, await startRun({ app, agent: db.as('munshi_agent') }, s.owner));
  expect((await ownerRun.port.read('paypal.links', {})).rows.length).toBeGreaterThan(0);
  // The agent's own database role holds no grant on the links themselves.
  expect(await sqlstate(tx(db.as('munshi_agent'), { tenant_id: s.tenantId }, (c) => c.query('select 1 from ops.paypal_link')))).toBe('42501');
});

it('a payment PayPal reports for an order cancelled since is no advance: its fix repays the customer’s credit instead, still only on approval', async () => {
  const who = await customer(s, 'Cancelled case (synthetic)');
  const orderId = await order(s, who, 1);
  const draftId = await proposePaypalLink(app, { session: s.manager }, { orderId });
  expect((await decide(app, s.owner, draftId, 'approved')).status).toBe('executed');
  await sweepShopPaypal(jobs, s.tenantId);
  const [link] = await q<{ id: string; paypal_id: string }>('select id::text, paypal_id from ops.paypal_link where draft_id = $1', [draftId]);
  await runCommand(app, s.manager, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  expect(await receivePaypalPaid(pub, { eventId: `WH-ORD-CANCELLED-${link?.id}`, paypalId: link?.paypal_id as string, status: 'PAID', paidMinor: TEA, currency: 'INR' }, sha)).toBe(
    'stored',
  );
  const finding = (await runWatchers(jobs, s.tenantId)).raised.find((f) => f.kind === 'paypal_unrecorded');
  const r = agentPort({ app, agent: db.as('munshi_agent') }, s.owner, await startRun({ app, agent: db.as('munshi_agent') }, s.owner));
  const fix = await draftFix(finding?.findingId as string, { port: r.port, asOf: new Date().toISOString().slice(0, 10) });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'payment.record', payload: { customerId: who, direction: 'in', method: 'paypal', amountMinor: TEA } });
  if (fix.kind !== 'proposed') return;
  expect(fix.payload).not.toHaveProperty('orderId');
  expect(await q('select 1 from books.payment where reference = $1', [link?.paypal_id])).toEqual([]);
  expect((await decide(app, s.owner, fix.draftId, 'approved')).status).toBe('executed');
  expect(await q<{ order_id: string | null; method: string }>('select order_id::text, method from books.payment where reference = $1', [link?.paypal_id])).toEqual([
    { order_id: null, method: 'paypal' },
  ]);
});
