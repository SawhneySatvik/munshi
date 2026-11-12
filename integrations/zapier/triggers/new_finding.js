// A finding a watcher raised (a money leak, a stock gap, a payment the books do not show), optionally of one desk or
// kind. Each finding triggers once, by its id. Its impact is the stored cell the watcher named.
'use strict';

const { amountFields, fetchFeed, shopFields, sourceText } = require('../feed');

const perform = async (z, bundle) => {
  const feed = await fetchFeed(z, bundle);
  const { desk, kind } = bundle.inputData || {};
  return feed.findings
    .filter((f) => (!desk || f.desk === desk) && (!kind || f.kind === kind))
    .map((f) => ({
      id: f.id,
      desk: f.desk,
      kind: f.kind,
      severity: f.severity,
      status: f.status,
      impact: f.impact ? f.impact.display : null,
      impact_value: f.impact ? f.impact.value : null,
      impact_currency: f.impact ? f.impact.currency : null,
      impact_unit: f.impact ? f.impact.unit : null,
      impact_source: f.impact ? sourceText(f.impact.source) : null,
      first_seen_at: f.firstSeenAt,
      last_seen_at: f.lastSeenAt,
      ...shopFields(feed),
    }));
};

module.exports = {
  key: 'new_finding',
  noun: 'Finding',
  display: {
    label: 'New Finding',
    description: 'Triggers when one of Munshi’s watchers raises a finding (for example overdue credit, or a PayPal payment not in the books).',
  },
  operation: {
    inputFields: [
      { key: 'desk', label: 'Desk', required: false, helpText: 'Only this desk’s findings, e.g. `credit` or `stock`. Leave empty for all.' },
      { key: 'kind', label: 'Kind', required: false, helpText: 'Only this kind, e.g. `overdue_credit` or `paypal_unrecorded`. Leave empty for all.' },
    ],
    perform,
    sample: {
      id: '00000000-0000-4000-8000-000000000005',
      desk: 'credit',
      kind: 'overdue_credit',
      severity: 'high',
      status: 'open',
      impact: '₹840',
      impact_value: '84000',
      impact_currency: 'INR',
      impact_unit: null,
      impact_source: '⟨snap:00000000-0000-4000-8000-000000000006·0·overdue⟩',
      first_seen_at: '2026-11-01T08:00:00.000Z',
      last_seen_at: '2026-11-01T08:00:00.000Z',
      shop_slug: 'sample-shop',
      shop_name: 'Sample Shop (synthetic)',
      shop_label: 'Sample shop: synthetic data',
      paypal_label: 'PayPal sandbox: payments are recorded, never processed by Munshi',
    },
    outputFields: [
      { key: 'desk', label: 'Desk' },
      { key: 'kind', label: 'Kind' },
      { key: 'severity', label: 'Severity' },
      { key: 'status', label: 'Status' },
      { key: 'impact', label: 'Impact' },
      { key: 'impact_source', label: 'Impact source (the stored cell)' },
      { key: 'first_seen_at', label: 'First seen', type: 'datetime' },
      { key: 'shop_name', label: 'Shop' },
      { key: 'shop_label', label: 'Shop label' },
    ],
  },
};
