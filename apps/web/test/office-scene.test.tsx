// The office scene draws the app's own words and nothing else: a line an agent says is the text the page passed in,
// with the row it comes from; a line carrying a figure says "Cannot verify"; none of the design file's sample shops,
// figures or chat ships in the scene's source or its markup. The room follows the shop's kind until the owner picks
// another, and every room, look and camera draws the seven agents with their labels. Each agent's bubble and the tray's
// are fixed words picked from what the page read; under reduced motion nothing in the scene moves.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MODEL_ALIASES } from "@munshi/ai";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { doingKey } from "../components/office/doing";
import { IsometricOffice } from "../components/office/IsometricOffice";
import { castAgents, OfficeScene } from "../components/office/OfficeScene";
import { MODEL_NAMES, modelName, OFFICE_WORDS, PRESETS, STYLES, VIEWS } from "../components/office/presets";
import type { Agent } from "../components/office/types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const OFFICE = path.join(import.meta.dirname, "..", "components", "office");
// The design file's sample shops, their figures and its demo chat: none of it is the app's.
const SAMPLE = [
  /Bansal/i,
  /Johari/i,
  /Prana/i,
  /Malabar/i,
  /Mithai/i,
  /Chandni/i,
  /Tata Tea/i,
  /\bAtta\b/i,
  /Kaju/i,
  /day book/i,
  /cardamom/i,
  /argan/i,
  /festival credit rule/i,
  /INITIAL_AGENTS|SAMPLE_THREADS|briefSummary|tagline/,
  /₹/,
];
const samplesIn = (text: string) => SAMPLE.filter((re) => re.test(text)).map(String);

const noop = () => {};
const scene = (agents: Agent[], extra: Partial<Parameters<typeof IsometricOffice>[0]> = {}) =>
  render(
    <IsometricOffice
      chrome={false}
      shopName="Test shop"
      localTime="2026-11-02T10:30:00+05:30"
      agents={agents}
      trayCount={0}
      events={[]}
      sample={false}
      onSelectAgent={noop}
      onOpenTray={noop}
      onOpenBrief={noop}
      {...extra}
    />,
  );

// Lines the test owns: words no design file carries, each with the row it comes from.
const OWN = { text: "Shelf count matches stock", source: { label: "Stock on hand" } };
const withLines = (): Agent[] =>
  castAgents("en", { tally: "drafting", ledger: "thinking" }).map((a) =>
    a.id === "tally" ? { ...a, line: OWN } : a.id === "ledger" ? { ...a, line: { text: "A payout waits for you", source: { label: "Settlements" } } } : a,
  );

test("the scene draws the app's own lines with their sources, and no sample text", () => {
  const { container } = scene(withLines());
  const tally = container.querySelector('[data-line="tally"]') as SVGElement;
  expect(tally.textContent).toContain(OWN.text);
  expect(tally.textContent).toContain(OWN.source.label);
  expect((container.querySelector('[data-line="ledger"]') as SVGElement).textContent).toContain("A payout waits for you");
  // Only the agents given a line say anything.
  expect([...container.querySelectorAll("[data-line]")].map((el) => el.getAttribute("data-line"))).toEqual(["tally", "ledger"]);
  // The line and its source reach a screen reader with the agent.
  expect(container.querySelector('[aria-label^="Tally,"]')?.getAttribute("aria-label")).toBe(
    `Tally, stock, drafting. ${OWN.text} (${OWN.source.label}). Talk to Tally`,
  );
  expect(samplesIn(container.innerHTML)).toEqual([]);
  // From the owner's desk the same words, the same labels.
  cleanup();
  const pov = scene(withLines(), { view: "pov_owner" });
  expect(pov.container.textContent).toContain(OWN.source.label);
  expect(pov.container.querySelector('[aria-label^="Tally,"]')?.getAttribute("aria-label")).toContain(OWN.text);
  expect(samplesIn(pov.container.innerHTML)).toEqual([]);
});

test("a line with a figure says Cannot verify; the scene shows no digit of its own", () => {
  const agents = castAgents("en", { dash: "waiting" }).map((a) => (a.id === "dash" ? { ...a, line: { text: "Draft for 1240 in your tray", source: { label: "Drafts" } } } : a));
  for (const view of VIEWS) {
    const { container } = scene(agents, { view });
    const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const digits: string[] = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[0-9०-९]/.test(n.textContent ?? "")) digits.push(n.textContent ?? "");
    expect(digits).toEqual([]);
    expect(container.textContent).toContain("Cannot verify");
    expect(container.querySelector('[aria-label^="Dash,"]')?.getAttribute("aria-label")).toBe("Dash, fixes, waiting. Cannot verify (Drafts). Talk to Dash");
    cleanup();
  }
});

