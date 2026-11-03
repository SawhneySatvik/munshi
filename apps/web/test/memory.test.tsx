// W2-A on the screens, over the real database. KEEPER1: the office's Keeper desk lists the notes in force, each with its
// words and its source chip (the decision's command, who decided it, when), and offers Forget to the owner alone; a
// manager sees the notes, no Forget, and their forget is refused; the owner's ends the note. KEEPER2: a decision card
// sends the person's words with the verdict, and words with a number are refused with the card's own message, nothing
// written. WHY1: the source drawer's "Why this number" walks a figure on request: a total ends whole at its read, and
// "Cannot verify" shows only where the chain breaks; a figure that is not the member's role's is refused. KEEPER3: the
// words carry no digit, the English no Devanagari. KEEPER4: in the office scene Keeper is at work on a day a note was
// written (its memory event), idle otherwise; in recorded mode the desk says the notes are kept but not used.
import { decide, mintSnapshot, openDemoSession, proposeDraft, type Session } from "@munshi/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type Shop, smallShop } from "../../../db/test/v2/core/shop.ts";
import { decideDraft } from "../app/actions";
import OfficePage from "../app/app/office/page";
import { forgetAction } from "../app/app/office/actions";
import { whyNumber } from "../app/app/why-actions";
import { LangProvider } from "../components/LangProvider";
import { SourceDrawer } from "../components/SourceDrawer";
import { SourcesProvider } from "../components/Sources";
import { Chain } from "../components/WhyChain";
import { MEMORY } from "../lib/i18n-memory";
import { SESSION_COOKIE, signSession } from "../lib/server/session";
import type { Snapshot, SourceRef } from "../lib/types";
import { sourcedInBoth } from "./app-render";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";
import { fakeMatchMedia } from "./render";

let db: WebDb;
let a: Shop;
const WORDS = "Ask before ordering from Gupta again";

beforeAll(async () => {
  db = await openWebDb();
  a = await smallShop(db.app, "Keeper");
  state.config = { databaseUrl: urlAs(db, "munshi_app"), agentDatabaseUrl: undefined, sessionSecret: Buffer.alloc(32, 7), demoTenantId: a.owner.tenantId };
  const d = await decide(db.app, a.owner, await reorder(), "rejected", "not_relevant", WORDS);
  if (d.status !== "rejected") throw new Error("test: the draft was not rejected");
});
afterAll(() => db.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function reorder(): Promise<string> {
  const snap = await mintSnapshot(db.app, { kind: "member", session: a.owner }, "stock.on_hand", { item_id: a.biscuits });
  const ref = { snapshotId: snap.id, row: 0, col: "on_hand" };
  const cell = snap.rows[0]?.on_hand;
  const qtyMilli = cell?.kind === "quantity" ? Number(cell.num) : 0;
  return proposeDraft(
    db.app,
    { session: a.owner },
    { command: "reorder.place", payload: { supplierId: a.supplier, lines: [{ itemId: a.biscuits, qtyMilli }] }, basedOn: [ref], payloadRefs: { "lines[0].qtyMilli": ref } },
  );
}

async function signIn(s: Session) {
  const o = await openDemoSession(db.app, s.tenantId, s.memberId);
  if (!o || !state.config) throw new Error("test: no demo session");
  const claim = { tenantId: s.tenantId, memberId: s.memberId, sessionId: o.session.sessionId as string, via: "demo" as const };
  state.cookies.set(SESSION_COOKIE, signSession(claim, o.expiresAt, state.config.sessionSecret));
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const noteId = async () =>
  (await db.admin.query<{ id: string }>("select n.id::text from ai.memory n join ops.message_text t on t.id = n.text_id where t.body = $1", [WORDS])).rows[0]?.id as string;

const scene = (el: Awaited<ReturnType<typeof OfficePage>>) => el.props as { states: Record<string, string>; events: { id: string; kind: string; agent: string }[] };

test("KEEPER1 the office lists each note in force with its words and source chip; Forget is the owner's alone", async () => {
  await signIn(a.manager);
  const page = await OfficePage({ searchParams: Promise.resolve({}) });
  // KEEPER4: a note written today: Keeper at work, its memory event in the scene; recorded mode said on the desk.
  expect(scene(page).states.keeper).toBe("drafting");
  expect(scene(page).events).toEqual([{ id: await noteId(), kind: "memory", agent: "keeper" }]);
  const text = sourcedInBoth(page);
  expect(text).toContain(MEMORY.en.recordedNote);
  expect(text).toContain(MEMORY.en.keeperTitle);
  expect(text).toContain(WORDS);
  expect(text).toMatch(/From a reorder\.place draft, declined by Owner, /);
  expect(screen.queryByRole("button", { name: /^Forget this note/ })).toBeNull();
  expect(await forgetAction(null, form({ memory: await noteId() }))).toEqual({ error: "refused" });
  cleanup();

  await signIn(a.owner);
  sourcedInBoth(await OfficePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("button", { name: `Forget this note: ${WORDS}` })).toBeTruthy();
  expect(await forgetAction(null, form({ memory: await noteId() }))).toEqual({ done: true });
  // Forgetting it again says it is already gone.
  expect(await forgetAction(null, form({ memory: await noteId() }))).toEqual({ error: "gone" });
  cleanup();
  const later = await OfficePage({ searchParams: Promise.resolve({}) });
  expect(scene(later).states.keeper).toBe("idle");
  expect(scene(later).events).toEqual([]);
  const after = sourcedInBoth(later);
  expect(after).not.toContain(WORDS);
  expect(after).toContain(MEMORY.en.keeperEmpty);
});

test("KEEPER2 a decision card sends the person's words with the verdict; words with a number are refused with the card's message and nothing is written", async () => {
  await signIn(a.owner);
  const draft = await reorder();
  const count = async () => (await db.admin.query<{ n: number }>("select count(*)::int as n from ai.memory where tenant_id = $1", [a.owner.tenantId])).rows[0]?.n;
  const before = await count();
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "Order 5 bags instead" }))).toEqual({ error: "note_number" });
  // Each refusal names its reason: a number word, another script, a handle (a number to the grammar), too long.
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "Order five bags instead" }))).toEqual({ error: "note_number" });
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "இது வேண்டாம்" }))).toEqual({ error: "note_script" });
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "Order ⟦a⟧ instead" }))).toEqual({ error: "note_number" });
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "x".repeat(161) }))).toEqual({ error: "note_length" });
  expect(await count()).toBe(before);
  expect(await decideDraft(null, form({ draft, verdict: "rejected", note: "The shop has enough biscuits" }))).toBeNull();
  expect(await count()).toBe((before ?? 0) + 1);
  // Counter staff may not leave a note.
  await signIn(a.staff);
  expect(await decideDraft(null, form({ draft: await reorder(), verdict: "rejected", note: "Not today" }))).toEqual({ error: "note_refused" });
});

