// The salon site (MUNSHI_SITE=elite) against the real API: apps/web's /api/v1 handlers on a fresh v2 database with the
// showcase tenants seeded as `pnpm dev` seeds them (test/world.ts). Never mocked: the database.
//   SITES-E1 every page renders from the API; each price and duration is a published cell with its ref;
//   SITES-E2 "source" shows the book row, and "Cannot verify" for a ref no release has;
//   SITES-E3 a live slot is held and becomes a booking request (ops rows only, no books row);
//   SITES-E4 a capability the release has off hides its section;
//   SITES-E5 the site presents as live (lib/variant.ts): no sample wording, and open to search engines.
// Red-proofs: db/test/v2/sabotage/apps-sites.ts.
import { createClient, formatMoney, type Service } from "@munshi/sdk";
import { act } from "react";
import { afterAll, beforeAll, expect, test } from "vitest";
import BookPage from "../app/[lang]/book/page.tsx";
import { generateMetadata } from "../app/[lang]/layout.tsx";
import HomePage from "../app/[lang]/page.tsx";
import PackagesPage from "../app/[lang]/packages/page.tsx";
import ServicesPage from "../app/[lang]/services/page.tsx";
import robots from "../app/robots.ts";
import { profile as elite } from "../businesses/elite/profile.ts";
import { ApiProvider } from "../components/Api.tsx";
import { Source } from "../components/Source.tsx";
import { button, click, looseDigits, render, submit, type, until } from "./render.tsx";
import { BROWSER, NotFound, openSites, SERVER, type World } from "./world.ts";
import { createRoot } from "react-dom/client";

let w: World;
const api = createClient({ baseUrl: SERVER });
let services: Service[] = [];
let refs = new Set<string>();

beforeAll(async () => {
  w = await openSites("elite");
  await w.db.sabotage();
  services = (await api.services("elite", { limit: 100 })).data;
  const plans = (await api.packages("elite", { limit: 100 })).data;
  refs = new Set([
    ...services.flatMap((s) => [s.price.ref, s.duration.ref]),
    ...plans.flatMap((p) => [p.price.ref, p.validityDays.ref, ...(p.value ? [p.value.ref] : []), ...p.lines.map((l) => l.sessions.ref)]),
  ]);
}, 300_000);
afterAll(async () => {
  await w?.close();
});

const figures = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".fig[data-ref], .fig[data-from]")];

test("SITES-E1 every Elite page renders from the API: each price and duration on it is a published cell with its ref, and nothing else carries digits", async () => {
  expect(services.length).toBeGreaterThan(20);
  for (const [name, page] of [
    ["home", HomePage],
    ["services", ServicesPage],
    ["packages", PackagesPage],
    ["book", BookPage],
  ] as const) {
    const root = await render(page);
    const figs = figures(root);
    expect(figs.length, name).toBeGreaterThan(0);
    for (const f of figs) expect(refs.has(f.dataset.ref ?? ""), `${name}: ${f.textContent} has a ref the API returned`).toBe(true);
    expect(root.querySelectorAll("[data-unverified]").length, name).toBe(0);
    expect(looseDigits(root), name).toEqual([]);
  }
  // The services page shows every service's price cell, as the API formats it.
  const root = await render(ServicesPage);
  for (const s of services) {
    const shown = root.querySelector(`[data-service="${s.id}"] .service-price .fig`);
    expect(shown?.getAttribute("data-ref")).toBe(s.price.ref);
    expect(shown?.textContent).toBe(formatMoney(s.price));
  }
  expect(w.sent.filter((s) => !s.browser).every((s) => s.status === 200 && s.headers.origin === undefined)).toBe(true);
});

test('SITES-E2 "source" shows the book row a figure was published from, and "Cannot verify" for a ref no release has', async () => {
  const root = await render(ServicesPage);
  const first = services[0] as Service;
  const row = root.querySelector(`[data-service="${first.id}"] .service-price`) as HTMLElement;
  await click(row.querySelector(".source-btn"));
  await until(() => expect(row.querySelector(".source-row")).not.toBeNull());
  const answer = await api.ref("elite", first.price.ref);
  if (!answer.verified) throw new Error("test: the API cannot trace its own price");
  expect(row.querySelector(".source-row")?.getAttribute("data-verified")).toBe("true");
  expect(row.querySelector(".source-row code")?.textContent).toBe(answer.source.id);
  expect(row.querySelector(".source-row")?.textContent).toContain(answer.source.table);
  const priceRow = await w.q<{ amount_minor: string }>(`select amount_minor::text from ${answer.source.table} where id = $1`, [answer.source.id]);
  expect(Number(priceRow[0]?.amount_minor)).toBe(first.price.minor);

  // A ref in the grammar that names a row the release does not have.
  const stray = first.price.ref.replace(/·\d+·/, "·999999·");
  const host = document.createElement("div");
  document.body.append(host);
  const r = createRoot(host);
  await act(async () => {
    r.render(
      <ApiProvider api={{ base: BROWSER, key: null, slug: "elite" }}>
        <Source refs={[stray]} derived={false} lang="en" what="a price" />
      </ApiProvider>,
    );
  });
  await click(host.querySelector(".source-btn"));
  await until(() => expect(host.querySelector(".source-row")).not.toBeNull());
  expect(host.querySelector(".source-row")?.getAttribute("data-verified")).toBe("false");
  expect(host.querySelector(".source-row")?.textContent).toBe("Cannot verify");
  await act(async () => r.unmount());
});

