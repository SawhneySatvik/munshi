// BP-CONSOLE's click-through against the running app (pnpm dev; BASE): every console screen and state at 390 and 1280
// px, full page, into .screenshots/BP-CONSOLE/ at the repository root. Signs in as the dev operator from the file dev.ts
// wrote (OPERATOR_FILE), generating its TOTP codes here; prints no secret. Exits non-zero on the first step that does
// not land where it should.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = "/home/user/munshi/.claude/worktrees/agent-ac913d63f5e163396";
const require = createRequire(path.join(ROOT, "apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3417";
const OUT = path.join(ROOT, ".screenshots", "BP-CONSOLE");
mkdirSync(OUT, { recursive: true });
const op = JSON.parse(readFileSync(process.env.OPERATOR_FILE, "utf8"));
const secretB32 = new URL(op.otpauth).searchParams.get("secret");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function unbase32(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    value = ((value << 5) | B32.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const KEY = unbase32(secretB32);
function hotp(counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", KEY).update(msg).digest();
  const at = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1e6).padStart(6, "0");
}
const nowStep = () => Math.floor(Date.now() / 30000);
let last = nowStep(); // the dev seed used a step at about its start; begin after the current one
async function freshCode() {
  const want = last + 1;
  while (want > nowStep() + 1) await new Promise((r) => setTimeout(r, 1000));
  last = want;
  return hotp(want);
}

const shots = [];
async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(path.relative(ROOT, file));
}
const at = (page, re, what) => {
  if (!re.test(new URL(page.url()).pathname + new URL(page.url()).search)) throw new Error(`${what}: landed on ${page.url()}`);
};

async function flow(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const w = `-${width}`;

  // Without a session: the console is 404.
  const res = await page.goto(`${BASE}/platform`, { waitUntil: "networkidle", timeout: 180_000 });
  if (res.status() !== 404) throw new Error(`/platform without a session answered ${res.status()}`);
  await shot(page, `no-session-404${w}`);

  await page.goto(`${BASE}/platform/sign-in`, { waitUntil: "networkidle", timeout: 180_000 });
  await shot(page, `sign-in-default${w}`);
  await page.fill('input[name="email"]', op.email);
  await page.fill('input[name="password"]', op.password);
  await page.fill('input[name="code"]', hotp(last - 5)); // an old code: refused
  await page.click('button[type="submit"]');
  await page.waitForURL(/failed=1/, { timeout: 60_000 });
  await shot(page, `sign-in-failed${w}`);
  await page.fill('input[name="email"]', op.email);
  await page.fill('input[name="password"]', op.password);
  await page.fill('input[name="code"]', await freshCode());
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/platform$/, { timeout: 60_000 });
  await shot(page, `shops-default${w}`);

  // The kirana shop: propose new caps.
  await page.locator(".pc-card-h a", { hasText: "Sharma" }).first().click();
  await page.waitForURL(/\/platform\/shops\//);
  await shot(page, `shop-default${w}`);
  const caps = page.locator('form[aria-label="AI and caps"]');
  await caps.locator('input[name="ai_daily_calls"]').fill(width < 600 ? "150" : "120");
  await caps.locator('button[type="submit"]').click();
  await page.waitForURL(/\/platform\/changes\/[0-9a-f-]+\?proposed=1/);
  await shot(page, `change-proposed${w}`);
  await page.locator('form[aria-label="Approve"] button[type="submit"]').click();
  await page.waitForURL(/done=approved/);
  await shot(page, `change-approved${w}`);
  await page.goto(`${BASE}/platform`, { waitUntil: "networkidle" });
  await shot(page, `shops-after-approval${w}`);

  // A WhatsApp grant: its approval needs a fresh code.
  await page.locator(".pc-card-h a", { hasText: "Sharma" }).first().click();
  await page.waitForURL(/\/platform\/shops\//);
  const wa = page.locator('form[aria-label="WhatsApp grant"]');
  await wa.locator('select[name="granted"]').selectOption("true");
  await wa.locator('input[name="max_test_recipients"]').fill("2");
  await wa.locator('button[type="submit"]').click();
  await page.waitForURL(/\/platform\/changes\/[0-9a-f-]+\?proposed=1/);
  await shot(page, `grant-proposed-needs-code${w}`);
  const approve = page.locator('form[aria-label="Approve"]');
  await approve.locator('input[name="code"]').fill(hotp(last)); // the sign-in's own code again: refused
  await approve.locator('button[type="submit"]').click();
  await page.waitForURL(/failed=refused/);
  await shot(page, `grant-refused-replayed-code${w}`);
  await approve.locator('input[name="code"]').fill(await freshCode());
  await approve.locator('button[type="submit"]').click();
  await page.waitForURL(/done=approved/);
  await shot(page, `grant-approved${w}`);

  // A proposal rejected.
  await page.goto(`${BASE}/platform/defaults`, { waitUntil: "networkidle" });
  await shot(page, `defaults-default${w}`);
  const slug = page.locator('form[aria-label="Reserve a slug"]');
  await slug.locator('input[name="slug"]').fill(`help-desk-${width}`);
  await slug.locator('button[type="submit"]').click();
  await page.waitForURL(/proposed=1/);
  await page.locator('form[aria-label="Reject"] button[type="submit"]').click();
  await page.waitForURL(/done=rejected/);
  await shot(page, `slug-rejected${w}`);
  // A refused proposal: out of range.
  await page.goto(`${BASE}/platform/defaults?failed=invalid`, { waitUntil: "networkidle" });
  await shot(page, `defaults-invalid${w}`);

  await page.goto(`${BASE}/platform/changes`, { waitUntil: "networkidle" });
  at(page, /^\/platform\/changes$/, "changes");
  await shot(page, `changes-log${w}`);

  // Sign out: the console is 404 again.
  await page.locator(".pc-nav-out button").click();
  await page.waitForURL(/\/platform\/sign-in$/);
  const again = await page.goto(`${BASE}/platform/changes`, { waitUntil: "networkidle" });
  if (again.status() !== 404) throw new Error(`/platform/changes after sign-out answered ${again.status()}`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) await flow(browser, width);
} finally {
  await browser.close();
}
console.log(shots.join("\n"));
