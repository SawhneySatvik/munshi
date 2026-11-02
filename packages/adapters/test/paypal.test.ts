// The PayPal adapter (payments/paypal.ts) with no network: the sandbox adapter against a scripted fetch that answers as
// PayPal's REST docs show, and recorded mode against a fetch that throws. Webhooks are verified by PayPal's own
// verify-webhook-signature (scripted here): the adapter never fetches the certificate URL a request names, and a
// transmission outside the window is refused before PayPal is asked.
import { afterEach, expect, test, vi } from 'vitest';
import { invoiceNumber, PayPalError, parsePaidEvent, paypalSandbox, paypalValue, recordedPayPal, type WebhookHeaders } from '../payments/index.ts';

const CLIENT_ID = 'test-client-id-AbCdEf0123456789';
const CLIENT_SECRET = 'test-client-secret-ZyXwVu9876543210';
const TOKEN = 'A21AAtest-access-token-QwErTy';
const WEBHOOK_ID = '0NH55953DH663215D';
const DRAFT = '0193f2a4-1b2c-7d3e-8f40-123456789abc';
const REQUEST = { requestId: DRAFT, amountMinor: 45_050, currency: 'INR', reference: 'MS-CREDIT-1' };
const NOW = Date.parse('2026-11-02T05:20:00Z');

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

// A scripted PayPal: each answer in turn, every call kept.
function scripted(answers: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
    const a = answers.shift();
    if (!a) throw new Error('scripted: no answer left');
    return new Response(a.status === 204 ? null : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const tokenAnswer = { status: 200, body: { access_token: TOKEN, token_type: 'Bearer', expires_in: 32400 } };
const sandbox = (fetch: typeof globalThis.fetch) => paypalSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, webhookId: WEBHOOK_ID, fetch, now: () => NOW });

afterEach(() => vi.restoreAllMocks());

test('PAYPAL-A1 sandbox: one OAuth token for many calls; a new invoice is searched for, created with our number and the request id, and sent for its payer link', async () => {
  const { fetch, calls } = scripted([
    tokenAnswer,
    { status: 200, body: { items: [], total_items: 0 } },
    { status: 201, body: { id: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'DRAFT' } },
    { status: 200, body: { href: 'https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5', rel: 'payer-view', method: 'GET' } },
    { status: 200, body: { id: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'SENT' } },
  ]);
  const pp = sandbox(fetch);
  const link = await pp.createLink(REQUEST);
  expect(link).toEqual({ paypalId: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'SENT', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5', mode: 'sandbox' });
  expect((await pp.invoice('INV2-Z56S-5LLA-Q52L-CPZ5')).status).toBe('SENT');
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST https://api-m.sandbox.paypal.com/v1/oauth2/token',
    'POST https://api-m.sandbox.paypal.com/v2/invoicing/search-invoices?page=1&page_size=1',
    'POST https://api-m.sandbox.paypal.com/v2/invoicing/invoices',
    'POST https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5/send',
    'GET https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5',
  ]);
  expect(calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);
  expect(calls[0]?.body).toBe('grant_type=client_credentials');
  for (const c of calls.slice(1)) expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
  expect(calls[2]?.headers['paypal-request-id']).toBe(DRAFT);
  const created = JSON.parse(calls[2]?.body ?? '{}');
  expect(created.detail).toMatchObject({ invoice_number: invoiceNumber(DRAFT), reference: 'MS-CREDIT-1', currency_code: 'INR' });
  expect(created.items).toEqual([{ name: 'Balance due', quantity: '1', unit_amount: { currency_code: 'INR', value: '450.50' } }]);
  expect(JSON.parse(calls[3]?.body ?? '{}')).toEqual({ send_to_recipient: false, send_to_invoicer: false });
});

