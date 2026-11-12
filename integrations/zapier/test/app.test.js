// ZAP1: the app definition is valid for Zapier's platform and has no action that writes. ZAP2: the connection test
// sends the key as a bearer token and fails on Munshi's bare 404 (a wrong key, a wrong shop). ZAP3: each trigger maps
// the feed's items, every amount with its source, and the link trigger takes only links PayPal has made. Against a
// local HTTP server standing in for Munshi's feed, with a synthetic feed. Run: npm test (node --test).
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const zapier = require('zapier-platform-core');
// The same check `zapier validate` runs: the definition compiled and its functions cleaned, then Zapier's schema.
const schemaTools = require('zapier-platform-core/src/tools/schema');
const App = require('../index');

const appTester = zapier.createAppTester(App);
const KEY = 'k'.repeat(64);

const FEED = {
  shop: { slug: 'sample-shop', name: 'Sample Shop', dataClass: 'synthetic', label: 'Sample shop: synthetic data', paypal: 'PayPal sandbox: payments are recorded, never processed by Munshi' },
  readAt: '2026-11-01T12:00:00.000Z',
  links: [
    {
      id: 'link-paid:paid', linkId: 'link-paid', state: 'paid', purpose: 'credit', customer: { id: 'c1', name: 'Asha (synthetic)' },
      amount: { minor: 50000, currency: 'INR', display: '₹500', source: { kind: 'snapshot', ref: '⟨snap:s1·0·balance⟩', snapshotId: 's1', row: 0, col: 'balance' } },
      payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV-PAID', mode: 'sandbox', createdAt: '2026-11-01T09:00:00.000Z', sentAt: '2026-11-01T09:00:05.000Z', paidAt: '2026-11-01T11:00:00.000Z', at: '2026-11-01T11:00:00.000Z',
    },
    {
      id: 'link-made:sent', linkId: 'link-made', state: 'sent', purpose: 'order', customer: { id: 'c2', name: 'Bharat (synthetic)' },
      amount: { minor: 12550, currency: 'INR', display: '₹125.50', source: { kind: 'snapshot', ref: '⟨snap:s2·0·due⟩', snapshotId: 's2', row: 0, col: 'due' } },
      payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV-MADE', mode: 'sandbox', createdAt: '2026-11-01T10:00:00.000Z', sentAt: '2026-11-01T10:00:04.000Z', paidAt: null, at: '2026-11-01T10:00:04.000Z',
    },
    {
      id: 'link-asked:asked', linkId: 'link-asked', state: 'asked', purpose: 'invoice', customer: { id: 'c3', name: 'Chitra (synthetic)' },
      amount: { minor: 9900, currency: 'INR', display: '₹99', source: { kind: 'snapshot', ref: '⟨snap:s3·0·open⟩', snapshotId: 's3', row: 0, col: 'open' } },
      payerUrl: null, mode: null, createdAt: '2026-11-01T10:30:00.000Z', sentAt: null, paidAt: null, at: '2026-11-01T10:30:00.000Z',
    },
  ],
  payments: [
    {
      id: 'ev1:unrecorded', eventId: 'ev1', linkId: 'link-paid', customer: { id: 'c1', name: 'Asha (synthetic)' },
      amount: { minor: 50000, currency: 'INR', display: '₹500', source: { kind: 'row', table: 'ops.payment_event', id: 'ev1' } },
      reference: 'INV-PAID', matchesLink: true, receivedAt: '2026-11-01T11:00:00.000Z',
    },
  ],
  findings: [
    { id: 'f1', desk: 'credit', kind: 'overdue_credit', severity: 'high', status: 'open', impact: { kind: 'money', value: '84000', currency: 'INR', unit: null, display: '₹840', source: { kind: 'snapshot', ref: '⟨snap:s4·0·overdue⟩', snapshotId: 's4', row: 0, col: 'overdue' } }, firstSeenAt: '2026-11-01T08:00:00.000Z', lastSeenAt: '2026-11-01T08:00:00.000Z' },
    { id: 'f2', desk: 'stock', kind: 'expiry', severity: 'medium', status: 'open', impact: null, firstSeenAt: '2026-11-01T07:00:00.000Z', lastSeenAt: '2026-11-01T07:00:00.000Z' },
  ],
};

