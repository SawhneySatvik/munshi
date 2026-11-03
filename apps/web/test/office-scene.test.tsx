// The office scene draws the app's own words and nothing else: a line an agent says is the text the page passed in,
// with the row it comes from; a line carrying a figure says "Cannot verify"; none of the design file's sample shops,
// figures or chat ships in the scene's source or its markup. The room follows the shop's kind until the owner picks
// another, and every room, look and camera draws the seven agents with their labels.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { IsometricOffice } from "../components/office/IsometricOffice";
import { castAgents, OfficeScene } from "../components/office/OfficeScene";
import { PRESETS, STYLES, VIEWS } from "../components/office/presets";
import type { Agent } from "../components/office/types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
