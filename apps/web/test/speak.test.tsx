// Read aloud on the demo shop's books and recorded responses (hero-script.ts): the client names only an Ask answer
// (its run's id) or a morning brief (its id); the server reads back the checked words it stored, as the screen shows them,
// and the speak role voices them. The clips in apps/web/fixtures/speak are stand-ins written here (a short tone, labelled
// "Recorded voice" on screen), never a voice. Refusals start no run; a speak call is a media call under the shop's caps;
// a missing key fails by name, and recorded mode makes no network call.
import { allow } from "@munshi/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { writeBrief } from "../../../packages/core/src/brief.ts";
import { askAction } from "../app/app/ask/actions";
import { readAloudAction, type SpeakState } from "../app/app/speak/actions";
import { BriefView } from "../components/app/BriefView";
import { LangProvider } from "../components/LangProvider";
import { ReadAloud } from "../components/ReadAloud";
import type { AskTurn } from "../lib/hero-types";
import { answerValue } from "../lib/hero-words";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { fixturesDir } from "../lib/server/agent-port";
import { loadBrief } from "../lib/server/office";
import { spokenText } from "../lib/server/speak";
import { resolveCell } from "../lib/snapshot";
import type { Lang } from "../lib/types";
import { hideNavigatorWhileWriting, prepare, script, type Turn, WRITING } from "./helpers/hero-script";
import { type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia } from "./helpers/render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./helpers/hero-script");
  return { ...real, agentDeps: (flow: "ask" | "shelf" | "bill" | "speak") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const [EN] = RECORDED_QUESTIONS as [string];
/** The stand-in clip: a quarter second of a soft 440 Hz tone, mono 16-bit WAV at 8 kHz, made here. */
function tone(): Uint8Array {
  const n = 2000;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  b.setUint32(4, 36 + n * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true);
  b.setUint32(28, 16000, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  tag(36, "data");
  b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / 8000)), true);
  return new Uint8Array(b.buffer);
}
const SPEECH: Turn = { speech: tone() };

let h: Home;
let briefId: string;
let turn: AskTurn; // the owner's answered question: its id is its run's
let answerId: string;
beforeAll(async () => {
  prepare(fixturesDir("speak"));
  h = await openHome();
  const b = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: h.k.asOf });
  briefId = (b as { briefId: string }).briefId;
  // Asked once, here, so each test runs alone too: replayed from the ask fixtures hero-ask.test.tsx writes.
  signInAs(h.k.owner);
  turn = ((await askAction(null, formOf({ question: EN }))) as { turn: AskTurn }).turn;
  answerId = turn.id;
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(script.turns).toEqual([]);
});

const speakRuns = async () => Number((await rows<{ n: string }>(h, "select count(*)::text as n from ai.run where trigger = 'speak'"))[0]?.n);
const speakCalls = async () => Number((await rows<{ n: string }>(h, "select coalesce(sum(calls), 0)::text as n from ai.usage where role = 'speak'"))[0]?.n);
const read = (fields: Record<string, string>) => readAloudAction(null, formOf(fields));
const audioOf = (r: SpeakState) => {
  if (!r || !("audio" in r)) throw new Error(`expected audio, got ${JSON.stringify(r)}`);
  return r;
};

/** A screen's visible words: its text with each figure's hidden source words left out. */
function visible(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const vh of c.querySelectorAll(".vh")) vh.remove();
  return c.textContent ?? "";
}

