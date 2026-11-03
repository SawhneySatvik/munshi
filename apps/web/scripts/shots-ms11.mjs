// Screenshots of the hero chain on screen on the books' real data (as `pnpm dev` seeds them) and recorded model
// responses: the mic in the bar (and its states), Ask (typed, spoken, unrecorded, the source drawer), the shelf count on
// /stock and the bill photo on /bills (each read, drafted, approved), at a true 390px phone viewport and at 1280. The
// photos and recordings uploaded are the committed synthetic media (packages/agent/fixtures/media): the recorded
// responses exist for exactly those files. The approving shots write to the books (a count, a purchase), so they run
// after the shots of the same flow before them; restart pnpm dev to reseed. Chrome runs with a fake microphone (a tone,
// auto-allowed), which no recorded response matches: the mic's own states are what those shots show.
// Usage (with the app running): node scripts/shots-ms11.mjs [base-url] [out-dir] [only-prefix]
// Headless Chrome clamps a window to 500px wide, so the 390px phone viewport is set with CDP device-metrics emulation.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [base = "http://localhost:3000/", out = ".screenshots/MS-11", only = ""] = process.argv.slice(2);
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
const setValue = (selector, value) =>
  `(() => { const el = document.querySelector(${js(selector)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`;
const pickOption = (selector, text) =>
  `(() => { const el = document.querySelector(${js(selector)}); const o = [...el.options].find((x) => x.textContent.startsWith(${js(text)})); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
const chip = (scope, label) => `[...document.querySelectorAll(${js(`${scope} .pair`)})].find((b) => b.querySelector(".ref").textContent === ${js(label)}).click()`;
const scrollTo = (selector, offset = 80) =>
  `window.scrollTo(0, document.querySelector(${js(selector)}).getBoundingClientRect().top + scrollY - ${offset})`;
const scrollInside = (scroller, selector, offset = 20) =>
  `(() => { const s = document.querySelector(${js(scroller)}); const el = document.querySelector(${js(selector)}); if (getComputedStyle(s).overflowY === "auto") s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - ${offset}; else window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset}); return true; })()`;
// Brings an element into view inside whatever scrolls it (a desk's sticky column scrolls on its own).
const into = (selector, block = "start") => `document.querySelector(${js(selector)}).scrollIntoView({ block: ${js(block)} }), true`;
const hindi = [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)];
const upload = (selector, file) => ({ upload: [selector, join(MEDIA, file)] });

// Ask: a recorded question, the recording, an unrecorded question.
const askTry = (q) => [
  `[...document.querySelectorAll(".press-try")].find((b) => b.getAttribute("aria-label").startsWith(${js(q)})).click()`,
  until(`document.querySelector(".turn")`),
];
// The card hydrates on its own: a value set before React holds the field is reset by hydration.
const ready = (selector) => until(`Object.keys(document.querySelector(${js(selector)}) ?? {}).some((k) => k.startsWith("__reactProps"))`);
const enabled = (selector) => until(`!document.querySelector(${js(selector)}).disabled`);
const askVoice = (clip) => [
  upload("#recording", clip),
  until(`!document.querySelector(".recorded-box .field .press").disabled`),
  click(".recorded-box .field .press"),
  until(`document.querySelector(".turn")`),
];
const askTyped = (q) => [setValue("#question", q), click(".composer .press-primary"), until(`document.querySelector(".turn")`)];
// The shelf: the committed shelf photo, counted.
const shelfPick = [ready(".shelf-photo input[type=file]"), upload(".shelf-photo input[type=file]", "shelf.png"), until(`document.querySelector(".photo-prev")`)];
const shelfCount = [...shelfPick, enabled(".shelf-photo .photo-form .press-primary"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out")`)];
const approveIn = (scope) => [
  `document.querySelector(${js(`${scope} .photo-draft .decide .press-primary`)}).click()`,
  until(`document.querySelector(${js(`${scope} .photo-draft .stamp`)})`),
];
// The bill: Gupta Traders, the committed bill photo, read.
const billPick = [ready(".bill-photo select"), pickOption(".bill-photo select", "Gupta Traders"), until(`document.querySelector(".bill-photo select").value !== ""`), upload(".bill-photo input[type=file]", "bill.png"), until(`document.querySelector(".bill-photo .photo-prev")`)];
const billRead = [...billPick, enabled(".bill-photo .photo-form .press-primary"), click(".bill-photo .photo-form .press-primary"), until(`document.querySelector(".bill-photo .photo-out, .bill-photo .ops-error, .bill-photo .bill-known")`)];
// The mic: a tap starts listening (the fake microphone, auto-allowed) and opens /ask.
const micTap = [click(".nav-mic .mic"), until(`location.pathname === "/ask" && document.querySelector(".mic.is-listening")`), "new Promise((r) => setTimeout(r, 1200))"];
const denyMic = `(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); return true; })()`;

