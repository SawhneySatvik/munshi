// Request ids and security headers on every route, asserted in-process for each page and route handler
// found under apps/web/app plus an unknown path: the request hook (apps/web/proxy.ts) matches it and sets x-request-id
// and the CSP, on the response and on the request Next renders (Next reads the nonce from the request's CSP); next.config
// adds the other four headers. Pages get a nonce policy, route handlers and media `default-src 'none'`. Red-proofs:
// test/v2/sabotage/core-boot.ts.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { goodEnv, loadNext, type Next, restoreEnv, setEnv } from './lib.ts';

const APP = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'apps', 'web', 'app');
const SAMPLE_ID = '0198a0b0-0000-7000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let db: TestDb;
let next: Next;
beforeAll(async () => {
  next = await loadNext();
  db = await openTestDb();
  setEnv(goodEnv(db));
  await db.sabotage();
});
afterAll(async () => {
  restoreEnv();
  await db?.close();
});

type Route = { url: string; kind: 'page' | 'data' };

// A URL per page.tsx, route.ts and metadata image under app/: route groups add no segment, a dynamic segment takes a
// sample value. Route handlers and media are data: nothing they serve is a document that may run a script.
function routes(dir = APP, segments: string[] = []): Route[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e): Route[] => {
    if (e.isDirectory()) {
      const s = e.name;
      if (s.startsWith('_')) return []; // a private folder is not routed
      const segment = /^\(.*\)$/.test(s) || s.startsWith('@') ? null : /^\[\[?\.\.\./.test(s) ? 'a/b' : /^\[.+\]$/.test(s) ? SAMPLE_ID : s;
      return routes(path.join(dir, s), segment ? [...segments, segment] : segments);
    }
    const url = `/${segments.join('/')}`;
    if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) return [{ url, kind: 'page' }];
    if (/^route\.(ts|js)$/.test(e.name)) return [{ url, kind: 'data' }];
    if (/^(icon|apple-icon)\.(svg|png|ico)$|^favicon\.ico$/.test(e.name)) return [{ url: `${url === '/' ? '' : url}/${e.name}`, kind: 'data' }];
    return [];
  });
}

const SECURITY = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
};

const directives = (csp: string) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

// The page policy, stated here independently of proxy.ts. Inline style attributes are allowed: the app renders
// computed styles (bar heights, grid columns, photo boxes) that a nonce cannot cover.
const pagePolicy = (nonce: string, dev = false) => ({
  'default-src': ["'self'"],
  'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
});
const DATA_POLICY = "default-src 'none'; frame-ancestors 'none'";

it('every route under apps/web/app, and an unknown one, gets the security headers and its CSP: pages a nonce policy, handlers and media none', async () => {
  const found = routes();
  // An independent count of the files that make routes.
  const files = readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((f) => /(^|\/)(page\.tsx|route\.ts|icon\.svg)$/.test(f));
  expect(found).toHaveLength(files.length);
  expect(found.map((r) => r.url)).toEqual(expect.arrayContaining(['/', '/sign-in', `/app/bills/${SAMPLE_ID}`, '/api/health', '/api/internal/tick', '/icon.svg']));
  const nonces = new Set<string>();
  for (const r of [...found, { url: '/no-such-page', kind: 'page' } as const]) {
    const url = `http://localhost${r.url}`;
    expect(next.doesMatch({ config: next.hookConfig, url, nextConfig: next.nextConfig }), r.url).toBe(true);
    const configured = await next.fromConfig({ url, nextConfig: next.nextConfig });
    for (const [name, value] of Object.entries(SECURITY)) expect(configured.headers.get(name), `${r.url} ${name}`).toBe(value);
    // One CSP, the hook's: a second one from next.config would be enforced beside it.
    expect(configured.headers.get('content-security-policy'), r.url).toBeNull();

    const res = await next.proxy(next.request(url));
    expect(res.headers.get('x-middleware-next'), r.url).toBe('1');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(res.headers.get('x-middleware-request-content-security-policy'), r.url).toBe(csp);
    if (r.kind === 'page') {
      const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? '';
      expect(nonce.length, r.url).toBeGreaterThanOrEqual(16);
      expect(directives(csp), r.url).toEqual(pagePolicy(nonce));
      nonces.add(nonce);
    } else {
      expect(csp, r.url).toBe(DATA_POLICY);
    }
  }
  // A fresh nonce for every page request.
  expect(nonces.size).toBe(found.filter((r) => r.kind === 'page').length + 1);
  // Under next dev, React's tooling needs eval; nothing else gets it.
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = 'development';
  try {
    const dev = (await next.proxy(next.request('http://localhost/'))).headers.get('content-security-policy') ?? '';
    expect(directives(dev)).toEqual(pagePolicy(/'nonce-([^']+)'/.exec(dev)?.[1] ?? '', true));
  } finally {
    env.NODE_ENV = nodeEnv;
  }
});

it("every response carries x-request-id, passed to the route too: Vercel's id when well-formed, else a fresh uuid, never the client's", async () => {
  const idOf = async (headers: Record<string, string> = {}, at = '/') => {
    const res = await next.proxy(next.request(`http://localhost${at}`, { headers }));
    const id = res.headers.get('x-request-id');
    expect(res.headers.get('x-middleware-request-x-request-id')).toBe(id);
    return id;
  };
  const a = await idOf();
  expect(a).toMatch(UUID);
  expect(await idOf()).not.toBe(a);
  const vercel = 'bom1::iad1::abcde-1730000000000-0123456789ab';
  expect(await idOf({ 'x-vercel-id': vercel, 'x-request-id': 'chosen-by-the-client' }, '/api/health')).toBe(vercel);
  expect(await idOf({ 'x-request-id': 'chosen-by-the-client' })).toMatch(UUID);
  for (const bad of ['has a space', 'x'.repeat(129), 'semi;colon', '<script>', '']) {
    expect(await idOf({ 'x-vercel-id': bad }), bad).toMatch(UUID);
  }
});
