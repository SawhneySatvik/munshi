// The SDK against a stubbed fetch (the system boundary): each route's method and path, an Idempotency-Key per write,
// errors as the API's error codes and never the server's text, the key only in a header, and figures that render or say
// "Cannot verify". Red-proofs: db/test/v2/sabotage/core-contracts.ts.
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { CANNOT_VERIFY, type Client, createClient, formatMoney, MunshiError } from '../src/index.ts';

const KEY = `mpk_elite_${'K'.repeat(40)}x_Y`;
const ID = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b';
const HOLD_TOKEN = `${'h'.repeat(40)}TOK`;
const REF = `⟨snap:${ID}·12·price⟩`;
const doc = JSON.parse(readFileSync(new URL('../../contracts/openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string; 'x-munshi-deferred': boolean; 'x-munshi-schemas': { response: string | null } }>>;
};

type Sent = { url: string; method: string; headers: Record<string, string>; body: string | undefined; credentials: string | undefined };
const sent: Sent[] = [];
function serve(status = 200, body: unknown = {}, headers: Record<string, string> = { 'x-request-id': 'bom1::hdr-1' }) {
  sent.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined, credentials: init.credentials });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  });
}
afterEach(() => vi.unstubAllGlobals());

const client = () => createClient({ baseUrl: 'https://demo.munshi.test/', key: KEY });
const person = { name: 'Asha', phone: '+910000000000', whatsappUpdates: false, noticeVersion: 'v1', consentVersion: 'v1', botToken: 't', website: '' };
// One call per route, with the path it must reach.
const CALLS: Record<string, [(c: Client) => Promise<unknown>, string]> = {
  site: [(c) => c.site('elite'), '/sites/elite'],
  catalogue: [(c) => c.catalogue('elite', { category: 'suits', limit: 20 }), '/sites/elite/catalogue?category=suits&limit=20'],
  services: [(c) => c.services('elite'), '/sites/elite/services'],
  packages: [(c) => c.packages('elite', { cursor: 'abc' }), '/sites/elite/packages?cursor=abc'],
  offers: [(c) => c.offers('elite'), '/sites/elite/offers'],
  stylists: [(c) => c.stylists('elite', { shop: ID }), `/sites/elite/stylists?shop=${ID}`],
  slots: [(c) => c.slots('elite', { shop: ID, service: ID, date: '2026-11-02' }), `/sites/elite/slots?shop=${ID}&service=${ID}&date=2026-11-02`],
  ref: [(c) => c.ref('elite', REF), `/sites/elite/refs/${ID}/12/price`],
  orderStatus: [(c) => c.orderStatus('elite', 'ORD-7K2Q'), '/sites/elite/orders/ORD-7K2Q'],
  hold: [
    (c) => c.hold('elite', { shopId: ID, stylistId: ID, serviceId: ID, start: '2026-11-02T11:00:00Z', shiftRel: 'books.shift_pattern', shiftId: ID, botToken: 't' }),
    '/sites/elite/holds',
  ],
  releaseHold: [(c) => c.releaseHold('elite', ID, HOLD_TOKEN), `/sites/elite/holds/${ID}`],
  book: [(c) => c.book('elite', { ...person, holdId: ID, holdToken: HOLD_TOKEN }), '/sites/elite/bookings'],
  requestBooking: [(c) => c.requestBooking('elite', { ...person, shopId: ID, serviceIds: [ID], preferredOn: '2026-11-02', timeWindow: 'evening' }), '/sites/elite/booking-requests'],
  enquire: [(c) => c.enquire('elite', { ...person, shopId: ID, message: 'Do you stitch blouses?' }), '/sites/elite/enquiries'],
  reserve: [(c) => c.reserve('elite', { ...person, itemId: ID, qtyMilli: 1000 }), '/sites/elite/reservations'],
  order: [(c) => c.order('elite', { shopId: ID, channel: 'widget', lines: [{ itemId: ID, qtyMilli: 2000 }] }), '/sites/elite/orders'],
};
const routes = Object.values(doc.paths).flatMap((item) => Object.entries(item).map(([method, op]) => ({ method: method.toUpperCase(), ...op })));
// Media is fetched by <img src> from the paths a release returns; the secret-key routes are deferred and server-side.
const served = routes.filter((r) => !r['x-munshi-deferred'] && r['x-munshi-schemas'].response !== null);
const writes = served.filter((r) => r.method !== 'GET').map((r) => r.operationId);

