// Ask on the demo shop's books, through the screen and the ask action, on recorded model responses (hero-script.ts).
// An answer's figures are cells the run minted, each a chip to its row; the person's words show as theirs and never
// reach a trace; a question with no recorded response, or the second edition (no models set up), says "Cannot verify"
// and why, never an error. Also the WAV the mic sends (the bytes the voice model's check reads) and the mic's refusals.
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { askAction } from "../app/ask/actions";
import { AskProvider } from "../components/AskProvider";
import { AskView } from "../components/AskView";
import { LangProvider } from "../components/LangProvider";
import { MicButton } from "../components/MicButton";
import type { AskTurn } from "../lib/hero-types";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { fixturesDir } from "../lib/server/agent-port";
import { resolveCell } from "../lib/snapshot";
import type { Lang } from "../lib/types";
import { encodeWav, resample } from "../lib/wav";
import { type Home, openHome, rows, signInAs } from "./home-db";
import { hideNavigatorWhileWriting, prepare, script, type Turn, WRITING } from "./hero-script";
import { formOf } from "./ops-db";
import { fakeMatchMedia, unsourced } from "./render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: "ask" | "shelf" | "bill") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const YESTERDAY = "2026-10-26";
const [EN, HI, CREDIT] = RECORDED_QUESTIONS as [string, string, string];
const media = (name: string) => new Uint8Array(readFileSync(new URL(`../../../packages/agent/fixtures/media/${name}`, import.meta.url)));

// The model turns for each recorded question: the router's desk, the desk's read, its note, the narrated answer.
const takings = (answer: string): Turn[] => [
  { json: { desk: "sales" } },
  { tools: [{ name: "sales_by_day", args: { from: YESTERDAY, to: YESTERDAY } }] },
  { text: "Read 1, row 0 is yesterday." },
  { json: { segments: [{ text: answer, refs: ["day", "total", "bills", "cash", "upi"].map((col) => ({ read: 1, row: 0, col })) }] } },
];
const TURNS: Record<string, Turn[]> = {
  [EN]: takings("On ⟦1⟧ the counter took ⟦2⟧ across ⟦3⟧ bills: ⟦4⟧ in cash and ⟦5⟧ by UPI."),
  [HI]: takings("⟦1⟧ को काउंटर की कुल बिक्री ⟦2⟧ रही, ⟦3⟧ बिलों में: नक़द ⟦4⟧ और UPI से ⟦5⟧।"),
  [CREDIT]: [
    { json: { desk: "credit" } },
    { tools: [{ name: "credit_balances", args: {} }] },
    { text: "Read 1, row 0 is the most overdue customer." },
    { json: { segments: [{ text: "⟦1⟧ owes ⟦2⟧, and ⟦3⟧ of it is past due since ⟦4⟧.", refs: ["customer", "balance", "overdue", "oldest_due_on"].map((col) => ({ read: 1, row: 0, col })) }] } },
  ],
};
const CLIPS = { "ask-en.wav": EN, "ask-hi.wav": HI } as const;

let h: Home;
beforeAll(async () => {
  prepare(fixturesDir("ask"));
  h = await openHome();
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  sessionStorage.clear();
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]); // write mode: every turn written was asked for
});

const view = (lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <AskProvider who={h.k.owner.memberId}>
        <AskView data={{ shop: "Sharma General Store", member: { name: "Rajesh Sharma", role: "owner" }, recorded: true, questions: RECORDED_QUESTIONS }} />
      </AskProvider>
    </LangProvider>,
  );
const turnsOf = async (): Promise<HTMLElement[]> => {
  await screen.findAllByRole("article", {}, { timeout: 30_000 });
  return screen.getAllByRole("article");
};

/** Yesterday's counter takings straight from the sales table: the independent figure an answer must match. */
async function yesterday() {
  const [r] = await rows<{ bills: string; total: string }>(
    h,
    `select count(*)::text as bills, coalesce(sum(total_minor), 0)::text as total from books.sale s
      where (s.sold_at at time zone 'Asia/Kolkata')::date = $1 and s.reverses_id is null
        and not exists (select 1 from books.sale r where r.reverses_id = s.id)`,
    [YESTERDAY],
  );
  return { bills: Number(r?.bills), total: Number(r?.total) };
}

