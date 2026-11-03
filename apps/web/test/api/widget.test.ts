// The order widget against the real API: the shipped widget file (apps/web/public/widgets/munshi-order.js, the script a shop's
// page loads) runs in jsdom, and every request it makes is answered by the /api/v1 route handlers on a real v2
// database, sent as a browser on the shop's page sends it (with that page's Origin). The database is never mocked.
//   - the widget shows the latest release's catalogue: each price the API's cell, with its ref, and the ref
//     resolves through "tap for source" to the book row;
//   - an order sent through the widget stores one ops.order_request under one Idempotency-Key, even when the
//     first answer is lost and the customer sends again; the code shown is the stored request's, and its status
//     link answers;
//   - a release with `orders` off renders nothing, as does a page on an origin the site does not list (the API
//     answers that origin's reads with the one 404, without a CORS header).
// Red-proofs: db/test/v2/sabotage/wid-cache.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { switchCapability } from "@munshi/core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { swapApiPorts } from "../../lib/api/deps";
import * as api from "../../lib/api/routes";
import { freshIp, type Handler, openWorld, publish, type World } from "./fixture";

const BASE = "https://munshi.example";
const SHIPPED = path.join(import.meta.dirname, "../../public/widgets/munshi-order.js");

let w: World;
let pageOrigin = "";
let loseNextOrderAnswer = false;
type Sent = { method: string; path: string; headers: Record<string, string>; status: number };
let sent: Sent[] = [];

const ROUTES: [method: string, pattern: RegExp, handler: Handler, names: string[]][] = [
  ["GET", /^\/api\/v1\/sites\/([^/]+)$/, api.site, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/catalogue$/, api.catalogue, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/refs\/([^/]+)\/([^/]+)\/([^/]+)$/, api.ref, ["slug", "snapshot", "row", "col"]],
  ["POST", /^\/api\/v1\/sites\/([^/]+)\/orders$/, api.order, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/orders\/([^/]+)$/, api.orderStatus, ["slug", "code"]],
];

// fetch as a browser on `pageOrigin` sends it, answered by the route handler Next would call.
async function browserFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  const method = init.method ?? "GET";
  const route = ROUTES.find(([m, p]) => m === method && p.test(url.pathname));
  const headers = new Headers(init.headers);
  headers.set("origin", pageOrigin);
  headers.set("x-forwarded-for", freshIp());
  if (!route) return new Response(null, { status: 404 });
  const [, pattern, handler, names] = route;
  const m = pattern.exec(url.pathname) as RegExpExecArray;
  const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] as string)]));
  const req = new Request(url, { method, headers, ...(init.body ? { body: init.body as string } : {}) });
  const res = await handler(req, { params: Promise.resolve(params) });
  sent.push({ method, path: url.pathname, headers: Object.fromEntries(headers.entries()), status: res.status });
  // A browser hands a cross-origin answer to the page only with the CORS header naming the page.
  if (res.headers.get("access-control-allow-origin") !== pageOrigin) throw new TypeError("Failed to fetch (CORS)");
  if (method === "POST" && loseNextOrderAnswer) {
    loseNextOrderAnswer = false;
    throw new TypeError("Failed to fetch (the answer was lost)");
  }
  return res;
}

beforeAll(async () => {
  w = await openWorld();
  await w.db.sabotage();
  pageOrigin = w.a.origin;
  vi.stubGlobal("fetch", browserFetch);
  // The shipped file, run as a page's <script src> runs it.
  new Function(readFileSync(SHIPPED, "utf8"))();
}, 300_000);
afterAll(async () => {
  vi.unstubAllGlobals();
  swapApiPorts({});
  await w?.close();
});

