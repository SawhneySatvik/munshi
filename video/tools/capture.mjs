// Captures the film's phone screens from the running Munshi app (pnpm dev) at a true 390×844 phone viewport (CDP
// device metrics; headless Chrome clamps windows to 500 px) at 3× pixel density, so a 2× punch-in stays sharp.
// Each shot signs in as the owner through the demo sign-in, walks one flow and saves:
//   assets/screens/<name>.png        the viewport as the phone shows it, or with `tall` a long stretch of the page with the
//                                    bottom bar hidden (the film scrolls it under the bar from assets/screens/nav-<lang>.png)
//   assets/js/spots.js               every `spots` selector's box in CSS px of that image, so the film's highlighter, ink circle and taps follow a re-shoot with no retiming
// The approving shots write to the books, so they run after every shot of the same flow; restart pnpm dev to reseed.
// Usage: node tools/capture.mjs <base-url> [only-prefix,...]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = join(ROOT, "..", "packages/agent/fixtures/media");
const OUT = join(ROOT, "assets/screens");
const SPOTS = join(ROOT, "assets/js/spots.js");
const [base = "http://localhost:3100/", onlyArg = ""] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(",") : [];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OWNER = "Rajesh Sharma";
const W = 390, H = 844, DPR = 3;

const js = (v) => JSON.stringify(v);
const until = (expr, ms = 30000) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { if (${expr}) ok(true); else if (Date.now() - t0 > ${ms}) no(new Error("timed out waiting for " + ${js(expr)})); else setTimeout(tick, 100); }; tick(); })`;
const reactReady = (sel) => until(`Object.keys(document.querySelector(${js(sel)}) ?? {}).some((k) => k.startsWith("__reactProps"))`);
const click = (sel) => `document.querySelector(${js(sel)}).click()`;
const setValue = (sel, value) =>
  `(() => { const el = document.querySelector(${js(sel)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`;
const pickOption = (sel, text) =>
  `(() => { const el = document.querySelector(${js(sel)}); const o = [...el.options].find((x) => x.textContent.startsWith(${js(text)})); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
const scrollTo = (sel, offset = 80) => `window.scrollTo(0, document.querySelector(${js(sel)}).getBoundingClientRect().top + scrollY - ${offset}), true`;
const chipFirst = (scope, label) =>
  `[...document.querySelectorAll(${js(`${scope} .pair`)})].find((b) => b.querySelector(".ref").textContent.trim() === ${js(label)}).click()`;
const upload = (sel, file) => ({ upload: [sel, join(MEDIA, file)] });
const wait = (ms) => `new Promise((r) => setTimeout(() => r(true), ${ms}))`;
const hindi = [click('label[for="lang-hi"]'), until(`document.cookie.includes("munshi_lang=hi")`)];

const shelfPick = [reactReady(".shelf-photo input[type=file]"), upload(".shelf-photo input[type=file]", "shelf.png"), until(`document.querySelector(".shelf-photo .photo-prev")`)];
const shelfCount = [...shelfPick, until(`!document.querySelector(".shelf-photo .photo-form .press-primary").disabled`), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out .finds")`)];
const billPick = [
  reactReady(".bill-photo select"),
  pickOption(".bill-photo select", "Gupta Traders"),
  until(`document.querySelector(".bill-photo select").value !== ""`),
  upload(".bill-photo input[type=file]", "bill.png"),
  until(`document.querySelector(".bill-photo .photo-prev")`),
];
const billRead = [...billPick, until(`!document.querySelector(".bill-photo .photo-form .press-primary").disabled`), click(".bill-photo .photo-form .press-primary"), until(`document.querySelector(".bill-photo .photo-out, .bill-photo .ops-error, .bill-photo .bill-known")`)];
const approveIn = (scope) => [click(`${scope} .photo-draft .decide .press-primary`), until(`document.querySelector(${js(`${scope} .photo-draft .stamp`)})`)];
const askVoice = (clip) => [
  reactReady("#recording"),
  upload("#recording", clip),
  until(`!document.querySelector(".recorded-box .field .press").disabled`),
  click(".recorded-box .field .press"),
  until(`document.querySelector(".turn")`),
];
const askTyped = (q) => [reactReady("#question"), setValue("#question", q), click(".composer .press-primary"), until(`document.querySelector(".turn")`)];
const micTap = [reactReady(".nav-mic .mic"), click(".nav-mic .mic"), until(`location.pathname === "/ask" && document.querySelector(".mic.is-listening")`), wait(1500)];

// One entry per sign-in; each step saves one screen. A shelf photo or a bill is read once per seed (a repeat shows "you
// sent this photo already"), so every screen of one flow is a step of one entry. `spots` names the boxes the film draws
// on; `need` lists the ones the film cannot do without, and a missing one fails the run.
const one = (name, path, act, spots = {}, extra = {}) => ({ path, steps: [{ name, act, spots, ...extra }] });
const shelfFinds = {
  out: ".shelf-photo .photo-out",
  boxed: ".shelf-photo .boxed",
  finds: ".shelf-photo .photo-out .finds",
  row1: ".shelf-photo .photo-out .finds > li:nth-child(1)",
  row2: ".shelf-photo .photo-out .finds > li:nth-child(2)",
  chip1: ".shelf-photo .photo-out .finds > li:nth-child(1) .pair",
  amt1: ".shelf-photo .photo-out .finds > li:nth-child(1) .pair:nth-of-type(1) .amt",
  amt2: ".shelf-photo .photo-out .finds > li:nth-child(1) .pair:nth-of-type(2) .amt",
  aside: ".shelf-photo .photo-aside",
  draft: ".shelf-photo .photo-out .photo-draft",
  approve: ".shelf-photo .photo-out .photo-draft .decide .press-primary",
};
const SHOTS = [
  one("nav-en", "/", [], { nav: ".nav" }),
  one("home", "/", [], { shop: ".shop h1", draft: ".col-b .pending" }),
  one("stock-glucose", "/stock", [reactReady(".every input[type=search]"), setValue(".every input[type=search]", "Glucose"), wait(300), scrollTo(".every", 12)], { row: ".every .finds > li:first-child", chip: ".every .finds > li:first-child .pair" }, { need: ["row", "chip"] }),
  one("shelf-empty", "/stock", [scrollTo(".shelf-photo", 20)], { pick: ".shelf-photo .photo-pick" }),
  // The shelf count off the drawn shelf photo (the recorded SAM and Spark turns), its source drawer, then the owner's tap.
  // The tap writes a count to the books, so this entry comes after every other stock screen.
  {
    path: "/stock",
    steps: [
      { name: "shelf-chosen", act: [...shelfPick, scrollTo(".shelf-photo", 20)], spots: { count: ".shelf-photo .photo-form .press-primary", prev: ".shelf-photo .photo-prev" }, need: ["count"] },
      { name: "shelf-counted", tall: { from: ".shelf-photo" }, act: [until(`!document.querySelector(".shelf-photo .photo-form .press-primary").disabled`), click(".shelf-photo .photo-form .press-primary"), until(`document.querySelector(".shelf-photo .photo-out .finds")`)], spots: shelfFinds, need: ["boxed", "row1", "row2", "chip1", "draft", "approve"] },
      { name: "shelf-source", act: [scrollTo(".shelf-photo .photo-out .finds", 120), chipFirst(".shelf-photo .photo-out .finds", "Stock ledger"), until(`document.querySelector("dialog:modal")`), wait(500)], spots: { dialog: "dialog:modal", what: "dialog:modal .src-what", table: "dialog:modal .ledger-scroll", cell: "dialog:modal td[aria-current]" }, need: ["table", "cell"] },
      { name: "shelf-approved", tall: { from: ".shelf-photo" }, act: [`document.querySelector("dialog:modal").close(), true`, wait(300), ...approveIn(".shelf-photo .photo-out")], spots: { draft: ".shelf-photo .photo-out .photo-draft", stamp: ".shelf-photo .photo-out .photo-draft .stamp", done: ".shelf-photo .photo-out .photo-draft .done" }, need: ["draft", "stamp", "done"] },
    ],
  },
  // The mic: a tap starts listening (Chrome's fake microphone, a tone no recording matches) and opens Ask.
  one("mic-listening", "/stock", micTap, { mic: ".nav-mic .mic", listen: ".composer .is-listening", composer: ".composer" }, { need: ["mic", "listen"] }),
  // Ask in Hindi by voice (the committed clip, its recorded transcript and answer), then the drawer behind one chip.
  {
    path: "/ask",
    steps: [
      { name: "ask-voice-hi", act: [...hindi, ...askVoice("ask-hi.wav"), scrollTo(".turn", 120)], spots: { turn: ".turn", said: ".turn .turn-said", reply: ".turn .turn-reply", chip2: ".turn .turn-reply .pair:nth-of-type(2)", amt2: ".turn .turn-reply .pair:nth-of-type(2) .amt" }, need: ["said", "reply", "chip2", "amt2"] },
      { name: "ask-source-hi", act: [click(".turn .turn-reply .pair:nth-of-type(2)"), until(`document.querySelector("dialog:modal")`), wait(500)], spots: { dialog: "dialog:modal", what: "dialog:modal .src-what", table: "dialog:modal .ledger-scroll", cell: "dialog:modal td[aria-current]" }, need: ["table", "cell"] },
    ],
  },
  one("nav-hi", "/", [...hindi], { nav: ".nav" }),
  one("ask-credit", "/ask", [`[...document.querySelectorAll(".press-try")].find((b) => b.getAttribute("aria-label").startsWith("Ask: Who")).click()`, until(`document.querySelector(".turn")`), scrollTo(".turn", 120)], { said: ".turn .turn-said", reply: ".turn .turn-reply", line: ".turn .turn-line", amt1: ".turn .turn-reply .pair:nth-of-type(1) .amt" }, { need: ["said", "reply", "line"] }),
  one("ask-cannot", "/ask", [...askTyped("What is the weather in Delhi today?"), scrollTo(".turn", 120)], { said: ".turn .turn-said", reply: ".turn .turn-reply", cv: ".turn .unverified" }, { need: ["said", "cv"] }),
  // The bill from Gupta Traders (simulated): read, the price-rise flag, the draft, the tap. Captured last, once the bill
  // fixture flags the price rise. Recording the bill writes to the books.
  {
    path: "/bills",
    steps: [
      { name: "bill-chosen", act: [...billPick, scrollTo(".bill-photo", 20)], spots: { prev: ".bill-photo .photo-prev", read: ".bill-photo .photo-form .press-primary" }, need: ["read"] },
      {
        name: "bill-read",
        tall: { from: ".bill-photo" },
        act: [until(`!document.querySelector(".bill-photo .photo-form .press-primary").disabled`), click(".bill-photo .photo-form .press-primary"), until(`document.querySelector(".bill-photo .photo-out, .bill-photo .ops-error, .bill-photo .bill-known")`)],
        spots: { out: ".bill-photo .photo-out", boxed: ".bill-photo .boxed", card: ".bill-photo .bk-card", note: ".bill-photo .bk-card-note", butter: ".bill-photo .bill-read tbody tr:nth-child(2)", lines: ".bill-photo .bill-read", rise: process.env.RISE ?? ".bill-photo .bill-read .bk-rise", draft: ".bill-photo .photo-out .photo-draft", approve: ".bill-photo .photo-out .photo-draft .decide .press-primary" },
        need: ["lines", "draft", "approve", ...(process.env.RISE ? ["rise"] : [])],
      },
      { name: "bill-approved", tall: { from: ".bill-photo" }, act: approveIn(".bill-photo .photo-out"), spots: { draft: ".bill-photo .photo-out .photo-draft", stamp: ".bill-photo .photo-out .photo-draft .stamp", done: ".bill-photo .photo-out .photo-draft .done" }, need: ["stamp", "done"] },
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(dirname(SPOTS), { recursive: true });
  const spots = existsSync(SPOTS) ? JSON.parse(readFileSync(SPOTS, "utf8").replace(/^[^{]*/, "").replace(/;\s*$/, "")) : {};
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "munshi-film-"));
  const chrome = spawn(
    CHROME,
    ["--headless", "--disable-gpu", "--hide-scrollbars", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let failed = false;
  try {
    let targets = [];
    for (let i = 0; i < 80 && !targets.length; i++) {
      await sleep(150);
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    }
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) return pending.get(m.id)(m), pending.delete(m.id);
      for (const w of waiters.filter((x) => x.method === m.method)) waiters.splice(waiters.indexOf(w), 1), w.resolve(m);
    });
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error(`${expression.slice(0, 140)}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result?.result?.value;
    };
    const debug = (m) => process.env.DEBUG && console.log(`  · ${m.slice(0, 120)}`);
    const act = async (a) => {
      debug(typeof a === "string" ? a : `upload ${a.upload[1]}`);
      if (typeof a === "string") return evaluate(a);
      const [selector, file] = a.upload;
      const { root } = (await send("DOM.getDocument", { depth: 0 })).result;
      const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result;
      if (!nodeId) throw new Error(`no ${selector} to upload into`);
      await send("DOM.setFileInputFiles", { nodeId, files: [file] });
    };
    const load = async (url) => {
      debug(`load ${url}`);
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
      await evaluate("document.fonts.ready.then(() => true)");
      await evaluate(reactReady(".lang input"));
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("DOM.enable");
    for (const shot of SHOTS.filter((s) => !only.length || s.steps.some((st) => only.some((p) => st.name.startsWith(p))))) {
      try {
        await send("Network.clearBrowserCookies");
        await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
        await load(`${base}sign-in`);
        await evaluate("sessionStorage.clear(), true");
        await evaluate(`[...document.querySelectorAll(".people .press")].find(b => b.querySelector("[data-name]").textContent === ${js(OWNER)}).click()`);
        await evaluate(until(`location.pathname === "/" && document.querySelector("main")`));
        await load(`${base}${shot.path.slice(1)}`);
        for (const step of shot.steps) {
          for (const a of step.act) await act(a);
          await sleep(700);
          // A tall step is the page from `tall.from` (less `tall.before` px) down, at most `tall.height` px, with the bottom
          // bar hidden: Chrome cannot capture a whole 12,000 px page at 3× (its texture limit is 16,384 px).
          let clip;
          let y0 = 0;
          if (step.tall) {
            await evaluate(`(() => { const s = document.createElement("style"); s.id = "film-tall"; s.textContent = ".nav, .nav-mic { display: none !important; }"; document.head.append(s); window.scrollTo(0, 0); return true; })()`);
            await sleep(300);
            const [top, total] = await evaluate(`[document.querySelector(${js(step.tall.from)}).getBoundingClientRect().top + scrollY, document.documentElement.scrollHeight]`);
            y0 = Math.max(0, Math.round(top - (step.tall.before ?? 20)));
            clip = { x: 0, y: y0, width: W, height: Math.min(step.tall.height ?? 3600, total - y0), scale: 1 };
          }
          const boxes = await evaluate(`(() => { const out = {}; for (const [k, sel] of Object.entries(${js(step.spots)})) { const el = document.querySelector(sel); if (!el) continue; const b = el.getBoundingClientRect(); const dy = ${step.tall ? `scrollY - ${y0}` : "0"}; out[k] = { x: Math.round(b.left), y: Math.round(b.top + dy), w: Math.round(b.width), h: Math.round(b.height) }; } out._page = { w: innerWidth, h: ${clip ? clip.height : "innerHeight"} }; return out; })()`);
          debug(`capture ${JSON.stringify(clip ?? "viewport")}`);
          const png = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
          if (!png.result) throw new Error(JSON.stringify(png.error));
          if (step.tall) await evaluate(`document.getElementById("film-tall").remove(), true`);
          writeFileSync(join(OUT, `${step.name}.png`), Buffer.from(png.result.data, "base64"));
          spots[step.name] = boxes;
          const missing = Object.keys(step.spots).filter((k) => !boxes[k]);
          const needed = (step.need ?? []).filter((k) => !boxes[k]);
          if (needed.length) failed = true;
          console.log(`${step.name}.png ${boxes._page.w}x${boxes._page.h}${missing.length ? `  (no box for: ${missing.join(", ")})` : ""}${needed.length ? "  NEEDED BY THE FILM" : ""}`);
        }
      } catch (err) {
        failed = true;
        console.log(`${shot.steps.map((st) => st.name).join(", ")} FAILED: ${err.message}`);
      }
    }
    writeFileSync(SPOTS, `// Written by tools/capture.mjs: each captured screen's boxes in CSS px of its image. Never edit by hand.\nwindow.SPOTS = ${JSON.stringify(spots, null, 1)};\n`);
    await send("Browser.close");
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (failed) process.exitCode = 1;
}

await main();
