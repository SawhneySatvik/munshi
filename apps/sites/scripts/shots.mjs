// Screenshots of the shop sites against the real stack: `pnpm dev` (apps/web and its /api/v1 on PORT, default 3140) must be
// running; this script starts the site app for each business in turn on :3150 (the origin dev.ts lists for both sites),
// drives Playwright through every page and state at 390 and 1280 px, and stops each server by its own PID.
//
//   node apps/sites/scripts/shots.mjs <dev log>          the dev log holds the publishable keys dev printed
//   SHOTS=capoff node apps/sites/scripts/shots.mjs <log> a dev started with
//                                                                 MUNSHI_DEV_SITE_OFF=elite:packages,prabhave:holds
//
// Output: .screenshots/sites/ at the repo root. The "Cannot verify" shot asks the real refs route about a row the
// release does not have (the request's row is rewritten to 999999), the one way a published page meets a ref that
// does not resolve.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const sitesDir = path.join(here, "..");
const out = path.join(sitesDir, "..", "..", ".screenshots", "sites");
mkdirSync(out, { recursive: true });
const log = readFileSync(process.argv[2] ?? "", "utf8");
const api = `http://localhost:${process.env.PORT ?? "3140"}`;
const BASE = "http://localhost:3150";
const capoff = process.env.SHOTS === "capoff";
// A rerun against the same dev picks other free times and pieces (the first run's are held or booked by then).
const OFFSET = Number(process.env.SHOTS_OFFSET ?? 0);
const WIDTHS = [390, 1280];
const shot = [];
// Each visitor (browser context) is its own network: the API allows five writes per IP in ten minutes, and every
// context here would otherwise share localhost's. Addresses from the documentation range (RFC 5737).
let visitor = 10 + OFFSET * 40;
async function context(browser, options) {
  // Reduced motion: the drawings are shown finished, not caught half-drawn.
  const ctx = await browser.newContext({ ...options, reducedMotion: "reduce" });
  const ip = `198.51.100.${visitor++}`;
  await ctx.route(`${api}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  return ctx;
}

const keyOf = (slug) => /MUNSHI_SITE_KEY=(\S+)/.exec(log.split("\n").find((l) => l.includes(`hosted site ${slug}:`)) ?? "")?.[1];

async function start(slug) {
  const key = keyOf(slug);
  if (!key) throw new Error(`no key for ${slug} in the dev log`);
  const child = spawn(path.join(sitesDir, "node_modules", ".bin", "next"), ["dev", "--port", "3150", "--hostname", "localhost"], {
    cwd: sitesDir,
    stdio: "ignore",
    env: { ...process.env, MUNSHI_SITE: slug, MUNSHI_API_URL: api, MUNSHI_SITE_KEY: key, PORT: "3150" },
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/`)).status < 500) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill("SIGTERM");
  throw new Error(`the ${slug} site did not start`);
}

