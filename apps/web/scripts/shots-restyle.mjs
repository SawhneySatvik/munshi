// P-6's click-through against the running app (BASE defaults to http://localhost:3000): the app screens in look A at
// 390 and 1280 px, full page, into .screenshots/BP-RESTYLE/ at the repository root, named <screen>-<width>.png. Signs in
// through /demo (Sharma General Store, then its owner). ALL=1 shoots every app screen; without it, the six the founder
// reviews first. Exits non-zero on the first step that does not land where it should.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "..", "..", "..", ".screenshots", "BP-RESTYLE");
mkdirSync(OUT, { recursive: true });
const WIDTHS = [390, 1280];
const shots = [];

const FIRST = [
  ["home", "/app"],
  ["counter", "/app/counter"],
  ["orders", "/app/orders"],
  ["settings", "/app/settings"],
  ["stock", "/app/stock"],
];
const REST = [
  "ask",
  "bills",
  "calendar",
  "campaigns",
  "credit",
  "customers",
  "inbox",
  "invoices",
  "loyalty",
  "offers",
  "office",
  "packages",
  "reports",
  "requests",
  "staff",
  "suppliers",
].map((s) => [s, `/app/${s}`]);
const SCREENS = process.env.ALL === "1" ? [...FIRST, ...REST] : FIRST;

// A full-page capture leaves fixed elements (the phone's floating pill) where the first viewport ended, over the
// content. So the viewport grows to the page's height for the shot: the pill sits at the true foot, in its --dock room.
async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  const before = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: before.width, height: Math.max(before.height, height) });
  await page.waitForTimeout(150);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  await page.setViewportSize(before);
  shots.push(path.relative(path.join(OUT, "..", ".."), file));
}

async function flow(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const w = `-${width}`;

  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 180_000 });
  await shot(page, `demo${w}`);
  await page.locator(".s-card-list a.s-card", { hasText: "Sharma General Store" }).first().click();
  await page.waitForURL(/\/demo\/[a-z0-9-]+$/);
  await shot(page, `demo-people${w}`);
  await page.locator("form button.s-card", { hasText: "Owner" }).first().click();
  await page.waitForURL(/\/app(\/[a-z]+)?$/, { timeout: 180_000 });

  for (const [name, p] of SCREENS) {
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180_000 });
    const at = new URL(page.url()).pathname;
    if (at !== p) throw new Error(`${p}: landed on ${at}`);
    await shot(page, `${name}${w}`);
  }

  // Tap-for-source on the home: the first figure opens the source drawer at its cell.
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle", timeout: 180_000 });
  const figure = page.locator("button.pair").first();
  await figure.scrollIntoViewIfNeeded();
  await figure.click();
  await page.locator("#source-drawer.is-open").waitFor();
  await shot(page, `home-source-open${w}`);
  await page.keyboard.press("Escape");

  // Hindi, on the home.
  await page.locator('label[for="lang-hi"]').click();
  await page.waitForTimeout(300);
  await shot(page, `home-hindi${w}`);
  await page.locator('label[for="lang-en"]').click();

  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const width of WIDTHS) await flow(browser, width);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(shots.join("\n"));
console.log(`${shots.length} screenshots`);
