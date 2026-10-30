// Red-proofs of the widgets (BP-WID-1: packages/widgets/test/*.test.ts in jsdom, apps/web/test/api/widget.test.ts
// against the real API) and of the cache (BP-CACHE-1: apps/web/test/api/cache.test.ts with a real redis-server). Each
// breaks one protection; the named test must then fail.
import type { Case } from './case.ts';

const WIDGETS = { dir: 'packages/widgets', config: 'vitest.config.ts' } as const;
const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const ORDER = 'packages/widgets/src/order.ts';
const UNIT_TESTS = 'test/order.test.ts';
const API_TEST = 'test/api/widget.test.ts';

const WID1 = 'WID1 every price shown is the cell the API returned, with its ref, and "source" shows the cell\'s book row';
const WID2 = 'WID2 a capability the release has off renders nothing, and the catalogue is never read; so does an unknown site';
const WID3 = 'WID3 an order is sent once under one Idempotency-Key; a retry after a lost answer reuses it; the next order has a new one';
const WID4 = "WID4 no figure is invented: no amount before the order; after it every digit is a cell, the API's derived figure, the customer's quantity or a code";
const WID_API3 = 'WID-API3 a release with orders off renders nothing, as does a page on an origin the site does not list';

export const WID_CACHE_CASES: Case[] = [
  // WID1: a price rendered without its ref
  {
    sabotage: 'v2-wid-ref-dropped',
    file: UNIT_TESTS,
    test: WID1,
    ...WIDGETS,
    ts: { file: ORDER, from: "...(isMoney(f) ? { 'data-ref': f.ref } : { 'data-from': f.from.join(' ') })", to: "...(isMoney(f) ? {} : { 'data-from': f.from.join(' ') })" },
  },
  // WID2: the capability is not checked
  { sabotage: 'v2-wid-capability-ignored', file: UNIT_TESTS, test: WID2, ...WIDGETS, ts: { file: ORDER, from: "if (!site.capabilities.includes('orders')) return;", to: '' } },
  // WID3: a fresh key on every try, so a retry after a lost answer is a second request
  {
    sabotage: 'v2-wid-key-per-try',
    file: UNIT_TESTS,
    test: WID3,
    ...WIDGETS,
    ts: {
      file: ORDER,
      from: 'if (!this.#attempt || this.#attempt.body !== text) this.#attempt = { key: newIdempotencyKey(), body: text };',
      to: 'this.#attempt = { key: newIdempotencyKey(), body: text };',
    },
  },
  // WID3: a second tap while the first is sending sends again
  {
    sabotage: 'v2-wid-double-send',
    file: UNIT_TESTS,
    test: WID3,
    ...WIDGETS,
    ts: { file: ORDER, from: 'if (!client || !site || this.#sending || this.#cart.size === 0) return;', to: 'if (!client || !site || this.#cart.size === 0) return;' },
  },
  // WID4: the widget works out a line amount itself
  {
    sabotage: 'v2-wid-client-amount',
    file: UNIT_TESTS,
    test: WID4,
    ...WIDGETS,
    ts: {
      file: ORDER,
      from: '      this.#figure(v.price),\n',
      to: "      this.#figure(v.price),\n      qty ? h('span', { class: 'estimate' }, formatMoney({ minor: (v.price.minor * qty) / UNIT, currency: v.price.currency, from: [v.price.ref] })) : null,\n",
    },
  },
  // WID5: the served file is not the source's build
  {
    sabotage: 'v2-wid-build-stale',
    file: 'test/build.test.ts',
    test: 'WID5 the served widget file is a fresh build of the source, a classic script with nothing loaded from elsewhere',
    ...WIDGETS,
    ts: { file: 'packages/widgets/build.ts', from: 'minify: false,', to: 'minify: true,' },
  },
  // WID-API3: the site's capabilities listed whether on or off
  {
    sabotage: 'v2-wid-api-capabilities-all',
    file: API_TEST,
    test: WID_API3,
    ...WEB,
    ts: { file: 'packages/core/src/site-api.ts', from: ".filter((i) => text(caps, i, 'state') === 'on')", to: '.filter(() => true)' },
  },
  // WID-API3: a read from any origin answered with a CORS header
  {
    sabotage: 'v2-wid-api-any-origin',
    file: API_TEST,
    test: WID_API3,
    ...WEB,
    ts: { file: 'packages/core/src/public.ts', from: 'origin === null ? !required : site.origins.includes(origin);', to: 'true;' },
  },
];
