// Screenshots of the counter, the credit book, stock and the navigation on the books' real data (as `pnpm dev` seeds
// them), in each state the screens have, plus the owner home again to show the navigation kept its fold. Each shot
// starts signed out and signs in through the demo sign-in. The recorded shots really write to the books (a sale, a
// payment, a count, waste), so they run after the shots of the same page before it (restart pnpm dev to reseed).
// Usage (with the app running): node scripts/shots-ms9a.mjs [base-url] [out-dir]
// Headless Chrome clamps a window to 500px wide, so the 390px phone viewport is set with CDP device-metrics emulation.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base = "http://localhost:3000/", out = ".screenshots/MS-9a"] = process.argv.slice(2);
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

// Counter: a bill of two packs of toor dal (search, then the stepper) and the first best-seller tile, on credit.
const fillBill = [
  setValue('.pick input[type="search"]', "toor"),
  until(`document.querySelector(".found .found-a")`),
  click(".found .found-a"),
  until(`document.querySelector(".line .step:not(:disabled)")`),
  `[...document.querySelectorAll(".line .step")][1].click()`,
  `[...document.querySelectorAll(".tile")].find((t) => !t.classList.contains("is-in")).click()`,
  pickOption('select[name="customer"]', "Ramesh K."),
];
const recordSale = [click(".bill .press-primary"), until(`document.querySelector(".receipt")`)];

