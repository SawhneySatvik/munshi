// Builds integrations/postman/munshi.postman_collection.json (Postman Collection v2.1) from what Munshi already states:
//   1. Integration feed: GET /api/integrations/v1/feed, the read-only feed Zapier polls (docs/zapier.md).
//   2. Public API v1: one request per operation in packages/contracts/openapi.json, in three folders: the public reads
//      (no key), the site writes (a site's publishable key) and the owner's deferred operations (a secret key). Each
//      checks its status is one the contract documents, and the reads chain the ids they find.
//   3. PayPal sandbox: the calls packages/adapters/payments/paypal.ts makes, in its order, with its headers.
// Run: node integrations/postman/build.ts (pnpm postman:build). Check: pnpm postman:check.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Schema = { $ref?: string; type?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minimum?: number; minItems?: number; pattern?: string; format?: string; oneOf?: Schema[]; anyOf?: Schema[]; const?: unknown; example?: unknown };
type Param = { name: string; in: string; required?: boolean; schema?: Schema };
type Operation = { operationId: string; summary?: string; parameters?: Param[]; requestBody?: { content: Record<string, { schema: Schema }> }; responses: Record<string, unknown>; security?: Record<string, unknown>[] };
export type OpenApi = { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };

const HERE = new URL('./', import.meta.url);
export const COLLECTION_FILE = fileURLToPath(new URL('munshi.postman_collection.json', HERE));
export const OPENAPI_FILE = fileURLToPath(new URL('../../packages/contracts/openapi.json', HERE));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** A path parameter's collection variable, by the operation's path and the parameter's name. */
export function pathVar(path: string, name: string): string {
  if (name === 'slug') return 'siteSlug';
  if (name === 'id') return path.includes('/media/') ? 'mediaId' : 'holdId';
  if (name === 'code') return 'orderCode';
  return { snapshot: 'refSnapshot', row: 'refRow', col: 'refCol' }[name] ?? name;
}

/** An OpenAPI path with its parameters as collection variables: /sites/{slug} -> /sites/{{siteSlug}}. */
export const postmanPath = (path: string) => path.replace(/\{([A-Za-z]+)\}/g, (_, name: string) => `{{${pathVar(path, name)}}}`);

const QUERY_VARS: Record<string, string> = { shop: '{{shopId}}', service: '{{serviceId}}', date: '{{today}}', stylist: '{{stylistId}}' };

// A small example from a JSON schema: required properties only, the first enum value, a placeholder that fits the pattern.
function sample(s: Schema, spec: OpenApi, depth = 0): unknown {
  if (depth > 8) return null;
  if (s.$ref) return sample(spec.components.schemas[s.$ref.split('/').pop() as string] as Schema, spec, depth + 1);
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const one = s.oneOf ?? s.anyOf;
  if (one) return sample(one[0] as Schema, spec, depth + 1);
  switch (s.type) {
    case 'object':
      return Object.fromEntries((s.required ?? []).map((k) => [k, sample(s.properties?.[k] ?? {}, spec, depth + 1)]));
    case 'array':
      return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => sample(s.items ?? {}, spec, depth + 1));
    case 'integer':
    case 'number':
      return Math.max(1, s.minimum ?? 1);
    case 'boolean':
      return false;
    case 'string':
      if (s.format === 'date') return '{{today}}';
      if (s.pattern?.includes('[0-9a-f]{8}-')) return '00000000-0000-4000-8000-000000000000';
      return 'example';
    default:
      return null;
  }
}

const lines = (js: string) => js.trim().split('\n');
const testScript = (js: string) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines(js) } });
const preScript = (js: string) => ({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(js) } });
const bearer = (variable: string) => ({ type: 'bearer', bearer: [{ key: 'token', value: `{{${variable}}}`, type: 'string' }] });
const NO_AUTH = { type: 'noauth' };