test('PAYPAL-A2 a retry of the same request finds the invoice PayPal already holds and creates none', async () => {
  const { fetch, calls } = scripted([
    tokenAnswer,
    {
      status: 200,
      body: { items: [{ id: 'INV2-AAAA-BBBB-CCCC-DDDD', status: 'SENT', detail: { metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD' } } }] },
    },
  ]);
  const link = await sandbox(fetch).createLink(REQUEST);
  expect(link).toEqual({ paypalId: 'INV2-AAAA-BBBB-CCCC-DDDD', status: 'SENT', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD', mode: 'sandbox' });
  expect(calls.filter((c) => c.url.endsWith('/v2/invoicing/invoices'))).toEqual([]);
  expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ invoice_number: invoiceNumber(DRAFT) });
});

// ---- webhooks ----------------------------------------------------------------------------------------------------------
const PAID = JSON.stringify({
  id: 'WH-3F562076HD293871E-75F399086E414290U',
  event_type: 'INVOICING.INVOICE.PAID',
  resource: { invoice: { id: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'PAID', payments: { paid_amount: { currency_code: 'INR', value: '450.50' } } } },
});
const CERT = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42';
const headers = (time = '2026-11-02T05:19:23Z', cert = CERT, algo = 'SHA256withRSA'): WebhookHeaders => ({
  'paypal-transmission-id': 'db49fb10-1343-11ef-ac58-e32457403f67',
  'paypal-transmission-time': time,
  'paypal-transmission-sig': 'ab2tJk1VCFm4EqdSuKqezr38rTdY3JeRQlw94V1xYAIQVgLScAFn2XLRAhtyo/1jp8RZPO80hLpWfbdvvwyxK1u6L6NX==',
  'paypal-cert-url': cert,
  'paypal-auth-algo': algo,
});

test('PAYPAL-A3 a webhook verifies only when PayPal says SUCCESS for our webhook id; the cert URL is never fetched; stale, off-host or bad input is refused unasked', async () => {
  const ok = scripted([tokenAnswer, { status: 200, body: { verification_status: 'SUCCESS' } }]);
  expect(await sandbox(ok.fetch).verifyWebhook(Buffer.from(PAID), headers())).toBe(true);
  const asked = JSON.parse(ok.calls[1]?.body ?? '{}');
  expect(ok.calls[1]?.url).toBe('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  expect(asked).toMatchObject({ webhook_id: WEBHOOK_ID, transmission_id: 'db49fb10-1343-11ef-ac58-e32457403f67', auth_algo: 'SHA256withRSA', cert_url: CERT });
  expect(asked.webhook_event).toEqual(JSON.parse(PAID));
  expect(ok.calls.some((c) => c.url === CERT)).toBe(false);

  const bad = scripted([tokenAnswer, { status: 200, body: { verification_status: 'FAILURE' } }]);
  expect(await sandbox(bad.fetch).verifyWebhook(Buffer.from(PAID), headers())).toBe(false);
  const down = scripted([tokenAnswer, { status: 500, body: {} }]);
  expect(await sandbox(down.fetch).verifyWebhook(Buffer.from(PAID), headers())).toBe(false);

  // Refused before PayPal is asked: a transmission eleven minutes old (a replay), a missing signature, a body not JSON.
  const unasked = scripted([]);
  const pp = sandbox(unasked.fetch);
  expect(await pp.verifyWebhook(Buffer.from(PAID), headers('2026-11-02T05:09:00Z'))).toBe(false);
  expect(await pp.verifyWebhook(Buffer.from(PAID), { ...headers(), 'paypal-transmission-sig': null })).toBe(false);
  expect(await pp.verifyWebhook(Buffer.from('not json'), headers())).toBe(false);
  expect(await pp.verifyWebhook(Buffer.from(PAID), headers(undefined, 'https://evil.example.com/v1/notifications/certs/CERT-1'))).toBe(false);
  expect(await pp.verifyWebhook(Buffer.from(PAID), headers(undefined, 'http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1'))).toBe(false);
  expect(await pp.verifyWebhook(Buffer.from(PAID), headers(undefined, CERT, 'SHA1withRSA'))).toBe(false);
  expect(unasked.calls).toEqual([]);
  expect(await recordedPayPal().verifyWebhook(Buffer.from(PAID), headers())).toBe(false);
});

test('PAYPAL-A4 recorded mode never calls the network: every method runs with fetch throwing, and a retry gives the same link', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('network used in recorded mode');
  });
  const pp = recordedPayPal();
  const a = await pp.createLink(REQUEST);
  expect(await pp.createLink(REQUEST)).toEqual(a);
  expect(a).toMatchObject({ status: 'SENT', payerUrl: null, mode: 'recorded' });
  expect(a.paypalId).toMatch(/^REC-[0-9A-F]{20}$/);
  expect(await pp.invoice(a.paypalId)).toEqual({ paypalId: a.paypalId, status: 'SENT', paidMinor: null, currency: null });
  expect(await pp.verifyWebhook(Buffer.from(PAID), headers())).toBe(false);
  expect(pp.label).toBe('PayPal sandbox (recorded)');
  expect(spy).not.toHaveBeenCalled();
});

test('PAYPAL-A5 no client id, secret or token reaches an error, its stack or the console, whatever PayPal answers', async () => {
  const logged: string[] = [];
  for (const m of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')));
  const cases: { status: number; body: unknown }[][] = [
    [{ status: 401, body: { error: 'invalid_client', error_description: `Client Authentication failed for ${CLIENT_ID}` } }],
    [tokenAnswer, { status: 500, body: { name: 'INTERNAL_SERVER_ERROR', debug_id: TOKEN } }],
    [tokenAnswer, { status: 200, body: { items: [] } }, { status: 422, body: { details: [{ value: CLIENT_SECRET }] } }],
  ];
  const failures = cases.map((answers) => () => sandbox(scripted(answers).fetch).createLink(REQUEST));
  const down = (async () => {
    throw new Error(`connect ECONNREFUSED with ${CLIENT_SECRET}`);
  }) as typeof globalThis.fetch;
  failures.push(() => sandbox(down).createLink(REQUEST));
  const codes: string[] = [];
  for (const f of failures) {
    const err = await f().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PayPalError);
    const e = err as PayPalError;
    codes.push(e.code);
    const seen = [e.message, e.stack ?? '', JSON.stringify(e), String((e as { cause?: unknown }).cause ?? '')].join('\n');
    for (const secret of [CLIENT_ID, CLIENT_SECRET, TOKEN, Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')]) expect(seen).not.toContain(secret);
  }
  expect(codes).toEqual(['paypal_auth', 'paypal_http', 'paypal_http', 'paypal_network']);
  expect(logged).toEqual([]);
});

test('PAYPAL-A6 amounts by digits alone; the paid event keeps PayPal status, a partial payment is not PAID; other events are not read', () => {
  expect([paypalValue(45_050, 'INR'), paypalValue(5, 'USD'), paypalValue(100, 'INR')]).toEqual(['450.50', '0.05', '1.00']);
  for (const [n, cur] of [
    [0, 'INR'],
    [-1, 'INR'],
    [1.5, 'INR'],
    [100, 'JPY'],
    [100, 'inr'],
  ] as const)
    expect(() => paypalValue(n, cur)).toThrow(PayPalError);
  expect(parsePaidEvent(JSON.parse(PAID))).toEqual({
    eventId: 'WH-3F562076HD293871E-75F399086E414290U',
    paypalId: 'INV2-Z56S-5LLA-Q52L-CPZ5',
    status: 'PAID',
    paidMinor: 45_050,
    currency: 'INR',
  });
  expect(parsePaidEvent(JSON.parse(PAID.replace('"PAID"', '"PARTIALLY_PAID"')))?.status).toBe('PARTIALLY_PAID');
  expect(parsePaidEvent({ ...JSON.parse(PAID), event_type: 'INVOICING.INVOICE.CANCELLED' })).toBeNull();
  expect(parsePaidEvent({ ...JSON.parse(PAID), id: 'WH bad id' })).toBeNull();
});

test('PAYPAL-A7 every PayPal call gives up at its timeout; cancel closes an invoice once, and a retry of a cancel PayPal already did is done', async () => {
  // A PayPal that never answers: the call gives up at the timeout with a network code, not a hang.
  const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof globalThis.fetch;
  const started = Date.now();
  const err = await paypalSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, webhookId: WEBHOOK_ID, fetch: hang, timeoutMs: 50 }).createLink(REQUEST).catch((e: unknown) => e);
  expect((err as PayPalError).code).toBe('paypal_network');
  expect(Date.now() - started).toBeLessThan(5_000);

  const first = scripted([tokenAnswer, { status: 204, body: {} }]);
  await sandbox(first.fetch).cancel('INV2-Z56S-5LLA-Q52L-CPZ5', `${DRAFT}`);
  expect(first.calls[1]?.url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5/cancel');
  expect(first.calls[1]?.headers['paypal-request-id']).toBe(DRAFT);
  const again = scripted([tokenAnswer, { status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } }, { status: 200, body: { id: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'CANCELLED' } }]);
  await sandbox(again.fetch).cancel('INV2-Z56S-5LLA-Q52L-CPZ5', DRAFT);
  const paid = scripted([tokenAnswer, { status: 422, body: {} }, { status: 200, body: { id: 'INV2-Z56S-5LLA-Q52L-CPZ5', status: 'PAID' } }]);
  expect(((await sandbox(paid.fetch).cancel('INV2-Z56S-5LLA-Q52L-CPZ5', DRAFT).catch((e: unknown) => e)) as PayPalError).code).toBe('paypal_http');
});