test("the office's source carries none of the design file's sample shops, figures or chat", () => {
  const files = readdirSync(OFFICE).filter((f) => /\.(tsx?|css)$/.test(f));
  expect(files).toContain("IsometricOffice.tsx");
  const found = files.flatMap((f) => samplesIn(readFileSync(path.join(OFFICE, f), "utf8")).map((s) => `${f}: ${s}`));
  expect(found).toEqual([]);
  // And as loaded: the scene with its controls (every room, look and camera named), in both languages.
  for (const lang of ["en", "hi"] as const) {
    const { container } = render(<OfficeScene shop="Test shop" lang={lang} at="2026-11-02T10:30:00+05:30" briefWritten sample={false} briefId="brief-h" />);
    expect(container.querySelectorAll("option").length).toBe(PRESETS.length + STYLES.length);
    expect(samplesIn(container.innerHTML)).toEqual([]);
    cleanup();
  }
});

test("every room, look and camera draws the seven agents, each a labelled button", () => {
  for (const environmentPreset of PRESETS) {
    for (const agentStyle of STYLES) {
      for (const view of VIEWS) {
        const { container } = scene(castAgents("en"), { environmentPreset, agentStyle, view });
        const root = container.querySelector(".munshi-office-root") as HTMLElement;
        expect([root.dataset.env, root.dataset.agentStyle, root.dataset.view]).toEqual([environmentPreset, agentStyle, view]);
        const named = within(root)
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label") ?? "")
          .filter((l) => /\. Talk to \w+$/.test(l));
        expect(named).toHaveLength(7);
        cleanup();
      }
    }
  }
});

test("the room follows the shop's kind until the owner picks one; the pick is kept in this browser only", () => {
  const office = (kind: string | undefined) => (
    <OfficeScene shop="Test shop" lang="en" at="2026-11-02T10:30:00+05:30" briefWritten={false} sample={false} briefId="brief-h" kind={kind} />
  );
  const env = (c: HTMLElement) => (c.querySelector(".munshi-office-root") as HTMLElement).dataset.env;
  expect(env(render(office("salon")).container)).toBe("salon");
  cleanup();
  expect(env(render(office("apparel")).container)).toBe("bazaar");
  cleanup();
  const { container, getByLabelText, getByRole } = render(office(undefined));
  expect(env(container)).toBe("kirana");
  act(() => {
    fireEvent.change(getByLabelText("Room"), { target: { value: "monsoon" } });
    fireEvent.click(getByRole("button", { name: "From your desk" }));
  });
  expect(env(container)).toBe("monsoon");
  expect((container.querySelector(".munshi-office-root") as HTMLElement).dataset.view).toBe("pov_owner");
  expect(JSON.parse(window.localStorage.getItem("munshi.office.view") ?? "{}")).toEqual({ preset: "monsoon", view: "pov_owner" });
  cleanup();
  // A salon's office opens in the room the owner picked; a stored value this version does not know is ignored.
  expect(env(render(office("salon")).container)).toBe("monsoon");
  cleanup();
  window.localStorage.setItem("munshi.office.view", JSON.stringify({ preset: "moon", style: "glass" }));
  const later = render(office("salon")).container.querySelector(".munshi-office-root") as HTMLElement;
  expect([later.dataset.env, later.dataset.agentStyle]).toEqual(["salon", "glass"]);
});

const bubbles = (c: HTMLElement) => Object.fromEntries([...c.querySelectorAll("[data-doing]")].map((g) => [g.getAttribute("data-doing"), g.textContent]));
const office = (extra: Partial<Parameters<typeof OfficeScene>[0]> = {}) => (
  <OfficeScene shop="Test shop" lang="en" at="2026-11-02T10:30:00+05:30" briefWritten={false} sample={false} briefId="brief-h" {...extra} />
);

test("a bubble says what the rows say: a run's state and how it ended, and Idle where the page read nothing", () => {
  const { container } = render(
    office({
      states: { munshi: "watching", tally: "waiting", ledger: "idle", dash: "thinking", echo: "blocked", bloom: "done" },
      doing: { ledger: doingKey("ledger", "idle", { outcome: "abstained", trigger: "question" }), dash: doingKey("dash", "thinking", { outcome: null, trigger: "photo" }) },
    }),
  );
  expect(bubbles(container)).toEqual({
    munshi: "Watching the shop",
    tally: "Draft in your tray",
    ledger: "Abstained",
    dash: "Reading a photo",
    echo: "Run failed",
    bloom: "Draft approved",
    keeper: "Idle",
  });
  cleanup();
  // Nothing read: Munshi's default pose is not activity. A written brief is the one thing the page knows without a run.
  expect(bubbles(render(office()).container).munshi).toBe("Idle");
  cleanup();
  expect(bubbles(render(office({ briefWritten: true })).container).munshi).toBe("Brief written");
  cleanup();
  // In Hindi, the names as they are.
  const hi = render(office({ lang: "hi", states: { tally: "waiting" } })).container;
  expect(bubbles(hi).tally).toBe(OFFICE_WORDS.hi.doing.tray);
  expect(hi.textContent).toContain("Tally");
});

