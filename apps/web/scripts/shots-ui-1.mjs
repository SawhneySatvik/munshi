// BP-UI-1's click-through against the running app (pnpm dev; BASE defaults to http://localhost:3000): every app screen
// in the Neem Ledger shell, and the shell's own states (a figure's source open, the phone's More, Hindi, the counter
// staff's bar), at 390 and 1280 px, full page, into .screenshots/BP-UI-1/ at the repository root, named
// <screen>-<state>-<width>.png. Signs in through /demo (the first sample shop, then a person). Exits non-zero on the
// first step that does not land where it should.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "..", "..", "..", ".screenshots", "BP-UI-1");
mkdirSync(OUT, { recursive: true });
const WIDTHS = [390, 1280];
const shots = [];

const SCREENS = [
  ["home", "/app"],
  ["counter", "/app/counter"],
  ["credit", "/app/credit"],
  ["stock", "/app/stock"],
  ["bills", "/app/bills"],
  ["suppliers", "/app/suppliers"],
  ["reports", "/app/reports"],
  ["ask", "/app/ask"],
];

async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(path.relative(path.join(OUT, "..", ".."), file));
}

async function signIn(page, who) {
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.locator(".s-card-list a.s-card").first().click();
  await page.waitForURL(/\/demo\/[a-z0-9-]+$/);
  await page.locator("form button.s-card", { hasText: who }).first().click();
  await page.waitForURL(/\/app(\/[a-z]+)?$/, { timeout: 180_000 });
}

async function flow(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const w = `-${width}`;
  const go = async (p) => {
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180_000 });
    const at = new URL(page.url()).pathname;
    if (at !== p) throw new Error(`${p}: landed on ${at}`);
  };

  await signIn(page, "Owner");
  for (const [name, p] of SCREENS) {
    await go(p);
    await shot(page, `${name}-default${w}`);
  }

  // Tap-for-source: the home's first figure opens the source drawer at its cell.
  await go("/app");
  const figure = page.locator("button.pair").first();
  await figure.scrollIntoViewIfNeeded();
  await figure.click();
  await page.locator("#source-drawer.is-open").waitFor();
  await shot(page, `home-source-open${w}`);
  await page.keyboard.press("Escape");

  // The phone's More popover (on a desk every section is on the rail).
  if (width < 1024) {
    await go("/app");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.locator("#nav-more:popover-open").waitFor();
    await shot(page, `nav-more-open${w}`);
    await page.keyboard.press("Escape");
  }

  // Hindi.
  await go("/app");
  await page.locator('label[for="lang-hi"]').click();
  await page.waitForTimeout(300);
  await shot(page, `home-hindi${w}`);
  await page.locator('label[for="lang-en"]').click();

  // The counter staff's shell: three sections and the mic.
  await ctx.clearCookies();
  await signIn(page, "Counter staff");
  await go("/app/counter");
  await shot(page, `counter-staff${w}`);

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
