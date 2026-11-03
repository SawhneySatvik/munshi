// The apparel site (MUNSHI_SITE=prabhave) against the real API (test/world.ts; the database is never mocked).
//   - every page renders from the API; each price is a published cell with its ref;
//   - a piece hold is one requested ops.reservation; holds off removes the ask;
//   - the order intake: one request under one Idempotency-Key even when the answer is lost; the ORD- code is the
//     stored request's and opens its status page;
//   - the site presents as live (lib/variant.ts): no sample wording, and open to search engines.
// Red-proofs: db/test/v2/sabotage/apps-sites.ts.
import { type CatalogueItem, createClient, formatMoney } from "@munshi/sdk";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import ProductPage from "../app/[lang]/catalogue/[id]/page.tsx";
import CataloguePage from "../app/[lang]/catalogue/page.tsx";
import { generateMetadata } from "../app/[lang]/layout.tsx";
import StatusPage from "../app/[lang]/order/[code]/page.tsx";
import OrderPage from "../app/[lang]/order/page.tsx";
import HomePage from "../app/[lang]/page.tsx";
import robots from "../app/robots.ts";
import { profile as prabhave } from "../businesses/prabhave/profile.ts";
import { button, click, looseDigits, render, submit, type, until } from "./render.tsx";
import { NotFound, openSites, SERVER, type World } from "./world.ts";

let w: World;
const api = createClient({ baseUrl: SERVER });
let items: CatalogueItem[] = [];
let refs = new Set<string>();
const variants = () => items.flatMap((i) => i.variants);

beforeAll(async () => {
  w = await openSites("prabhave");
  await w.db.sabotage();
  items = (await api.catalogue("prabhave", { limit: 100 })).data;
  const offers = (await api.offers("prabhave", { limit: 100 })).data;
  refs = new Set([...variants().map((v) => v.price.ref), ...offers.flatMap((o) => (o.kind === "percent_off" ? [o.percentBp.ref] : [o.amountOff.ref]))]);
}, 300_000);
afterAll(async () => {
  await w?.close();
});
beforeEach(() => {
  localStorage.clear();
});

const free = () => variants().filter((v) => !v.held);