function url(base: string, path: string, query: { key: string; value: string }[] = []) {
  const raw = `{{${base}}}${path}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`;
  return { raw, host: [`{{${base}}}`], path: path.split('/').filter(Boolean), ...(query.length ? { query } : {}) };
}

// The reads that must answer 200 on a published site, and what each passes to the next.
const MUST_ANSWER = new Set(['site', 'catalogue', 'offers', 'packages', 'services', 'stylists', 'ref']);
const CHAIN: Record<string, string> = {
  site: `const site = pm.response.json();
pm.test("names its slug and its sample label", () => { pm.expect(site.slug).to.eql(pm.variables.get("siteSlug")); pm.expect(site.label).to.be.a("string"); });
if (site.shops && site.shops[0]) pm.collectionVariables.set("shopId", site.shops[0].id);`,
  services: `const first = (pm.response.json().data || [])[0];
if (first) {
  pm.collectionVariables.set("serviceId", first.id);
  const ref = /^⟨snap:([0-9a-f-]{36})·(\\d+)·([a-z_][a-z0-9_]*)⟩$/.exec(first.price && first.price.ref || "");
  pm.test("a price carries the stored cell it comes from", () => pm.expect(ref).to.not.eql(null));
  if (ref) { pm.collectionVariables.set("refSnapshot", ref[1]); pm.collectionVariables.set("refRow", ref[2]); pm.collectionVariables.set("refCol", ref[3]); }
}`,
  stylists: `const first = (pm.response.json().data || [])[0];
if (first) pm.collectionVariables.set("stylistId", first.id);`,
};
// The order the public reads run in, so each finds what an earlier one saved.
const READ_ORDER = ['site', 'services', 'stylists', 'ref', 'slots', 'catalogue', 'offers', 'packages', 'mediaJpg', 'mediaSvg', 'orderStatus'];

