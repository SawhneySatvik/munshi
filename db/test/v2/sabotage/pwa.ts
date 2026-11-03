// Red-proofs of the installable app's gates (D-079, apps/web/test/pwa.test.tsx). public/sw.js reaches the test through
// vite as a ?raw string, so its mutations are written without double quotes, backslashes or newlines that the string
// escapes.
import type { Case } from './case.ts';

const web = { dir: 'apps/web', config: 'vitest.config.ts', file: 'test/pwa.test.tsx' };
const PWA1 = 'the manifest names the app, opens on /app standalone, and its icons are files of the sizes it states';
const PWA2 = 'the service worker never serves a POST, a server action, an RSC fetch, /api, sign-in, sign-out or /platform';
const PWA3 = 'sign-out wipes the offline store and every cache; the session tag is set with a session and cleared with it';
const PWA4 = 'a session tag that changed wipes the store; a view is kept by tenant and member under its tag';
const PWA5 = 'a day-old finding opened now is shown; a view opened over a day ago is deleted, and the view asked for says so';
const PWA6 = 'the offline view shows only the stored cells, through Figure, under its read time, with every action disabled';
const PWA7 = "the installable app's words carry no digit, the English ones no Devanagari, and the Muse credit shows in both";
const PWA8 = 'a page is kept only under the tag its request carried and the member that tag is bound to; nothing else is shown';
const PWA9 = 'the root piece prunes the store on every page and forgets it on every signed-out page';
const PWA10 = 'the first worker never reloads the page; an update waits and reloads only on the click; no version unregisters';
const PWA11 = "Home and the stock page keep their views under the request's tag";
const PWA12 = "the worker keeps the shell and never a page; offline an /app page goes to the offline view; 'clear' empties every cache";
const PWA13 = 'online, the offline view goes back to the page it stands in for once the server answers';

const t = (test: string, sabotage: string, file: string, from: string, to: string): Case => ({ sabotage, ...web, test, ts: { file, from, to } });
const SW = 'apps/web/public/sw.js';
const STORE = 'apps/web/lib/offline/store.ts';
const VIEW = 'apps/web/components/pwa/OfflineView.tsx';
const CLIENT = 'apps/web/components/pwa/PwaClient.tsx';

