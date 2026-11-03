// The installable app.
// - the manifest is valid and its icons are the files it names, at their sizes.
// - the worker's route() never handles a POST, a server action, a router RSC, prefetch or state-tree request, /api,
//   sign-in, sign-out, /platform, the shop sites, another origin, or a page outside /app.
// - sign-out wipes the offline store and every cache, the sign-out page uses that form, and the session tag goes
//   with the session.
// - a session tag that changed, or none, wipes the store.
// - freshness is the page's open time: a day-old finding opened now is shown; a view opened over a day ago is
//   deleted, not hidden, and the view asked for says so even when the other is fresh.
// - the offline view renders only the stored cells, through Figure, with every action disabled and no form.
// - the words carry no digit, the English ones no Devanagari, the Muse credit shows in both, and the offline page
//   follows the language chosen since.
// - a page is kept only under the tag its request carried, if that is the device's tag, and only for the member the
//   tag is bound to; nothing else is shown.
// - the root piece prunes the store on every page and forgets it on every signed-out page.
// - the first worker never reloads the page; an update waits and reloads only on the person's click; with no version
//   (dev) every registration goes.
// - Home and the stock page keep their views (the pages, rendered).
// - the worker, run: install keeps the shell (the offline view, its static files, the fonts its CSS names); pages
//   are never stored (no HTML but the offline view's and offline.html); offline an /app page goes to the offline view;
//   'clear' empties every cache and keeps the shell again.
// - online, the offline view goes back to the page it stands in for once the server answers.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { signOut } from "../app/(auth)/actions";
import SignOutPage from "../app/(auth)/sign-out/page";
import { signIn } from "../app/actions";
import HomePage from "../app/app/page";
import StockPage from "../app/app/stock/page";
import manifest from "../app/manifest";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { MuseCredit } from "../components/pwa/MuseCredit";
import { OfflineBody, OfflineView } from "../components/pwa/OfflineView";
import { PwaClient } from "../components/pwa/PwaClient";
import { goTo, reloadPage } from "../components/pwa/reload";
import { SignOutForm } from "../components/pwa/SignOutForm";
import { LANG_COOKIE } from "../lib/i18n";
import { PWA } from "../lib/i18n-pwa";
import { type KeptView, keep, keptView, MAX_AGE_MS, OFFLINE_DB, prune, readKept, reconcile } from "../lib/offline/store";
import { TAG_COOKIE } from "../lib/offline/tag";
import { resolveCell } from "../lib/snapshot";
import { loadHome } from "../lib/server/home";
import { SESSION_COOKIE } from "../lib/server/session";
import { loadStock } from "../lib/server/stock";
import type { Lang } from "../lib/types";
import { refsIn, sourcedInBoth } from "./helpers/app-render";
import { Redirect, state } from "./helpers/app-state";
import { type Home, openHome, signInAs } from "./helpers/home-db";
import { fakeMatchMedia } from "./helpers/render";
// The worker as the build serves it, through vite (so a red-proof can edit it), run below in node contexts of its own.
import SW from "../public/sw.js?raw";

vi.mock("../components/pwa/reload", () => ({ reloadPage: vi.fn(), goTo: vi.fn() }));

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  setTag("");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "onLine");
});

const web = new URL("..", import.meta.url);
const DEVA = /[ऀ-ॿ]/;
const DIGITS = /[0-9०-९]/;
const HOUR = 3_600_000;

