// Agentic commerce with PayPal on the demo kirana (PayPal's sandbox; recorded mode, no network), seeded after
// seedKiranaPaypal through core's real paths, as the shop's people would: every book row is a person's own direct command
// or an approved draft, PayPal's paid notice is stored the way the webhook stores one (the public role, no actor, no book
// row), and a customer's WhatsApp message is stored the way the webhook stores one too (recorded: the shop's channel is
// not live).
//   - Kavya R. (synthetic) wrote on WhatsApp for flour and butter and said she would pay online. Her request became an
//     order the owner confirmed; a PayPal link for what the order needs, drafted by the manager and approved by the owner,
//     made in recorded mode; its WhatsApp message approved by the owner; and a paid notice for it, labelled on screen as a
//     recorded demo (PayPal sent nothing). The books do not show the payment, so the paypal_unrecorded watcher raises it,
//     and its fix drafts the order's advance by PayPal for a person to approve.
//   - Irfan M. (synthetic) wrote the same kind of message and nothing has happened yet: in the inbox, "Draft order" runs
//     the agent on it (a recorded response, apps/web/fixtures/inbox), and the rest of the walk is a person's to take.
// Everything here happens after the recorded as_of the replayed answers use (now), and no read as of that day changes:
// an order and its advance are no sale and no credit, so the recorded fixtures still match.
import { createHash, randomUUID } from 'node:crypto';
import { decide, handleInbound, intakeWhatsapp, runCommand, withPage, withTx } from '@munshi/core';
import { messagePaypalLink, proposePaypalLink, receivePaypalPaid, sweepShopPaypal, wiredPayPal, wirePayPal } from '@munshi/core/paypal';
import type pg from 'pg';
import { recordedPayPal } from '../../packages/adapters/payments/index.ts';
import type { Kirana } from './kirana.ts';

export const PAYPAL_ORDER_DEMO = {
  paid: { name: 'Kavya R.', phone: '+919800000104' }, // synthetic
  paidText: "Namaste! Please send 2 Wheat flour 5 kg and 1 Butter 100 g. I'll pay online.",
  eventId: 'WH-RECORDED-DEMO-KAVYA', // a recorded demo notice: PayPal sent nothing
  fresh: { name: 'Irfan M.', phone: '+919800000105' }, // synthetic
  freshText: "Hello, please send 1 Wheat flour 5 kg and 2 Butter 100 g. I'll pay by PayPal.",
} as const;

async function reachable(app: pg.Pool, k: Kirana, who: { name: string; phone: string }): Promise<string> {
  const customerId = (await runCommand(app, k.owner, 'customer.create', { name: who.name, phone: who.phone })).customerId as string;
  await runCommand(app, k.owner, 'consent.record', { customerId, channel: 'whatsapp', purpose: 'service', granted: true, source: 'in_person', noticeVersion: 'v1' });
  return customerId;
}

// A WhatsApp text as the webhook stores one: the public role, under the shop's context, no actor.
async function received(pub: pg.Pool, tenantId: string, from: string, text: string): Promise<string> {
  const id = randomUUID();
  await withTx(pub, { kind: 'system', tenantId }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, $3, $4, 'text', $5, now())`,
      [tenantId, id, `wamid.recorded-demo-${randomUUID()}`, from, text],
    ),
  );
  return id;
}

export async function seedKiranaPaypalOrder(
  pools: { app: pg.Pool; jobs: pg.Pool; pub: pg.Pool },
  k: Kirana,
): Promise<{ orderId: string; linkId: string; eventId: string; freshMessageId: string; freshCustomerId: string }> {
  const { app, jobs, pub } = pools;
  const flour = k.items.get('Wheat flour 5 kg');
  const butter = k.items.get('Butter 100 g');
  if (!flour || !butter) throw new Error('seed: no flour or butter in the kirana catalogue');

  // Kavya R.: her message, the request it made, and the order the owner confirmed from it.
  const kavya = await reachable(app, k, PAYPAL_ORDER_DEMO.paid);
  const messageId = await received(pub, k.tenantId, PAYPAL_ORDER_DEMO.paid.phone, PAYPAL_ORDER_DEMO.paidText);
  const { requestId } = await withTx(pub, { kind: 'system', tenantId: k.tenantId }, (c) => intakeWhatsapp(c, { shopId: k.shopId, inboundMessageId: messageId }));
  const orderId = (
    await runCommand(app, k.owner, 'order.confirm', {
      requestId,
      customerId: kavya,
      lines: [
        { itemId: flour, qtyMilli: 2000 },
        { itemId: butter, qtyMilli: 1000 },
      ],
    })
  ).orderId as string;
  await handleInbound(app, k.owner, messageId, 'handled');

  // A PayPal link for what the order needs, drafted by the manager and approved by the owner, made in recorded mode.
  const draftId = await proposePaypalLink(app, { session: k.manager }, { orderId });
  const decided = await decide(app, k.owner, draftId, 'approved');
  if (decided.status !== 'executed') throw new Error(`seed: the order's PayPal link was ${decided.status}`);
  const before = wiredPayPal();
  wirePayPal(recordedPayPal());
  try {
    await sweepShopPaypal(jobs, k.tenantId);
  } finally {
    wirePayPal(before);
  }
  const link = await withPage(app, k.owner, async (c) =>
    (
      await c.query<{ id: string; paypal_id: string | null; amount_minor: string; currency: string }>(
        'select id::text, paypal_id, amount_minor::text, currency from ops.paypal_link where draft_id = $1',
        [draftId],
      )
    ).rows[0],
  );
  if (!link?.paypal_id) throw new Error("seed: the order's PayPal link was not made");

  // Its WhatsApp message, drafted and approved on its own (recorded delivery on this sample shop).
  const message = await messagePaypalLink(app, k.owner, link.id);
  if (message.outcome !== 'drafted' || !message.draftId) throw new Error(`seed: the link's message was ${message.outcome}`);
  const sent = await decide(app, k.owner, message.draftId, 'approved');
  if (sent.status !== 'executed') throw new Error(`seed: the link's message was ${sent.status}`);

  // The paid notice, stored as the webhook stores a verified one: by the public role, under the link's shop, no actor.
  const stored = await receivePaypalPaid(
    pub,
    { eventId: PAYPAL_ORDER_DEMO.eventId, paypalId: link.paypal_id, status: 'PAID', paidMinor: Number(link.amount_minor), currency: link.currency },
    createHash('sha256').update(`recorded demo notice for ${link.paypal_id}`).digest('hex'),
  );
  if (stored !== 'stored') throw new Error(`seed: the order's paid notice was ${stored}`);

  // Irfan M.: a fresh message, for the agent to read when a person taps "Draft order".
  const freshCustomerId = await reachable(app, k, PAYPAL_ORDER_DEMO.fresh);
  const freshMessageId = await received(pub, k.tenantId, PAYPAL_ORDER_DEMO.fresh.phone, PAYPAL_ORDER_DEMO.freshText);
  return { orderId, linkId: link.id, eventId: PAYPAL_ORDER_DEMO.eventId, freshMessageId, freshCustomerId };
}
