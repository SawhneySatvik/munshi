// The capability screens' click-through against the running app (pnpm dev; BASE defaults to http://localhost:3000): every
// capability screen on the shop it belongs to (the kirana for trade, Elite for bookings, salary and packages, Prabhave
// for orders and holds) and their states (empty, filled, an error, a draft waiting, a switched-off capability, Hindi),
// at 390 and 1280 px side by side, full page, into .screenshots/app-screens/ at the repository root, named
// <shop>-<screen>-<state>-<width>.png. Signs in through /demo (a shop, then a person). The flows write to the dev
// database as the person would (a campaign composed, a salary draft made, a capability switched off and on again).
// Exits non-zero on the first step that does not land where it should.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "..", "..", "..", ".screenshots", "app-screens");
mkdirSync(OUT, { recursive: true });
const shots = [];

const SHOPS = {
  kirana: {
    slug: "sharma-general-store",
    screens: [
      ["customers", "/app/customers"],
      ["offers", "/app/offers"],
      ["invoices", "/app/invoices"],
      ["orders", "/app/orders"],
      ["staff", "/app/staff"],
      ["inbox", "/app/inbox"],
      ["settings", "/app/settings"],
      ["office", "/app/office"],
    ],
  },
  elite: {
    slug: "elite",
    screens: [
      ["calendar", "/app/calendar"],
      ["requests", "/app/requests"],
      ["staff", "/app/staff"],
      ["salary", "/app/staff/salary"],
      ["packages", "/app/packages"],
      ["loyalty", "/app/loyalty"],
      ["customers", "/app/customers"],
      ["invoices", "/app/invoices"],
      ["offers", "/app/offers"],
      ["inbox", "/app/inbox"],
      ["campaigns", "/app/campaigns"],
      ["settings", "/app/settings"],
      ["office", "/app/office"],
    ],
  },
  prabhave: {
    slug: "prabhave",
    screens: [
      ["orders", "/app/orders"],
      ["offers", "/app/offers"],
      ["customers", "/app/customers"],
      ["invoices", "/app/invoices"],
      ["staff", "/app/staff"],
      ["inbox", "/app/inbox"],
      ["campaigns", "/app/campaigns"],
      ["office", "/app/office"],
    ],
  },
};

async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}-${page.viewportSize().width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(path.relative(path.join(OUT, "..", ".."), file));
}

async function go(page, p) {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180_000 });
  const at = new URL(page.url()).pathname;
  if (at !== p) throw new Error(`${p}: landed on ${at}`);
}

async function signIn(page, slug, who) {
  await page.context().clearCookies();
  await go(page, `/demo/${slug}`);
  await page.locator("form button.s-card", { hasText: who }).first().click();
  await page.waitForURL(/\/app(\/[a-z]+)?$/, { timeout: 180_000 });
}

/** Both widths at once: a phone and a desk, each its own browser context, signed in as the same person. */
async function pair(browser) {
  const pages = [];
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: 1 });
    pages.push(await ctx.newPage());
  }
  return {
    pages,
    desk: pages[1],
    async signIn(slug, who) {
      for (const p of pages) await signIn(p, slug, who);
    },
    async both(p, name) {
      for (const page of pages) {
        await go(page, p);
        await shot(page, name);
      }
    },
    async hindi(p, name) {
      for (const page of pages) {
        await go(page, p);
        await page.locator('label[for="lang-hi"]').click();
        await page.waitForTimeout(400);
        await shot(page, name);
        await page.locator('label[for="lang-en"]').click();
        await page.waitForTimeout(200);
      }
    },
    async close() {
      for (const p of pages) await p.context().close();
    },
  };
}

/** Submits the form holding `button` on a page and waits for its outcome line. */
async function submit(page, form, button) {
  await form.getByRole("button", { name: button, exact: true }).click();
  await form.locator(".act-status").filter({ has: page.locator(".ops-error, .act-done") }).waitFor({ timeout: 60_000 });
}

async function trade(browser) {
  const s = await pair(browser);
  await s.signIn(SHOPS.kirana.slug, "Owner");
  for (const [name, p] of SHOPS.kirana.screens) await s.both(p, `kirana-${name}-default`);
  // A customer's page, from the list's first link.
  await go(s.desk, "/app/customers");
  const href = await s.desk.locator(".app-title a").first().getAttribute("href");
  if (href) await s.both(href, "kirana-customer-default");
  await s.hindi("/app/customers", "kirana-customers-hindi");
  await s.hindi("/app/settings", "kirana-settings-hindi");
  await s.close();
}

