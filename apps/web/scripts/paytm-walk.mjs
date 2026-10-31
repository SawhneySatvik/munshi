// The Paytm demo path against the running app (BASE, default http://localhost:3000), at 1280 px, into
// .screenshots/PAYTM/: the demo picker, Bansal's home and brief, settlements, AI staff settings, orders, and one Ask
// (live when the app runs MUNSHI_MODEL_MODE=live). Exits non-zero at the first step that does not land.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "..", "..", "..", ".screenshots", "PAYTM");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const shot = async (name) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`shot ${name}`);
};
const go = async (p) => {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180_000 });
  const at = new URL(page.url()).pathname;
  if (at !== p) throw new Error(`${p}: landed on ${at}`);
};
try {
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 180_000 });
  await shot("01-demo-picker");
  const bansal = page.locator("a, button", { hasText: /Bansal/ }).first();
  if ((await bansal.count()) === 0) throw new Error("the demo picker shows no Bansal");
  await bansal.click();
  await page.waitForLoadState("networkidle");
  await page.locator("form button.s-card", { hasText: "Owner" }).first().click();
  await page.waitForURL(/\/app(\/[a-z]+)?$/, { timeout: 180_000 });
  await shot("02-bansal-home");
  for (const [name, p] of [["03-settlements", "/app/settlements"], ["04-ai-staff", "/app/settings"], ["05-orders", "/app/orders"], ["06-counter", "/app/counter"], ["07-office-brief", "/app/office"]]) {
    await go(p);
    await shot(name);
  }
  await go("/app/ask");
  const box = page.locator("textarea, input[type=text]").first();
  await box.fill("Which customers owe me money for more than 30 days?");
  await box.press("Enter");
  await page.waitForTimeout(25_000);
  await shot("08-ask");
  const text = await page.locator("main").innerText();
  console.log(`ask: ${/Written by/i.test(text) ? "answer shows Written by" : "no 'Written by' on the page"}; ${/Cannot verify/.test(text) ? "has Cannot verify" : ""}`);
} catch (e) {
  console.error(`paytm-walk: ${e instanceof Error ? e.message : e}`);
  await page.screenshot({ path: path.join(OUT, "error.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
