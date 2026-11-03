// W2-A, the demo shop's notes in recorded mode, over the real database. MEMREC1: the kirana seed's history leaves two
// notes in force (a standing preference from an approved reorder, the manager's reason from a declined one), and the
// owner's recorded Ask still matches its fixture and answers: while answers are replayed the app's port gives no
// prompt the notes, so a note cannot turn every Ask into a missed fixture. MEMREC2: one rule, by mode: the app's port
// gives a run the notes only when the models answer live; in record mode (answers being recorded) as in recorded mode,
// none. Fixtures: apps/web/fixtures/ask (hero-ask's).
import { notesFor } from "@munshi/core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { HISTORY } from "../../../db/seed/kirana-history.ts";
import { askAction } from "../app/app/ask/actions";
import type { AskTurn } from "../lib/hero-types";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { notesGiven, recordedMode, startRun } from "../lib/server/agent-port";
import { type Home, openHome, rows, signInAs } from "./home-db";
import { formOf } from "./ops-db";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: "ask" | "shelf" | "bill") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const CREDIT = RECORDED_QUESTIONS[2] as string;

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());

test("MEMREC1 with the seed's notes in force, a recorded owner Ask still matches its fixture and answers", async () => {
  expect(recordedMode()).toBe(true);
  const notes = await notesFor(h.db.app, h.k.owner);
  expect(notes.map((n) => [n.kind, n.text]).sort()).toEqual(
    [
      ["declined", HISTORY.declined.words],
      ["preference", HISTORY.approved.words],
    ].sort(),
  );
  signInAs(h.k.owner);
  const r = (await askAction(null, formOf({ question: CREDIT }))) as { turn: AskTurn };
  expect(r.turn.reply.kind).toBe("answer");
  // The run was given no note: its trace holds no memory read.
  const traced = await rows<{ label: string }>(h, "select label from ai.trace where run_id = $1 order by seq", [r.turn.id]);
  expect(traced.map((t) => t.label)).not.toContain("memory");
});

test("MEMREC2 the app's port gives a run the notes only when the models answer live: none in record or recorded mode", async () => {
  const was = process.env.MUNSHI_MODEL_MODE;
  const given = async (mode: string) => {
    process.env.MUNSHI_MODEL_MODE = mode;
    const run = await startRun(h.k.owner, "question");
    return { notes: (await run.port.memory?.()) ?? [], given: notesGiven() };
  };
  try {
    expect(await given("record")).toEqual({ notes: [], given: false });
    expect(await given("recorded")).toEqual({ notes: [], given: false });
    // The control: live, the same port gives the owner the seed's two notes.
    const live = await given("live");
    expect(live.given).toBe(true);
    expect(live.notes.map((n) => n.text).sort()).toEqual([HISTORY.approved.words, HISTORY.declined.words].sort());
  } finally {
    if (was === undefined) delete process.env.MUNSHI_MODEL_MODE;
    else process.env.MUNSHI_MODEL_MODE = was;
  }
});