test("WHY1 the drawer walks a figure on request: a total ends whole at its read; Cannot verify only where the chain breaks; another role's figure is refused", async () => {
  const snap = await mintSnapshot(db.app, { kind: "member", session: a.owner }, "stock.on_hand", { item_id: a.biscuits });
  const cell = snap.rows[0]?.on_hand;
  const shown: Snapshot = {
    id: snap.id,
    query: "stock.on_hand",
    readAt: new Date().toISOString(),
    title: { en: "Stock on hand", hi: "Stock on hand" },
    columns: [{ key: "on_hand", numeric: true }],
    rows: [{ on_hand: { t: "qty", milli: cell?.kind === "quantity" ? Number(cell.num) : 0, unit: "pack" } }],
  };
  const ref: SourceRef = { label: { en: "On hand", hi: "On hand" }, snapshotId: snap.id, row: 1, col: "on_hand" };
  await signIn(a.owner);
  render(
    <LangProvider initial="en">
      <SourcesProvider snapshots={[shown]} deskRef={ref}>
        <SourceDrawer />
      </SourcesProvider>
    </LangProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: MEMORY.en.whyShow }));
  await waitFor(() => expect(document.querySelector(".why-graph")).not.toBeNull());
  const items = [...document.querySelectorAll(".why-node")].map((li) => li.className.replace("why-node ", ""));
  // A total is whole: it ends at its read, with the read's time, and nothing says "Cannot verify".
  expect(items).toEqual(["why-figure", "why-read", "why-total"]);
  expect(document.querySelector(".why-total")?.textContent).toMatch(/^A total read from the books at .+ \(stock\.on_hand\)$/);
  expect(document.querySelector(".why-total time")).not.toBeNull();
  expect(document.querySelector(".why-graph")?.textContent).not.toContain("Cannot verify");
  cleanup();

  // A figure that is the office's: staff are refused its chain, and the drawer says so.
  const prices = await mintSnapshot(db.app, { kind: "member", session: a.owner }, "purchases.last_prices", {});
  await signIn(a.staff);
  expect(await whyNumber({ snapshotId: prices.id, row: 1, col: "item" })).toEqual({ error: "not_for_role" });
  render(
    <LangProvider initial="en">
      <Chain nodes={[{ kind: "break", node: null, parent: null, label: "no_snapshot", who: null, at: null }]} />
    </LangProvider>,
  );
  expect(document.body.textContent).toContain(`Cannot verify ${MEMORY.en.noSnapshot}`);
});

test("KEEPER3 Keeper's words carry no digit, and the English ones no Devanagari", () => {
  expect(Object.values(MEMORY.en).filter((w) => /[0-9०-९]/.test(w))).toEqual([]);
  expect(Object.values(MEMORY.hi).filter((w) => /[0-9०-९]/.test(w))).toEqual([]);
  expect(Object.values(MEMORY.en).filter((w) => /[ऀ-ॿ]/.test(w))).toEqual([]);
});