describe("asking by text", () => {
  beforeEach(() => hideNavigatorWhileWriting(vi.stubGlobal));
  test("a typed question is answered from cells its run minted: each figure a chip to its row, equal to the books", async () => {
    view();
    if (WRITING) script.turns = [...(TURNS[EN] as Turn[])];
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: EN } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const [card] = await turnsOf();
    const turn = within(card as HTMLElement);
    expect(turn.getByText("You asked")).toBeTruthy();
    expect(turn.getByText(EN).getAttribute("data-said")).toBe("");
    expect(turn.getByText("Recorded response")).toBeTruthy();
    expect(turn.getByText("Sales & money desk")).toBeTruthy();
    const chips = turn.getAllByRole("button", { name: /source: Counter sales/ });
    expect(chips).toHaveLength(5);
    const books = await yesterday();
    expect(books.bills).toBeGreaterThan(0);
    const money = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: n % 100 ? 2 : 0 }).format(n / 100)}`;
    expect(chips.map((c) => c.querySelector(".amt")?.textContent)).toEqual(["26 Oct", money(books.total), String(books.bills), expect.any(String), expect.any(String)]);
    const line = card?.querySelector(".turn-line") as HTMLElement;
    expect([...line.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent)).toEqual([
      "On ",
      " the counter took ",
      " across ",
      " bills: ",
      " in cash and ",
      " by UPI.",
    ]);
    expect(line.querySelectorAll("[data-said], [data-printed]")).toHaveLength(0); // the model's words are never marked as the person's
    expect(unsourced(document.body)).toEqual([]);
  });

  test("the answer's snapshots are this run's, under this shop; the question never reaches a trace", async () => {
    if (WRITING) script.turns = [...(TURNS[CREDIT] as Turn[])];
    const r = await askAction(null, formOf({ question: CREDIT }));
    const turn = (r as { turn: AskTurn }).turn;
    expect(turn.reply.kind).toBe("answer");
    const ids = turn.snapshots.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(0);
    const stamped = await rows<{ run_id: string; tenant_id: string }>(h, "select run_id::text, tenant_id::text from snap.snapshot where id = any($1::uuid[])", [ids]);
    expect(stamped.map((s) => s.run_id)).toEqual(ids.map(() => turn.id));
    expect(stamped.every((s) => s.tenant_id === h.k.tenantId)).toBe(true);
    // The overdue customer named is the credit book's first row, and the figures are its cells.
    if (turn.reply.kind !== "answer") return;
    const parts = turn.reply.segments[0] ?? [];
    expect(parts[0]).toEqual({ t: "name", v: "Ramesh K." });
    const owes = parts.find((p) => p.t === "ref");
    expect(owes && owes.t === "ref" && resolveCell(turn.snapshots, owes.ref)?.t).toBe("money");
    const traces = await rows<{ kind: string; label: string; refs: unknown }>(h, "select kind, label, refs from ops.run_trace where run_id = $1 order by seq", [turn.id]);
    expect(traces.length).toBeGreaterThan(3);
    const all = JSON.stringify(traces);
    for (const word of ["overdue", "credit?", "Who", "Ramesh"]) expect(all.includes(word), word).toBe(false);
    expect(traces.map((t) => t.label)).toContain("credit.balances");
    const [run] = await rows<{ started_by: string; ended: boolean }>(h, "select started_by::text, ended_at is not null as ended from ops.run where id = $1", [turn.id]);
    expect(run).toEqual({ started_by: h.k.owner.memberId, ended: true });
  });

  test("a question with no recorded response says Cannot verify and why, in fixed words", async () => {
    view();
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "What is the weather in Delhi on the 3rd?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const [card] = await turnsOf();
    expect(card?.textContent).toContain("Cannot verify");
    expect(card?.textContent).toContain("The assistant did not answer. There is no recorded response for this.");
    expect(within(card as HTMLElement).queryAllByRole("button", { name: /source:/ })).toHaveLength(0);
    // The person's own digits ("3rd") are theirs, marked so; nothing else on the page carries one.
    expect(unsourced(document.body)).toEqual([]);
  });

  test("the session's questions stay across pages (the layout's provider) and in the tab after a remount", async () => {
    sessionStorage.setItem(`munshi_asks:${h.k.owner.memberId}`, JSON.stringify([]));
    view();
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "unrecorded" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await turnsOf();
    cleanup();
    view();
    expect(await turnsOf()).toHaveLength(1);
  });
});

describe("asking by voice", () => {
  beforeEach(() => hideNavigatorWhileWriting(vi.stubGlobal));
  test("a recording (the committed synthetic clips) is transcribed and answered; the words show as the person's", async () => {
    for (const [clip, words] of Object.entries(CLIPS)) {
      view();
      if (WRITING) script.turns = [{ transcript: words }, ...(TURNS[words] as Turn[])];
      const file = new File([media(clip) as BlobPart], clip, { type: "audio/wav" });
      fireEvent.change(screen.getByLabelText("Or send a recording"), { target: { files: [file] } });
      fireEvent.click(screen.getByRole("button", { name: "Send the recording" }));
      const [card] = await turnsOf();
      const turn = within(card as HTMLElement);
      expect(turn.getByText("You said")).toBeTruthy();
      expect(turn.getByText(words).getAttribute("data-said")).toBe("");
      expect(turn.getAllByRole("button", { name: /source: Counter sales/ })).toHaveLength(5);
      expect(unsourced(document.body)).toEqual([]);
      cleanup();
      sessionStorage.clear();
    }
  });

  test("the transcript never reaches a trace", async () => {
    if (WRITING) script.turns = [{ transcript: HI }, ...(TURNS[HI] as Turn[])];
    const r = await askAction(null, withAudio(media("ask-hi.wav")));
    const turn = (r as { turn: AskTurn }).turn;
    expect(turn.words).toBe(HI);
    const traces = await rows<{ label: string }>(h, "select label from ops.run_trace where run_id = $1 order by seq", [turn.id]);
    expect(traces.map((t) => t.label)).toContain("voice");
    const all = JSON.stringify(traces);
    for (const word of HI.replace(/[?।]/g, "").split(" ")) expect(all.includes(word), word).toBe(false);
  });

  test("a file that is not a WAV is refused before any model; a WAV the voice model cannot take abstains", async () => {
    expect(await askAction(null, withAudio(new TextEncoder().encode("not audio at all, just text")))).toEqual({ error: "not_audio" });
    const stereo = media("ask-en.wav");
    new DataView(stereo.buffer).setUint16(22, 2, true);
    const r = (await askAction(null, withAudio(stereo))) as { turn: AskTurn };
    expect(r.turn.words).toBeNull();
    expect(r.turn.reply).toEqual({ kind: "abstain", missing: ["model_error"] });
  });

  test("under the second edition (MUNSHI_EDITION=paytm) the assistant abstains: no fixture, no voice adapter, no error", async () => {
    vi.stubEnv("MUNSHI_EDITION", "paytm");
    try {
      const typed = (await askAction(null, formOf({ question: EN }))) as { turn: AskTurn };
      expect(typed.turn.reply).toEqual({ kind: "abstain", missing: ["model_error"] });
      const spoken = (await askAction(null, withAudio(media("ask-en.wav")))) as { turn: AskTurn };
      expect(spoken.turn.reply).toEqual({ kind: "abstain", missing: ["model_error"] });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the mic", () => {
  test("it sends what the voice model's check reads: RIFF/WAVE, PCM, mono, 16 kHz, 16-bit, resampled from the device rate", () => {
    const tone = new Float32Array(48_000).map((_, i) => Math.sin(i / 10) * 0.5); // one second at 48 kHz
    const wav = encodeWav(resample(tone, 48_000, 16_000));
    const v = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 16_000, 16]);
    expect(v.getUint32(40, true)).toBe(16_000 * 2);
    expect(wav.length).toBe(44 + 16_000 * 2);
  });

  test("no microphone, or no permission: the bubble says so and nothing is sent", async () => {
    const mic = () => {
      render(
        <LangProvider initial="en">
          <AskProvider who="mic">
            <ul>
              <MicButton />
            </ul>
          </AskProvider>
        </LangProvider>,
      );
      return screen.getByRole("button", { name: "Ask by voice: tap to speak" });
    };
    fireEvent.click(mic()); // jsdom has no microphone and no Web Audio
    expect((await screen.findByRole("status")).textContent).toContain("No microphone was found on this device.");
    cleanup();

    class Ctx {
      sampleRate = 16_000;
      close = async () => {};
      resume = async () => {};
    }
    vi.stubGlobal("AudioContext", Ctx);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })) },
    });
    try {
      fireEvent.click(mic());
      expect(await screen.findByText(/allow the microphone for this site/)).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });
});

function withAudio(bytes: Uint8Array): FormData {
  const form = new FormData();
  form.set("audio", new Blob([bytes as BlobPart], { type: "audio/wav" }), "question.wav");
  return form;
}