/** This device's session tag (the readable cookie the server sets beside the session). */
function setTag(tag: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: the test plays the browser's cookie jar.
  document.cookie = tag ? `${TAG_COOKIE}=${tag}; path=/` : `${TAG_COOKIE}=; path=/; max-age=0`;
}

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (file: string) => {
  const b = readFileSync(new URL(`public${file}`, web));
  expect(b.subarray(1, 4).toString("latin1"), file).toBe("PNG");
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

test("the manifest names the app, opens on /app standalone, and its icons are files of the sizes it states", () => {
  const m = manifest();
  expect(m).toMatchObject({ name: "Munshi", short_name: "Munshi", start_url: "/app", scope: "/", display: "standalone" });
  const ground = readFileSync(new URL("styles/tokens.css", web), "utf8").match(/--ground:\s*(#[0-9a-f]{6});/)?.[1];
  expect(m.background_color).toBe(ground);
  expect(m.theme_color).toBe(ground);
  const icons = m.icons ?? [];
  for (const i of icons) expect(pngSize(i.src), i.src).toBe(i.sizes);
  expect(icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  expect(m.shortcuts?.map((s) => [s.name, s.url])).toEqual([
    ["Ask", "/app/ask"],
    ["Counter", "/app/counter"],
    ["Stock", "/app/stock"],
  ]);
  for (const s of m.shortcuts ?? []) for (const i of s.icons ?? []) expect(pngSize(i.src)).toBe(i.sizes);
  expect(pngSize("/icons/apple-touch-icon.png")).toBe("180x180");
  for (const f of ["/offline.html", "/icons/maskable-512.png"]) expect(readFileSync(new URL(`public${f}`, web)).length).toBeGreaterThan(0);
});

// ---- the worker, in node ----

const ORIGIN = "https://shop.example";
type Req = { method: string; url: string; mode: string; destination: string; headers: Headers };
type Route = (r: Req) => string;
type Listener = (event: Record<string, unknown>) => void;

/** A response as the network gives it to a worker (same-origin: type "basic"). */
const answer = (body: string, type: string, status = 200) => {
  const r = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(r, "type", { value: "basic" });
  return r;
};

/** Caches, in memory, keyed by path. */
function memoryCaches() {
  const store = new Map<string, Map<string, Response>>();
  const pathOf = (r: string | Req) => new URL(typeof r === "string" ? r : r.url, ORIGIN).pathname + new URL(typeof r === "string" ? r : r.url, ORIGIN).search;
  const api = {
    store,
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name) as Map<string, Response>;
      const cache = {
        match: async (r: string | Req) => c.get(pathOf(r))?.clone(),
        put: async (r: string | Req, res: Response) => void c.set(pathOf(r), res),
        add: async (r: string) => {
          const res = await net.fetch(r);
          if (!res.ok) throw new Error(`add ${r}: ${res.status}`);
          c.set(pathOf(r), res);
        },
        addAll: async (rs: string[]) => {
          for (const r of rs) await cache.add(r);
        },
      };
      return cache;
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  return api;
}

/** The network the worker sees: answers by path, or fails (offline). */
const net = {
  offline: false,
  fetch: async (r: string | Req): Promise<Response> => {
    if (net.offline) throw new TypeError("Failed to fetch");
    const path = new URL(typeof r === "string" ? r : r.url, ORIGIN).pathname;
    if (path === "/offline") return answer('<html><link rel="stylesheet" href="/_next/static/chunks/shell.css"><script src="/_next/static/chunks/app.js"></script></html>', "text/html");
    if (path === "/_next/static/chunks/shell.css") return answer("@font-face{src:url(../media/face-1.woff2) format('woff2')}", "text/css");
    if (path.startsWith("/_next/static/missing")) return answer("<html>not found</html>", "text/html", 404);
    if (path.startsWith("/_next/static/")) return answer("x", path.endsWith(".woff2") ? "font/woff2" : "application/javascript");
    if (path.startsWith("/icons/") || path.endsWith(".png")) return answer("png", "image/png");
    if (path === "/offline.html") return answer("<html>offline</html>", "text/html");
    if (path === "/manifest.webmanifest") return answer("{}", "application/manifest+json");
    return answer(`<html>page ${path}</html>`, "text/html");
  },
};

/** sw.js run in a fresh context: its listeners, route(), and the caches it writes. */
function runWorker() {
  const listeners = new Map<string, Listener>();
  const skipWaiting = vi.fn();
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=build-a`),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting,
    clients: { claim: async () => {} },
  };
  const caches = memoryCaches();
  const context = vm.createContext({ self, URL, Response, Headers, caches, fetch: (r: string | Req) => net.fetch(r), Promise, Set, Map });
  vm.runInContext(SW, context, { filename: "public/sw.js" });
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    (listeners.get(type) as Listener)({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (responded = p) });
    await Promise.all(waits);
    return responded ? await responded : undefined;
  };
  return { listeners, route: (self as unknown as { __munshiRoute: Route }).__munshiRoute, caches, fire, skipWaiting };
}

const req = (path: string, opts: { method?: string; mode?: string; destination?: string; headers?: Record<string, string> } = {}): Req => ({
  method: opts.method ?? "GET",
  url: path.startsWith("http") ? path : `${ORIGIN}${path}`,
  mode: opts.mode ?? "cors",
  destination: opts.destination ?? "",
  headers: new Headers(opts.headers ?? {}),
});
const nav = (path: string, headers?: Record<string, string>) => req(path, { mode: "navigate", destination: "document", headers });
const img = (path: string) => req(path, { destination: "image" });

test("the service worker never serves a POST, a server action, an RSC fetch, /api, sign-in, sign-out or /platform", () => {
  const { route, listeners } = runWorker();
  expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message"]);
  const never = [
    ["a POST to a page", req("/app", { method: "POST", mode: "navigate" })],
    ["a POST to /_next/static", req("/_next/static/chunks/a.js", { method: "POST" })],
    ["a server action", req("/app/stock", { method: "POST", headers: { "Next-Action": "abc" } })],
    ["a server action as a navigation", nav("/app/stock", { "Next-Action": "abc" })],
    ["an RSC fetch", nav("/app/stock", { RSC: "1" })],
    ["an RSC fetch by query", nav("/app/stock?_rsc=x1")],
    ["a router state tree", nav("/app", { "Next-Router-State-Tree": "x" })],
    ["a prefetch", nav("/app/counter", { "Next-Router-Prefetch": "1" })],
    ["an /api read", img("/api/v1/photo")],
    ["sign-in", img("/sign-in/mark.png")],
    ["sign-out", img("/sign-out/mark.png")],
    ["a console page", img("/platform/logo.png")],
    ["a shop site", img("/s/elite/logo.png")],
    ["a shop site page", nav("/s/elite")],
    ["another origin", req("https://cdn.example/_next/static/x.js")],
    ["a page outside /app", nav("/")],
    ["a site page", nav("/how-it-works")],
    ["a plain fetch", req("/app/data.json")],
  ] as const;
  for (const [what, r] of never) expect(route(r), what).toBe("none");
  expect(route(req("/_next/static/chunks/main-abc.js"))).toBe("static");
  expect(route(req("/_next/static/media/face.woff2", { destination: "font" }))).toBe("static");
  expect(route(img("/icons/icon-192.png"))).toBe("image");
  expect(route(img("/_next/image?url=%2Fx.png"))).toBe("image");
  expect(route(nav("/app"))).toBe("page");
  expect(route(nav("/app/stock"))).toBe("page");
  expect(route(nav("/offline?from=%2Fapp"))).toBe("page");
});

test("the worker keeps the shell and never a page; offline an /app page goes to the offline view; 'clear' empties every cache", async () => {
  net.offline = false;
  const w = runWorker();
  await w.fire("install");
  const paths = (name: string) => [...(w.caches.store.get(`munshi-${name}-build-a`)?.keys() ?? [])].sort();
  expect(paths("shell")).toEqual(["/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/manifest.webmanifest", "/offline", "/offline.html"]);
  // The shell's CSS and JS, and the font that CSS names.
  expect(paths("static")).toEqual(["/_next/static/chunks/app.js", "/_next/static/chunks/shell.css", "/_next/static/media/face-1.woff2"]);

  // Online: pages are fetched and never stored; static files and images are, but not a failed one.
  const online = async (r: Req) => (await w.fire("fetch", { request: r }))?.status;
  expect(await online(nav("/app"))).toBe(200);
  expect(await online(nav("/app/stock"))).toBe(200);
  expect(await online(req("/_next/static/chunks/later.js"))).toBe(200);
  expect(await online(req("/_next/static/missing.js"))).toBe(404);
  expect(await online(img("/icons/icon-192.png"))).toBe(200);
  expect(await w.fire("fetch", { request: nav("/") })).toBeUndefined();
  const html: string[] = [];
  for (const [name, entries] of w.caches.store) for (const [path, res] of entries) if (res.headers.get("content-type")?.includes("text/html")) html.push(`${name} ${path}`);
  expect(html.sort()).toEqual(["munshi-shell-build-a /offline", "munshi-shell-build-a /offline.html"]);
  expect(paths("static")).toContain("/_next/static/chunks/later.js");
  expect(paths("static")).not.toContain("/_next/static/missing.js");

  // Offline: an /app page is sent to the offline view; the view is the kept page; with no view kept, offline.html.
  net.offline = true;
  const sent = await w.fire("fetch", { request: nav("/app/stock") });
  expect([sent?.status, sent?.headers.get("location")]).toEqual([302, `${ORIGIN}/offline?from=%2Fapp%2Fstock`]);
  expect(await (await w.fire("fetch", { request: nav("/offline?from=%2Fapp") }))?.text()).toContain("_next/static/chunks/shell.css");
  expect(await (await w.fire("fetch", { request: req("/_next/static/chunks/app.js") }))?.text()).toBe("x");
  w.caches.store.get("munshi-shell-build-a")?.delete("/offline");
  expect(await (await w.fire("fetch", { request: nav("/app") }))?.text()).toBe("<html>offline</html>");
  net.offline = false;

  // 'clear' (sign-out): every cache goes, then the member-free shell is kept again; the page hears 'cleared'.
  w.caches.store.set("munshi-images-build-a", new Map([["/members-photo.png", answer("p", "image/png")]]));
  const told: unknown[] = [];
  const deleted: string[] = [];
  const del = w.caches.delete;
  w.caches.delete = async (name: string) => {
    deleted.push(name);
    return del(name);
  };
  await w.fire("message", { data: "clear", source: { postMessage: (m: unknown) => told.push(m) } });
  expect(deleted.sort()).toEqual(["munshi-images-build-a", "munshi-shell-build-a", "munshi-static-build-a"]);
  expect([...w.caches.store.keys()].sort()).toEqual(["munshi-shell-build-a", "munshi-static-build-a"]);
  expect(told).toEqual(["cleared"]);
  await w.fire("message", { data: "skip" });
  expect(w.skipWaiting).toHaveBeenCalledTimes(1);
});

// ---- a small IndexedDB for jsdom (it has none): named stores with key paths, requests answered on a later task ----

function fakeIndexedDB() {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const keyPaths = new Map<string, string>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const deleted: string[] = [];
  type Req = Record<string, unknown> & { result?: unknown };
  const call = (r: Req, name: string) => (r[name] as (() => void) | undefined)?.();
  return {
    dbs,
    deleted,
    open(name: string) {
      const r: Req = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        const db = dbs.get(name) as Map<string, Map<string, unknown>>;
        r.result = {
          createObjectStore(store: string, opts: { keyPath: string }) {
            db.set(store, new Map());
            keyPaths.set(store, opts.keyPath);
          },
          close() {},
          transaction() {
            let pending = 0;
            let completed = false;
            const tx: Req = {};
            const settle = () =>
              later(() => {
                if (pending === 0 && !completed) {
                  completed = true;
                  call(tx, "oncomplete");
                }
              });
            const op = (fn: () => unknown) => {
              pending++;
              const q: Req = {};
              later(() => {
                q.result = fn();
                call(q, "onsuccess");
                pending--;
                settle();
              });
              return q;
            };
            tx.objectStore = (store: string) => {
              const data = db.get(store) as Map<string, unknown>;
              const key = keyPaths.get(store) as string;
              return {
                get: (k: string) => op(() => structuredClone(data.get(k))),
                getAll: () => op(() => [...data.values()].map((v) => structuredClone(v))),
                put: (v: Record<string, string>) => op(() => data.set(v[key] as string, structuredClone(v))),
                delete: (k: string) => op(() => data.delete(k)),
                clear: () => op(() => data.clear()),
              };
            };
            settle();
            return tx;
          },
        };
        if (fresh) call(r, "onupgradeneeded");
        call(r, "onsuccess");
      });
      return r;
    },
    deleteDatabase(name: string) {
      const r: Req = {};
      later(() => {
        dbs.delete(name);
        deleted.push(name);
        call(r, "onsuccess");
      });
      return r;
    },
    /** The kept views, by key. */
    views: () => [...(dbs.get(OFFLINE_DB)?.get("views")?.keys() ?? [])].map((k) => k.replace(/[0-9a-f-]{36}/g, "<id>")).sort(),
  };
}

const ownerOf = (who: { tenantId: string; memberId: string }, tag: string) => ({ tenant: who.tenantId, member: who.memberId, tag });
const viewsOf = async (who: Home["k"]["owner"], tag: string, openedAt = new Date().toISOString()) => {
  const home = keptView({ kind: "home", data: await loadHome(who) }, ownerOf(who, tag), openedAt);
  const stock = keptView({ kind: "stock", data: await loadStock(who) }, ownerOf(who, tag), openedAt);
  if (!home || !stock) throw new Error("test: the member's home and stock hold snapshots");
  return { home, stock };
};

/** The elements in a server page's tree, children first-class (no rendering). */
function elementsIn(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elementsIn(n, out);
  else if (isValidElement(node)) {
    out.push(node);
    elementsIn((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

test("sign-out wipes the offline store and every cache; the session tag is set with a session and cleared with it", async () => {
  const idb = fakeIndexedDB();
  const cacheKeys = ["munshi-shell-a", "munshi-static-a", "munshi-images-a"];
  const deletedCaches: string[] = [];
  const posted: unknown[] = [];
  vi.stubGlobal("indexedDB", idb);
  vi.stubGlobal("caches", { keys: async () => cacheKeys, delete: async (k: string) => deletedCaches.push(k) > 0 });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: { postMessage: (m: unknown) => posted.push(m) } } });
  const action = vi.fn(async () => {});
  render(
    <SignOutForm action={action} className="s-form">
      <button type="submit">Sign out</button>
    </SignOutForm>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await vi.waitFor(() => expect(posted).toEqual(["clear"]));
  expect(idb.deleted).toEqual([OFFLINE_DB]);
  expect(deletedCaches.sort()).toEqual([...cacheKeys].sort());
  // The sign-out page posts through that form.
  const forms = elementsIn(await SignOutPage()).filter((e) => e.type === SignOutForm);
  expect(forms.map((f) => (f.props as { action: unknown }).action)).toEqual([signOut]);

  // The server's side: a sign-in sets a readable tag that is not the session's token; another sign-in a new one;
  // sign-out clears it.
  const signInOf = async (memberId: string) => {
    const form = new FormData();
    form.set("member", memberId);
    await expect(signIn(form)).rejects.toBeInstanceOf(Redirect);
    return state.cookies.get(TAG_COOKIE) as string;
  };
  state.cookies.clear();
  const first = await signInOf(h.k.owner.memberId);
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.cookies.get(SESSION_COOKIE)).not.toContain(first);
  expect(state.cookieOptions.get(TAG_COOKIE)).toMatchObject({ httpOnly: false, path: "/" });
  const second = await signInOf(h.k.manager.memberId);
  expect(second).not.toBe(first);
  await expect(signOut()).rejects.toBeInstanceOf(Redirect);
  expect(state.cookies.get(TAG_COOKIE)).toBe("");
  expect(state.cookieOptions.get(TAG_COOKIE)).toMatchObject({ maxAge: 0 });
});

test("a session tag that changed wipes the store; a view is kept by tenant and member under its tag", async () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  const { home, stock } = await viewsOf(h.k.owner, "tag-a");
  expect(home.key).toBe(`${h.k.tenantId}:${h.k.owner.memberId}:home`);
  expect(await keep(home, "tag-a")).toBe(true);
  expect(await keep(stock, "tag-a")).toBe(true);
  expect((await readKept("tag-a")).views.map((v) => v.kind).sort()).toEqual(["home", "stock"]);
  // The same session on the next load: nothing goes.
  expect(await reconcile("tag-a")).toBe(false);
  expect(idb.views()).toHaveLength(2);
  // Another session on this device: the store goes.
  expect(await reconcile("tag-b")).toBe(true);
  expect(idb.deleted).toEqual([OFFLINE_DB]);
  expect(idb.views()).toEqual([]);
  // No session at all (signed out, the cookie expired): the store goes.
  await keep(home, "tag-a");
  expect(await reconcile("")).toBe(true);
  expect(idb.views()).toEqual([]);
  expect(idb.dbs.has(OFFLINE_DB)).toBe(false);
  // A keep under a new tag drops the old session's views.
  await keep(home, "tag-a");
  const { stock: next } = await viewsOf(h.k.owner, "tag-c");
  expect(await keep(next, "tag-c")).toBe(true);
  expect(idb.views()).toEqual(["<id>:<id>:stock"]);
  expect((await readKept("tag-a")).views).toEqual([]);
});

test("a day-old finding opened now is shown; a view opened over a day ago is deleted, and the view asked for says so", async () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  const now = Date.now();
  // Home's snapshots read three days ago (a finding left open), its page opened now: shown.
  const { home, stock } = await viewsOf(h.k.owner, "tag-a", new Date(now).toISOString());
  const old = new Date(now - 72 * HOUR).toISOString();
  const aged = { ...home, data: { ...home.data, snapshots: home.data.snapshots.map((s) => ({ ...s, readAt: old })) } } as KeptView;
  await keep(aged, "tag-a");
  expect((await prune("tag-a", now + HOUR)).views.map((v) => v.kind)).toEqual(["home"]);
  // A day and an hour after the page was opened: the view is deleted from the store, not hidden.
  const later = await prune("tag-a", now + MAX_AGE_MS + HOUR);
  expect(later).toEqual({ views: [], stale: ["home"], removed: true });
  expect(idb.views()).toEqual([]);

  // The view asked for is too old while the other is fresh: it says so, and shows no figure.
  const { stock: fresh } = await viewsOf(h.k.owner, "tag-a", new Date(now + MAX_AGE_MS).toISOString());
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <OfflineBody views={[fresh]} stale={["home"]} which="home" />
      </LangProvider>,
    );
    expect(document.body.textContent).toContain(PWA[lang].offlineStale);
    expect(document.querySelectorAll("button.fig")).toHaveLength(0);
    expect(DIGITS.test(document.body.textContent ?? "")).toBe(false);
    cleanup();
  }
  expect(stock.kind).toBe("stock");
});

/** Every control on the page that could act: none may be enabled but a figure (it opens its source, a read). */
const enabledActions = () =>
  [...document.querySelectorAll("button, input, select, textarea")].filter(
    (el) => !(el as HTMLButtonElement).disabled && !el.classList.contains("fig") && !el.closest(".drawer, [role=dialog]"),
  );

test("the offline view shows only the stored cells, through Figure, under its read time, with every action disabled", async () => {
  const { home, stock } = await viewsOf(h.k.owner, "tag-a");
  for (const view of [home, stock]) {
    const refs = refsIn(view.data);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(resolveCell(view.data.snapshots, r), `${r.label.en} ${r.col}`).toBeDefined();
  }
  for (const which of ["home", "stock"] as const) {
    const text = sourcedInBoth(<OfflineBody views={[home, stock]} which={which} />);
    const view = which === "home" ? home : stock;
    expect(text).toContain("Offline · this page as opened at");
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(view.openedAt);
    expect(document.querySelectorAll("button.fig").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(enabledActions().map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    const disabled = [...document.querySelectorAll("button:disabled")].map((b) => b.textContent);
    expect(disabled).toEqual(which === "home" ? expect.arrayContaining(["Approve", "Reject"]) : ["Record a count"]);
    cleanup();
  }
});

test("the installable app's words carry no digit, the English ones no Devanagari, and the Muse credit shows in both", async () => {
  for (const lang of ["en", "hi"] as Lang[]) expect(Object.values(PWA[lang]).filter((w) => DIGITS.test(w)), lang).toEqual([]);
  expect(Object.values(PWA.en).filter((w) => DEVA.test(w))).toEqual([]);
  expect(Object.keys(PWA.hi).sort()).toEqual(Object.keys(PWA.en).sort());
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <MuseCredit />
      </LangProvider>,
    );
    expect(document.body.textContent).toContain("Muse Spark Open");
    if (lang === "en") expect(DEVA.test(document.body.textContent ?? "")).toBe(false);
    cleanup();
  }
  // The offline page was kept in Hindi; the person has since chosen English: it follows the choice.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // biome-ignore lint/suspicious/noDocumentCookie: the person's language choice, as the toggle sets it.
  document.cookie = `${LANG_COOKIE}=en; path=/`;
  render(
    <LangProvider initial="hi">
      <OfflineView />
    </LangProvider>,
  );
  await screen.findByText(PWA.en.offlineTitle);
  expect(DEVA.test(document.body.textContent ?? "")).toBe(false);
  cleanup();
  const offline = readFileSync(new URL("public/offline.html", web), "utf8");
  expect(DIGITS.test(offline.replace(/<style>[\s\S]*<\/style>/, "").replace(/<[^>]*>/g, ""))).toBe(false);
});

test("a page is kept only under the tag its request carried and the member that tag is bound to; nothing else is shown", async () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  // Member A's page, rendered under A's tag, restored from history after B signed in on this device: not kept.
  const a = await viewsOf(h.k.owner, "tag-a");
  expect(await keep(a.home, "tag-b")).toBe(false);
  expect(idb.views()).toEqual([]);
  // B's session binds tag-b to B; A's data claiming tag-b is refused, and the store is emptied.
  const b = await viewsOf(h.k.manager, "tag-b");
  expect(await keep(b.home, "tag-b")).toBe(true);
  const forged = keptView({ kind: "stock", data: a.stock.data }, ownerOf(h.k.owner, "tag-b"), a.stock.openedAt) as KeptView;
  expect(await keep(forged, "tag-b")).toBe(false);
  expect(idb.views()).toEqual([]);
  // And a view of another member written under the tag is never shown.
  expect(await keep(b.stock, "tag-b")).toBe(true);
  const raw = idb.dbs.get(OFFLINE_DB)?.get("views") as Map<string, unknown>;
  raw.set("planted", { ...a.home, tag: "tag-b", key: "planted" });
  const shown = await readKept("tag-b");
  expect(shown.views.map((v) => `${v.member === h.k.manager.memberId ? "B" : "A"}:${v.kind}`)).toEqual(["B:stock"]);
  expect(raw.has("planted")).toBe(false);
});

/** A service worker container: a registration whose worker states the test drives. */
function fakeWorkers(opts: { controller: boolean; waiting?: boolean }) {
  const container = new EventTarget() as EventTarget & Record<string, unknown>;
  const posted: unknown[] = [];
  const waiting = opts.waiting ? { scriptURL: "/sw.js?v=b", postMessage: (m: unknown) => posted.push(m) } : null;
  const reg = Object.assign(new EventTarget(), { waiting, installing: null, unregister: vi.fn(async () => true) });
  Object.assign(container, {
    controller: opts.controller ? { postMessage: () => {} } : null,
    register: vi.fn(async () => reg),
    getRegistrations: vi.fn(async () => [reg]),
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  return { container, reg, posted };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

test("the root piece prunes the store on every page and forgets it on every signed-out page", async () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  const { home } = await viewsOf(h.k.owner, "tag-a");
  const at = async (path: string, tag: string) => {
    state.path = path;
    setTag(tag);
    render(
      <LangProvider initial="en">
        <PwaClient version={null} />
      </LangProvider>,
    );
    await flush();
    await flush();
    cleanup();
  };
  // A page under the same session keeps the store; under another, it goes.
  await keep(home, "tag-a");
  await at("/app", "tag-a");
  expect(idb.views()).toHaveLength(1);
  await at("/app/stock", "tag-z");
  expect(idb.views()).toEqual([]);
  // A signed-out page (where a revoked session's /app request lands) forgets the store even under the same tag.
  await keep(home, "tag-a");
  await at("/sign-in", "tag-a");
  expect(idb.views()).toEqual([]);
  state.path = "/";
});

test("the first worker never reloads the page; an update waits and reloads only on the click; no version unregisters", async () => {
  // First install: no controller when the page registered; the new worker's claim changes the controller.
  let sw = fakeWorkers({ controller: false });
  render(
    <LangProvider initial="en">
      <PwaClient version="build-a" />
    </LangProvider>,
  );
  await flush();
  expect(sw.container.register).toHaveBeenCalledWith("/sw.js?v=build-a", { scope: "/" });
  sw.container.dispatchEvent(new Event("controllerchange"));
  expect(reloadPage).not.toHaveBeenCalled();
  expect(document.querySelector(".pwa-update")).toBeNull();
  cleanup();

  // An update: a worker waits behind the controlling one; the page offers a reload, and only the click hands over.
  sw = fakeWorkers({ controller: true, waiting: true });
  render(
    <LangProvider initial="en">
      <PwaClient version="build-b" />
    </LangProvider>,
  );
  const reload = await screen.findByRole("button", { name: PWA.en.updateReload });
  sw.container.dispatchEvent(new Event("controllerchange"));
  expect(reloadPage).not.toHaveBeenCalled();
  fireEvent.click(reload);
  expect(sw.posted).toEqual(["skip"]);
  sw.container.dispatchEvent(new Event("controllerchange"));
  expect(reloadPage).toHaveBeenCalledTimes(1);
  cleanup();

  // No version (next dev): nothing registers, and a worker left from a build goes.
  sw = fakeWorkers({ controller: true });
  render(
    <LangProvider initial="en">
      <PwaClient version={null} />
    </LangProvider>,
  );
  await flush();
  expect(sw.container.register).not.toHaveBeenCalled();
  expect(sw.reg.unregister).toHaveBeenCalledTimes(1);
});

test("Home and the stock page keep their views under the request's tag", async () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  signInAs(h.k.owner);
  state.cookies.set(TAG_COOKIE, "tag-p");
  setTag("tag-p");
  const show = async (page: () => Promise<ReactNode>) => {
    render(
      <LangProvider initial="en">
        <AskProvider who={h.k.owner.memberId}>{await page()}</AskProvider>
      </LangProvider>,
    );
  };
  await show(HomePage);
  await vi.waitFor(() => expect(idb.views()).toEqual(["<id>:<id>:home"]));
  cleanup();
  await show(StockPage);
  await vi.waitFor(() => expect(idb.views()).toEqual(["<id>:<id>:home", "<id>:<id>:stock"]));
  cleanup();
  // The device's tag is no longer the request's (another sign-in since): the page is not kept, the old ones go.
  setTag("tag-q");
  expect(await reconcile()).toBe(true);
  await show(HomePage);
  await flush();
  await flush();
  expect(idb.views()).toEqual([]);
  state.cookies.delete(TAG_COOKIE);
});

test("online, the offline view goes back to the page it stands in for once the server answers", async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDB());
  window.history.replaceState(null, "", "/offline?from=%2Fapp%2Fstock");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  render(
    <LangProvider initial="en">
      <OfflineView />
    </LangProvider>,
  );
  await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith("/app/stock"));
  expect(document.body.textContent).not.toContain(PWA.en.offlineTitle);
  cleanup();
  // The network says online but the server does not answer: the kept view stays.
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  vi.mocked(goTo).mockClear();
  render(
    <LangProvider initial="en">
      <OfflineView />
    </LangProvider>,
  );
  await screen.findByText(PWA.en.offlineTitle);
  expect(goTo).not.toHaveBeenCalled();
  window.history.replaceState(null, "", "/");
});