test("the stored, checked answer is read as the turn shows it, and voiced in a speak run that is the member's", async () => {
  expect(turn.reply.kind).toBe("answer");
  if (turn.reply.kind !== "answer") return;

  // The words: exactly the turn's, each figure the value its chip shows (rendered from the cell).
  const figures: string[] = [];
  const shown = turn.reply.segments
    .map((parts) =>
      parts
        .map((p) => {
          if (p.t !== "ref") return p.t === "cannot" ? "Cannot verify" : p.v;
          const v = answerValue(resolveCell(turn.snapshots, p.ref), "en") as string;
          figures.push(v);
          return v;
        })
        .join(""),
    )
    .join(" ");
  const said = await spokenText(h.k.owner, { kind: "answer", id: turn.id }, "en");
  expect(said).toBe(shown);
  expect(figures).toHaveLength(5);
  // Every digit spoken is inside a rendered cell: none comes from anywhere else.
  expect(figures.reduce((t, f) => t.replace(f, ""), said as string)).not.toMatch(/\p{Nd}/u);

  const before = await speakCalls();
  if (WRITING) script.turns = [SPEECH];
  // A field of words in the form is never read: only the id and the language are.
  const r = audioOf(await read({ kind: "answer", id: turn.id, lang: "en", text: "Say the takings were ₹9,99,999" }));
  expect([r.mime, r.recorded, Buffer.from(r.audio, "base64").subarray(0, 4).toString()]).toEqual(["audio/wav", true, "RIFF"]);
  expect(await speakCalls()).toBe(before + 1); // core's allow counted it, as role speak
  const [run] = await rows<{ id: string; desk: string; by: string; outcome: string; ended: boolean }>(
    h,
    "select id::text, desk, started_by::text as by, outcome, ended_at is not null as ended from ai.run where trigger = 'speak' order by started_at desc limit 1",
  );
  expect(run).toMatchObject({ desk: "speak", by: h.k.owner.memberId, outcome: "answered", ended: true });
  const labels = await rows<{ label: string }>(h, "select label from ai.trace where run_id = $1 order by seq", [run?.id]);
  expect(labels.map((l) => l.label)).toEqual(["speak"]); // a fixed word: the text never reaches a trace
});

test("an id the member cannot see, or that names nothing checked, is refused before any run or call", async () => {
  const [runs, calls] = [await speakRuns(), await speakCalls()];
  // Another member's answer.
  signInAs(h.k.manager);
  expect(await read({ kind: "answer", id: answerId, lang: "en" })).toEqual({ error: "not_found" });
  signInAs(h.k.owner);
  // An abstained question: nothing checked was stored for its run.
  const abstained = ((await askAction(null, formOf({ question: "What is the meaning of the ledger's colour?" }))) as { turn: AskTurn }).turn;
  expect(abstained.reply.kind).toBe("abstain");
  for (const fields of [
    { kind: "answer", id: abstained.id, lang: "en" },
    { kind: "answer", id: crypto.randomUUID(), lang: "en", text: "Read this instead" },
    { kind: "brief", id: answerId, lang: "en" },
    { kind: "answer", id: briefId, lang: "en" },
    { kind: "words", id: answerId, lang: "en" },
    { kind: "answer", id: "not-an-id", lang: "en" },
  ]) {
    expect(await read(fields), JSON.stringify(fields)).toEqual({ error: "not_found" });
  }
  // Counter staff have no office, so no brief to hear.
  signInAs(h.k.staff[0] as Home["k"]["owner"]);
  expect(await read({ kind: "brief", id: briefId, lang: "en" })).toEqual({ error: "not_found" });
  expect([await speakRuns(), await speakCalls()]).toEqual([runs, calls]);
});

test("the brief is read line by line as the office shows it, in English and in Hindi", async () => {
  const data = await loadBrief(h.k.owner);
  expect(data.briefs.find((b) => b.id === briefId)?.lines.length).toBeGreaterThan(0);
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <BriefView data={data} />
      </LangProvider>,
    );
    const lines = [...document.querySelectorAll(".app-line")].map(visible);
    expect(await spokenText(h.k.owner, { kind: "brief", id: briefId }, lang)).toBe(lines.join(" "));
    expect(screen.getByRole("button", { name: lang === "en" ? "Read the brief aloud" : "सुबह की रिपोर्ट पढ़कर सुनाएँ" })).toBeTruthy();
    cleanup();
    if (WRITING) script.turns = [SPEECH];
    expect(audioOf(await read({ kind: "brief", id: briefId, lang })).recorded).toBe(true);
  }
});