async function salon(browser) {
  const s = await pair(browser);
  await s.signIn(SHOPS.elite.slug, "Owner");
  for (const [name, p] of SHOPS.elite.screens) await s.both(p, `elite-${name}-${name === "campaigns" ? "empty" : "default"}`);

  // Salary: the owner makes the month's draft; it waits for approval.
  await go(s.desk, "/app/staff/salary");
  const make = s.desk.getByRole("button", { name: "Make the draft", exact: true });
  if (await make.count()) {
    await make.click();
    await s.desk.getByText("Waiting for your approval").first().waitFor({ timeout: 60_000 });
    await s.both("/app/staff/salary", "elite-salary-draft-waiting");
  }

  // Campaigns: one composed, a typed figure in its words refused (an error, on each width), then words saved.
  await go(s.desk, "/app/campaigns");
  const compose = s.desk.locator("form.act").filter({ has: s.desk.getByRole("button", { name: "Compose", exact: true }) });
  await compose.locator('input[name="name"]').fill("Come back this week (sample)");
  await compose.locator('select[name="segment"]').selectOption("bought_within_days");
  await submit(s.desk, compose, "Compose");
  await s.both("/app/campaigns", "elite-campaigns-composing");
  for (const page of s.pages) {
    await go(page, "/app/campaigns");
    const copy = page.locator("form.act").filter({ has: page.getByRole("button", { name: "Save the words", exact: true }) }).first();
    await copy.locator("textarea").fill("Twenty percent off: 20% this week only");
    await submit(page, copy, "Save the words");
    await shot(page, "elite-campaigns-error-figure");
  }
  await go(s.desk, "/app/campaigns");
  const copy = s.desk.locator("form.act").filter({ has: s.desk.getByRole("button", { name: "Save the words", exact: true }) }).first();
  await copy.locator("textarea").fill("We miss you. Your chair is waiting this week.");
  await submit(s.desk, copy, "Save the words");
  await s.both("/app/campaigns", "elite-campaigns-filled");
  // Proposing with no consenting customer in the audience is refused: the demo's customers have no phone.
  for (const page of s.pages) {
    await go(page, "/app/campaigns");
    const propose = page.locator("form.act").filter({ has: page.getByRole("button", { name: "Propose", exact: true }) }).first();
    await submit(page, propose, "Propose");
    await shot(page, "elite-campaigns-error-audience");
  }
  await s.hindi("/app/campaigns", "elite-campaigns-hindi");

  // A switched-off capability: loyalty off in Settings, its screen answers 404 and leaves the navigation; then on again.
  await go(s.desk, "/app/settings");
  const loyalty = s.desk.locator("form.act[aria-label='Loyalty']");
  await submit(s.desk, loyalty, "Switch off");
  await s.both("/app/settings", "elite-settings-loyalty-off");
  for (const page of s.pages) {
    await page.goto(`${BASE}/app/loyalty`, { waitUntil: "networkidle", timeout: 180_000 });
    await shot(page, "elite-loyalty-switched-off");
  }
  await go(s.desk, "/app/settings");
  await submit(s.desk, s.desk.locator("form.act[aria-label='Loyalty']"), "Switch on");

  for (const [name, p] of [
    ["calendar", "/app/calendar"],
    ["salary", "/app/staff/salary"],
    ["settings", "/app/settings"],
    ["office", "/app/office"],
  ]) {
    await s.hindi(p, `elite-${name}-hindi`);
  }

  // A desk (a manager): the calendar and requests at their branch; no settings.
  await s.signIn(SHOPS.elite.slug, "Kalkaji");
  await s.both("/app/calendar", "elite-calendar-desk");
  await s.both("/app/requests", "elite-requests-desk");
  await s.close();
}

async function boutique(browser) {
  const s = await pair(browser);
  await s.signIn(SHOPS.prabhave.slug, "Owner");
  for (const [name, p] of SHOPS.prabhave.screens) await s.both(p, `prabhave-${name}-default`);
  await s.hindi("/app/orders", "prabhave-orders-hindi");
  await s.hindi("/app/inbox", "prabhave-inbox-hindi");
  await s.close();
}

const browser = await chromium.launch();
try {
  await trade(browser);
  await salon(browser);
  await boutique(browser);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(shots.join("\n"));
console.log(`${shots.length} screenshots`);