const SHOTS = [
  // The bar and the rail: the raised mic, by role.
  { name: "390-nav-owner", w: 390, h: 844, as: OWNER, path: "/" },
  { name: "390-nav-more", w: 390, h: 844, as: OWNER, path: "/", act: [click(".nav-more .nav-a"), until(`document.querySelector("#nav-more:popover-open")`)] },
  { name: "390-nav-staff", w: 390, h: 844, as: STAFF, path: "/counter" },
  { name: "1280-nav-rail", w: 1280, h: 800, as: OWNER, path: "/" },
  { name: "390-home-voice-button", w: 390, h: 844, as: OWNER, path: "/", act: [scrollTo(".home .ask", 300)] },
  { name: "390-mic-denied", w: 390, h: 844, as: OWNER, path: "/counter", act: [denyMic, click(".nav-mic .mic"), until(`document.querySelector(".mic-say p")`)] },
  { name: "1280-mic-denied", w: 1280, h: 800, as: OWNER, path: "/counter", act: [denyMic, click(".nav-mic .mic"), until(`document.querySelector(".composer-say p")`)] },
  { name: "390-mic-listening", w: 390, h: 844, as: OWNER, path: "/counter", act: micTap },
  { name: "1280-mic-listening", w: 1280, h: 800, as: OWNER, path: "/counter", act: micTap },
  {
    name: "390-mic-unrecorded",
    w: 390,
    h: 844,
    as: OWNER,
    path: "/counter",
    act: [...micTap, click(".nav-mic .mic"), until(`document.querySelector(".turn")`), scrollTo(".turn", 120)],
  },
  {
    name: "1280-mic-unrecorded",
    w: 1280,
    h: 800,
    as: OWNER,
    path: "/counter",
    act: [...micTap, click(".nav-mic .mic"), until(`document.querySelector(".turn")`)],
  },
  // Ask.
  { name: "390-ask-empty", w: 390, h: 844, as: OWNER, path: "/ask" },
  { name: "390-ask-recorded", w: 390, h: 844, as: OWNER, path: "/ask", act: [scrollTo(".recorded-box", 20)] },
  { name: "1280-ask-empty", w: 1280, h: 800, as: OWNER, path: "/ask" },
  { name: "390-ask-answer", w: 390, h: 844, as: OWNER, path: "/ask", act: [...askTry("Ask: How much"), scrollTo(".turn", 120)] },
  { name: "1280-ask-answer", w: 1280, h: 800, as: OWNER, path: "/ask", act: askTry("Ask: How much") },
  { name: "390-ask-source", w: 390, h: 844, as: OWNER, path: "/ask", act: [...askTry("Ask: How much"), chip(".turn", "Counter sales"), until(`document.querySelector("dialog:modal")`)] },
  { name: "1280-ask-source", w: 1280, h: 800, as: OWNER, path: "/ask", act: [...askTry("Ask: Who"), chip(".turn", "Credit book")] },
  { name: "390-ask-credit", w: 390, h: 844, as: OWNER, path: "/ask", act: [...askTry("Ask: Who"), scrollTo(".turn", 120)] },
  { name: "390-ask-voice-hi", w: 390, h: 844, as: OWNER, path: "/ask", act: [...hindi, ...askVoice("ask-hi.wav"), scrollTo(".turn", 120)] },
  { name: "1280-ask-voice-hi", w: 1280, h: 800, as: OWNER, path: "/ask", act: [...hindi, ...askVoice("ask-hi.wav")] },
  { name: "390-ask-voice-en", w: 390, h: 844, as: STAFF, path: "/ask", act: [...askVoice("ask-en.wav"), scrollTo(".turn", 120)] },
  { name: "390-ask-cannot-verify", w: 390, h: 844, as: OWNER, path: "/ask", act: [...askTyped("What is the weather in Delhi today?"), scrollTo(".turn", 120)] },
  { name: "1280-ask-credit", w: 1280, h: 800, as: OWNER, path: "/ask", act: askTry("Ask: Who") },
  { name: "1280-ask-cannot-verify", w: 1280, h: 800, as: OWNER, path: "/ask", act: askTyped("What is the weather in Delhi today?") },
  { name: "1280-ask-history", w: 1280, h: 800, as: OWNER, path: "/ask", act: [...askTry("Ask: How much"), ...askTyped("Who sells the most tea?")] },
  { name: "390-ask-history", w: 390, h: 844, as: OWNER, path: "/ask", act: [...askTry("Ask: How much"), ...askTyped("Who sells the most tea?"), scrollTo(".asked", 20)] },
  // The shelf count on /stock.
  { name: "390-shelf-empty", w: 390, h: 844, as: OWNER, path: "/stock", act: [scrollTo(".shelf-photo", 20)] },
  { name: "390-shelf-chosen", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfPick, scrollTo(".shelf-photo", 20)] },
  { name: "1280-shelf-empty", w: 1280, h: 800, as: OWNER, path: "/stock" },
  { name: "1280-shelf-chosen", w: 1280, h: 800, as: OWNER, path: "/stock", act: [...shelfPick, into(".shelf-photo")] },
  { name: "390-shelf-refused", w: 390, h: 844, as: OWNER, path: "/stock", act: [upload(".shelf-photo input[type=file]", "ask-en.wav"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .ops-error")`), scrollTo(".shelf-photo", 20)] },
  { name: "1280-shelf-refused", w: 1280, h: 800, as: OWNER, path: "/stock", act: [upload(".shelf-photo input[type=file]", "ask-en.wav"), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .ops-error")`)] },
  { name: "390-shelf-counted", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, scrollTo(".shelf-photo .photo-out", 20)] },
  { name: "390-shelf-rows", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, scrollTo(".shelf-photo .photo-out .finds", 20)] },
  { name: "390-shelf-draft", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, scrollTo(".shelf-photo .photo-out .photo-draft", 40)] },
  { name: "1280-shelf-counted", w: 1280, h: 800, as: OWNER, path: "/stock", act: [...shelfCount, scrollInside(".ops-b", ".shelf-photo .photo-out")] },
  { name: "390-shelf-staff-waiting", w: 390, h: 844, as: STAFF, path: "/stock", act: [scrollTo(".shelf-photo .photo-waiting", 20)] },
  { name: "1280-shelf-staff-waiting", w: 1280, h: 800, as: STAFF, path: "/stock", act: [into(".shelf-photo .photo-waiting")] },
  { name: "390-shelf-approved", w: 390, h: 844, as: OWNER, path: "/stock", act: [...shelfCount, ...approveIn(".shelf-photo .photo-out"), scrollTo(".shelf-photo .photo-out .photo-draft", 40)] },
  { name: "1280-shelf-approved", w: 1280, h: 800, as: OWNER, path: "/stock", act: [...shelfCount, ...approveIn(".shelf-photo .photo-out"), scrollInside(".ops-b", ".shelf-photo .photo-out .photo-draft")] },
  { name: "390-shelf-hi", w: 390, h: 844, as: OWNER, path: "/stock", act: [...hindi, ...shelfCount, scrollTo(".shelf-photo .photo-out .finds", 20)] },
  // The bill photo on /bills.
  { name: "390-bill-photo-empty", w: 390, h: 844, as: OWNER, path: "/bills", act: [scrollTo(".bill-photo", 20)] },
  { name: "1280-bill-photo-empty", w: 1280, h: 800, as: OWNER, path: "/bills" },
  { name: "390-bill-photo-chosen", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billPick, scrollTo(".bill-photo .photo-prev", 200)] },
  { name: "390-bill-photo-read", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .photo-out", 20)] },
  { name: "390-bill-photo-lines", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .bill-read", 60)] },
  { name: "390-bill-photo-draft", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .photo-out .photo-draft", 40)] },
  { name: "390-bill-photo-source", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, `document.querySelector(".bill-read .bk-fig").click()`, until(`document.querySelector("dialog:modal")`)] },
  { name: "1280-bill-photo-read", w: 1280, h: 800, as: OWNER, path: "/bills", act: billRead },
  { name: "1280-bill-photo-lines", w: 1280, h: 800, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .bill-read", 120)] },
  { name: "1280-bill-photo-draft", w: 1280, h: 800, as: OWNER, path: "/bills", act: [...billRead, into(".bill-photo .photo-out .photo-draft", "center")] },
  { name: "390-bill-photo-hi", w: 390, h: 844, as: OWNER, path: "/bills", act: [...hindi, ...billRead, scrollTo(".bill-photo .bill-read", 60)] },
  // A bill is recorded once, so its approved card is shot at 390 and then, on the same page, at 1280.
  {
    name: "390-bill-photo-approved",
    w: 390,
    h: 844,
    as: OWNER,
    path: "/bills",
    act: [...billRead, ...approveIn(".bill-photo .photo-out"), scrollTo(".bill-photo .photo-out .photo-draft", 40)],
    also: { name: "1280-bill-photo-approved", w: 1280, h: 800, act: [into(".bill-photo .photo-out .photo-draft", "center")] },
  },
  // An earlier reading of the same bill, still waiting: approving it now goes stale (the books hold the bill).
  { name: "1280-bill-photo-stale", w: 1280, h: 800, as: OWNER, path: "/bills", act: [ready(".bill-photo .photo-waiting .decide .press-primary"), ...approveIn(".bill-photo .photo-waiting"), into(".bill-photo .photo-waiting .stamp", "center")] },
  { name: "1280-bill-photo-already", w: 1280, h: 800, as: OWNER, path: "/bills", act: billRead },
  { name: "390-bill-photo-already", w: 390, h: 844, as: OWNER, path: "/bills", act: [...billRead, scrollTo(".bill-photo .bill-known", 300)] },
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
