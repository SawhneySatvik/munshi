// Screenshots of the owner home on the books' real data (as `pnpm dev` seeds them), in the states the approved reference
// shows, plus layout checks printed for each. Each shot starts signed out and signs in through the demo sign-in; the
// approved shot really approves the waiting draft, so it runs last (reseed to take the set again).
// Usage (with the app running): node scripts/shots.mjs [base-url] [out-dir] [name-prefix]
// Headless Chrome clamps a window to 500px wide, so the 390px phone viewport is set with CDP device-metrics emulation.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// localhost, not 127.0.0.1: next dev serves its client to the origin it prints, and the page never hydrates on another.
const [base = "http://localhost:3000/", out = ".screenshots/MS-7", prefix = ""] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;
const chip = (label, amount) =>
  `[...document.querySelectorAll(".pair")].find(b => b.querySelector(".ref").textContent === ${JSON.stringify(label)} && b.querySelector(".amt").textContent === ${JSON.stringify(amount)}).click()`;
// Resolves once `expr` holds (a server action re-rendered the page, a sign-in redirected), or fails after 15 s.
const until = (expr) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { if (${expr}) ok(true); else if (Date.now() - t0 > 15000) no(new Error("timed out waiting for " + ${JSON.stringify(expr)})); else setTimeout(tick, 100); }; tick(); })`;
// React has hydrated the page (its props sit on the language toggle): clicks now run the app's handlers, not the
// browser's defaults (a form would post natively, the toggle would not set its cookie).
const hydrated = until(`Object.keys(document.querySelector(".lang input")).some((k) => k.startsWith("__reactProps"))`);
const OWNER = "Rajesh Sharma";
const STAFF = "Pooja Yadav";
const signIn = (name) => [
  `[...document.querySelectorAll(".people .press")].find(b => b.querySelector("[data-name]").textContent === ${JSON.stringify(name)}).click()`,
  until(`location.pathname === "/" && document.querySelector(".home")`),
];
// The draft card, 120px below the top: the decision and the brief rows above it.
const scrollToDraft = `window.scrollTo(0, document.querySelector(".pending").getBoundingClientRect().top + scrollY - 120)`;

const scrollToMore = `window.scrollTo(0, document.querySelector(".more").getBoundingClientRect().top + scrollY - 80)`;

const SHOTS = [
  { name: "390-sign-in", w: 390, h: 844 },
  { name: "390", w: 390, h: 844, as: OWNER },
  { name: "390-source", w: 390, h: 844, as: OWNER, act: [chip("Credit book", "₹2,350")] },
  { name: "390-hi", w: 390, h: 844, as: OWNER, act: [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)], reload: true },
  { name: "1280", w: 1280, h: 800, as: OWNER },
  { name: "1280-source", w: 1280, h: 800, as: OWNER, act: [chip("Credit book", "₹2,350")] },
  { name: "390-expanded", w: 390, h: 844, as: OWNER, act: [click(".more-btn"), until(`document.querySelector(".more .finds")`), scrollToMore] },
  { name: "390-staff", w: 390, h: 844, as: STAFF, act: [scrollToDraft] },
  { name: "390-approved", w: 390, h: 844, as: OWNER, act: [click(".press-primary"), until(`document.querySelector(".pending .stamp")`), scrollToDraft] },
  { name: "1280-approved", w: 1280, h: 800, as: OWNER },
];

// Runs in the page after each shot's actions: overflow, tap targets (an absolute ::after pad counts), whether the centre
// and edges of every visible chip land on that chip's own button, and the faces that loaded.
const CHECKS = `(() => {
  const px = (v) => parseFloat(v) || 0;
  const small = [];
  for (const el of document.querySelectorAll("button, a[href], label")) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const a = getComputedStyle(el, "::after");
    const pad = a.content !== "none" && a.position === "absolute";
    const h = b.height + (pad ? Math.max(0, -px(a.top)) + Math.max(0, -px(a.bottom)) : 0);
    const w = b.width + (pad ? Math.max(0, -px(a.left)) + Math.max(0, -px(a.right)) : 0);
    if (h < 48 || w < 48) small.push((el.className || el.tagName) + " '" + el.textContent.trim().slice(0, 24) + "' " + Math.round(w) + "x" + Math.round(h));
  }
  const misses = [];
  let probed = 0;
  const ask = document.querySelector(".ask");
  if (ask && !document.querySelector("dialog:modal")) {
    const dock = ask.getBoundingClientRect();
    for (const ref of document.querySelectorAll(".pair .ref")) {
      const b = ref.getBoundingClientRect();
      const own = ref.closest(".pair");
      for (const y of [b.top + 3, b.top + b.height / 2, b.bottom - 3]) {
        const x = b.left + b.width / 2;
        if (y < 0 || y > innerHeight || (dock.height && y > dock.top && getComputedStyle(document.querySelector(".ask")).position === "fixed")) continue;
        probed++;
        if (document.elementFromPoint(x, y)?.closest(".pair") !== own) misses.push(ref.textContent + "@" + Math.round(y));
      }
    }
  }
  // The decision above the fold on a phone: the whole approval card, and its buttons clear of the fixed voice dock.
  const pending = document.querySelector(".pending");
  const buttons = pending ? [...pending.querySelectorAll(".press")].map((b) => Math.round(b.getBoundingClientRect().bottom)) : [];
  const dockTop = ask ? Math.round(ask.getBoundingClientRect().top) : null;
  const fold = pending ? { cardTop: Math.round(pending.getBoundingClientRect().top + scrollY), cardBottom: Math.round(pending.getBoundingClientRect().bottom + scrollY), buttonsBottom: buttons, dockTop } : null;
  const fonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/^'?__|_[0-9a-f]+'?$/g, "")))];
  return JSON.stringify({
    viewport: innerWidth + "x" + innerHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    lang: document.documentElement.lang,
    smallTargets: small,
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
    for (const shot of SHOTS) {
      await send("Network.clearBrowserCookies");
      await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: shot.w < 600 });
      await load(() => send("Page.navigate", { url: `${base}sign-in` }));
      for (const js of [...(shot.as ? signIn(shot.as) : []), ...(shot.act ?? [])]) await evaluate(js);
      if (shot.reload) await load(() => send("Page.reload"));
      await sleep(400);
      const checks = await evaluate(CHECKS);
      const png = await send("Page.captureScreenshot", { format: "png" });
      const file = join(out, `${prefix}${shot.name}.png`);
      writeFileSync(file, Buffer.from(png.result.data, "base64"));
      console.log(`${file} ${checks}`);
    }
    console.log(problems.length ? `console problems:\n  ${problems.join("\n  ")}` : "console problems: none");
    await send("Browser.close");
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    // Chrome can still be flushing its profile; a leftover temp directory must not hide the run's own error.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
}

await main();