test("every Prabhave page renders from the API: each price on it is a published cell with its ref", async () => {
  expect(variants().length).toBeGreaterThan(50);
  const piece = free()[0];
  if (!piece) throw new Error("test: no free piece");
  for (const [name, page, params] of [
    ["home", HomePage, { lang: "en" }],
    ["catalogue", CataloguePage, { lang: "en" }],
    ["product", ProductPage, { lang: "en", id: piece.id }],
    ["home (Hindi)", HomePage, { lang: "hi" }],
  ] as const) {
    const root = await render(page, params);
    const figs = [...root.querySelectorAll<HTMLElement>(".fig[data-ref]")];
    expect(figs.length, name).toBeGreaterThan(0);
    for (const f of figs) expect(refs.has(f.dataset.ref ?? ""), `${name}: ${f.textContent}`).toBe(true);
    expect(root.querySelectorAll("[data-unverified]").length, name).toBe(0);
    expect(looseDigits(root), name).toEqual([]);
  }
  // The product page's price is the chosen piece's own cell, as the API formats it.
  const root = await render(ProductPage, { lang: "en", id: piece.id });
  const price = root.querySelector(".piece-price .fig");
  expect(price?.getAttribute("data-ref")).toBe(piece.price.ref);
  expect(price?.textContent).toBe(formatMoney(piece.price));
  await expect(render(ProductPage, { lang: "en", id: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(NotFound);
});

test('Prabhave presents as the live shop: no sample banner, note, catalogue line or "sample site" on any page in either language, and search engines may index it', async () => {
  const piece = free()[1];
  if (!piece) throw new Error("test: no free piece");
  const sampleLine = prabhave.copy.sampleCatalogue as { en: string; hi: string };
  for (const lang of ["en", "hi"] as const) {
    for (const [name, page, params] of [
      ["home", HomePage, { lang }],
      ["catalogue", CataloguePage, { lang }],
      ["product", ProductPage, { lang, id: piece.id }],
      ["order", OrderPage, { lang }],
    ] as const) {
      const root = await render(page, params);
      const at = `${name} (${lang})`;
      expect(root.querySelector("[data-banner]"), at).toBeNull();
      expect(root.querySelector(".sample-line"), at).toBeNull();
      expect(root.querySelector(".wordmark-sub")?.textContent, at).toBe(prabhave.wordmark.sub[lang]);
      const text = root.textContent ?? "";
      expect(text, at).not.toMatch(/sample site|नमूना साइट/i);
      expect(text, at).not.toContain(sampleLine[lang]);
    }
    const meta = await generateMetadata({ params: Promise.resolve({ lang }) });
    expect(meta.robots, lang).toEqual({ index: true, follow: true });
  }
  // The hold form carries no sample note.
  const root = await render(ProductPage, { lang: "en", id: piece.id });
  await click(button(root, "Hold it for your visit"));
  expect(root.querySelector('form[data-state="holding"]')).not.toBeNull();
  expect(root.querySelector(".demo-note")).toBeNull();
  expect(robots().rules).toEqual({ userAgent: "*", allow: "/" });
});

test("a piece hold is stored as one requested reservation; holds off removes the ask", async () => {
  const piece = free()[3];
  if (!piece) throw new Error("test: no free piece");
  const count = async () =>
    (await w.q<{ n: number }>("select count(*)::int as n from ops.reservation where tenant_id = $1 and item_id = $2", [w.showcase.prabhave.tenantId, piece.id]))[0]?.n;
  const before = await count();
  let root = await render(ProductPage, { lang: "en", id: piece.id });
  expect(root.querySelector(".piece-choose")?.getAttribute("data-piece")).toBe(piece.id);
  await click(button(root, "Hold it for your visit"));
  await type(root.querySelector('input[name="name"]'), "Meera (sample)");
  await type(root.querySelector('input[name="phone"]'), "+91 98765 43210");
  await submit(root.querySelector('form[data-state="holding"]'));
  await until(() => expect(root.querySelector('[data-state="hold-asked"]')).not.toBeNull());
  const reference = root.querySelector('[data-kind="reference"]')?.textContent;
  const stored = await w.q<{ id: string; state: string }>("select id::text, state from ops.reservation where id = $1", [reference]);
  expect(stored[0]?.state).toBe("requested");
  expect(await count()).toBe((before ?? 0) + 1);

  await w.capability("prabhave", "holds", false);
  try {
    root = await render(ProductPage, { lang: "en", id: piece.id });
    expect(button(root, "Hold it for your visit")).toBeUndefined();
    expect(button(root, "Add to my order")).toBeDefined();
    root = await render(HomePage);
    expect(root.querySelector('[data-capability="holds"]')).toBeNull();
  } finally {
    await w.capability("prabhave", "holds", true);
  }
});

test("an order is sent once under one Idempotency-Key even when the answer is lost; its ORD- code is the stored request and opens its status page", async () => {
  // The latest release's cells: the piece-hold test published fresh releases.
  items = (await api.catalogue("prabhave", { limit: 100 })).data;
  const [a, b] = free().slice(6, 8);
  if (!a || !b) throw new Error("test: not enough free pieces");
  const stored = async () =>
    await w.q<{ code: string; channel: string; lines: unknown }>("select code, channel, lines from ops.order_request where tenant_id = $1 order by created_at desc", [
      w.showcase.prabhave.tenantId,
    ]);
  const before = (await stored()).length;
  let root = await render(ProductPage, { lang: "en", id: a.id });
  await click(button(root, "Add to my order"));
  await click(button(root, "Add to my order"));
  root = await render(ProductPage, { lang: "en", id: b.id });
  await click(button(root, "Add to my order"));

  root = await render(OrderPage);
  await until(() => expect(root.querySelector('[data-state="cart"]')).not.toBeNull());
  const shownPrices = [...root.querySelectorAll<HTMLElement>(".line-price .fig")].map((f) => f.dataset.ref);
  expect(shownPrices.sort()).toEqual([a.price.ref, b.price.ref].sort());
  // Before the answer there is no amount and no total: the page computes no figure.
  expect(root.querySelector(".fig[data-from]")).toBeNull();

  const posts = () => w.sent.filter((s) => s.method === "POST" && s.path.endsWith("/orders"));
  const sentBefore = posts().length;
  w.lose.next = "/orders";
  await click(button(root, "Send order to the shop"));
  await until(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Try again"));
  await click(button(root, "Send order to the shop"));
  await until(() => expect(root.querySelector('[data-state="ordered"]')).not.toBeNull());

  const mine = posts().slice(sentBefore);
  expect(mine.map((p) => p.status)).toEqual([201, 201]);
  expect(mine[1]?.headers["idempotency-key"]).toBe(mine[0]?.headers["idempotency-key"]);
  const rows = await stored();
  expect(rows.length).toBe(before + 1);
  expect(rows[0]?.channel).toBe("site");
  const code = root.querySelector('[data-kind="code"]')?.textContent ?? "";
  expect(code).toBe(rows[0]?.code);
  expect(code).toMatch(/^ORD-[A-Z0-9]{4,6}$/);
  // The amounts and the total are the API's derived figures, each naming the cells it came from.
  const total = root.querySelector<HTMLElement>(".total .fig[data-from]");
  expect(total?.dataset.from?.split(" ").sort()).toEqual([a.price.ref, b.price.ref].sort());
  expect(total?.textContent).toBe(formatMoney({ minor: a.price.minor * 2 + b.price.minor, currency: "INR", from: [a.price.ref] }));
  expect(localStorage.getItem("site.order")).toBe("{}");

  const status = await render(StatusPage, { lang: "en", code });
  expect(status.querySelector("h1")?.textContent).toContain(code);
  expect(status.querySelector("[data-request]")?.getAttribute("data-request")).toBe("received");
  await expect(render(StatusPage, { lang: "en", code: "ORD-ZZZZ" })).rejects.toBeInstanceOf(NotFound);
});
