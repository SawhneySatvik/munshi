// Screenshots of /bills, /suppliers and /reports on the books' real data (as `pnpm dev` seeds them), at a true 390px
// phone viewport (CDP device metrics: headless Chrome clamps a window to 500px) and at 1280, with layout checks printed
// for each. Each shot starts signed out and signs in through the demo sign-in. The shots that write the books run last:
// recording a bill, then approving the waiting reorder (reseed to take the set again).
// Usage (with the app running): node scripts/shots-ms9b.mjs [base-url] [out-dir] [only-names-comma-separated]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base = "http://localhost:3000/", out = ".screenshots/MS-9b", only = ""] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OWNER = "Rajesh Sharma";
const STAFF = "Pooja Yadav";

const until = (expr) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { if (${expr}) ok(true); else if (Date.now() - t0 > 15000) no(new Error("timed out waiting for " + ${JSON.stringify(expr)})); else setTimeout(tick, 100); }; tick(); })`;
const hydrated = until(`Object.keys(document.querySelector(".lang input")).some((k) => k.startsWith("__reactProps"))`);
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;
const scrollTo = (selector, offset = 80) =>
  `window.scrollTo(0, document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY - ${offset})`;
// The first figure (table cell or chip) whose number reads `amount`, or the first figure at all.
const figure = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;
const hindi = [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)];
// React's own value setter, so a controlled input sees the change.
const type = (selector, value) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); })()`;
const pickOption = (selector, text) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const o = [...el.options].find((o) => o.textContent.startsWith(${JSON.stringify(text)})); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value); el.dispatchEvent(new Event("change", { bubbles: true })); })()`;
// A bill form filled from Gupta Traders' paper bill: Butter above its last bill price, so the rise flag shows.
const fillBillNo = (billNo) => [
  pickOption('select[name="supplier"]', "Gupta Traders"),
  type('input[name="billNo"]', billNo),
  pickOption('select[name="item-0"]', "Butter 100 g"),
  type('input[name="qty-0"]', "12"),
  type('input[name="cost-0"]', "62.50"),
  until(`document.querySelector(".bk-price.is-rise")`),
];
const fillBill = fillBillNo("GT-2001");

const SHOTS = [
  { name: "390-reports", w: 390, h: 844, as: OWNER, path: "reports" },
  { name: "390-reports-source", w: 390, h: 844, as: OWNER, path: "reports", act: [figure(".bk-takings .pair")] },
  { name: "390-reports-week", w: 390, h: 844, as: OWNER, path: "reports?view=week" },
  { name: "390-reports-week-table", w: 390, h: 844, as: OWNER, path: "reports?view=week", act: [scrollTo(".bk-week-table")] },
  { name: "390-reports-today", w: 390, h: 844, as: OWNER, path: "reports?view=today" },
  { name: "390-reports-hi", w: 390, h: 844, as: OWNER, path: "reports", act: hindi, reload: true },
  { name: "1280-reports", w: 1280, h: 800, as: OWNER, path: "reports" },
  { name: "1280-reports-week", w: 1280, h: 800, as: OWNER, path: "reports?view=week" },
  { name: "1280-reports-week-source", w: 1280, h: 800, as: OWNER, path: "reports?view=week", act: [figure(".bk-colbar.is-peak")] },
  { name: "390-bills", w: 390, h: 844, as: OWNER, path: "bills" },
  { name: "390-bills-list", w: 390, h: 844, as: OWNER, path: "bills", act: [scrollTo(".bk-bills-table")] },
  { name: "390-bills-source", w: 390, h: 844, as: OWNER, path: "bills", act: [figure(".bk-bills-table .bk-fig")] },
  { name: "390-bills-hi", w: 390, h: 844, as: OWNER, path: "bills", act: hindi, reload: true },
  { name: "390-bills-staff", w: 390, h: 844, as: STAFF, path: "bills" },
  { name: "1280-bills", w: 1280, h: 800, as: OWNER, path: "bills" },
  { name: "390-bill", w: 390, h: 844, as: OWNER, path: "bills", act: [click(".bk-bill-no"), until(`document.querySelector(".bk-bill-facts")`)] },
  {
    name: "390-bill-rise",
    w: 390,
    h: 844,
    as: OWNER,
    path: "bills",
    // The oldest of Gupta Traders' weekly bills this month (not a small paneer bill): the first after Butter's cost rose.
    act: [`[...document.querySelectorAll(".bk-bills-table tbody tr")].filter((tr) => tr.querySelector(".bk-bill-who").textContent.includes("Gupta") && tr.querySelectorAll(".bk-fig")[1].textContent.replace(/[^0-9]/g, "").length > 4).at(-1).querySelector(".bk-bill-no").click()`, until(`document.querySelector(".bk-bill-facts")`), scrollTo(".finds", 120)],
  },
  { name: "1280-bill", w: 1280, h: 800, as: OWNER, path: "bills", act: [click(".bk-bill-no"), until(`document.querySelector(".bk-bill-facts")`)] },
  { name: "390-bill-new", w: 390, h: 844, as: OWNER, path: "bills/new" },
  { name: "390-bill-new-rise", w: 390, h: 844, as: OWNER, path: "bills/new", act: [...fillBill, scrollTo(".bk-line", 140)] },
  { name: "1280-bill-new-rise", w: 1280, h: 800, as: OWNER, path: "bills/new", act: fillBill },
  { name: "390-bill-new-staff", w: 390, h: 844, as: STAFF, path: "bills/new" },
  { name: "390-suppliers", w: 390, h: 844, as: OWNER, path: "suppliers" },
  { name: "390-suppliers-list", w: 390, h: 844, as: OWNER, path: "suppliers", act: [scrollTo(".bk-firms")] },
  { name: "390-suppliers-source", w: 390, h: 844, as: OWNER, path: "suppliers", act: [figure(".bk-firm .bk-fig")] },
  { name: "390-suppliers-hi", w: 390, h: 844, as: OWNER, path: "suppliers", act: hindi, reload: true },
  { name: "390-suppliers-staff", w: 390, h: 844, as: STAFF, path: "suppliers" },
  { name: "1280-suppliers", w: 1280, h: 800, as: OWNER, path: "suppliers" },
  // These two write the books: a bill recorded by hand, then the waiting reorder approved.
  {
    name: "390-bill-recorded",
    w: 390,
    h: 844,
    as: OWNER,
    path: "bills/new",
    act: [...fillBill, click('.bk-form-actions button[type="submit"]'), until(`location.pathname.startsWith("/bills/") && document.querySelector(".stamp")`)],
  },
  {
    name: "1280-bill-recorded",
    w: 1280,
    h: 800,
    as: OWNER,
    path: "bills/new",
    act: [...fillBillNo("GT-2002"), click('.bk-form-actions button[type="submit"]'), until(`location.pathname.startsWith("/bills/") && document.querySelector(".stamp")`)],
  },
  {
    name: "390-suppliers-approved",
    w: 390,
    h: 844,
    as: OWNER,
    path: "suppliers",
    act: [click(".pending .press-primary"), until(`document.querySelector(".pending .stamp")`), scrollTo(".pending", 120)],
  },
  { name: "1280-suppliers-approved", w: 1280, h: 800, as: OWNER, path: "suppliers" },
];

// Runs in the page after each shot's actions: overflow, tap targets (an absolute ::after pad counts), inputs under 16px,
// figures with no source, and the faces that loaded.
const CHECKS = `(() => {
  const px = (v) => parseFloat(v) || 0;
  const small = [];
  for (const el of document.querySelectorAll("button, a[href], label, select, input:not([type=hidden])")) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || getComputedStyle(el).visibility === "hidden") continue;
    if (el.closest("fieldset.lang") && el.tagName === "INPUT") continue;
    const a = getComputedStyle(el, "::after");
    const pad = a.content !== "none" && a.position === "absolute";
    const h = b.height + (pad ? Math.max(0, -px(a.top)) + Math.max(0, -px(a.bottom)) : 0);
    const w = b.width + (pad ? Math.max(0, -px(a.left)) + Math.max(0, -px(a.right)) : 0);
    if (h < 48 || w < 48) small.push((el.className || el.tagName) + " '" + el.textContent.trim().slice(0, 24) + "' " + Math.round(w) + "x" + Math.round(h));
  }
  const tinyInputs = [...document.querySelectorAll("input:not([type=hidden]), select")].filter((el) => !el.closest("fieldset.lang") && px(getComputedStyle(el).fontSize) < 16).length;
  const fonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/^'?__|_[0-9a-f]+'?$/g, "")))];
  return JSON.stringify({
    path: location.pathname + location.search,
    viewport: innerWidth + "x" + innerHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    lang: document.documentElement.lang,
    smallTargets: small,
    tinyInputs,
    figures: document.querySelectorAll(".pair").length,
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
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      if (m.method === "Runtime.exceptionThrown") problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(m.params.type))
        problems.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
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
      if (r.result.exceptionDetails) throw new Error(`${expression}: ${r.result.exceptionDetails.exception?.description}`);
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
    const wanted = only ? only.split(",") : null;
    for (const shot of SHOTS.filter((s) => !wanted || wanted.includes(s.name))) {
      try {
        await send("Network.clearBrowserCookies");
        await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: shot.w < 600 });
        await load(() => send("Page.navigate", { url: `${base}sign-in` }));
        await evaluate(
          `[...document.querySelectorAll(".people .press")].find(b => b.querySelector("[data-name]").textContent === ${JSON.stringify(shot.as)}).click()`,
        );
        // Each role lands on its own first page (the owner on the home, the counter staff on the counter).
        await evaluate(until(`location.pathname !== "/sign-in" && document.querySelector("main")`));
        await load(() => send("Page.navigate", { url: `${base}${shot.path}` }));
        for (const js of shot.act ?? []) await evaluate(js);
        if (shot.reload) await load(() => send("Page.reload"));
        await sleep(450);
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