const SHOTS = [
  // Navigation and the home it must not push below the fold.
  { name: "390-home", w: 390, h: 844, as: OWNER, path: "/" },
  { name: "390-home-more", w: 390, h: 844, as: OWNER, path: "/", act: [click(".nav-more .nav-a"), until(`document.querySelector("#nav-more:popover-open")`)] },
  { name: "1280-home", w: 1280, h: 800, as: OWNER, path: "/" },
  { name: "390-home-voice", w: 390, h: 844, as: OWNER, path: "/", act: [scrollTo(".ask", 420)] },

  // Counter.
  { name: "390-counter", w: 390, h: 844, as: STAFF, path: "/counter" },
  { name: "1280-counter", w: 1280, h: 800, as: OWNER, path: "/counter" },
  { name: "390-counter-hi", w: 390, h: 844, as: STAFF, path: "/counter", act: hindi, reload: true },
  { name: "1280-counter-hi", w: 1280, h: 800, as: STAFF, path: "/counter", act: hindi, reload: true },
  { name: "390-counter-bill", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, scrollTo(".bill")] },
  {
    name: "390-counter-error",
    w: 390,
    h: 844,
    as: STAFF,
    path: "/counter",
    act: [...fillBill.slice(0, -1), click(".bill .press-primary"), until(`document.querySelector(".bill .ops-error")`), scrollTo(".bill .unverified", 120)],
  },
  { name: "1280-counter-bill", w: 1280, h: 800, as: OWNER, path: "/counter", act: fillBill },
  {
    name: "1280-counter-error",
    w: 1280,
    h: 800,
    as: STAFF,
    path: "/counter",
    act: [...fillBill.slice(0, -1), click(".bill .press-primary"), until(`document.querySelector(".bill .ops-error")`), scrollTo(".bill .ops-error", 500)],
  },
  { name: "390-counter-source", w: 390, h: 844, as: STAFF, path: "/counter", act: [chip(".today", "Counter sales"), until(`document.querySelector("dialog:modal")`)] },
  { name: "390-counter-receipt", w: 390, h: 844, as: STAFF, path: "/counter", act: [...fillBill, ...recordSale, scrollTo(".receipt")] },
  { name: "1280-counter-receipt", w: 1280, h: 800, as: OWNER, path: "/counter", act: [...fillBill, ...recordSale] },

  // Credit book.
  { name: "390-credit", w: 390, h: 844, as: OWNER, path: "/credit" },
  { name: "1280-credit", w: 1280, h: 800, as: OWNER, path: "/credit" },
  { name: "390-credit-staff", w: 390, h: 844, as: STAFF, path: "/credit" },
  { name: "1280-credit-staff", w: 1280, h: 800, as: STAFF, path: "/credit" },
  { name: "390-credit-hi", w: 390, h: 844, as: OWNER, path: "/credit", act: hindi, reload: true },
  { name: "1280-credit-hi", w: 1280, h: 800, as: OWNER, path: "/credit", act: hindi, reload: true },
  { name: "390-credit-list", w: 390, h: 844, as: OWNER, path: "/credit", act: [scrollTo(".owing")] },
  {
    name: "390-credit-error",
    w: 390,
    h: 844,
    as: STAFF,
    path: "/credit",
    act: [pickOption('select[name="customer"]', "Ramesh K."), click(".entry .press-primary"), until(`document.querySelector(".entry .ops-error")`), scrollTo(".entry .amount", 160)],
  },
  { name: "1280-credit-source", w: 1280, h: 800, as: OWNER, path: "/credit", act: [chip(".owing li:first-child", "Credit book"), until(`document.querySelector(".src.is-open")`)] },
  {
    name: "390-credit-recorded",
    w: 390,
    h: 844,
    as: STAFF,
    path: "/credit",
    act: [
      `[...document.querySelectorAll(".owing .press-row")][0].click()`,
      setValue(".entry .amount", "200"),
      click(".entry .press-primary"),
      until(`document.querySelector(".entry .recorded")`),
      scrollTo(".entry .recorded", 200),
    ],
  },
  {
    name: "1280-credit-recorded",
    w: 1280,
    h: 800,
    as: OWNER,
    path: "/credit",
    act: [
      pickOption('select[name="customer"]', "Sunita P."),
      clickText(".seg label", "Credit given"),
      setValue(".entry .amount", "150"),
      click(".entry .press-primary"),
      until(`document.querySelector(".entry .recorded")`),
    ],
  },

  // Stock.
  { name: "390-stock", w: 390, h: 844, as: OWNER, path: "/stock" },
  { name: "1280-stock", w: 1280, h: 800, as: OWNER, path: "/stock" },
  { name: "390-stock-staff", w: 390, h: 844, as: STAFF, path: "/stock", act: [scrollTo(".entry")] },
  { name: "1280-stock-staff", w: 1280, h: 800, as: STAFF, path: "/stock" },
  { name: "390-stock-hi", w: 390, h: 844, as: OWNER, path: "/stock", act: hindi, reload: true },
  { name: "1280-stock-hi", w: 1280, h: 800, as: OWNER, path: "/stock", act: hindi, reload: true },
  { name: "390-stock-low", w: 390, h: 844, as: OWNER, path: "/stock", act: [scrollTo(".low")] },
  { name: "390-stock-every", w: 390, h: 844, as: OWNER, path: "/stock", act: [scrollTo(".every")] },
  { name: "390-stock-source", w: 390, h: 844, as: OWNER, path: "/stock", act: [chip(".every li:nth-child(3)", "Stock ledger"), until(`document.querySelector("dialog:modal")`)] },
  { name: "1280-stock-source", w: 1280, h: 800, as: OWNER, path: "/stock", act: [chip(".every li:nth-child(3)", "Stock ledger"), until(`document.querySelector(".src.is-open")`)] },
  {
    name: "390-stock-error",
    w: 390,
    h: 844,
    as: STAFF,
    path: "/stock",
    act: [pickOption('select[name="item"]', "Tea leaves 250 g"), setValue("#stock-qty", "999"), click(".entry .press-primary"), until(`document.querySelector(".entry .ops-error")`), scrollTo(".entry", 20)],
  },
  {
    name: "390-stock-recorded",
    w: 390,
    h: 844,
    as: OWNER,
    path: "/stock",
    act: [
      `[...document.querySelectorAll(".low .press-row")][0].click()`,
      setValue("#stock-qty", "3"),
      click(".entry .press-primary"),
      until(`document.querySelector(".entry .recorded")`),
      scrollTo(".entry", 20),
    ],
  },
  {
    name: "1280-stock-recorded",
    w: 1280,
    h: 800,
    as: STAFF,
    path: "/stock",
    act: [
      pickOption('select[name="item"]', "Cream biscuits 100 g"),
      setValue("#stock-qty", "1"),
      click(".entry .press-primary"),
      until(`document.querySelector(".entry .recorded")`),
    ],
  },
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