type Widget = HTMLElement & { ready: Promise<void> };
async function mount(): Promise<Widget> {
  document.body.replaceChildren();
  const el = document.createElement("munshi-order") as Widget;
  el.setAttribute("site", w.a.slug);
  el.setAttribute("key", w.a.key);
  el.setAttribute("api", BASE);
  document.body.append(el);
  await el.ready;
  return el;
}
const root = (el: Element) => el.shadowRoot as ShadowRoot;
const button = (el: Element, label: string) =>
  [...root(el).querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
const q = async <R>(sql: string, params: unknown[] = []) => (await w.db.admin.query(sql, params)).rows as R[];

test("the shipped widget shows the release's catalogue: each price the API's cell with its ref, which resolves to its book row", async () => {
  const el = await mount();
  expect(el.hidden).toBe(false);
  const catalogue = (await (await api.catalogue(new Request(`${BASE}/api/v1/sites/${w.a.slug}/catalogue`), { params: Promise.resolve({ slug: w.a.slug }) })).json()) as {
    data: { variants: { price: { minor: number; currency: string; ref: string } }[] }[];
  };
  const cells = catalogue.data.flatMap((i) => i.variants.map((v) => v.price));
  expect(cells.length).toBe(2);
  const shown = [...root(el).querySelectorAll<HTMLElement>(".figure[data-ref]")].map((f) => [f.textContent, f.dataset.ref]);
  expect(shown).toEqual(cells.map((c) => [`₹${(c.minor / 100).toLocaleString("en-IN")}`, c.ref]));

  (root(el).querySelector("button.src") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root(el).querySelector(".panel")?.textContent).toContain("books.price"));
  const priceIds = await q<{ id: string }>("select id::text as id from books.price where tenant_id = $1", [w.a.tenantId]);
  expect(priceIds.map((r) => r.id)).toContain((root(el).querySelector(".panel code") as HTMLElement).textContent);
});

test("an order through the widget stores one request under one key, even when the first answer is lost; the code and status link are the stored request's", async () => {
  const before = (await q<{ n: number }>("select count(*)::int as n from ops.order_request where tenant_id = $1", [w.a.tenantId]))[0]?.n as number;
  const el = await mount();
  sent = [];
  button(el, "One more Assam tea 250 g").click();
  button(el, "One more Assam tea 250 g").click();
  loseNextOrderAnswer = true;
  button(el, "Send order to the shop").click();
  await vi.waitFor(() => expect(root(el).querySelector('[role="alert"]')?.textContent).toContain("Try again"), { timeout: 20_000 });
  button(el, "Send order to the shop").click();
  await vi.waitFor(() => expect(root(el).querySelector(".answer")).not.toBeNull(), { timeout: 20_000 });

  const posts = sent.filter((s) => s.method === "POST");
  expect(posts.map((p) => p.status)).toEqual([201, 201]);
  expect(posts[1]?.headers["idempotency-key"]).toBe(posts[0]?.headers["idempotency-key"]);
  const stored = await q<{ code: string; channel: string; lines: unknown }>(
    "select code, channel, lines from ops.order_request where tenant_id = $1 order by created_at desc",
    [w.a.tenantId],
  );
  expect(stored.length).toBe(before + 1);
  expect(stored[0]?.channel).toBe("widget");
  const code = root(el).querySelector('.answer [data-kind="code"]')?.textContent;
  expect(code).toBe(stored[0]?.code);
  const total = root(el).querySelector<HTMLElement>(".answer p .figure[data-from]");
  expect(total?.textContent).toBe("₹480");

  const link = [...root(el).querySelectorAll("a")].find((a) => a.textContent === "Order status") as HTMLAnchorElement;
  const status = new URL(link.href);
  expect(status.pathname).toBe(`/api/v1/sites/${w.a.slug}/orders/${code}`);
  const answer = await api.orderStatus(new Request(status), { params: Promise.resolve({ slug: w.a.slug, code: code as string }) });
  expect(answer.status).toBe(200);
  expect(((await answer.json()) as { request: string }).request).toBe("received");
});

test("a release with orders off renders nothing, as does a page on an origin the site does not list", async () => {
  pageOrigin = "https://elsewhere.example";
  const elsewhere = await mount();
  expect(elsewhere.hidden).toBe(true);
  expect(root(elsewhere).childNodes.length).toBe(0);
  pageOrigin = w.a.origin;

  await switchCapability(w.db.app, w.a.owner, "orders", false);
  await publish(w.db, w.a.tenantId, w.a.siteId);
  sent = [];
  const off = await mount();
  expect(off.hidden).toBe(true);
  expect(root(off).childNodes.length).toBe(0);
  expect(sent.map((s) => s.path)).toEqual([`/api/v1/sites/${w.a.slug}`]);

  await switchCapability(w.db.app, w.a.owner, "orders", true);
  await publish(w.db, w.a.tenantId, w.a.siteId);
  expect((await mount()).hidden).toBe(false);
});
