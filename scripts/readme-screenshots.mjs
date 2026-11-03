// The README's screenshots: signs in to the demo on a running `pnpm dev` and writes a fixed set of images to docs/images/.
// Read-only by design: it never approves, rejects, records, composes or sends. The one thing it asks is a recorded Ask
// question (an ai run, as any visitor's would be). It refuses to run unless the app answers as a demo deployment, whose
// demo sign-in lists only the synthetic sample shops.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/readme-screenshots.mjs
//
// playwright-core is not a dependency of this repository: install it anywhere (`npm i playwright-core` in a scratch
// folder) and point PLAYWRIGHT_CORE at the package. The browser is the installed Google Chrome (CHROME_EXE overrides).
// sharp comes from apps/web. MUNSHI_SHOT_URL overrides http://localhost:3000. The shop sites are captured only when
// MUNSHI_SHOT_ELITE / MUNSHI_SHOT_PRABHAVE name each site's address (with `pnpm dev`, http://localhost:3150/s/elite and
// http://localhost:3151/s/prabhave; deployed, <domain>/s/elite and <domain>/s/prabhave).
// Exits 1 when a required shot fails or the images add up to more than 8 MB.
import { mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}docs/images`;
const BASE = process.env.MUNSHI_SHOT_URL ?? "http://localhost:3000";
const MAX_BYTES = 8 * 1024 * 1024;

const sharp = createRequire(`${ROOT}apps/web/package.json`)("sharp");
const pwPath = process.env.PLAYWRIGHT_CORE;
if (!pwPath) {
  console.error("readme-screenshots: set PLAYWRIGHT_CORE to a playwright-core package directory");
  process.exit(2);
}
const { chromium } = createRequire(`${pwPath}/package.json`)("playwright-core");

const health = await fetch(`${BASE}/api/health`)
  .then((r) => r.json())
  .catch(() => null);
if (health?.deployment !== "demo") {
  console.error(`readme-screenshots: ${BASE}/api/health does not answer as a demo deployment; nothing captured`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : { channel: "chrome" });
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const written = [];
const failed = [];

async function context(size, shop, person, pinClock = false) {
  const ctx = await browser.newContext({ ...size, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  // The office scene draws a wall clock and window light from the browser's time: pin it to late morning.
  if (pinClock) {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await page.clock.setFixedTime(new Date(`${day}T11:00:00+05:30`));
  }
  if (shop) {
    await page.goto(`${BASE}/demo/${shop}`, { waitUntil: "load" });
    await page.getByText(person).first().click();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
  }
  return { ctx, page };
}

async function open(page, route) {
  await page.goto(BASE + route, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function save(page, name) {
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  const file = `${OUT}/${name}.png`;
  await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toFile(file);
  written.push(file);
  console.log(`ok   ${name}.png  ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

async function shot(page, name, route, act, optional = false) {
  try {
    if (route) await open(page, route);
    if (act) await act(page);
    await save(page, name);
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (optional) return console.log(`skip ${name}.png  (${why})`);
    failed.push(name);
    console.error(`FAIL ${name}: ${why}`);
  }
}

// "Why this number": open a figure's source, then walk it to its book row, the decision and the approver. Reads only.
async function whyThisNumber(page) {
  await page.locator("main button.fig").first().click();
  await page.locator(".why-ask:visible").first().click();
  const chain = page.locator(".why-chain:visible").first();
  await chain.waitFor({ timeout: 20_000 });
  await chain.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}

// Ask a recorded question and require a cited answer: at least one figure and no "Cannot verify". The desk's prompt
// carries the shop's business date, so a recording replays only on the day it was recorded; on any other day this
// shot is skipped, not failed.
async function askCredit(page) {
  await page.getByRole("button", { name: "Ask: Who is most overdue on credit?" }).click();
  const answer = page.getByRole("article").last();
  await answer.locator("button.fig").first().waitFor({ timeout: 45_000 });
  if (/Cannot verify/.test(await answer.textContent())) throw new Error("the answer says Cannot verify");
  await page.waitForTimeout(400);
}

const S = "sharma-general-store";
const RAJESH = "Rajesh Sharma";

