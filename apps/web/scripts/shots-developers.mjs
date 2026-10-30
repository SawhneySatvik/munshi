// BP-DEV-1's screenshots against the running app (pnpm dev; BASE): every developer portal page at 390 and 1280 px, full
// page, plus the reference searched and an example opened, into .screenshots/BP-DEV-1/ at the repository root.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(ROOT, "apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3160";
const OUT = path.join(ROOT, ".screenshots", "BP-DEV-1");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["overview", "/developers"],
  ["getting-started", "/developers/getting-started"],
  ["auth-and-errors", "/developers/auth-and-errors"],
  ["figures", "/developers/figures"],
  ["guides", "/developers/guides"],
  ["reference", "/developers/reference"],
  ["sandbox", "/developers/sandbox"],
  ["sdk", "/developers/sdk"],
];

const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    for (const [name, href] of PAGES) {
      const res = await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      if (res?.status() !== 200) throw new Error(`${href} answered ${res?.status()}`);
      await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
    }
    await page.goto(`${BASE}/developers/reference`, { waitUntil: "networkidle" });
    await page.getByRole("searchbox").fill("orders");
    await page.screenshot({ path: path.join(OUT, `reference-searched-${width}.png`), fullPage: true });
    await page.getByRole("searchbox").fill("");
    await page.locator("#catalogue summary").click();
    await page.locator("#catalogue").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `reference-example-${width}.png`) });
    await page.getByRole("searchbox").fill("zzz");
    await page.screenshot({ path: path.join(OUT, `reference-no-match-${width}.png`) });
    const missing = await page.goto(`${BASE}/developers/no-such-page`);
    if (missing?.status() !== 404) throw new Error(`an unknown page answered ${missing?.status()}`);
    await page.screenshot({ path: path.join(OUT, `not-found-${width}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`shots: wrote ${OUT}`);