test("SITES-E3 a live slot is held and turned into a booking request: one held booking, then its contact, and no books row", async () => {
  const books = async () => (await w.q<{ n: number }>("select (select count(*) from books.sale) + (select count(*) from books.sale_line) + (select count(*) from approval.decision) as n"))[0]?.n;
  const before = await books();
  const root = await render(BookPage);
  // A day with free times: the first that offers any.
  let slot: HTMLButtonElement | undefined;
  for (const day of [...root.querySelectorAll<HTMLButtonElement>(".days .chip")]) {
    await click(day);
    await until(() => expect(root.querySelector(".slots .muted, .slots .err, .slot")).not.toBeNull());
    await until(() => expect(root.querySelector(".slots .muted")?.textContent ?? "").not.toContain("Asking"));
    slot = root.querySelector<HTMLButtonElement>(".slot") ?? undefined;
    if (slot) break;
  }
  expect(slot).toBeDefined();
  await click(slot);
  await until(() => expect(root.querySelector('[data-state="held"]')).not.toBeNull());
  // The live site's form carries no sample note.
  expect(root.querySelector(".demo-note")).toBeNull();
  const held = await w.q<{ id: string; state: string }>("select id::text, state from ops.booking where tenant_id = $1 and state = 'held'", [w.showcase.elite.tenantId]);
  expect(held.length).toBe(1);

  await type(root.querySelector('input[name="name"]'), "Asha (sample)");
  await type(root.querySelector('input[name="phone"]'), "+91 98765 43210");
  await submit(root.querySelector("form.form"));
  await until(() => expect(root.querySelector('[data-state="booked"]')).not.toBeNull());
  const reference = root.querySelector('[data-kind="reference"]')?.textContent;
  const after = await w.q<{ id: string; state: string; contact: number }>(
    "select b.id::text, b.state, (select count(*)::int from ops.booking_contact c where c.booking_id = b.id) as contact from ops.booking b where b.id = $1",
    [held[0]?.id],
  );
  expect(after[0]?.state).not.toBe("held");
  expect(after[0]?.contact).toBe(1);
  expect(reference).toMatch(/^[0-9a-f-]{36}$/);
  expect(await books()).toBe(before);
  const writes = w.sent.filter((s) => s.method !== "GET");
  expect(writes.map((s) => [s.path.split("/").pop(), s.status])).toEqual([
    ["holds", 201],
    ["bookings", 202],
  ]);
  expect(writes.every((s) => s.headers.origin && s.headers["idempotency-key"] && s.headers.authorization?.startsWith("Bearer mpk_elite_"))).toBe(true);
  expect(button(root, "Book another")).toBeDefined();
});

test("SITES-E4 a capability the release has off hides its section: packages off drops the nav entry, the home section and the page", async () => {
  let root = await render(HomePage);
  expect(root.querySelector('a[data-nav="/packages"]')).not.toBeNull();
  expect(root.querySelector('[data-capability="packages"]')).not.toBeNull();
  await w.capability("elite", "packages", false);
  try {
    root = await render(HomePage);
    expect(root.querySelector('a[data-nav="/packages"]')).toBeNull();
    expect(root.querySelector('[data-capability="packages"]')).toBeNull();
    await expect(render(PackagesPage)).rejects.toBeInstanceOf(NotFound);
  } finally {
    await w.capability("elite", "packages", true);
  }
  root = await render(HomePage);
  expect(root.querySelector('a[data-nav="/packages"]')).not.toBeNull();
});

test('SITES-E5 Elite presents as the live salon: no sample banner, note or "sample site" on any page in either language, and search engines may index it', async () => {
  for (const lang of ["en", "hi"] as const) {
    for (const [name, page] of [
      ["home", HomePage],
      ["services", ServicesPage],
      ["packages", PackagesPage],
      ["book", BookPage],
    ] as const) {
      const root = await render(page, { lang });
      const at = `${name} (${lang})`;
      expect(root.querySelector("[data-banner]"), at).toBeNull();
      expect(root.querySelector(".demo-note"), at).toBeNull();
      expect(root.querySelector(".wordmark-sub")?.textContent, at).toBe(elite.wordmark.sub[lang]);
      // The stylists' line about invented names stays for now: it waits on the founder.
      const copy = root.cloneNode(true) as HTMLElement;
      for (const el of copy.querySelectorAll(".stylists .muted")) el.remove();
      expect(copy.textContent ?? "", at).not.toMatch(/sample site|नमूना साइट/i);
    }
    const meta = await generateMetadata({ params: Promise.resolve({ lang }) });
    expect(meta.robots, lang).toEqual({ index: true, follow: true });
    expect(String((meta.title as { default: string }).default), lang).not.toMatch(/sample site|नमूना साइट/i);
  }
  expect(robots().rules).toEqual({ userAgent: "*", allow: "/" });
});