it('every route the SDK serves has its method, and each sends its route method to its path', async () => {
  expect(served.map((r) => r.operationId).sort()).toEqual(Object.keys(CALLS).sort());
  expect(Object.keys(client()).sort()).toEqual(Object.keys(CALLS).sort());
  // As on Safari 16, whose URLSearchParams has no size: the queries must reach the URL there too.
  const size = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size') as PropertyDescriptor;
  Object.defineProperty(URLSearchParams.prototype, 'size', { get: () => undefined, configurable: true });
  try {
    for (const r of served) {
      serve();
      const [call, path] = CALLS[r.operationId] as [(c: Client) => Promise<unknown>, string];
      await call(client());
      expect([r.operationId, sent.length, sent[0]?.method, sent[0]?.url]).toEqual([r.operationId, 1, r.method, `https://demo.munshi.test/api/v1${path}`]);
      expect(sent[0]?.credentials).toBe('omit');
    }
  } finally {
    Object.defineProperty(URLSearchParams.prototype, 'size', size);
  }
});

it('every write sends a fresh Idempotency-Key, or the one the form render made, and no read sends one', async () => {
  expect(writes.sort()).toEqual(['book', 'enquire', 'hold', 'order', 'releaseHold', 'requestBooking', 'reserve']);
  for (const op of Object.keys(CALLS)) {
    const [call] = CALLS[op] as [(c: Client) => Promise<unknown>, string];
    serve();
    await call(client());
    await call(client());
    const keys = sent.map((s) => s.headers['idempotency-key']);
    if (!writes.includes(op)) {
      expect([op, keys]).toEqual([op, [undefined, undefined]]);
      continue;
    }
    expect(keys.every((k) => typeof k === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(k))).toBe(true);
    expect([op, keys[0] === keys[1]]).toEqual([op, false]);
  }
  serve(202, { id: ID, received: true });
  await client().order('elite', { shopId: ID, channel: 'site', lines: [{ itemId: ID, qtyMilli: 1000 }] }, { idempotencyKey: 'form-render-0001' });
  await client().order('elite', { shopId: ID, channel: 'site', lines: [{ itemId: ID, qtyMilli: 1000 }] }, { idempotencyKey: 'form-render-0001' });
  expect(sent.map((s) => s.headers['idempotency-key'])).toEqual(['form-render-0001', 'form-render-0001']);
  expect(() => client().order('elite', { shopId: ID, channel: 'site', lines: [] }, { idempotencyKey: 'short' })).toThrow(/Idempotency-Key/);
});

it("an error surfaces as its error code, status and request id, never the server's text", async () => {
  const fail = async () => {
    try {
      await client().book('elite', { ...person, holdId: ID, holdToken: HOLD_TOKEN });
    } catch (err) {
      return err as MunshiError;
    }
    throw new Error('the call did not fail');
  };
  const leak = 'duplicate key value violates unique constraint "booking_no_overlap" for +919876543210';
  serve(409, { error: { code: 'slot_taken', message: leak, fields: ['start', 'phone +919876543210'], requestId: 'bom1::req-9' } });
  let err = await fail();
  expect(err).toBeInstanceOf(MunshiError);
  expect([err.status, err.code, err.requestId, err.fields]).toEqual([409, 'slot_taken', 'bom1::req-9', ['start']]);
  expect(`${err.message} ${err.stack} ${JSON.stringify(err)} ${inspect(err)}`).not.toContain('duplicate');
  expect(`${err.message} ${err.stack} ${JSON.stringify(err)} ${inspect(err)}`).not.toContain('+919876543210');
  serve(502, '<html>Bad gateway from the edge</html>', { 'x-request-id': 'bom1::edge-1', 'content-type': 'text/html' });
  err = await fail();
  expect([err.status, err.code, err.requestId, err.fields]).toEqual([502, 'internal', 'bom1::edge-1', []]);
  serve(418, { error: { code: 'teapot', message: 'short and stout', requestId: 'x' } });
  err = await fail();
  expect([err.status, err.code, err.requestId]).toEqual([418, 'internal', 'bom1::hdr-1']);
  serve(200, 'not json');
  err = await fail();
  expect([err.status, err.code]).toEqual([200, 'internal']);
  serve(404, { error: { code: 'not_found', message: 'Not found.', fields: [], requestId: '<script>' } }, {});
  err = await fail();
  expect([err.code, err.requestId]).toEqual(['not_found', null]);
});

