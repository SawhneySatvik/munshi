// PayPal on the demo kirana (PayPal's sandbox; recorded mode, no network), seeded after seedKirana through core's real
// paths, as the shop's people would: every book row is a person's own direct command, every PayPal link an approved
// draft, and PayPal's paid notice is stored the way the webhook stores one (the public role, no actor, no book row).
//   - Neha J. (synthetic): a customer with a WhatsApp number and service consent, whose opening balance from the paper
//     khata was due ten days ago. From the first watcher run of the day (pnpm dev's ticker runs one within a minute) her
//     overdue_credit finding offers both fixes, the reminder and "Send a PayPal link"; approving the link sends it to her
//     on WhatsApp (recorded on this sample shop).
//   - Sunita P. (a planted overdue customer): a PayPal link the manager drafted and the owner approved, made in recorded
//     mode, and a paid notice for it, labelled on screen as a recorded demo (PayPal sent nothing). The books do not show
//     the payment, so the paypal_unrecorded watcher raises it, and its fix drafts "record this payment" for a person.
// Everything here happens now, after the recorded as_of the replayed answers use: no read as of that day changes (the
// credit book, the overdue total and the answers' reads stop at its end), so the recorded fixtures still match.
import { createHash } from 'node:crypto';
import { decide, runCommand, withPage } from '@munshi/core';
import { proposePaypalLink, receivePaypalPaid, sweepShopPaypal, wiredPayPal, wirePayPal } from '@munshi/core/paypal';
import type pg from 'pg';
import { recordedPayPal } from '../../packages/adapters/payments/index.ts';
import type { Kirana } from './kirana.ts';

export const PAYPAL_DEMO = {
  customer: 'Neha J.',
  phone: '+919800000102', // synthetic
  openingMinor: 84_000, // ₹840 from the paper khata
  dueDaysAgo: 10,
  paid: 'Sunita P.',
  eventId: 'WH-RECORDED-DEMO-SUNITA', // a recorded demo notice: PayPal sent nothing
} as const;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export async function seedKiranaPaypal(pools: { app: pg.Pool; jobs: pg.Pool; pub: pg.Pool }, k: Kirana): Promise<{ customerId: string; linkId: string; eventId: string }> {
  const { app, jobs, pub } = pools;
  // Neha J.: her number and her consent to service messages on WhatsApp, given in person; then her opening balance.
  const customerId = (await runCommand(app, k.owner, 'customer.create', { name: PAYPAL_DEMO.customer, phone: PAYPAL_DEMO.phone })).customerId as string;
  await runCommand(app, k.owner, 'consent.record', { customerId, channel: 'whatsapp', purpose: 'service', granted: true, source: 'in_person', noticeVersion: 'v1' });
  const due = daysAgo(PAYPAL_DEMO.dueDaysAgo);
  await runCommand(app, k.owner, 'credit.record', { customerId, amountMinor: PAYPAL_DEMO.openingMinor, dueOn: due < today() ? due : daysAgo(1) });

  // Sunita P.: a link for her balance, drafted by the manager and approved by the owner, made in recorded mode.
  const sunita = k.customers.get(PAYPAL_DEMO.paid);
  if (!sunita) throw new Error(`seed: no ${PAYPAL_DEMO.paid} in the kirana seed`);
  const draftId = await proposePaypalLink(app, { session: k.manager }, { customerId: sunita });
  const decided = await decide(app, k.owner, draftId, 'approved');
  if (decided.status !== 'executed') throw new Error(`seed: the PayPal link was ${decided.status}`);
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
  if (!link?.paypal_id) throw new Error('seed: the PayPal link was not made');
  // The paid notice, stored as the webhook stores a verified one: by the public role, under the link's shop, no actor.
  const raw = `recorded demo notice for ${link.paypal_id}`;
  const stored = await receivePaypalPaid(
    pub,
    { eventId: PAYPAL_DEMO.eventId, paypalId: link.paypal_id, status: 'PAID', paidMinor: Number(link.amount_minor), currency: link.currency },
    createHash('sha256').update(raw).digest('hex'),
  );
  if (stored !== 'stored') throw new Error(`seed: the paid notice was ${stored}`);
  return { customerId, linkId: link.id, eventId: PAYPAL_DEMO.eventId };
}