export const PWA_CASES: Case[] = [
  // The manifest opens on the site, not the app; an icon states a size its file is not.
  t(PWA1, 'v2-pwa-start-url', 'apps/web/app/manifest.ts', 'start_url: "/app",', 'start_url: "/",'),
  t(PWA1, 'v2-pwa-icon-size', 'apps/web/app/manifest.ts', '{ src: "/icons/icon-512.png", sizes: "512x512"', '{ src: "/icons/icon-512.png", sizes: "384x384"'),

  // Each of route()'s exclusions, removed alone.
  t(PWA2, 'v2-pwa-sw-post', SW, "if (request.method !== 'GET') return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-action', SW, "if (h.has('next-action')) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-rsc', SW, "if (h.has('rsc')) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-prefetch', SW, "if (h.has('next-router-prefetch')) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-state-tree', SW, "if (h.has('next-router-state-tree')) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-rsc-query', SW, "if (url.searchParams.has('_rsc')) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-origin', SW, "if (url.origin !== self.location.origin) return 'none';", ''),
  t(PWA2, 'v2-pwa-sw-api', SW, '(api|sign-in|', '(sign-in|'),
  t(PWA2, 'v2-pwa-sw-sign-in', SW, 'api|sign-in|sign-out', 'api|sign-out'),
  t(PWA2, 'v2-pwa-sw-sign-out', SW, 'sign-in|sign-out|platform', 'sign-in|platform'),
  t(PWA2, 'v2-pwa-sw-platform', SW, 'sign-out|platform|s)', 'sign-out|s)'),
  t(PWA2, 'v2-pwa-sw-sites', SW, 'platform|s)', 'platform)'),
  // Every navigation handled, not only /app's.
  t(PWA2, 'v2-pwa-sw-app-only', SW, "APP.test(url.pathname) || url.pathname === OFFLINE_VIEW ? 'page' : 'none'", "'page'"),

  // The worker, run: a page stored; a failed response kept; no redirect to the offline view; the CSS's fonts not kept;
  // 'clear' ignored.
  t(PWA12, 'v2-pwa-sw-page-stored', SW, 'return await fetch(request);', 'const r = await fetch(request); await (await caches.open(SHELL)).put(request, r.clone()); return r;'),
  t(PWA12, 'v2-pwa-sw-keepable', SW, "const keepable = (res) => res && res.ok && res.type === 'basic';", 'const keepable = (res) => !!res;'),
  t(PWA12, 'v2-pwa-sw-redirect', SW, 'if (view && APP.test(path)) return Response.redirect(', 'if (false) return Response.redirect('),
  t(PWA12, 'v2-pwa-sw-fonts', SW, "if (u.origin === self.location.origin && u.pathname.startsWith('/_next/static/')) fonts.push(u.pathname);", ''),
  t(PWA12, 'v2-pwa-sw-clear', SW, "if (event.data !== 'clear') return;", 'return;'),

  // Sign-out: the form posts without wiping; the page forgets the form; the session tag is left behind.
  t(PWA3, 'v2-pwa-signout-wipe', 'apps/web/components/pwa/SignOutForm.tsx', 'onSubmit={() => void wipeDevice()}', 'onSubmit={() => undefined}'),
  t(
    PWA3,
    'v2-pwa-signout-page',
    'apps/web/app/(auth)/sign-out/page.tsx',
    '<SignOutForm action={signOut} className="s-form">\n        <Submit>{w.signOut}</Submit>\n      </SignOutForm>',
    '<form action={signOut} className="s-form">\n        <Submit>{w.signOut}</Submit>\n      </form>',
  ),
  t(PWA3, 'v2-pwa-signout-tag', 'apps/web/lib/server/session.ts', '  jar.set(TAG_COOKIE, "", { ...options(0), httpOnly: false });\n', ''),

  // Another session's tag no longer wipes the store.
  t(PWA4, 'v2-pwa-tag-wipe', STORE, 'if (!tag || (binding && binding.tag !== tag))', 'if (!tag)'),
  // No tag on the device (signed out, expired) no longer deletes the store (its views go one by one; the store stays).
  t(PWA4, 'v2-pwa-no-tag-wipe', STORE, 'if (!tag || (binding && binding.tag !== tag))', 'if (tag && binding && binding.tag !== tag)'),

  // Freshness from the cells' read time, not the page's open time; an old view hidden but kept; the asked view's age
  // not said.
  t(PWA5, 'v2-pwa-fresh-by-snapshot', STORE, 'now - Date.parse(v.openedAt) < MAX_AGE_MS', 'now - Date.parse(v.data.snapshots.map((s) => s.readAt).sort()[0] ?? v.openedAt) < MAX_AGE_MS'),
  t(PWA5, 'v2-pwa-stale-shown', STORE, 'else if (!(now - Date.parse(v.openedAt) < MAX_AGE_MS)) {', 'else if (false) {'),
  t(PWA5, 'v2-pwa-stale-hidden', STORE, 'drop.push(v.key);\n      stale.push(v.kind);', 'stale.push(v.kind);'),
  t(PWA5, 'v2-pwa-stale-asked', VIEW, 'lede={stale.includes(which) ? p.offlineStale : p.offlineNothing}', 'lede={p.offlineNothing}'),

  // A figure typed beside the cells; Reject offered offline.
  t(PWA6, 'v2-pwa-offline-unsourced', VIEW, 'fill(o.booksHold, { onHand: <Figure cell={row.onHand} /> })', 'fill(o.booksHold, { onHand: row.onHand.row })'),
  t(PWA6, 'v2-pwa-offline-enabled', VIEW, '<Button disabled>{t.reject}</Button>', '<Button>{t.reject}</Button>'),

  // Devanagari in the English credit; a digit in the words; the offline page stuck in the language it was kept in.
  t(PWA7, 'v2-pwa-words-deva', 'apps/web/lib/i18n-pwa.ts', 'builtWithMuse: "Built with Muse Spark Open",', 'builtWithMuse: "Built with Muse Spark Open मुंशी",'),
  t(PWA7, 'v2-pwa-words-digit', 'apps/web/lib/i18n-pwa.ts', 'offlineStale: "This page was opened on this device more than a day ago,', 'offlineStale: "This page was opened on this device more than 24 hours ago,'),
  t(PWA7, 'v2-pwa-offline-lang', VIEW, 'if (chosen !== lang) setLang(chosen);', ''),

  // A page kept under a tag its request did not carry; under a tag bound to another member; shown though not bound.
  t(PWA8, 'v2-pwa-keep-tag', STORE, ' || view.tag !== tagNow) return false;', ') return false;'),
  t(PWA8, 'v2-pwa-keep-binding', STORE, '} else if (binding.tenant !== view.tenant || binding.member !== view.member) {', '} else if (false) {'),
  t(PWA8, 'v2-pwa-show-binding', STORE, 'v.tenant === binding.tenant && v.member === binding.member', 'true'),

  // The root piece no longer prunes or forgets.
  t(PWA9, 'v2-pwa-client-prune', CLIENT, 'void (SIGNED_OUT.test(path ?? "") ? forget() : reconcile());', 'void path;'),

  // The first install reloads the page; a dev page keeps a build's worker.
  t(PWA10, 'v2-pwa-first-reload', CLIENT, 'if (!skipped.current) return;', ''),
  t(PWA10, 'v2-pwa-dev-unregister', CLIENT, '.then((regs) => Promise.all(regs.map((r) => r.unregister())))', '.then(() => undefined)'),

  // Home or the stock page no longer keeps its view (the wrapper removed).
  t(
    PWA11,
    'v2-pwa-home-keep',
    'apps/web/app/app/page.tsx',
    '    <KeepOffline kind="home" {...keepOf(jar, session)} data={data}>\n      <InstallPrompt />\n      <GettingStarted done={start} />\n      <OwnerHome data={data} now={new Date().toISOString()} />\n    </KeepOffline>',
    '    <>\n      <InstallPrompt />\n      <GettingStarted done={start} />\n      <OwnerHome data={data} now={new Date().toISOString()} />\n    </>',
  ),
  t(
    PWA11,
    'v2-pwa-stock-keep',
    'apps/web/app/app/stock/page.tsx',
    '    <KeepOffline kind="stock" {...keepOf(jar, session)} data={data}>\n      <StockBook data={data} photo={<ShelfPhoto key="shelf-photo" waiting={waiting} recorded={recordedMode()} />} formKey={formKey()} />\n    </KeepOffline>',
    '    <StockBook data={data} photo={<ShelfPhoto key="shelf-photo" waiting={waiting} recorded={recordedMode()} />} formKey={formKey()} />',
  ),

  // Online, the offline view stays (kept data shown without the server's say).
  t(PWA13, 'v2-pwa-online-back', VIEW, 'if (navigator.onLine) {', 'if (false) {'),
];