let server;
let baseUrl;
const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    seen.push({ path: url.pathname, shop: url.searchParams.get('shop'), auth: req.headers.authorization, method: req.method });
    const ok = req.method === 'GET' && url.pathname === '/api/integrations/v1/feed' && url.searchParams.get('shop') === 'sample-shop' && req.headers.authorization === `Bearer ${KEY}`;
    if (!ok) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(FEED));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const bundle = (authData = {}, inputData = {}) => ({ authData: { baseUrl, shop: 'sample-shop', apiKey: KEY, ...authData }, inputData });

test('ZAP1 the app is valid for Zapier and has no action that writes', () => {
  assert.deepEqual(schemaTools.validateApp(schemaTools.prepareApp(App)), []);
  assert.deepEqual(Object.keys(App.creates), []);
  assert.deepEqual(Object.keys(App.searches), []);
  assert.deepEqual(Object.keys(App.triggers).sort(), ['new_finding', 'paypal_link_made', 'paypal_payment_waiting']);
});

test('ZAP2 the connection test sends the key as a bearer token, and a wrong key or shop fails it', async () => {
  seen.length = 0;
  assert.deepEqual(await appTester(App.authentication.test, bundle()), { shop: 'Sample Shop', label: 'Sample shop: synthetic data' });
  assert.deepEqual(seen[0], { path: '/api/integrations/v1/feed', shop: 'sample-shop', auth: `Bearer ${KEY}`, method: 'GET' });
  await assert.rejects(appTester(App.authentication.test, bundle({ apiKey: 'wrong' })), /did not recognise this connection/);
  await assert.rejects(appTester(App.authentication.test, bundle({ shop: 'another-shop' })), /did not recognise this connection/);
});

test('ZAP3 the payment trigger maps each payment waiting to be recorded, with its stored row', async () => {
  const items = await appTester(App.triggers.paypal_payment_waiting.operation.perform, bundle());
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: 'ev1:unrecorded', event_id: 'ev1', link_id: 'link-paid', customer_id: 'c1', customer_name: 'Asha (synthetic)',
    amount: '₹500', amount_minor: 50000, amount_currency: 'INR', amount_source: 'ops.payment_event:ev1',
    reference: 'INV-PAID', matches_link: true, received_at: '2026-11-01T11:00:00.000Z',
    shop_slug: 'sample-shop', shop_name: 'Sample Shop', shop_label: 'Sample shop: synthetic data', paypal_label: FEED.shop.paypal,
  });
});

test('ZAP3 the link trigger takes only links PayPal has made, each with its payer URL and its stored cell', async () => {
  const items = await appTester(App.triggers.paypal_link_made.operation.perform, bundle());
  assert.deepEqual(items.map((i) => i.id), ['link-made:sent']);
  assert.equal(items[0].payer_url, 'https://www.sandbox.paypal.com/invoice/p/#INV-MADE');
  assert.equal(items[0].amount, '₹125.50');
  assert.equal(items[0].amount_source, '⟨snap:s2·0·due⟩');
  assert.equal(items[0].purpose, 'order');
});

test('ZAP3 the finding trigger maps each finding, and filters by desk and kind', async () => {
  const all = await appTester(App.triggers.new_finding.operation.perform, bundle());
  assert.deepEqual(all.map((i) => i.id), ['f1', 'f2']);
  assert.equal(all[0].impact, '₹840');
  assert.equal(all[0].impact_source, '⟨snap:s4·0·overdue⟩');
  assert.equal(all[1].impact, null);
  const credit = await appTester(App.triggers.new_finding.operation.perform, bundle({}, { desk: 'credit' }));
  assert.deepEqual(credit.map((i) => i.id), ['f1']);
  const expiry = await appTester(App.triggers.new_finding.operation.perform, bundle({}, { kind: 'expiry' }));
  assert.deepEqual(expiry.map((i) => i.id), ['f2']);
});

test('ZAP3 every sample is labelled synthetic', () => {
  for (const t of Object.values(App.triggers)) {
    assert.match(t.operation.sample.shop_label, /synthetic/);
    assert.match(t.operation.sample.shop_name, /synthetic/);
  }
});
