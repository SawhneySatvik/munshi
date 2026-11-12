// A PayPal link PayPal has made (state `sent`: made, not paid yet), with its payer URL. A link's item id is its id and
// its state, so the same link triggers again only if it comes back to this state, which links never do.
'use strict';

const { amountFields, fetchFeed, shopFields } = require('../feed');

const perform = async (z, bundle) => {
  const feed = await fetchFeed(z, bundle);
  return feed.links
    .filter((l) => l.state === 'sent')
    .map((l) => ({
      id: l.id,
      link_id: l.linkId,
      state: l.state,
      purpose: l.purpose,
      customer_id: l.customer.id,
      customer_name: l.customer.name,
      ...amountFields('amount', l.amount),
      payer_url: l.payerUrl,
      mode: l.mode,
      created_at: l.createdAt,
      sent_at: l.sentAt,
      ...shopFields(feed),
    }));
};

module.exports = {
  key: 'paypal_link_made',
  noun: 'PayPal Link',
  display: {
    label: 'New PayPal Link Made',
    description: 'Triggers when PayPal (sandbox) has made a payment link a person approved in Munshi, with the payer URL.',
  },
  operation: {
    perform,
    sample: {
      id: '00000000-0000-4000-8000-000000000002:sent',
      link_id: '00000000-0000-4000-8000-000000000002',
      state: 'sent',
      purpose: 'credit',
      customer_id: '00000000-0000-4000-8000-000000000003',
      customer_name: 'Sample Customer (synthetic)',
      amount: '₹500',
      amount_minor: 50000,
      amount_currency: 'INR',
      amount_source: '⟨snap:00000000-0000-4000-8000-000000000004·0·balance⟩',
      payer_url: 'https://www.sandbox.paypal.com/invoice/p/#SAMPLE-INVOICE-ID',
      mode: 'sandbox',
      created_at: '2026-11-01T09:00:00.000Z',
      sent_at: '2026-11-01T09:00:05.000Z',
      shop_slug: 'sample-shop',
      shop_name: 'Sample Shop (synthetic)',
      shop_label: 'Sample shop: synthetic data',
      paypal_label: 'PayPal sandbox: payments are recorded, never processed by Munshi',
    },
    outputFields: [
      { key: 'customer_name', label: 'Customer' },
      { key: 'purpose', label: 'For (credit, invoice or order)' },
      { key: 'amount', label: 'Amount asked' },
      { key: 'amount_minor', label: 'Amount (minor units)', type: 'integer' },
      { key: 'amount_currency', label: 'Currency' },
      { key: 'amount_source', label: 'Amount source (the stored cell)' },
      { key: 'payer_url', label: 'PayPal payer URL' },
      { key: 'mode', label: 'Mode (sandbox or recorded)' },
      { key: 'sent_at', label: 'Made at', type: 'datetime' },
      { key: 'shop_name', label: 'Shop' },
      { key: 'shop_label', label: 'Shop label' },
    ],
  },
};
