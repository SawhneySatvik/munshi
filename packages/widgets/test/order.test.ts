// <munshi-order> in jsdom, against an API double that answers in the contract's shapes (the widget's own logic;
// apps/web/test/api/widget.test.ts runs the shipped file against the real API and database):
//   - every price shown is the cell the API returned, with its ref, and "source" shows the cell's book row;
//   - a capability the release has off (or an unknown site) renders nothing, and the catalogue is never read;
//   - an order is sent once under one Idempotency-Key: a double tap sends one request, a retry after a lost answer
//     reuses the key, and the next order has a new one; the code and the status link are shown;
//   - no figure is invented: before the order there is no amount or total; after it, every digit on the widget is a
//     cell with its ref, a derived figure with the refs it came from (the API's own value, even when it is not the
//     sum of the lines), the customer's quantity, or a code; a figure without a ref reads "Cannot verify".
// Red-proofs: db/test/v2/sabotage/wid-cache.ts.
import { formatMoney } from '@munshi/sdk';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { MunshiOrder } from '../src/order.ts';

const SLUG = 'sample-shop';
const API = 'https://munshi.example';
const KEY = `mpk_${SLUG}_${'A'.repeat(43)}`;
const SNAP = '0b0e7a52-8c49-4d0f-9b0e-3f2b6f0c1a11';
const ref = (row: number, col = 'price') => `⟨snap:${SNAP}·${row}·${col}⟩`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHOP = id(900);

const site = (capabilities: string[]) => ({
  slug: SLUG,
  name: 'Sample Kirana (synthetic)',
  businessType: 'kirana',
  dataClass: 'synthetic',
  label: 'Sample site',
  shops: [{ id: SHOP, name: 'Main branch', area: null, hours: [] }],
  bookingMode: 'none',
  intake: 'open',
  noticeVersion: 'v1',
  consentVersion: 'v1',
  look: { tokens: { '--accent': '#aa3300' }, fontPair: 'inter', profile: {}, art: {} },
  capabilities,
  release: { id: id(901), publishedAt: '2026-10-29T10:00:00.000Z' },
});
const variant = (n: number, name: string, minor: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  name,
  attrs: {},
  unit: 'pack',
  price: { minor, currency: 'INR', ref: ref(n) },
  held: false,
  ...extra,
});
const catalogue = {
  data: [
    { id: id(1), name: 'Assam tea 250 g', category: 'Tea', variants: [variant(1, 'Assam tea 250 g', 24_000)] },
    { id: id(2), name: 'Basmati rice', category: 'Rice', variants: [variant(2, '1 kg', 13_500), variant(3, '5 kg', 62_000, { held: true })] },
  ],
  next: null,
};

type Seen = { method: string; url: string; headers: Record<string, string>; body: unknown };
let seen: Seen[] = [];
let answers: Record<string, (s: Seen) => Response | Promise<Response>> = {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The order's answer as the API gives it; the total is deliberately not the lines' sum, so a widget that adds the lines
// up shows a different number from the one it was given.
const created = (s: Seen) => {
  const lines = (s.body as { lines: { itemId: string; qtyMilli: number }[] }).lines.map((l) => {
    const n = Number(l.itemId.slice(-3));
    return {
      itemId: l.itemId,
      qty: { qtyMilli: l.qtyMilli, source: 'request' },
      price: { minor: 24_000, currency: 'INR', ref: ref(n) },
      amount: { minor: 48_000, currency: 'INR', from: [ref(n)] },
    };
  });
  return json(201, { code: 'ORD-K7Q2', lines, total: { minor: 77_700, currency: 'INR', from: lines.map((l) => l.price.ref) }, offerCode: null, message: 'm', waLink: null });
};

beforeAll(async () => {
  await import('../src/index.ts');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const s: Seen = { method: init.method ?? 'GET', url, headers: { ...(init.headers as Record<string, string>) }, body: init.body ? JSON.parse(init.body as string) : undefined };
    seen.push(s);
    const path = url.replace(`${API}/api/v1/sites/${SLUG}`, '').split('?')[0] as string;
    const answer = answers[`${s.method} ${path.startsWith('/refs/') ? '/refs' : path}`];
    return answer ? answer(s) : json(404, { error: { code: 'not_found', message: 'Not found.', fields: [], requestId: 'r' } });
  });
});

