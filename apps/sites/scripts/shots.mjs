// Screenshots of a running site build, through headless Chrome's DevTools protocol, with layout checks printed per shot:
// horizontal overflow, tap targets under 48px, inputs under 16px, and the faces that actually loaded.
// Usage: node scripts/shots.mjs <base-url> <out-dir> <shots.json | name,...>
//   Each shot: { name, path, w, h, full?, act?: [js | "wait:<expr>"], scroll?: "selector", faces? }. A phone (w < 600)
//   renders at 2x.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, out, spec] = process.argv.slice(2);
if (!base || !out || !spec) throw new Error("usage: shots.mjs <base-url> <out-dir> <shots.json>");
const SHOTS = JSON.parse(readFileSync(spec, "utf8"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CHECKS = `(() => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth > innerWidth ? doc.scrollWidth - innerWidth : 0;
  const small = [];
  for (const el of document.querySelectorAll("a[href], button, summary, input, select, textarea, label")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.matches("label") && !el.querySelector("input")) continue;
    if (el.closest(".footer-base span, p") && el.matches("a") && getComputedStyle(el).display === "inline") continue;
    if (el.matches("input[type=checkbox], input[type=radio]") || el.closest(".visually-hidden")) continue;
    if (r.height < 48 || r.width < 48) small.push((el.className || el.tagName) + " '" + (el.textContent || el.value || "").trim().slice(0, 24) + "' " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  const tinyInputs = [...document.querySelectorAll("input:not([type=radio]):not([type=checkbox]), select, textarea")].filter((el) => !el.closest(".visually-hidden") && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name || el.id);
  const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !el.closest(".marquee, .chip-nav ul"); }).slice(0, 5).map((el) => el.tagName + "." + el.className);
  const faces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.style + " " + f.weight);
  return { overflow, wide, small: small.slice(0, 12), tinyInputs, faces: [...new Set(faces)] };
})()`;

const until = (expr, ms = 15000) =>
  `new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { let v = false; try { v = ${expr}; } catch {} if (v) ok(true); else if (Date.now() - t0 > ${ms}) no(new Error("timed out: " + ${JSON.stringify(expr)})); else setTimeout(tick, 80); }; tick(); })`;

async function main() {
  mkdirSync(out, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "sites-shots-"));
  const chrome = spawn(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
      } catch {}
    }
    if (!page) throw new Error("Chrome did not start");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { ok, no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) {
        for (const w of waiters.splice(0)) w(m);
        if (m.method === "Runtime.exceptionThrown") console.log("  page error:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
      }
    });
    const send = (method, params = {}) =>
      new Promise((ok, no) => {
        const i = ++id;
        pending.set(i, { ok, no });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");

    for (const shot of SHOTS) {
      const phone = shot.w < 600;
      await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
      // Every shot starts with an empty tray: clear the origin's session storage from the page left by the last shot.
      await evaluate("try { sessionStorage.clear() } catch {} true");
      await send("Page.navigate", { url: new URL(shot.path, base).href });
      await evaluate(until(`document.readyState === "complete"`));
      await evaluate("document.fonts.ready.then(() => true)");
      // An action is JS to run, or "wait:<expr>" to wait until the expression holds (hydration, a sent state).
      for (const a of shot.act ?? []) await evaluate(a.startsWith("wait:") ? until(a.slice(5)) : a);
      if (shot.scroll) await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(shot.scroll)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 16); return true; })()`);
      else await evaluate("window.scrollTo(0, 0)");
      await new Promise((r) => setTimeout(r, 350));
      const checks = await evaluate(CHECKS);
      const shotPng = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, `${shot.name}.png`), Buffer.from(shotPng.data, "base64"));
      if (shot.full) {
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        const full = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: shot.w, height: Math.ceil(cssContentSize.height), scale: 1 },
        });
        writeFileSync(join(out, `${shot.name}-full.png`), Buffer.from(full.data, "base64"));
      }
      const flags = [checks.overflow ? `OVERFLOW ${checks.overflow}px` : "", checks.wide.length ? `WIDE ${checks.wide.join(" ")}` : "", checks.small.length ? `SMALL ${checks.small.join("; ")}` : "", checks.tinyInputs.length ? `TINY-INPUT ${checks.tinyInputs.join(",")}` : ""].filter(Boolean);
      console.log(`${shot.name}: ${flags.length ? flags.join(" | ") : "ok"}`);
      if (shot.faces) console.log(`  faces: ${checks.faces.join(", ")}`);
    }
    await send("Browser.close").catch(() => {});
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    // Chrome's helpers can still be writing the profile; a leftover temp folder is harmless.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

await main();
