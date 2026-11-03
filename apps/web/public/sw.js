// Munshi's service worker, hand-written and small. Registered by components/pwa/PwaClient.tsx as
// /sw.js?v=<build id>: the version names every cache, so a new build installs afresh and the old caches go on activate.
//
// What it keeps: the app shell (the offline view's page, the build's CSS, JS and fonts it loads, the icons), the build's
// static files (content-hashed, so cache-first forever) and images (stale-while-revalidate). The only HTML it ever
// stores is the offline view's page and offline.html.
// What it never handles (the network answers, untouched): any request but a GET (so no server action, which is a POST,
// and nothing that writes), a request carrying Next-Action, the router's RSC, prefetch and state-tree requests, /api/*,
// sign-in, sign-out, /platform/*, the shop sites under /s/*, another origin, and any page outside /app. An /app page is
// always fetched; offline, it falls back to the offline view (which renders the stored cells IndexedDB holds,
// read-only), or to offline.html until that view is kept.
//
// route() is the one decision. test/pwa.test.tsx runs this file in node: it asks route() about mocked requests, and
// fires its install, fetch and message listeners against mocked caches and fetch.
// Single quotes throughout: the red-proofs (db/test/v2/sabotage/pwa.ts) edit this text as a JSON-escaped string.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL = 'munshi-shell-' + VERSION;
const STATIC = 'munshi-static-' + VERSION;
const IMAGES = 'munshi-images-' + VERSION;
const OFFLINE_VIEW = '/offline';
const OFFLINE_PAGE = '/offline.html';
const SHELL_FILES = [OFFLINE_PAGE, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const NEVER = /^\/(api|sign-in|sign-out|platform|s)(\/|$)/;
const APP = /^\/app(\/|$)/;

/** How a request is served: 'none' (the network, untouched), 'static', 'image' or 'page'. */
function route(request) {
  if (request.method !== 'GET') return 'none';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'none';
  const h = request.headers;
  if (h.has('next-action')) return 'none';
  if (h.has('rsc')) return 'none';
  if (h.has('next-router-prefetch')) return 'none';
  if (h.has('next-router-state-tree')) return 'none';
  if (url.searchParams.has('_rsc')) return 'none';
  if (NEVER.test(url.pathname)) return 'none';
  if (request.mode === 'navigate') return APP.test(url.pathname) || url.pathname === OFFLINE_VIEW ? 'page' : 'none';
  if (url.pathname.startsWith('/_next/static/')) return 'static';
  if (request.destination === 'image' || url.pathname.startsWith('/icons/')) return 'image';
  return 'none';
}
self.__munshiRoute = route;

// A response worth keeping: same-origin, whole and successful.
const keepable = (res) => res && res.ok && res.type === 'basic';

async function warm() {
  const shell = await caches.open(SHELL);
  await shell.addAll(SHELL_FILES);
  // The offline view is a page of the build: keep it, every static file its HTML names (its CSS and JS), and the fonts
  // that CSS loads.
  try {
    const res = await fetch(OFFLINE_VIEW, { cache: 'reload', credentials: 'same-origin' });
    if (!keepable(res)) return;
    const html = await res.clone().text();
    await shell.put(OFFLINE_VIEW, res);
    const statics = await caches.open(STATIC);
    const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s\\<>)]+/g) || [])];
    const fonts = [];
    await Promise.all(
      assets.map(async (a) => {
        const got = await fetch(a).catch(() => null);
        if (!keepable(got)) return;
        if (a.endsWith('.css')) {
          const css = await got.clone().text();
          for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
            const u = new URL(m[1], self.location.origin + a);
            if (u.origin === self.location.origin && u.pathname.startsWith('/_next/static/')) fonts.push(u.pathname);
          }
        }
        await statics.put(a, got);
      }),
    );
    await Promise.all([...new Set(fonts)].map((f) => statics.add(f).catch(() => undefined)));
  } catch {
    // The view is kept on the next install; offline.html stands in until then.
  }
}

async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (keepable(res)) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(event.request);
  const fresh = fetch(event.request).then(async (res) => {
    if (keepable(res)) await cache.put(event.request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => undefined));
    return hit;
  }
  return fresh;
}

// A page is never stored. Offline: the offline view itself, an /app page sent to it, offline.html until it is kept.
async function page(request) {
  try {
    return await fetch(request);
  } catch {
    const path = new URL(request.url).pathname;
    const shell = await caches.open(SHELL);
    const view = await shell.match(OFFLINE_VIEW);
    if (view && path === OFFLINE_VIEW) return view;
    if (view && APP.test(path)) return Response.redirect(new URL(OFFLINE_VIEW + '?from=' + encodeURIComponent(path), self.location.origin).href, 302);
    return (await shell.match(OFFLINE_PAGE)) || Response.error();
  }
}

// A new version waits until the person reloads (PwaClient's prompt sends 'skip'): until then an open page keeps the
// build it loaded, served by the worker of that build.
self.addEventListener('install', (event) => {
  event.waitUntil(warm());
});

self.addEventListener('activate', (event) => {
  const mine = [SHELL, STATIC, IMAGES];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !mine.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const how = route(event.request);
  if (how === 'static') event.respondWith(cacheFirst(event.request));
  else if (how === 'image') event.respondWith(staleWhileRevalidate(event));
  else if (how === 'page') event.respondWith(page(event.request));
});

// Sign-out sends 'clear': every cache goes. The shell (no member's data in it) is kept again so offline still opens.
self.addEventListener('message', (event) => {
  if (event.data === 'skip') return void self.skipWaiting();
  if (event.data !== 'clear') return;
  event.waitUntil(
    clearAll()
      .then(warm)
      .then(() => event.source && event.source.postMessage('cleared')),
  );
});
