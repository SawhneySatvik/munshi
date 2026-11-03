// Red-proofs of the widgets (BP-WID-1: packages/widgets/test/*.test.ts in jsdom, apps/web/test/api/widget.test.ts
// against the real API) and of the cache (BP-CACHE-1: apps/web/test/api/cache.test.ts with a real redis-server). Each
// breaks one protection; the named test must then fail.
import type { Case } from './case.ts';

const WIDGETS = { dir: 'packages/widgets', config: 'vitest.config.ts' } as const;
const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const ORDER = 'packages/widgets/src/order.ts';
const UNIT_TESTS = 'test/order.test.ts';
const API_TEST = 'test/api/widget.test.ts';

const WID1 = 'every price shown is the cell the API returned, with its ref, and "source" shows the cell\'s book row';
const WID2 = 'a capability the release has off renders nothing, and the catalogue is never read; so does an unknown site';
const WID3 = 'an order is sent once under one Idempotency-Key; a retry after a lost answer reuses it; the next order has a new one';
const WID4 = "no figure is invented: no amount before the order; after it every digit is a cell, the API's derived figure, the customer's quantity or a code";
const WID_API3 = 'a release with orders off renders nothing, as does a page on an origin the site does not list';

const CACHE_TEST = 'test/api/cache.test.ts';
const SITE_API = 'packages/core/src/site-api.ts';
const KEYS = 'packages/core/src/cache-keys.ts';
const VERIFY1_CACHED =
  "(cached) an unknown slug and an unverified site answer the same 404 bytes from the cache; verifying and publishing drop the site's entry";
const RC1 =
  "every key that reaches the cache starts with a tenant id, the requested site's; cacheKey takes only a TenantId; only core's cache-keys.ts and the wiring import the port";
const RC2 = 'every public read from the cached release plus the live overlays is byte-identical to one built fresh, refs included';
const RC3 = 'a request for tenant B never reads a key planted for tenant A';
const RC4 = 'with Redis paused (slow) or stopped, every API route answers as it does with no cache';

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
    test: 'the served widget file is a fresh build of the source, a classic script with nothing loaded from elsewhere',
    ...WIDGETS,
    ts: { file: 'packages/widgets/scripts/build.ts', from: 'minify: false,', to: 'minify: true,' },
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

  // ---- BP-CACHE-1 ----

  // RC1: one key built without the tenant
  {
    sabotage: 'v2-cache-key-without-tenant',
    file: CACHE_TEST,
    test: RC1,
    ...WEB,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
    ts: { file: SITE_API, from: "cacheKey(asTenantId(site.tenantId), 'snapshot', id),", to: '`munshi:demo:snapshot:${id}`,' },
  },
  // RC2: a live overlay (the held flags) cached with the release
  {
    sabotage: 'v2-cache-overlay-cached',
    file: CACHE_TEST,
    test: RC2,
    ...WEB,
    ts: {
      file: SITE_API,
      from: "const { rows: held } = await c.query<{ item_id: string }>(`select distinct item_id::text as item_id from ops.reservation where state = 'held' and held_until > now()`);",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
      to: "const { rows: held } = await cached(cacheKey(asTenantId(site.tenantId), 'snapshot', `${s.id}-held`), PINNED_TTL, () => c.query<{ item_id: string }>(`select distinct item_id::text as item_id from ops.reservation where state = 'held' and held_until > now()`));",
    },
  },
  // RC3: the tenant prefix dropped from every key
  {
    sabotage: 'v2-cache-tenant-prefix-dropped',
    file: CACHE_TEST,
    test: RC3,
    ...WEB,
    ts: {
      file: KEYS,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
      from: "return [`munshi:${wired?.deployment ?? 'demo'}:t:${tenantId}:${kind}`, ...parts].join(':');",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text, not a template
      to: "return [`munshi:${wired?.deployment ?? 'demo'}:${kind}`, ...parts].join(':');",
    },
  },
  // RC4: a cache error reaches the request
  {
    sabotage: 'v2-cache-error-thrown',
    file: CACHE_TEST,
    test: RC4,
    ...WEB,
    ts: { file: KEYS, from: '    } catch {\n      // the cache is down, slow or holds something unreadable: Postgres answers\n    }', to: '    } catch (err) {\n      throw err;\n    }' },
  },
  // RC4: no budget, so a paused Redis holds every request
  { sabotage: 'v2-cache-no-budget', file: CACHE_TEST, test: RC4, ...WEB, ts: { file: KEYS, from: '    }, CACHE_BUDGET_MS);', to: '    }, 120_000);' } },
  // VERIFY1 (cached): verifying a site leaves its negative entry in place
  {
    sabotage: 'v2-cache-verify-not-dropped',
    file: CACHE_TEST,
    test: VERIFY1_CACHED,
    ...WEB,
    ts: { file: 'packages/core/src/platform.ts', from: "  if (ch.kind === 'site_verify' && ch.tenant_id) await dropSite(ch.tenant_id);\n", to: '' },
  },
  // VERIFY1 (cached): publishing leaves the old release in place
  {
    sabotage: 'v2-cache-publish-not-dropped',
    file: CACHE_TEST,
    test: VERIFY1_CACHED,
    ...WEB,
    ts: { file: 'packages/core/src/site-release.ts', from: '  if (tenant[0]?.id) await dropSite(tenant[0].id);\n', to: '' },
  },
  // VERIFY1 (cached): no negative entries
  {
    sabotage: 'v2-cache-no-negative-entries',
    file: CACHE_TEST,
    test: VERIFY1_CACHED,
    ...WEB,
    ts: { file: KEYS, from: "(value !== null || opts.keepNull !== false)", to: '(value !== null)' },
  },
  // CONFIG1: any MUNSHI_CACHE_URL is taken
  {
    sabotage: 'v2-cache-config-any-url',
    file: 'test/config.test.ts',
    test: 'the cache address: unset is the memory cache; off, a redis:// or a unix:/// address is taken; anything else is invalid',
    dir: 'packages/config',
    config: 'vitest.config.ts',
    ts: { file: 'packages/config/src/index.ts', from: "invalid.push('MUNSHI_CACHE_URL');", to: '{}' },
  },
  // CACHE-A3: replies that never come pile up without end
  {
    sabotage: 'v2-cache-adapter-no-cap',
    file: 'test/cache.test.ts',
    test: 'Redis paused: calls reject rather than queue without end; stopped: they reject at once; restarted: it reconnects',
    dir: 'packages/adapters',
    config: 'vitest.config.ts',
    ts: { file: 'packages/adapters/cache/index.ts', from: 'if (pending.length >= MAX_PENDING && socket) {', to: 'if (false && socket) {' },
  },
];