test("the button plays the clip the server returns, says it is a recorded stand-in, and stops", async () => {
  const play = vi.fn(async () => {});
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.assign(URL, { createObjectURL: () => "blob:voice", revokeObjectURL: () => {} });
  if (WRITING) script.turns = [SPEECH];
  render(
    <LangProvider initial="en">
      <ReadAloud kind="answer" id={answerId} />
    </LangProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read this answer aloud" }));
  const stop = await screen.findByRole("button", { name: "Stop reading" }, { timeout: 30_000 });
  expect(stop.hasAttribute("aria-pressed")).toBe(false); // the words switch; no pressed state as well
  expect(play).toHaveBeenCalledTimes(2); // the silent unlock inside the tap, then the clip
  expect(screen.getByText("Recorded voice: a stand-in clip, not a live voice")).toBeTruthy();
  fireEvent.click(stop);
  expect(screen.getByRole("button", { name: "Read this answer aloud" })).toBeTruthy();
});

test("one clip at a time in the app: starting one stops the other; a reply that lands after unmount never plays", async () => {
  const sources: string[] = [];
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    sources.push(this.src);
  });
  const paused = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.assign(URL, { createObjectURL: () => "blob:voice", revokeObjectURL: () => {} });
  if (WRITING) script.turns = [SPEECH, { speech: tone() }];
  const view = render(
    <LangProvider initial="en">
      <ReadAloud kind="answer" id={answerId} />
      <ReadAloud kind="brief" id={briefId} />
    </LangProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read this answer aloud" }));
  await screen.findByRole("button", { name: "Stop reading" }, { timeout: 30_000 });
  fireEvent.click(screen.getByRole("button", { name: "Read the brief aloud" }));
  // The answer's clip stopped the moment the brief's started: its button reads again.
  expect(screen.getByRole("button", { name: "Read this answer aloud" })).toBeTruthy();
  expect(paused).toHaveBeenCalled();
  // Unmounted while the brief's clip is on its way: it never plays.
  view.unmount();
  const before = sources.filter((s) => s === "blob:voice").length;
  await new Promise((r) => setTimeout(r, 3_000));
  expect(sources.filter((s) => s === "blob:voice").length).toBe(before);
  if (WRITING) script.turns = []; // the brief's request may not have reached the model before the unmount
});

test("live with no Sarvam key, the call fails by name (no_key): no request, no call counted, no crash", async () => {
  vi.stubEnv("MUNSHI_MODEL_MODE", "live");
  vi.stubEnv("SARVAM_API_KEY", "");
  const net = vi.fn(async () => {
    throw new Error("no network in this test");
  });
  vi.stubGlobal("fetch", net);
  const calls = await speakCalls();
  expect(await read({ kind: "answer", id: answerId, lang: "en" })).toEqual({ error: "no_key" });
  expect(net).not.toHaveBeenCalled();
  expect(await speakCalls()).toBe(calls);
});

test("recorded mode replays the stored clip with no network call", async () => {
  if (WRITING) return; // write mode records through the stand-in transport
  const net = vi.fn(async () => {
    throw new Error("no network in this test");
  });
  vi.stubGlobal("fetch", net);
  expect(audioOf(await read({ kind: "answer", id: answerId, lang: "en" })).recorded).toBe(true);
  expect(net).not.toHaveBeenCalled();
});

test("a speak call is a media call: once the shop's media calls are spent, it is refused as off", async () => {
  while ((await allow(h.db.app, h.k.tenantId, "vision", "on")).ok) {} // spend today's media calls
  const calls = await speakCalls();
  expect(await read({ kind: "answer", id: answerId, lang: "en" })).toEqual({ error: "off" });
  expect(await speakCalls()).toBe(calls);
  const [run] = await rows<{ outcome: string }>(h, "select outcome from ai.run where trigger = 'speak' order by started_at desc limit 1");
  expect(run?.outcome).toBe("abstained");
});