function operationItem(path: string, method: string, op: Operation, spec: OpenApi) {
  const params = op.parameters ?? [];
  const documented = Object.keys(op.responses)
    .filter((c) => /^\d{3}$/.test(c))
    .map(Number);
  const query = params.filter((p) => p.in === 'query' && (p.required || p.name in QUERY_VARS) && p.name !== 'stylist').map((p) => ({ key: p.name, value: QUERY_VARS[p.name] ?? String(sample(p.schema ?? {}, spec)) }));
  const header: { key: string; value: string }[] = [];
  for (const p of params.filter((x) => x.in === 'header')) {
    if (p.name === 'Idempotency-Key') header.push({ key: p.name, value: '{{$guid}}' });
    else if (p.name === 'X-Munshi-Device') header.push({ key: p.name, value: '{{deviceToken}}' });
    else if (p.name === 'X-Hold-Token') header.push({ key: p.name, value: '{{holdToken}}' });
  }
  const body = op.requestBody?.content['application/json']?.schema;
  if (body) header.push({ key: 'Content-Type', value: 'application/json' });
  const scheme = Object.keys(op.security?.[0] ?? {})[0];
  const ok = MUST_ANSWER.has(op.operationId) ? `pm.test("answers 200", () => pm.response.to.have.status(200));\n` : '';
  const tests = `${ok}const documented = ${JSON.stringify(documented)};
pm.test("status is one the contract documents", () => pm.expect(documented).to.include(pm.response.code));
pm.test("carries a request id", () => pm.expect(pm.response.headers.get("x-request-id")).to.be.a("string"));
if (pm.response.code === 200 && (pm.response.headers.get("content-type") || "").includes("application/json")) {
  pm.test("a JSON object", () => pm.expect(pm.response.json()).to.be.an("object"));
${CHAIN[op.operationId] ? CHAIN[op.operationId].replace(/^/gm, '  ') : ''}
}`;
  return {
    name: `${op.operationId} · ${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      auth: scheme ? bearer(scheme === 'secretKey' ? 'secretKey' : 'publishableKey') : NO_AUTH,
      header,
      url: url('baseUrl', `/api/v1${postmanPath(path)}`, query),
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(sample(body, spec), null, 2), options: { raw: { language: 'json' } } } } : {}),
      description: op.summary ?? op.operationId,
    },
    event: [testScript(tests)],
  };
}

function publicApi(spec: OpenApi) {
  const reads: ReturnType<typeof operationItem>[] = [];
  const writes: ReturnType<typeof operationItem>[] = [];
  const owner: ReturnType<typeof operationItem>[] = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      const scheme = Object.keys(op.security?.[0] ?? {})[0];
      const item = operationItem(path, method, op, spec);
      (scheme === 'secretKey' ? owner : scheme === 'publishableKey' ? writes : reads).push(item);
    }
  }
  const rank = (name: string) => {
    const i = READ_ORDER.indexOf(name.split(' · ')[0] as string);
    return i < 0 ? READ_ORDER.length : i;
  };
  reads.sort((a, b) => rank(a.name) - rank(b.name));
  return {
    name: 'Public API v1',
    description: 'Every operation in packages/contracts/openapi.json. Public reads need no key. Site writes take a site’s publishable key and change a real request queue: run them only against a local or sample site. The owner’s operations are specified and deferred: they answer 404.',
    item: [
      { name: 'Public reads', description: 'No key. Safe to run against any deployment.', item: reads },
      { name: 'Site writes', description: 'A site’s publishable key (publishableKey). Each makes a request a person then decides; run against local or a sample site only.', item: writes },
      { name: 'Owner (deferred)', description: 'Server-to-server with a secret key (secretKey). Specified, not built: 404 today.', item: owner },
    ],
  };
}

function feed() {
  const ok = `pm.test("answers 200", () => pm.response.to.have.status(200));
pm.test("is never cached", () => pm.expect(pm.response.headers.get("cache-control")).to.eql("no-store"));
const f = pm.response.json();
pm.test("names the shop with its sample label", () => { pm.expect(f.shop.slug).to.eql(pm.variables.get("shop")); pm.expect(f.shop.label).to.include("Sample"); });
pm.test("each link's id is its link and its state", () => f.links.forEach((l) => pm.expect(l.id).to.eql(l.linkId + ":" + l.state)));
pm.test("each link state is the app's own", () => f.links.forEach((l) => pm.expect(["asked", "sent", "paid", "recorded", "failed", "cancelled"]).to.include(l.state)));
pm.test("every amount names its source", () => {
  f.links.forEach((l) => { pm.expect(l.amount.display).to.be.a("string"); pm.expect(l.amount.source).to.be.an("object"); });
  f.payments.forEach((p) => pm.expect(p.amount.source).to.include({ kind: "row", table: "ops.payment_event" }));
  f.findings.forEach((x) => { if (x.impact) pm.expect(x.impact.source.kind).to.eql("snapshot"); });
});`;
  const refused = `pm.test("a wrong key is a bare 404", () => { pm.response.to.have.status(404); pm.expect(pm.response.text()).to.eql(""); });`;
  return {
    name: 'Integration feed',
    description: 'GET /api/integrations/v1/feed: one sample shop’s PayPal links, the PayPal payments its books do not show yet, and its findings. Read only. Bearer MUNSHI_INTEGRATION_SECRET (integrationSecret); anything else is a bare 404.',
    item: [
      {
        name: 'Feed',
        request: { method: 'GET', auth: bearer('integrationSecret'), header: [], url: url('baseUrl', '/api/integrations/v1/feed', [{ key: 'shop', value: '{{shop}}' }]) },
        event: [testScript(ok)],
      },
      {
        name: 'Feed refuses a wrong key',
        request: {
          method: 'GET',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: 'not-the-key', type: 'string' }] },
          header: [],
          url: url('baseUrl', '/api/integrations/v1/feed', [{ key: 'shop', value: '{{shop}}' }]),
        },
        event: [testScript(refused)],
      },
    ],
  };
}

function paypal() {
  const json = { mode: 'raw', options: { raw: { language: 'json' } } };
  const headers = (requestId?: string) => [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'Prefer', value: 'return=representation' },
    ...(requestId ? [{ key: 'PayPal-Request-Id', value: requestId }] : []),
  ];
  const invoice = (suffix = '') => url('paypalBase', `/v2/invoicing/invoices/{{paypalInvoiceId}}${suffix}`);
  const close = JSON.stringify({ send_to_recipient: false, send_to_invoicer: false }, null, 2);
  return {
    name: 'PayPal sandbox',
    description:
      'The calls Munshi’s PayPal adapter makes (packages/adapters/payments/paypal.ts), in its order, against PayPal’s sandbox only: test money, nothing real moves. paypalClientId and paypalClientSecret are a sandbox app’s. Each run makes a new invoice number and request id, and the last step cancels the invoice.',
    auth: bearer('paypalToken'),
    item: [
      {
        name: 'OAuth token (client credentials)',
        event: [
          preScript(`const id = pm.variables.replaceIn("{{$guid}}");
pm.collectionVariables.set("paypalRequestId", id);
// The adapter's invoice number: MS- and the request id's first 20 hex digits.
pm.collectionVariables.set("paypalInvoiceNumber", "MS-" + id.replace(/-/g, "").slice(0, 20).toUpperCase());`),
          testScript(`pm.test("a token", () => pm.response.to.have.status(200));
const b = pm.response.json();
pm.test("with its expiry", () => pm.expect(b.expires_in).to.be.above(0));
pm.collectionVariables.set("paypalToken", b.access_token);`),
        ],
        request: {
          method: 'POST',
          auth: { type: 'basic', basic: [{ key: 'username', value: '{{paypalClientId}}', type: 'string' }, { key: 'password', value: '{{paypalClientSecret}}', type: 'string' }] },
          header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
          body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client_credentials' }] },
          url: url('paypalBase', '/v1/oauth2/token'),
        },
      },
      {
        name: 'Search by invoice number (the adapter asks first, so a retry never makes a second)',
        event: [testScript(`pm.test("answers", () => pm.response.to.have.status(200));
pm.test("a fresh number finds nothing", () => pm.expect(pm.response.json().items || []).to.have.length(0));`)],
        request: {
          method: 'POST',
          header: headers(),
          body: { ...json, raw: JSON.stringify({ invoice_number: '{{paypalInvoiceNumber}}' }, null, 2) },
          url: url('paypalBase', '/v2/invoicing/search-invoices', [
            { key: 'page', value: '1' },
            { key: 'page_size', value: '1' },
          ]),
        },
      },
      {
        name: 'Create a draft invoice',
        event: [testScript(`pm.test("created", () => pm.expect([200, 201]).to.include(pm.response.code));
const inv = pm.response.json();
pm.test("a draft with an id", () => { pm.expect(inv.id).to.match(/^[A-Za-z0-9-]{1,64}$/); pm.expect(inv.status).to.eql("DRAFT"); });
pm.test("our invoice number", () => pm.expect(inv.detail.invoice_number).to.eql(pm.variables.get("paypalInvoiceNumber")));
pm.collectionVariables.set("paypalInvoiceId", inv.id);`)],
        request: {
          method: 'POST',
          header: headers('{{paypalRequestId}}'),
          body: {
            ...json,
            raw: JSON.stringify(
              {
                detail: { invoice_number: '{{paypalInvoiceNumber}}', reference: '{{paypalReference}}', currency_code: '{{paypalCurrency}}', note: 'Recorded by Munshi; payable on PayPal.' },
                items: [{ name: 'Balance due', quantity: '1', unit_amount: { currency_code: '{{paypalCurrency}}', value: '{{paypalValue}}' } }],
              },
              null,
              2,
            ),
          },
          url: url('paypalBase', '/v2/invoicing/invoices'),
        },
      },
      {
        name: 'Send it (PayPal answers the payer link; PayPal emails no one)',
        event: [testScript(`pm.test("sent", () => pm.response.to.have.status(200));
const href = pm.response.json().href;
pm.test("a payer link on PayPal's sandbox", () => pm.expect(href).to.match(/^https:\\/\\/www\\.sandbox\\.paypal\\.com\\//));
pm.collectionVariables.set("paypalPayerUrl", href);`)],
        request: { method: 'POST', header: headers('{{paypalRequestId}}-send'), body: { ...json, raw: close }, url: invoice('/send') },
      },
      {
        name: 'Get it (status and paid amount)',
        event: [testScript(`pm.test("read", () => pm.response.to.have.status(200));
const inv = pm.response.json();
pm.test("waiting to be paid", () => pm.expect(["SENT", "UNPAID"]).to.include(inv.status));
pm.test("for the amount asked", () => pm.expect(inv.amount.value).to.eql(pm.variables.get("paypalValue")));`)],
        request: { method: 'GET', header: headers(), url: invoice() },
      },
      {
        name: 'Cancel it (a debt settled another way)',
        // PayPal's sandbox answers a cancel with 200 and the cancelled invoice (its reference says 204): either is a cancel.
        event: [testScript(`pm.test("cancelled", () => pm.expect(pm.response.code).to.be.oneOf([200, 204]));`)],
        request: { method: 'POST', header: headers('{{paypalRequestId}}-cancel'), body: { ...json, raw: close }, url: invoice('/cancel') },
      },
    ],
  };
}

const variable = (key: string, value = '') => ({ key, value, type: 'string' });

/** The whole collection, from the contract. */
export function buildCollection(spec: OpenApi) {
  return {
    info: {
      _postman_id: '6a0d6f3e-9a54-4f43-9a8f-2f1d1b0c7e11',
      name: 'Munshi',
      description:
        'Munshi’s read-only integration feed, its public API v1 (from packages/contracts/openapi.json) and the PayPal sandbox calls its adapter makes. Built by integrations/postman/build.ts; edit that, not this file. Data on the sample shops is synthetic; PayPal is the sandbox.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [feed(), publicApi(spec), paypal()],
    variable: [
      variable('shopId'),
      variable('serviceId'),
      variable('stylistId'),
      variable('refSnapshot', '00000000-0000-4000-8000-000000000000'),
      variable('refRow', '0'),
      variable('refCol', 'price'),
      variable('mediaId', '00000000-0000-4000-8000-000000000000'),
      variable('holdId', '00000000-0000-4000-8000-000000000000'),
      variable('orderCode', 'ORD-0000'),
      variable('deviceToken', 'postman-device-0000000000000'),
      variable('holdToken', 'x'.repeat(43)),
      variable('paypalBase', 'https://api-m.sandbox.paypal.com'),
      variable('paypalCurrency', 'USD'),
      variable('paypalValue', '1.00'),
      variable('paypalReference', 'postman-sandbox-test'),
      variable('paypalRequestId'),
      variable('paypalInvoiceNumber'),
      variable('paypalToken'),
      variable('paypalInvoiceId'),
      variable('paypalPayerUrl'),
    ],
    event: [
      preScript(`// Today in the shop's zone (Asia/Kolkata), for the reads that take a date.
pm.collectionVariables.set("today", new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));`),
    ],
  };
}

export const collectionText = (spec: OpenApi) => `${JSON.stringify(buildCollection(spec), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as OpenApi;
  writeFileSync(COLLECTION_FILE, collectionText(spec));
  const count = Object.values(spec.paths).reduce((n, ops) => n + METHODS.filter((m) => ops[m]).length, 0);
  console.log(`postman: wrote ${COLLECTION_FILE} (${count} API operations, the feed and PayPal's sandbox calls)`);
}
