// The guarantee on the hero screens, case by case. An answer's sentence shows only as the agent's checks pass it: a free
// digit, a number in words, or a handle with no cell turns the whole sentence into "Cannot verify", and the model's
// words never carry the marker that exempts the person's own words from the digit check. "Recorded response" shows only
// in recorded mode.
import type { CheckedSegment } from "@munshi/agent";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AskProvider } from "../components/AskProvider";
import { AskView } from "../components/AskView";
import { LangProvider } from "../components/LangProvider";
import { agentDeps, recordedMode } from "../lib/server/agent-port";
import { partsOf } from "../lib/server/hero";
import type { AskTurn } from "../lib/hero-types";
import type { Snapshot } from "../lib/types";
import { unsourced } from "./helpers/render";

const SNAP = "6f1d1d2e-3b0a-4a51-9f3e-2b1c8f6a7d10";
const snapshots: Snapshot[] = [
  { id: SNAP, query: "sales.by_day", readAt: "2026-10-27T05:00:00.000Z", title: { en: "t", hi: "t" }, columns: [], rows: [{ total: { t: "money", minor: 123_400, currency: "INR" } }] },
];
const seg = (text: string, cells: CheckedSegment["cells"] = [{ kind: "money", num: "123400", currency: "INR" }]): CheckedSegment => ({
  text,
  refs: cells.map(() => ({ snapshotId: SNAP, row: 0, col: "total" })),
  cells,
});

describe("an answer's sentence shows only as its checks pass", () => {
  test("a cited figure is a ref to its cell; the words around it are bare text", () => {
    expect(partsOf(seg("The counter took ⟦1⟧ yesterday."), snapshots)).toEqual([
      { t: "text", v: "The counter took " },
      { t: "ref", ref: { label: { en: "Counter sales", hi: "काउंटर बिक्री" }, snapshotId: SNAP, row: 1, col: "total" } },
      { t: "text", v: " yesterday." },
    ]);
  });

  test("a free digit, a number in words, a unit beside a handle or a handle with no cell: the whole sentence is Cannot verify", () => {
    for (const text of ["The counter took ⟦1⟧ from 12 bills.", "The counter took ⟦1⟧ from twelve bills.", "The counter took ₹⟦1⟧.", "It took ⟦1⟧ and ⟦2⟧."]) {
      expect(partsOf(seg(text), snapshots), text).toEqual([{ t: "cannot" }]);
    }
  });

  const savedTurn = (id: string): AskTurn => ({
    id,
    at: "2026-10-27T05:00:00.000Z",
    via: "text",
    words: "How much did the counter take yesterday?",
    reply: {
      kind: "answer",
      desk: "sales",
      segments: [[{ t: "text", v: "The counter took " }, { t: "ref", ref: { label: { en: "Counter sales", hi: "काउंटर बिक्री" }, snapshotId: SNAP, row: 1, col: "total" } }, { t: "text", v: " yesterday." }]],
    },
    snapshots,
    recorded: false,
  });
  const askPage = (who: string) =>
    render(
      <LangProvider initial="en">
        <AskProvider who={who}>
          <AskView data={{ shop: "Shop", member: { name: "Owner", role: "owner" }, recorded: false, questions: [] }} />
        </AskProvider>
      </LangProvider>,
    );
  afterEach(() => sessionStorage.clear());

  test("the model's words render as bare text, never with the person's-words marker; only the person's own words carry it", () => {
    sessionStorage.setItem("munshi_asks:g", JSON.stringify([savedTurn("t1")]));
    const view = askPage("g");
    const line = view.container.querySelector(".turn-line") as HTMLElement;
    expect(line.textContent).toContain("The counter took ");
    expect(line.textContent).toContain(" yesterday.");
    expect(line.querySelector("[data-said]")).toBeNull();
    expect(view.container.querySelector(".turn-words [data-said]")?.textContent).toBe("How much did the counter take yesterday?");
    expect(view.container.querySelector(".recorded-box")).toBeNull(); // no recorded-mode slip when the models are live
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  });

  test("saved turns are parsed on load: a malformed entry is dropped, the good one stays", () => {
    const bad = { ...savedTurn("t2"), reply: { kind: "answer", desk: "sales", segments: [[{ t: "html", v: "<img onerror=x>" }]] } };
    sessionStorage.setItem("munshi_asks:g", JSON.stringify([savedTurn("t1"), bad, "nope", { id: 7 }, { ...savedTurn("t3"), via: "carrier-pigeon" }]));
    const view = askPage("g");
    expect(view.container.querySelectorAll(".turn")).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain("onerror");
    cleanup();
    sessionStorage.setItem("munshi_asks:g", JSON.stringify({ not: "a list" }));
    expect(askPage("g").container.querySelectorAll(".turn")).toHaveLength(0);
    cleanup();
    sessionStorage.setItem("munshi_asks:g", "{broken json");
    expect(askPage("g").container.querySelectorAll(".turn")).toHaveLength(0);
    cleanup();
  });
});

describe("model modes", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("Recorded response shows only in recorded mode (the default); live and record are not recorded", () => {
    expect(recordedMode()).toBe(true);
    vi.stubEnv("MUNSHI_MODEL_MODE", "live");
    expect(recordedMode()).toBe(false);
    vi.stubEnv("MUNSHI_MODEL_MODE", "record");
    expect(recordedMode()).toBe(false);
    vi.stubEnv("MUNSHI_MODEL_MODE", "recorded");
    expect(recordedMode()).toBe(true);
  });

  test("an empty MUNSHI_MODEL_MODE is recorded for the app and for the agent it configures", () => {
    vi.stubEnv("MUNSHI_MODEL_MODE", "");
    expect(recordedMode()).toBe(true);
    expect(agentDeps("ask").mode).toBe("recorded");
    vi.stubEnv("MUNSHI_MODEL_MODE", "live");
    expect(agentDeps("ask").mode).toBe("live");
  });
});

