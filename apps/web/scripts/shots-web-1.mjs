// BP-WEB-1's click-through against the running app (pnpm dev; BASE defaults to http://localhost:3000): the product site,
// the demo's paths into /app (a sample shop's person; a sandbox sample shop of your own), the log-in page, and the
// refusals a person can reach. Every page and state at 390 and 1280 px, full page, into .screenshots/BP-WEB-1/ at the
// repository root, named <page>-<state>-<width>.png. Exits non-zero on the first step that does not land where it should.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "..", "..", "..", ".screenshots", "BP-WEB-1");
mkdirSync(OUT, { recursive: true });
const WIDTHS = [390, 1280];
const run = Date.now().toString(36);
const shots = [];

function expectPath(page, want, step) {
  const at = new URL(page.url()).pathname + new URL(page.url()).search;
  if (!(typeof want === "string" ? at === want : want.test(at))) throw new Error(`${step}: landed on ${at}, wanted ${want}`);
}

async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)); // the sticky nav then sits at the top of a full-page shot
  await page.waitForTimeout(400); // the entrance animations settle
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(path.relative(path.join(OUT, "..", ".."), file));
}

async function flow(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const go = async (p) => {
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180_000 });
  };
  const w = `-${width}`;

  // The site.
  await go("/");
  await shot(page, `home-default${w}`);
  await page.getByRole("button", { name: "₹750" }).click();
  await page.locator(".s-rec").waitFor();
  await page.locator("#example").scrollIntoViewIfNeeded();
  await shot(page, `home-record-open${w}`);
  await page.getByRole("button", { name: "Approve and send" }).click();
  await page.locator(".s-done").waitFor();
  await shot(page, `home-example-approved${w}`);
  await page.getByRole("button", { name: "Show the example again" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await shot(page, `home-example-not-now${w}`);
  await page.locator('label[for="site-lang-hi"]').click();
  await page.getByRole("heading", { level: 1, name: "अपनी दुकान से पूछिए। हर जवाब जाँचिए।" }).waitFor();
  await shot(page, `home-hindi${w}`);
  await page.locator('label[for="site-lang-en"]').click();
  await page.getByRole("heading", { level: 1, name: "Ask your shop. Check every answer." }).waitFor();

  await go("/how-it-works");
  await shot(page, `how-it-works-default${w}`);

  // Home → Try the demo → a sample shop → a person → /app.
  await go("/");
  await page.locator(".s-hero").getByRole("link", { name: "Try the demo" }).click();
  await page.waitForURL("**/demo");
  await shot(page, `demo-picker${w}`);
  await page.locator(".s-card-list a.s-card").first().click();
  await page.waitForURL(/\/demo\/[a-z0-9-]+$/);
  await shot(page, `demo-people${w}`);
  await page.locator("form button.s-card.is-lead").click();
  await page.waitForURL("**/app");
  expectPath(page, "/app", "demo person");
  await shot(page, `app-after-demo-pick${w}`);
  await ctx.clearCookies();

  // Home → Sign up → a sample shop of your own → /app.
  const slug = `judge-${run}-${width}`;
  await go("/");
  await page.locator(".s-pill").getByRole("link", { name: "Sign up" }).click();
  await page.waitForURL("**/sign-up");
  await shot(page, `sign-up-type${w}`);
  await page.locator(".s-type", { hasText: "Salon" }).click();
  await page.getByRole("button", { name: "Next" }).first().click();
  await page.getByLabel("Shop name").waitFor();
  await shot(page, `sign-up-name-empty${w}`);
  await page.getByLabel("Shop name").fill(`Judge ${run} Salon`);
  await page.getByLabel("Web address").fill(slug);
  await page.getByLabel("Your name").fill("A judge");
  await shot(page, `sign-up-name-filled${w}`);
  await page.locator("fieldset:not([hidden])").getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Make my sample shop" }).waitFor();
  await shot(page, `sign-up-in${w}`);
  await page.getByRole("button", { name: "Make my sample shop" }).click();
  await page.waitForURL("**/app");
  expectPath(page, "/app", "sample shop");
  await shot(page, `app-after-sign-up${w}`);
  await ctx.clearCookies();

  // The same web address again: taken, back on the sign-up's name step with its line.
  await go("/sign-up");
  await page.getByRole("button", { name: "Next" }).first().click();
  await page.getByLabel("Shop name").fill("Another judge's shop");
  await page.getByLabel("Web address").fill(slug);
  await page.getByLabel("Your name").fill("Another judge");
  await page.locator("fieldset:not([hidden])").getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Make my sample shop" }).click();
  await page.waitForURL("**/sign-up?taken=1");
  await page.locator(".s-alert").waitFor();
  await shot(page, `sign-up-taken${w}`);

  // A web address the browser refuses before it is sent (the field's pattern), then one the server refuses.
  await go("/sign-up");
  await page.getByRole("button", { name: "Next" }).first().click();
  await page.getByLabel("Shop name").fill("Bad address");
  await page.getByLabel("Web address").fill("Not A Slug!");
  await page.getByLabel("Your name").fill("A judge");
  await page.locator("fieldset:not([hidden])").getByRole("button", { name: "Next" }).click();
  if (await page.getByRole("button", { name: "Make my sample shop" }).isVisible()) throw new Error("an invalid web address passed the name step");
  await shot(page, `sign-up-invalid-held${w}`);
  await go("/sign-up?invalid=1");
  await shot(page, `sign-up-invalid${w}`);
  await go("/demo?taken=1");
  await shot(page, `demo-taken${w}`);

  // Log in: on the demo deployment it is the demo picker.
  await go("/");
  await page.locator(".s-pill").getByRole("link", { name: "Log in" }).click();
  await page.waitForURL("**/demo");
  await shot(page, `log-in-demo${w}`);
  await go("/sign-in");
  expectPath(page, "/demo", "sign-in on the demo");

  // Not found (real sign-in screens answer 404 on the demo).
  await go("/choose-shop");
  await shot(page, `not-found-default${w}`);

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