afterEach(() => {
  document.body.replaceChildren();
  seen = [];
});

function serve(capabilities = ['orders', 'counter']) {
  answers = {
    'GET ': () => json(200, site(capabilities)),
    'GET /catalogue': () => json(200, catalogue),
    'POST /orders': created,
    'GET /refs': (s) => {
      const m = /refs\/([^/]+)\/([0-9]+)\/([a-z_]+)$/.exec(s.url) as RegExpExecArray;
      return json(200, {
        verified: true,
        cell: { minor: 24_000, currency: 'INR', ref: `⟨snap:${m[1]}·${m[2]}·${m[3]}⟩` },
        source: { table: 'books.price', id: id(500) },
        publishedAt: '2026-10-29T10:00:00.000Z',
      });
    },
  };
}

async function mount(attrs: Record<string, string> = {}): Promise<MunshiOrder> {
  const el = document.createElement('munshi-order') as MunshiOrder;
  for (const [k, v] of Object.entries({ site: SLUG, api: API, key: KEY, ...attrs })) el.setAttribute(k, v);
  document.body.append(el);
  await el.ready;
  return el;
}

const root = (el: Element) => el.shadowRoot as ShadowRoot;
const all = (el: Element, sel: string) => [...root(el).querySelectorAll<HTMLElement>(sel)];
const button = (el: Element, label: string) => all(el, 'button').find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
const posts = () => seen.filter((s) => s.method === 'POST');

// Every text node with a digit, and whether it sits in an element that says where it came from.
function digits(el: Element): { text: string; traced: boolean }[] {
  const out: { text: string; traced: boolean }[] = [];
  const walk = document.createTreeWalker(root(el), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? '';
    if (!/[0-9]/.test(text) || n.parentElement?.tagName === 'STYLE') continue;
    const at = n.parentElement?.closest('[data-ref],[data-from],[data-source="request"],[data-kind]');
    out.push({ text, traced: !!at });
  }
  return out;
}

test('every price shown is the cell the API returned, with its ref, and "source" shows the cell\'s book row', async () => {
  serve();
  const el = await mount();
  expect(el.hidden).toBe(false);
  const figures = all(el, '.figure[data-ref]');
  const cells = catalogue.data.flatMap((i) => i.variants.map((v) => v.price));
  expect(figures.map((f) => [f.textContent, f.dataset.ref])).toEqual(cells.map((c) => [formatMoney(c), c.ref]));
  expect(figures.map((f) => f.textContent)).toEqual(['₹240', '₹135', '₹620']);
  expect(root(el).textContent).toContain('Sample site'); // simulated means labelled

  (all(el, 'button.src')[1] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root(el).querySelector('.panel')?.textContent).toContain('books.price'));
  const asked = seen.filter((s) => s.url.includes('/refs/'));
  expect(asked.map((s) => decodeURIComponent(s.url.split('/refs/')[1] as string))).toEqual([`${SNAP}/2/price`]);
  expect(root(el).querySelector('.panel')?.textContent).toContain(id(500));
});

test('a capability the release has off renders nothing, and the catalogue is never read; so does an unknown site', async () => {
  serve(['counter', 'stock']);
  const el = await mount();
  expect(el.hidden).toBe(true);
  expect(root(el).childNodes.length).toBe(0);
  expect(seen.map((s) => s.url)).toEqual([`${API}/api/v1/sites/${SLUG}`]);

  serve();
  seen = [];
  const other = await mount({ site: 'nobody-here' });
  expect(other.hidden).toBe(true);
  expect(root(other).childNodes.length).toBe(0);
});

