// Screenshots of the screens wired to the priced reads: the priced counter bill and its receipts, a bill's lines,
// the suppliers' last prices and the week's total, on the books' real data (as `pnpm dev` seeds them). Each shot starts
// signed out and signs in through the demo sign-in. The recorded shots really write to the books (a sale).
// Usage (with the app running): node scripts/shots-ms10.mjs [base-url] [out-dir]
// Headless Chrome clamps a window to 500px wide, so the 390px phone viewport is set with CDP device-metrics emulation.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base = "http://localhost:3000/", out = ".screenshots/MS-10"] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OWNER = "Rajesh Sharma";
const STAFF = "Pooja Yadav";
const LANDING = { [OWNER]: "/", [STAFF]: "/counter" };

const js = (v) => JSON.stringify(v);
// Resolves once `expr` holds (a server action re-rendered the page, a sign-in redirected), or fails after 30 s.
const until = (expr) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { if (${expr}) ok(true); else if (Date.now() - t0 > 30000) no(new Error("timed out waiting for " + ${js(expr)})); else setTimeout(tick, 100); }; tick(); })`;
const hydrated = until(`Object.keys(document.querySelector(".lang input")).some((k) => k.startsWith("__reactProps"))`);
const click = (selector) => `document.querySelector(${js(selector)}).click()`;
const clickText = (selector, text) =>
  `[...document.querySelectorAll(${js(selector)})].find((el) => el.textContent.trim().startsWith(${js(text)})).click()`;
// React reads a controlled field's value through its native setter and an input (or, for a select, change) event.
const setValue = (selector, value) =>
  `(() => { const el = document.querySelector(${js(selector)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`;
const pickOption = (selector, text) =>
  `(() => { const el = document.querySelector(${js(selector)}); const o = [...el.options].find((x) => x.textContent === ${js(text)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
const chip = (scope, label) => `[...document.querySelectorAll(${js(`${scope} .pair`)})].find((b) => b.querySelector(".ref").textContent === ${js(label)}).click()`;
const scrollTo = (selector, offset = 80) =>
  `window.scrollTo(0, document.querySelector(${js(selector)}).getBoundingClientRect().top + scrollY - ${offset})`;
const hindi = [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)];

// Counter: a bill of two packs of toor dal (search, then the stepper) and the first best-seller tile, priced by sale.quote.
const fillBill = [
  setValue('.pick input[type="search"]', "toor"),
  until(`document.querySelector(".found .found-a")`),
  click(".found .found-a"),
  until(`document.querySelector(".line .step:not(:disabled)")`),
  `[...document.querySelectorAll(".line .step")][1].click()`,
  `[...document.querySelectorAll(".tile")].find((t) => !t.classList.contains("is-in")).click()`,
  until(`document.querySelector(".bill .bill-total")`),
];
const onCredit = [...fillBill, pickOption('select[name="customer"]', "Ramesh K.")];
const recordSale = [click(".bill .press-primary"), until(`document.querySelector(".receipt")`)];
const openBill = () => [`document.querySelector(".bk-bill-no").click()`, until(`location.pathname.startsWith("/bills/")`)];

const SHOTS = [
  { name: "390-counter-empty", w: 390, h: 844, as: STAFF, path: "/counter" },
  { name: "390-counter-priced", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, scrollTo(".bill")] },
  { name: "1280-counter-priced", w: 1280, h: 800, as: OWNER, path: "/counter", act: fillBill },
  { name: "390-counter-priced-hi", w: 390, h: 844, as: STAFF, path: "/counter", act: [...hindi, ...fillBill, scrollTo(".bill")] },
  { name: "390-counter-tender-upi", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, clickText(".seg label", "UPI"), scrollTo(".bill .seg", 200)] },
  { name: "390-counter-source", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, chip(".bill-total", "Price list"), until(`document.querySelector("dialog:modal")`)] },
  { name: "390-receipt-cash", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, clickText(".seg label", "Cash"), ...recordSale, scrollTo(".receipt")] },
  { name: "1280-receipt-upi", w: 1280, h: 800, as: OWNER, path: "/counter", act: [...fillBill, clickText(".seg label", "UPI"), ...recordSale] },
  { name: "390-receipt-credit", w: 390, h: 844, as: STAFF, path: "/counter", act: [...onCredit, ...recordSale, scrollTo(".receipt")] },
  { name: "1280-receipt-credit-hi", w: 1280, h: 800, as: OWNER, path: "/counter", act: [...hindi, ...onCredit, ...recordSale] },
  { name: "390-bill-lines", w: 390, h: 844, as: OWNER, path: "/bills", act: openBill() },
  { name: "1280-bill-lines", w: 1280, h: 800, as: OWNER, path: "/bills", act: openBill() },
  { name: "390-suppliers", w: 390, h: 844, as: OWNER, path: "/suppliers", act: [scrollTo(".bk-firms", 40)] },
  { name: "1280-suppliers", w: 1280, h: 800, as: OWNER, path: "/suppliers" },
  { name: "390-reports-week", w: 390, h: 844, as: OWNER, path: "/reports?view=week", act: [scrollTo(".bk-week-table", 120)] },
  { name: "1280-reports-week", w: 1280, h: 800, as: OWNER, path: "/reports?view=week", act: [scrollTo(".bk-week-table", 200)] },
];

// Runs in the page after each shot's actions: overflow, tap targets (an absolute ::after pad counts), text under 16px
// in fields (iOS zooms), chips whose centre lands on another element, the home's fold against the docked bar, faces.
const CHECKS = `(() => {
  const px = (v) => parseFloat(v) || 0;
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width && b.height && getComputedStyle(el).visibility !== "hidden"; };
  const small = [];
  for (const el of document.querySelectorAll("button, a[href], .seg label, select, input:not([type=hidden]):not([type=radio])")) {
    if (!visible(el) || el.closest("dialog:not([open])")) continue;
    const b = el.getBoundingClientRect();
    const a = getComputedStyle(el, "::after");
    const pad = a.content !== "none" && a.position === "absolute";
    const h = b.height + (pad ? Math.max(0, -px(a.top)) + Math.max(0, -px(a.bottom)) : 0);
    const w = b.width + (pad ? Math.max(0, -px(a.left)) + Math.max(0, -px(a.right)) : 0);
    if (h < 48 || w < 48) small.push((el.className || el.tagName) + " '" + el.textContent.trim().slice(0, 24) + "' " + Math.round(w) + "x" + Math.round(h));
  }
  const tinyFields = [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]), select")].filter((el) => visible(el) && px(getComputedStyle(el).fontSize) < 16).length;
  const nav = document.querySelector(".nav");
  const navTop = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight;
  const misses = [];
  let probed = 0;
  if (!document.querySelector("dialog:modal")) {
    for (const ref of document.querySelectorAll(".pair .ref")) {
      const b = ref.getBoundingClientRect();
      const own = ref.closest(".pair");
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      if (y < 0 || y > navTop - 2 || !b.width) continue;
      probed++;
      if (document.elementFromPoint(x, y)?.closest(".pair") !== own) misses.push(ref.textContent + "@" + Math.round(y));
    }
  }
  const pending = location.pathname === "/" && document.querySelector(".pending");
  const fold = pending ? { cardBottom: Math.round(pending.getBoundingClientRect().bottom), navTop: Math.round(navTop) } : null;
  const fonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/^'?__|_[0-9a-f]+'?$/g, "")))];
  return JSON.stringify({
    viewport: innerWidth + "x" + innerHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    lang: document.documentElement.lang,
    navLinks: [...new Set([...document.querySelectorAll(".nav a")].map((a) => a.getAttribute("href")))].join(" "),
    current: document.querySelector('.nav [aria-current="page"]')?.getAttribute("href") ?? null,
    smallTargets: small,
    tinyFields,
    chipProbes: probed,
    chipMisses: misses,
    fold,
    fonts,
  });
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(out, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "munshi-shots-"));
  const chrome = spawn(
    CHROME,
    ["--headless", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let failed = false;
  try {
    let targets = [];
    for (let i = 0; i < 60 && !targets.length; i++) {
      await sleep(150);
      targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((r) => r.json())
        .catch(() => []);
    }
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    const waiters = [];
    const problems = [];
    let current = "";
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      if (m.method === "Runtime.exceptionThrown") problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(m.params.type))
        problems.push(`[${current}] console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
      for (const w of waiters.filter((x) => x.method === m.method)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const i = ++id;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (!r.result) throw new Error(`${expression}: ${JSON.stringify(r.error)}`);
      if (r.result.exceptionDetails) throw new Error(`${expression.slice(0, 160)}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result.result.value;
    };
    const load = async (navigate) => {
      const loaded = once("Page.loadEventFired");
      await navigate();
      await loaded;
      await evaluate("document.fonts.ready.then(() => true)");
      await evaluate(hydrated);
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");
    for (const shot of SHOTS) {
      current = shot.name;
      try {
        await send("Network.clearBrowserCookies");
        await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: shot.w < 600 });
        await load(() => send("Page.navigate", { url: `${base}sign-in` }));
        await evaluate(
          `[...document.querySelectorAll(".people .press")].find(b => b.querySelector("[data-name]").textContent === ${js(shot.as)}).click()`,
        );
        await evaluate(until(`location.pathname === ${js(LANDING[shot.as])} && document.querySelector("main")`));
        if (shot.path !== LANDING[shot.as]) await load(() => send("Page.navigate", { url: `${base}${shot.path.slice(1)}` }));
        else await evaluate(hydrated);
        for (const act of shot.act ?? []) await evaluate(act);
        if (shot.reload) await load(() => send("Page.reload"));
        await sleep(500);
        const checks = await evaluate(CHECKS);
        const png = await send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${shot.name}.png`);
        writeFileSync(file, Buffer.from(png.result.data, "base64"));
        console.log(`${file} ${checks}`);
      } catch (err) {
        failed = true;
        console.log(`${shot.name} FAILED: ${err.message}`);
      }
    }
    console.log(problems.length ? `console problems:\n  ${problems.join("\n  ")}` : "console problems: none");
    await send("Browser.close");
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
  if (failed) process.exitCode = 1;
}

await main();
