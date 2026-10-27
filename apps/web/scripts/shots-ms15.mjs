// Screenshots of what MS-15 changed on the photo screens, on the books' real data (as `pnpm dev` seeds them) and recorded
// model responses: the "not checked" note on a bill's printed text, the photo copy, a new pick clearing the old result,
// a repeat photo returning its waiting draft, "Recorded response" on a refused reading and on waiting drafts. The shots
// run in order against one database (each leaves drafts waiting for the next); restart pnpm dev to reseed.
// Usage (with the app running): node scripts/shots-ms15.mjs [base-url] [out-dir] [only-prefix]
// Headless Chrome clamps a window to 500px wide, so the 390px phone viewport is set with CDP device-metrics emulation.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [base = "http://localhost:3000/", out = ".screenshots/MS-15", only = ""] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MEDIA = fileURLToPath(new URL("../../../packages/agent/fixtures/media/", import.meta.url));
const OWNER = "Rajesh Sharma";
const STAFF = "Pooja Yadav";
const LANDING = { [OWNER]: "/", [STAFF]: "/counter" };

const js = (v) => JSON.stringify(v);
// Resolves once `expr` holds (a server action answered, a sign-in redirected), or fails after 30 s.
const until = (expr) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { if (${expr}) ok(true); else if (Date.now() - t0 > 30000) no(new Error("timed out waiting for " + ${js(expr)})); else setTimeout(tick, 100); }; tick(); })`;
const hydrated = until(`Object.keys(document.querySelector(".lang input")).some((k) => k.startsWith("__reactProps"))`);
const click = (selector) => `document.querySelector(${js(selector)}).click()`;
const pickOption = (selector, text) =>
  `(() => { const el = document.querySelector(${js(selector)}); const o = [...el.options].find((x) => x.textContent.startsWith(${js(text)})); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
const scrollTo = (selector, offset = 80) =>
  `window.scrollTo(0, document.querySelector(${js(selector)}).getBoundingClientRect().top + scrollY - ${offset})`;
const scrollInside = (scroller, selector, offset = 20) =>
  `(() => { const s = document.querySelector(${js(scroller)}); const el = document.querySelector(${js(selector)}); if (getComputedStyle(s).overflowY === "auto") s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - ${offset}; else window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset}); return true; })()`;
// Brings an element into view inside whatever scrolls it (a desk's sticky column scrolls on its own).
const into = (selector, block = "start") => `document.querySelector(${js(selector)}).scrollIntoView({ block: ${js(block)} }), true`;
const hindi = [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)];
const upload = (selector, file) => ({ upload: [selector, join(MEDIA, file)] });

// The card hydrates on its own: a value set before React holds the field is reset by hydration.
const ready = (selector) => until(`Object.keys(document.querySelector(${js(selector)}) ?? {}).some((k) => k.startsWith("__reactProps"))`);
const enabled = (selector) => until(`!document.querySelector(${js(selector)}).disabled`);
// The shelf: the committed shelf photo, counted.
const shelfPick = [ready(".shelf-photo input[type=file]"), upload(".shelf-photo input[type=file]", "shelf.png"), until(`document.querySelector(".photo-prev")`)];
const shelfCount = [...shelfPick, enabled(".shelf-photo .photo-form .press-primary"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out")`)];
// The bill: Gupta Traders, the committed bill photo, read.
const billPick = [ready(".bill-photo select"), pickOption(".bill-photo select", "Gupta Traders"), until(`document.querySelector(".bill-photo select").value !== ""`), upload(".bill-photo input[type=file]", "bill.png"), until(`document.querySelector(".bill-photo .photo-prev")`)];
const billRead = [...billPick, enabled(".bill-photo .photo-form .press-primary"), click(".bill-photo .photo-form .press-primary"), until(`document.querySelector(".bill-photo .photo-out, .bill-photo .ops-error, .bill-photo .bill-known")`)];
const SHOTS = [
  { name: "390-bill-note", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .bill-read", 120)] },
  { name: "390-bill-photo-cleared", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, upload(".bill-photo input[type=file]", "shelf.png"), until(`!document.querySelector(".bill-photo .photo-out")`), scrollTo(".bill-photo", 20)] },
  { name: "390-bill-photo-again", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .photo-out", 20)] },
  { name: "1280-bill-photo-again", w: 1280, h: 800, as: OWNER, path: "/bills", act: [...billRead, into(".bill-photo .photo-out")] },
  { name: "390-bill-photo-waiting-recorded", w: 390, h: 844, as: OWNER, path: "/bills", act: [scrollTo(".bill-photo .photo-waiting", 20)] },
  { name: "390-bill-photo-gone-copy-hi", w: 390, h: 844, as: OWNER, path: "/bills", act: [...hindi, ...billRead, scrollTo(".bill-photo .photo-out .photo-draft", 120)] },
  { name: "390-shelf-counted-copy", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, scrollTo(".shelf-photo .photo-out > .field-note", 300)] },
  { name: "390-shelf-photo-cleared", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, upload(".shelf-photo input[type=file]", "bill.png"), until(`!document.querySelector(".shelf-photo .photo-out")`), scrollTo(".shelf-photo", 20)] },
  { name: "390-shelf-photo-again", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfPick, enabled(".shelf-photo .photo-form .press-primary"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out")`), scrollTo(".shelf-photo .photo-out", 20)] },
  { name: "1280-shelf-photo-again", w: 1280, h: 800, as: OWNER, path: "/stock", act: [...shelfPick, enabled(".shelf-photo .photo-form .press-primary"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out")`), scrollInside(".ops-b", ".shelf-photo .photo-out")] },
  { name: "390-shelf-waiting-recorded", w: 390, h: 844, as: OWNER, path: "/stock", act: [scrollTo(".shelf-photo .photo-waiting", 20)] },
  { name: "390-shelf-refused-recorded", w: 390, h: 844, as: OWNER, path: "/stock", act: [upload(".shelf-photo input[type=file]", "ask-en.wav"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .ops-error")`), scrollTo(".shelf-photo", 20)] },
];

// Runs in the page after each shot's actions: overflow, tap targets (an absolute ::after pad counts), text under 16px
// in fields (iOS zooms), chips whose centre lands on another element, faces.
const CHECKS = `(() => {
  const px = (v) => parseFloat(v) || 0;
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width && b.height && getComputedStyle(el).visibility !== "hidden"; };
  const small = [];
  for (const el of document.querySelectorAll("button, a[href], .seg label, select, input:not([type=hidden]):not([type=radio]):not(.vh), textarea, label.photo-pick")) {
    if (!visible(el) || el.closest("dialog:not([open])") || el.closest(".vh")) continue;
    const b = el.getBoundingClientRect();
    const a = getComputedStyle(el, "::after");
    const pad = a.content !== "none" && a.position === "absolute";
    const h = b.height + (pad ? Math.max(0, -px(a.top)) + Math.max(0, -px(a.bottom)) : 0);
    const w = b.width + (pad ? Math.max(0, -px(a.left)) + Math.max(0, -px(a.right)) : 0);
    if (h < 48 || w < 48) small.push((el.className || el.tagName) + " '" + el.textContent.trim().slice(0, 24) + "' " + Math.round(w) + "x" + Math.round(h));
  }
  const tinyFields = [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]):not(.vh), select, textarea")].filter((el) => visible(el) && px(getComputedStyle(el).fontSize) < 16).length;
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
  const fonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/^'?__|_[0-9a-f]+'?$/g, "")))];
  return JSON.stringify({
    viewport: innerWidth + "x" + innerHeight,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    lang: document.documentElement.lang,
    smallTargets: small,
    tinyFields,
    chipProbes: probed,
    chipMisses: misses,
    boxes: document.querySelectorAll(".boxed rect, .boxed .fig-box").length,
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
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
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
      if (m.method === "Runtime.exceptionThrown") problems.push(`[${current}] exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(m.params.type))
        problems.push(`[${current}] console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(`[${current}] log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
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
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (!r.result) throw new Error(`${expression}: ${JSON.stringify(r.error)}`);
      if (r.result.exceptionDetails) throw new Error(`${expression.slice(0, 160)}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result.result.value;
    };
    const act = async (a) => {
      if (typeof a === "string") return evaluate(a);
      const [selector, file] = a.upload;
      const { root } = (await send("DOM.getDocument", { depth: 0 })).result;
      const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result;
      if (!nodeId) throw new Error(`no ${selector} to upload into`);
      await send("DOM.setFileInputFiles", { nodeId, files: [file] });
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
    await send("DOM.enable");
    for (const shot of SHOTS.filter((s) => s.name.startsWith(only))) {
      current = shot.name;
      try {
        await send("Network.clearBrowserCookies");
        await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: shot.w < 600 });
        await load(() => send("Page.navigate", { url: `${base}sign-in` }));
        await evaluate("sessionStorage.clear(), true");
        await evaluate(
          `[...document.querySelectorAll(".people .press")].find(b => b.querySelector("[data-name]").textContent === ${js(shot.as)}).click()`,
        );
        await evaluate(until(`location.pathname === ${js(LANDING[shot.as])} && document.querySelector("main")`));
        if (shot.path !== LANDING[shot.as]) await load(() => send("Page.navigate", { url: `${base}${shot.path.slice(1)}` }));
        else await evaluate(hydrated);
        for (const a of shot.act ?? []) await act(a);
        for (const step of [shot, ...(shot.also ? [shot.also] : [])]) {
          if (step !== shot) {
            await send("Emulation.setDeviceMetricsOverride", { width: step.w, height: step.h, deviceScaleFactor: 1, mobile: step.w < 600 });
            for (const a of step.act ?? []) await act(a);
          }
          await sleep(600);
          const checks = await evaluate(CHECKS);
          const png = await send("Page.captureScreenshot", { format: "png" });
          const file = join(out, `${step.name}.png`);
          writeFileSync(file, Buffer.from(png.result.data, "base64"));
          console.log(`${file} ${checks}`);
        }
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