test("a run's outcome names only itself: an open run is never read as finished, a run that ended never as running", () => {
  expect(doingKey("tally", "thinking", { outcome: null, trigger: "recipe" })).toBe("fix");
  expect(doingKey("tally", "thinking", { outcome: null, trigger: "brief" })).toBe("reading");
  expect(doingKey("tally", "watching")).toBe("watchStock");
  expect(doingKey("bloom", "watching")).toBe("watchShop");
  expect(doingKey("keeper", "drafting")).toBe("note");
  expect(doingKey("ledger", "idle", { outcome: "proposed", trigger: "recipe" })).toBe("closed");
  expect(doingKey("ledger", "idle", { outcome: "answered", trigger: "question" })).toBe("answered");
  expect(doingKey("ledger", "idle", { outcome: "something new", trigger: "question" })).toBe("idle");
  expect(doingKey("ledger", undefined, null)).toBe("idle");
});

test("the bubbles' words carry no figure, the English no Devanagari; a figure handed to a bubble says Cannot verify; a line wins", () => {
  for (const lang of ["en", "hi"] as const) {
    const w = OFFICE_WORDS[lang];
    for (const word of [...Object.values(w.doing), w.trayWaiting, w.trayClear]) {
      expect(word, word).not.toMatch(/[0-9\u0966-\u096F\u20B9]/);
      if (lang === "en") expect(word, word).not.toMatch(/[\u0900-\u097F]/);
    }
  }
  expect(Object.keys(OFFICE_WORDS.hi.doing)).toEqual(Object.keys(OFFICE_WORDS.en.doing));
  const agents = castAgents("en").map((a) => (a.id === "dash" ? { ...a, doing: "Drafted 3 fixes" } : a.id === "tally" ? { ...a, doing: "Watching stock", line: OWN } : a));
  const { container } = scene(agents);
  expect(bubbles(container)).toEqual({ dash: "Cannot verify" });
  expect((container.querySelector('[data-line="tally"]') as SVGElement).textContent).toContain(OWN.text);
});

test("the tray says a draft waits only when the books say so, and nothing when the page does not know; it shows no count", () => {
  const tray = (c: HTMLElement) => c.querySelector("[data-tray]");
  const waiting = render(office({ trayWaiting: true })).container;
  expect(tray(waiting)?.getAttribute("data-tray")).toBe("waiting");
  expect(tray(waiting)?.textContent).toBe("Waiting for you");
  expect(waiting.textContent).not.toMatch(/[0-9]/);
  cleanup();
  const clear = render(office({ trayWaiting: false })).container;
  expect(tray(clear)?.getAttribute("data-tray")).toBe("clear");
  expect(tray(clear)?.textContent).toBe("Nothing waiting");
  cleanup();
  expect(tray(render(office()).container)).toBeNull();
});

const reducedMotion = (matches: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query.includes("reduce"), addEventListener: () => {}, removeEventListener: () => {} }));

test("under reduced motion the scene is still: an event plays no effect but is told to a screen reader, and a walk is already over", () => {
  const events = [{ id: "e1", kind: "approved" as const, agent: "dash" as const }];
  const walking = castAgents("en", { dash: "walking" }).map((a) => (a.id === "dash" ? { ...a, walkTo: "tray" as const } : a));
  const raf = vi.fn(() => 0);
  vi.stubGlobal("requestAnimationFrame", raf);

  reducedMotion(true);
  const still = scene(walking, { events }).container;
  expect((still.querySelector(".munshi-office-root") as HTMLElement).dataset.motion).toBe("still");
  expect(still.textContent).not.toContain(OFFICE_WORDS.en.approved);
  expect(still.textContent).toContain(OFFICE_WORDS.en.said.approved("Dash"));
  expect(raf).not.toHaveBeenCalled();
  cleanup();

  // With motion on the same props do play, so the checks above can fail.
  reducedMotion(false);
  const live = scene(walking, { events }).container;
  expect((live.querySelector(".munshi-office-root") as HTMLElement).dataset.motion).toBe("live");
  expect(live.textContent).toContain(OFFICE_WORDS.en.approved);
  expect(raf).toHaveBeenCalled();
});

test("reduced motion turns off every animation and transition in the scene's styles", () => {
  const css = readFileSync(path.join(OFFICE, "scene.css"), "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(block).toContain("animation: none !important");
  expect(block).toContain("transition: none !important");
  // No animation lives outside the stylesheet, where that rule could not reach it.
  for (const f of readdirSync(OFFICE).filter((x) => x.endsWith(".tsx"))) {
    const source = readFileSync(path.join(OFFICE, f), "utf8");
    expect(source, f).not.toContain("<animate");
  }
});

test("every model the build serves has a name for the run log; one it no longer serves shows as itself", () => {
  expect(Object.keys(MODEL_NAMES).sort()).toEqual(Object.keys(MODEL_ALIASES).sort());
  expect(modelName("muse-spark")).toBe("Muse Spark");
  expect(modelName("retired-model")).toBe("retired-model");
});