// The public site and the demo picker, signed out.
{
  const { ctx, page } = await context(DESKTOP, null, null, true);
  await shot(page, "landing", "/");
  await shot(page, "demo-picker", "/demo");
  await shot(page, "how-it-works", "/how-it-works");
  await shot(page, "developers", "/developers");
  await shot(page, "console-sign-in", "/platform/sign-in");
  await ctx.close();
}

// The office, the hero image.
{
  const { ctx, page } = await context(DESKTOP, S, RAJESH, true);
  await shot(page, "office", "/app/office");
  await ctx.close();
}

// The owner app, as the kirana's owner.
{
  const { ctx, page } = await context(DESKTOP, S, RAJESH);
  await shot(page, "home", "/app");
  await shot(page, "jump-to", "/app", async (p) => {
    await p.getByRole("button", { name: /Jump to/ }).first().click();
    await p.waitForTimeout(400);
  });
  await shot(page, "ask", "/app/ask");
  await shot(page, "ask-answer", "/app/ask", askCredit, true);
  await shot(page, "counter", "/app/counter", async (p) => {
    // Items added to a bill stay on screen until "Record sale", which this script never presses.
    for (const item of ["Wheat flour 5 kg", "Toor dal 1 kg", "Tea leaves 250 g"]) await p.getByRole("button", { name: item }).first().click();
    await p.getByText("Pricing the bill from the books").waitFor({ state: "hidden", timeout: 20_000 });
    await p.waitForTimeout(300);
  });
  await shot(page, "stock", "/app/stock");
  await shot(page, "credit-paypal", "/app/credit");
  await shot(page, "why-this-number", "/app/credit", whyThisNumber);
  await shot(page, "bills", "/app/bills");
  await shot(page, "suppliers", "/app/suppliers");
  // Reports is not shot: its days run to today, and the demo seed's counter sales end on the day it was seeded.
  await shot(page, "growth", "/app/growth");
  await shot(page, "settlements", "/app/settlements");
  await shot(page, "surplus", "/app/surplus");
  await shot(page, "inbox", "/app/inbox");
  await shot(page, "ai-staff", "/app/settings/ai");
  await ctx.close();
}

// Campaigns are switched on for the second kirana; the form is filled on screen only, never composed.
{
  const { ctx, page } = await context(DESKTOP, "bansal", "Aarav Bansal");
  await shot(page, "campaigns", "/app/campaigns", async (p) => {
    await p.locator('input[name="name"]').fill("Diwali regulars");
    await p.locator('select[name="channel"]').selectOption("instagram");
    await p.waitForTimeout(300);
  });
  await ctx.close();
}

// Phones.
{
  const { ctx, page } = await context(PHONE, null, null, true);
  await shot(page, "phone-landing", "/");
  await ctx.close();
}
{
  const { ctx, page } = await context(PHONE, S, RAJESH, true);
  await shot(page, "phone-office", "/app/office");
  await ctx.close();
}
{
  const { ctx, page } = await context(PHONE, S, RAJESH);
  await shot(page, "phone-home", "/app");
  await shot(page, "phone-ask", "/app/ask");
  await shot(page, "phone-counter", "/app/counter");
  await shot(page, "phone-credit", "/app/credit");
  await shot(page, "phone-stock", "/app/stock");
  await shot(page, "phone-more", "/app", async (p) => {
    await p.getByRole("button", { name: "More", exact: true }).click();
    await p.waitForTimeout(400);
  });
  await ctx.close();
}

// The shop sites, when their origins are given.
for (const [name, origin] of [
  ["site-elite", process.env.MUNSHI_SHOT_ELITE],
  ["site-prabhave", process.env.MUNSHI_SHOT_PRABHAVE],
]) {
  if (!origin) {
    console.log(`skip ${name}.png  (no origin given)`);
    continue;
  }
  const { ctx, page } = await context(DESKTOP, null, null);
  await shot(page, name, null, async (p) => {
    await p.goto(origin, { waitUntil: "load" });
    await p.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  });
  await ctx.close();
}

await browser.close();
const total = written.reduce((n, f) => n + statSync(f).size, 0);
console.log(`\n${written.length} image(s), ${(total / 1024 / 1024).toFixed(2)} MB in docs/images${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
if (failed.length || total > MAX_BYTES) process.exit(1);
