// PayPal says paid, and the shop's books do not show it yet: the watcher's own rule (watch.paypal_unrecorded). The
// feed lists these newest first; each notification is one item, so it triggers once. Recording it stays a person's
// approval in Munshi.
'use strict';

const { amountFields, fetchFeed, shopFields } = require('../feed');

const perform = async (z, bundle) => {
  const feed = await fetchFeed(z, bundle);
  return feed.payments.map((p) => ({
    id: p.id,
    event_id: p.eventId,
    link_id: p.linkId,
    customer_id: p.customer.id,
    customer_name: p.customer.name,
    ...amountFields('amount', p.amount),
    reference: p.reference,
    matches_link: p.matchesLink,
    received_at: p.receivedAt,
    ...shopFields(feed),
  }));
};

module.exports = {
  key: 'paypal_payment_waiting',
  noun: 'Payment',
  display: {
    label: 'PayPal Payment Waiting to Be Recorded',
    description: 'Triggers when PayPal (sandbox) reports a payment that the shop’s books do not show yet. Recording it is still a person’s approval in Munshi.',
  },
  operation: {
    perform,
    sample: {
      id: '00000000-0000-4000-8000-000000000001:unrecorded',
      event_id: '00000000-0000-4000-8000-000000000001',
      link_id: '00000000-0000-4000-8000-000000000002',
      customer_id: '00000000-0000-4000-8000-000000000003',
      customer_name: 'Sample Customer (synthetic)',
      amount: '₹500',
      amount_minor: 50000,
      amount_currency: 'INR',
      amount_source: 'ops.payment_event:00000000-0000-4000-8000-000000000001',
      reference: 'SAMPLE-INVOICE-ID',
      matches_link: true,
      received_at: '2026-11-01T10:00:00.000Z',
      shop_slug: 'sample-shop',
      shop_name: 'Sample Shop (synthetic)',
      shop_label: 'Sample shop: synthetic data',
      paypal_label: 'PayPal sandbox: payments are recorded, never processed by Munshi',
    },
    outputFields: [
      { key: 'customer_name', label: 'Customer' },
      { key: 'amount', label: 'Amount PayPal received' },
      { key: 'amount_minor', label: 'Amount (minor units)', type: 'integer' },
      { key: 'amount_currency', label: 'Currency' },
      { key: 'amount_source', label: 'Amount source (the stored notification)' },
      { key: 'reference', label: 'PayPal invoice id' },
      { key: 'matches_link', label: 'Matches what the link asked', type: 'boolean' },
      { key: 'received_at', label: 'Received at', type: 'datetime' },
      { key: 'shop_name', label: 'Shop' },
      { key: 'shop_label', label: 'Shop label' },
      { key: 'paypal_label', label: 'PayPal label' },
    ],
  },
};