it('the key travels only in the Authorization header of a write, the hold token only where the contract puts it, and neither in a URL, an error or the console', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m));
  const seen: string[] = [];
  for (const op of Object.keys(CALLS)) {
    const [call] = CALLS[op] as [(c: Client) => Promise<unknown>, string];
    serve(404, { error: { code: 'not_found', message: 'Not found.', fields: [], requestId: 'r' } });
    const err = await call(client()).catch((e: unknown) => e);
    seen.push(`${String(err)} ${(err as Error).stack} ${JSON.stringify(err)} ${inspect(err)}`);
    for (const s of sent) {
      // The booking body carries its hold token by contract; no other body carries it or the key.
      seen.push(s.url, op === 'book' ? (s.body ?? '').replace(HOLD_TOKEN, '') : (s.body ?? ''));
      const auth = s.headers.authorization;
      expect([op, auth]).toEqual([op, writes.includes(op) ? `Bearer ${KEY}` : undefined]);
      if (op === 'releaseHold') expect(s.headers['x-hold-token']).toBe(HOLD_TOKEN);
    }
  }
  expect(() => createClient({ baseUrl: 'https://x.test', key: `msk_elite_${'S'.repeat(43)}` })).toThrow(/publishable/);
  try {
    createClient({ baseUrl: 'https://x.test', key: `mpk_elite_${'B'.repeat(10)}` });
  } catch (err) {
    seen.push(String(err), (err as Error).stack ?? '');
  }
  const all = seen.join('\n');
  expect(all).not.toContain(KEY);
  expect(all).not.toContain(HOLD_TOKEN);
  expect(all).not.toContain('B'.repeat(10));
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  for (const file of ['index.ts', 'money.ts']) expect(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).not.toMatch(/\bconsole\./);
});

it('formatMoney works in whole minor units with Indian grouping, and a figure that cannot trace says "Cannot verify"', async () => {
  const fig = (minor: number) => ({ minor, currency: 'INR', ref: REF });
  expect(formatMoney(fig(249_900))).toBe('₹2,499');
  expect(formatMoney(fig(12_499_950))).toBe('₹1,24,999.50');
  expect(formatMoney(fig(5600))).toBe('₹56');
  expect(formatMoney(fig(99))).toBe('₹0.99');
  // 9007199254740 rupees, grouped by hand: 740 last, then pairs: 90,07,19,92,54
  expect(formatMoney(fig(900_719_925_474_099))).toBe('₹90,07,19,92,54,740.99');
  expect(formatMoney({ minor: 499_800, currency: 'INR', from: [REF, REF] })).toBe('₹4,998');
  for (const bad of [
    { minor: 249_900, currency: 'INR', ref: null },
    { minor: 249_900, currency: 'INR', ref: '' },
    { minor: 249_900, currency: 'INR', ref: 'snap:x·1·price' },
    { minor: 249_900, currency: 'INR' },
    { minor: 2499.5, currency: 'INR', ref: REF },
    { minor: 499_800, currency: 'INR', from: [] },
    { minor: 499_800, currency: 'INR', from: ['typed by a model'] },
  ]) {
    expect(formatMoney(bad as never)).toBe(CANNOT_VERIFY);
  }
  serve();
  expect(await client().ref('elite', 'price ₹2,499')).toEqual({ verified: false, label: 'Cannot verify' });
  expect(sent).toHaveLength(0);
});