async function snap(page, name) {
  await page.waitForTimeout(500);
  const file = `${name}-${page.viewportSize().width}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: true });
  shot.push(file);
}

async function go(page, p) {
  const r = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return r?.status();
}

async function source(page, scope, name) {
  const btn = page.locator(`${scope} .source-btn`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.locator(".source-row").first().waitFor();
  await snap(page, name);
}

async function elite(browser, width, n) {
  const ctx = await context(browser, { viewport: { width, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  if (capoff) {
    await go(page, "/");
    await snap(page, "elite-capability-off-packages-home");
    // Next answers this not-found with the 404 page (in dev the status line is already sent as 200).
    await go(page, "/packages");
    await snap(page, "elite-capability-off-packages-page-not-found");
    await ctx.close();
    return;
  }
  await go(page, "/");
  await snap(page, "elite-home-dark");
  await page.locator(".banner").screenshot({ path: path.join(out, `elite-demo-banner-${width}.png`) });
  shot.push(`elite-demo-banner-${width}.png`);
  await go(page, "/services");
  await snap(page, "elite-services");
  await source(page, ".service-price", "elite-source-verified");
  await page.route("**/api/v1/sites/elite/refs/**", (route) => route.continue({ url: route.request().url().replace(/\/refs\/([^/]+)\/\d+\//, "/refs/$1/999999/") }));
  await go(page, "/services");
  await source(page, ".service-price", "elite-source-cannot-verify");
  await page.unroute("**/api/v1/sites/elite/refs/**");
  await go(page, "/packages");
  await snap(page, "elite-packages");
  await go(page, "/book");
  await page.locator(".slot").first().waitFor();
  await snap(page, "elite-book-slots");
  // Each width holds a different free time: the other width's is booked by then.
  const free = page.locator(".slot");
  await free.nth((n * 5 + 3 + OFFSET * 7) % (await free.count())).click();
  await page.locator(".held").waitFor();
  await snap(page, "elite-hold-made");
  await page.fill('input[name="name"]', "Asha (sample)");
  await page.fill('input[name="phone"]', "+91 98765 43210");
  await page.click('button[type="submit"]');
  await page.locator('[data-state="booked"]').waitFor();
  await snap(page, "elite-booking-request-made");
  await go(page, "/hi");
  await snap(page, "elite-home-hindi");
  await ctx.close();
  const light = await context(browser, { viewport: { width, height: 900 }, colorScheme: "light" });
  const lp = await light.newPage();
  await go(lp, "/");
  await snap(lp, "elite-home-light");
  await go(lp, "/services");
  await snap(lp, "elite-services-light");
  await light.close();
}

async function prabhave(browser, width, n) {
  const ctx = await context(browser, { viewport: { width, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await go(page, "/");
  if (capoff) {
    await snap(page, "prabhave-capability-off-holds-home");
    await page.locator(".look-link").first().click();
    await page.waitForLoadState("networkidle");
    await snap(page, "prabhave-capability-off-holds-product");
    await ctx.close();
    return;
  }
  await snap(page, "prabhave-home");
  await page.locator(".banner").screenshot({ path: path.join(out, `prabhave-demo-banner-${width}.png`) });
  shot.push(`prabhave-demo-banner-${width}.png`);
  await go(page, "/catalogue");
  await snap(page, "prabhave-catalogue");
  // A different product per width, so each hold asks about a piece no one holds yet.
  const looks = page.locator(".look-link");
  await looks.nth((2 + n * 3 + OFFSET) % (await looks.count())).click();
  await page.waitForLoadState("networkidle");
  await snap(page, "prabhave-product");
  await source(page, ".piece-price", "prabhave-source-verified");
  await page.locator(".piece-price .source-btn").first().click();
  await page.getByRole("button", { name: "Hold it for your visit" }).click();
  await page.fill('input[name="name"]', "Meera (sample)");
  await page.fill('input[name="phone"]', "+91 98765 43210");
  await snap(page, "prabhave-hold-form");
  await page.getByRole("button", { name: "Ask the shop to hold it" }).click();
  await page.locator('[data-state="hold-asked"]').waitFor();
  await snap(page, "prabhave-hold-made");
  await page.getByRole("button", { name: "Add to my order" }).click();
  await page.getByRole("button", { name: "Add to my order" }).click();
  await go(page, "/catalogue");
  await page.locator(".look-link").nth(n * 3).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add to my order" }).click();
  await go(page, "/order");
  await page.locator('[data-state="cart"]').waitFor();
  await snap(page, "prabhave-order-cart");
  await page.getByRole("button", { name: "Send order to the shop" }).click();
  await page.locator('[data-state="ordered"]').waitFor();
  await snap(page, "prabhave-order-placed");
  await page.route("**/api/v1/sites/prabhave/refs/**", (route) => route.continue({ url: route.request().url().replace(/\/refs\/([^/]+)\/\d+\//, "/refs/$1/999999/") }));
  await source(page, ".total", "prabhave-source-cannot-verify");
  await page.unroute("**/api/v1/sites/prabhave/refs/**");
  await page.getByRole("link", { name: "See the order's status" }).click();
  await page.waitForLoadState("networkidle");
  await snap(page, "prabhave-order-status");
  await go(page, "/order");
  await snap(page, "prabhave-order-empty");
  await go(page, "/hi");
  await snap(page, "prabhave-home-hindi");
  await go(page, "/order/ORD-ZZZZ");
  await snap(page, "prabhave-order-unknown-code");
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const [slug, run] of [
    ["elite", elite],
    ["prabhave", prabhave],
  ]) {
    const child = await start(slug);
    try {
      for (const [n, w] of WIDTHS.entries()) await run(browser, w, n);
    } catch (err) {
      for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(process.env.SHOTS_DEBUG ?? out, `FAILED-${slug}.png`), fullPage: true });
      throw err;
    } finally {
      child.kill("SIGTERM");
    }
  }
} finally {
  await browser.close();
}
console.log(`shots: ${shot.length} files in ${path.relative(process.cwd(), out) || out}`);
for (const f of shot) console.log(`  ${f}`);