test('an order is sent once under one Idempotency-Key; a retry after a lost answer reuses it; the next order has a new one', async () => {
  serve();
  const el = await mount();
  button(el, 'One more Assam tea 250 g').click();
  button(el, 'One more Assam tea 250 g').click();
  const place = button(el, 'Send order to the shop');
  expect(place.disabled).toBe(false);

  // The first answer is lost (the network drops it); the retry is the same attempt.
  let drop = true;
  answers['POST /orders'] = (s) => {
    if (drop) {
      drop = false;
      throw new TypeError('network');
    }
    return created(s);
  };
  place.click();
  await vi.waitFor(() => expect(root(el).querySelector('[role="alert"]')?.textContent).toContain('Try again'));
  const again = button(el, 'Send order to the shop');
  again.click();
  again.click(); // a double tap while it is sending
  button(el, 'Sending…')?.click();
  await vi.waitFor(() => expect(root(el).querySelector('.answer')).not.toBeNull());

  expect(posts().length).toBe(2);
  const [first, second] = posts() as [Seen, Seen];
  expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
  expect(second.body).toEqual(first.body);
  expect(first.body).toEqual({ shopId: SHOP, channel: 'widget', lines: [{ itemId: id(1), qtyMilli: 2000 }] });
  expect(first.headers.authorization).toBe(`Bearer ${KEY}`);
  expect(root(el).querySelector('[data-kind="code"]')?.textContent).toBe('ORD-K7Q2');
  const link = all(el, 'a').find((a) => a.textContent === 'Order status') as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe(`${API}/api/v1/sites/${SLUG}/orders/ORD-K7Q2`);

  button(el, 'One more Assam tea 250 g').click();
  button(el, 'Send order to the shop').click();
  await vi.waitFor(() => expect(posts().length).toBe(3));
  expect(posts()[2]?.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);

  const shown = await mount({ 'status-page': 'https://shop.example/orders/{code}' });
  button(shown, 'One more Assam tea 250 g').click();
  button(shown, 'Send order to the shop').click();
  await vi.waitFor(() => expect(root(shown).querySelector('.answer')).not.toBeNull());
  expect((all(shown, 'a').find((a) => a.textContent === 'Order status') as HTMLAnchorElement).getAttribute('href')).toBe('https://shop.example/orders/ORD-K7Q2');
});

test('no figure is invented: no amount before the order; after it every digit is a cell, the API\'s derived figure, the customer\'s quantity or a code', async () => {
  serve();
  const el = await mount();
  button(el, 'One more Assam tea 250 g').click();
  button(el, 'One more Assam tea 250 g').click();
  button(el, 'One more Basmati rice · 1 kg').click();
  expect(all(el, '[data-from]')).toEqual([]); // no line amount, no total, before the API gives them
  expect(digits(el).filter((d) => !d.traced)).toEqual([]);

  button(el, 'Send order to the shop').click();
  await vi.waitFor(() => expect(root(el).querySelector('.answer')).not.toBeNull());
  const derived = all(el, '.answer .figure[data-from]');
  // Two line amounts and the total, each the API's own value with the refs it came from.
  expect(derived.map((d) => [d.textContent, d.dataset.from])).toEqual([
    ['₹480', ref(1)],
    ['₹480', ref(2)],
    ['₹777', `${ref(1)} ${ref(2)}`],
  ]);
  expect(digits(el).filter((d) => !d.traced)).toEqual([]);

  // A price that does not carry a ref the grammar accepts cannot be traced.
  answers['GET /catalogue'] = () => json(200, { data: [{ ...catalogue.data[0], variants: [variant(1, 'Assam tea 250 g', 24_000, { price: { minor: 24_000, currency: 'INR', ref: 'made up' } })] }], next: null });
  const bad = await mount();
  expect(all(bad, '.figure').map((f) => [f.textContent, f.dataset.ref])).toEqual([['Cannot verify', undefined]]);
  expect(digits(bad).filter((d) => !d.traced)).toEqual([]);
});
