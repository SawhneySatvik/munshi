// The office's desks and run log over the real database. The seeded runs follow ai.run's contract (its triggers,
// desks and outcomes, a member's run as the app role with that member as the actor, a watcher's as the jobs role with
// none), their traces ai.trace's, their drafts proposeDraft's and their decisions decide()'s; they cover desks and
// outcomes the app's agent port does not write today. One run is the agent port's own (startRun / endRun: a question,
// filed under `ask`, its labels stored as the port stores them).
// The counts are the rows' (a run older than seven days and another shop's runs are not counted); the scene's states
// come from each member's latest run, and a shop with no runs shows everyone idle; the page renders every count and
// step timing as a sourced figure in both languages, filters the log in its read and opens a run's steps in its one
// transaction; the words carry no digit, and the English ones no Devanagari; only a run the log shows opens; the agent
// port's own run counts under Munshi.
import { decide, mintSnapshot, openDemoSession, proposeDraft, type Session } from "@munshi/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type Shop, smallShop } from "../../../db/test/v2/core/shop.ts";
import { tx } from "../../../db/test/v2/db.ts";
import OfficePage from "../app/app/office/page";
import { BriefView } from "../components/app/BriefView";
import { LangProvider } from "../components/LangProvider";
import { DESKS, OUTCOME, STEP, TRIGGER } from "../lib/i18n-desks";
import { endRun, startRun } from "../lib/server/agent-port";
import { type DesksData, loadOffice } from "../lib/server/desks";
import { SESSION_COOKIE, signSession } from "../lib/server/session";
import { resolveCell } from "../lib/snapshot";
import type { Snapshot } from "../lib/types";
import { refsIn, sourcedInBoth } from "./helpers/app-render";
import { state } from "./helpers/app-state";
import { openWebDb, urlAs, type WebDb } from "./helpers/home-db";
import { fakeMatchMedia, unsourced } from "./helpers/render";

let db: WebDb;
let a: Shop; // the shop under test
let b: Shop; // another tenant, with runs of its own
let c: Shop; // a shop with no runs
const runs: Record<string, string> = {};

const ctx = (s: Session) => ({ tenant_id: s.tenantId, actor_id: s.memberId });

/** A member's run, still open, with its trace steps. */
async function run(s: Session, trigger: string, desk: string, steps: [string, string, number][] = []): Promise<string> {
  return tx(db.app, ctx(s), async (cl) => {
    const r = await cl.query<{ id: string }>("insert into ai.run (tenant_id, trigger, desk) values ($1, $2, $3) returning id::text", [s.tenantId, trigger, desk]);
    const runId = r.rows[0]?.id as string;
    for (const [i, [kind, label, ms]] of steps.entries()) {
      await cl.query("insert into ai.trace (tenant_id, run_id, seq, kind, label, ms) values ($1, $2, $3, $4, $5, $6)", [s.tenantId, runId, i + 1, kind, label, ms]);
    }
    return runId;
  });
}
const end = (s: Session, id: string, outcome: string) => tx(db.app, ctx(s), (cl) => cl.query("update ai.run set ended_at = now(), outcome = $2 where id = $1", [id, outcome]));

/** A watcher's run as the jobs role writes it (no actor), ended with its findings raised. */
async function watcherRun(tenantId: string): Promise<string> {
  const id = await tx(db.jobs, { tenant_id: tenantId }, async (cl) =>
    (await cl.query<{ id: string }>("insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'watch') returning id::text", [tenantId])).rows[0]?.id as string,
  );
  await tx(db.jobs, { tenant_id: tenantId }, (cl) => cl.query("update ai.run set ended_at = now(), outcome = 'raised' where id = $1", [id]));
  return id;
}

/** Moves a finished run back in time (past ai.run's flow trigger, as superuser, for the fixture only). */
async function backdate(id: string, interval: string) {
  const admin = await db.admin.connect();
  try {
    await admin.query("begin");
    await admin.query("set local session_replication_role = replica");
    await admin.query(`update ai.run set started_at = now() - interval '${interval}', ended_at = now() - interval '${interval}' where id = $1`, [id]);
    await admin.query("commit");
  } finally {
    admin.release();
  }
}

/** A reorder the run proposes, citing the on-hand cell it read for the run. */
async function draft(shop: Shop, runId: string): Promise<string> {
  const snap = await mintSnapshot(db.app, { kind: "member", session: shop.owner }, "stock.on_hand", { item_id: shop.biscuits }, runId);
  const ref = { snapshotId: snap.id, row: 0, col: "on_hand" };
  const cell = snap.rows[0]?.on_hand;
  const qty = cell?.kind === "quantity" ? Number(cell.num) : 0;
  return proposeDraft(
    db.app,
    { session: shop.owner, runId },
    { command: "reorder.place", payload: { supplierId: shop.supplier, lines: [{ itemId: shop.biscuits, qtyMilli: qty }] }, basedOn: [ref], payloadRefs: { "lines[0].qtyMilli": ref } },
  );
}

beforeAll(async () => {
  db = await openWebDb();
  a = await smallShop(db.app, "Desks");
  b = await smallShop(db.app, "Elsewhere");
  c = await smallShop(db.app, "Quiet");
  state.config = { databaseUrl: urlAs(db, "munshi_app"), agentDatabaseUrl: undefined, sessionSecret: Buffer.alloc(32, 7), demoTenantId: a.owner.tenantId };

  // Munshi: a question as the agent port runs it (answered), one it abstained on, and last, a watcher run just now
  // (its latest: watching).
  const asked = await startRun(a.owner, "question");
  await asked.port.trace({ kind: "route", label: "stock", ids: [], ms: 4 });
  await asked.port.trace({ kind: "model", label: "reason,muse-spark", ids: [], ms: 812 });
  await asked.port.trace({ kind: "answer", label: "ok", ids: [], ms: 1 });
  await endRun(asked);
  runs.answered = asked.runId;
  runs.abstained = await run(a.owner, "question", "ask", [["route", "none", 3], ["abstain", "out_of_scope", 0]]);
  await end(a.owner, runs.abstained, "abstained");
  // Tally: a run older than the window (failed, not counted), then one proposing three reorders: one approved, one
  // rejected, one still waiting (its latest: waiting).
  runs.old = await run(a.owner, "photo", "stock");
  await end(a.owner, runs.old, "failed");
  await backdate(runs.old, "8 days");
  runs.tally = await run(a.owner, "question", "stock", [["route", "stock", 5], ["read", "stock.on_hand", 27], ["propose", "reorder.place", 9]]);
  const [d1, d2] = [await draft(a, runs.tally), await draft(a, runs.tally)];
  await draft(a, runs.tally);
  await end(a.owner, runs.tally, "proposed");
  await decide(db.app, a.owner, d1 as string, "approved");
  await decide(db.app, a.owner, d2 as string, "rejected", "not_now");
  // Ledger: a bill photo that failed (blocked). Dash: a fix proposed and approved (done). Echo: a reply still running
  // (thinking). Bloom and Keeper: no runs.
  runs.ledger = await run(a.owner, "photo", "bills", [["model", "model_error", 1500]]);
  await end(a.owner, runs.ledger, "failed");
  runs.dash = await run(a.owner, "recipe", "recipe");
  const d4 = await draft(a, runs.dash);
  await end(a.owner, runs.dash, "proposed");
  await decide(db.app, a.owner, d4, "approved");
  runs.echo = await run(a.owner, "inbox", "replies");
  runs.watch = await watcherRun(a.owner.tenantId);

  // Another shop: a watcher run two hours ago (Munshi idle there, not watching), then a stock run that failed after its
  // reorder was approved (done, not blocked); none of it is the first shop's.
  runs.otherWatch = await watcherRun(b.owner.tenantId);
  await backdate(runs.otherWatch, "2 hours");
  runs.other = await run(b.owner, "question", "stock");
  const d5 = await draft(b, runs.other);
  await decide(db.app, b.owner, d5, "approved");
  await end(b.owner, runs.other, "failed");
  await db.sabotage();
}, 240_000);
afterAll(() => db.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Each card's counts as the cells say, by cast member. */
function counts(data: DesksData, snapshots: Snapshot[]) {
  return Object.fromEntries(
    data.cards.map((card) => [card.cast, Object.fromEntries(Object.entries(card.counts).map(([k, ref]) => [k, Number((resolveCell(snapshots, ref) as { v: number }).v)]))]),
  );
}
const zero = { runs: 0, proposed: 0, approved: 0, rejected: 0, abstained: 0, failed: 0 };

test("each cast member's counts are the rows': its runs in the last seven days, their drafts and the decisions on them", async () => {
  const { desks } = await loadOffice(a.owner);
  if (!desks) throw new Error("test: no desks");
  expect(desks.cards.map((x) => x.cast)).toEqual(["munshi", "tally", "ledger", "dash", "echo", "bloom", "keeper"]);
  expect(counts(desks, desks.snapshots)).toEqual({
    munshi: { ...zero, runs: 3, abstained: 1 },
    tally: { ...zero, runs: 1, proposed: 3, approved: 1, rejected: 1 },
    ledger: { ...zero, runs: 1, failed: 1 },
    dash: { ...zero, runs: 1, proposed: 1, approved: 1 },
    echo: { ...zero, runs: 1 },
    bloom: zero,
    keeper: zero,
  });
  expect(desks.cards.find((x) => x.cast === "tally")?.latest).toMatchObject({ id: runs.tally, outcome: "proposed", trigger: "question", desk: "stock" });
  expect(desks.cards.find((x) => x.cast === "echo")?.latest).toMatchObject({ id: runs.echo, outcome: null, trigger: "inbox", desk: "replies" });
  expect(desks.cards.find((x) => x.cast === "keeper")?.latest).toBeNull();
  // The log: the window's runs, newest first; the backdated run and the other shop's are absent.
  expect(desks.log.map((r) => r.id)).toEqual([runs.watch, runs.echo, runs.dash, runs.ledger, runs.tally, runs.abstained, runs.answered]);
  expect(desks.capped).toBe(false);

  // The other shop sees only its own runs.
  const other = (await loadOffice(b.owner)).desks as DesksData;
  expect(counts(other, other.snapshots).tally).toEqual({ ...zero, runs: 1, proposed: 1, approved: 1, failed: 1 });
  expect(counts(other, other.snapshots).munshi).toEqual({ ...zero, runs: 1 });
  expect(other.log.map((r) => r.id)).toEqual([runs.other, runs.otherWatch]);
});

const said = (name: string) => document.querySelector(`[aria-label^="${name},"]`)?.getAttribute("aria-label") ?? "";

test("the scene's states come from each member's latest run; a shop with no runs shows everyone idle", async () => {
  const { brief, desks, states } = await loadOffice(a.owner);
  // A watcher run of the last hour: watching. A failed run whose draft was approved: done (the ruling's order).
  expect(states).toEqual({ munshi: "watching", tally: "waiting", ledger: "blocked", dash: "done", echo: "thinking" });
  expect((await loadOffice(b.owner)).states).toEqual({ munshi: "idle", tally: "done" });
  render(
    <LangProvider initial="en">
      <BriefView data={{ ...brief, snapshots: [...brief.snapshots, ...(desks?.snapshots ?? [])] }} states={states} />
    </LangProvider>,
  );
  expect(said("Munshi")).toMatch(/^Munshi, the lead, watching/);
  expect(said("Tally")).toMatch(/^Tally, stock, waiting/);
  expect(said("Ledger")).toMatch(/^Ledger, money, blocked/);
  expect(said("Dash")).toMatch(/^Dash, fixes, done/);
  expect(said("Echo")).toMatch(/^Echo, customers, thinking/);
  expect(said("Bloom")).toMatch(/^Bloom, campaigns, idle/);
  cleanup();

  // The other shop's watcher run is two hours old: idle, over the scene's own default (watching while no brief is written).
  const other = await loadOffice(b.owner);
  render(
    <LangProvider initial="en">
      <BriefView data={other.brief} states={other.states} />
    </LangProvider>,
  );
  expect(said("Munshi")).toMatch(/^Munshi, the lead, idle/);
  cleanup();

  const quiet = await loadOffice(c.owner);
  expect(quiet.states).toEqual({});
  expect(counts(quiet.desks as DesksData, (quiet.desks as DesksData).snapshots).tally).toEqual(zero);
  render(
    <LangProvider initial="en">
      <BriefView data={quiet.brief} states={quiet.states} />
    </LangProvider>,
  );
  for (const [name, role] of [["Tally", "stock"], ["Ledger", "money"], ["Dash", "fixes"], ["Echo", "customers"], ["Keeper", "memory"]]) {
    expect(said(name as string)).toMatch(new RegExp(`^${name}, ${role}, idle`));
  }
});

async function signIn(s: Session) {
  const o = await openDemoSession(db.app, s.tenantId, s.memberId);
  if (!o || !state.config) throw new Error("test: no demo session");
  const claim = { tenantId: s.tenantId, memberId: s.memberId, sessionId: o.session.sessionId as string, via: "demo" as const };
  state.cookies.set(SESSION_COOKIE, signSession(claim, o.expiresAt, state.config.sessionSecret));
}
const office = async (q: { cast?: string; run?: string }) => {
  const el = await OfficePage({ searchParams: Promise.resolve(q) });
  const p = el.props as { data: { snapshots: Snapshot[] }; desks: { props: { data: DesksData } } };
  return { el, snapshots: p.data.snapshots, desks: p.desks.props.data };
};

test("the page shows every count and step timing as a sourced figure, filters the log by member and opens a run's steps", async () => {
  await signIn(a.owner);
  const { el, snapshots, desks } = await office({ run: runs.answered });
  const refs = refsIn(desks);
  expect(refs.length).toBe(7 * 6 + 3); // six counts a card, and the opened run's three step timings
  for (const r of refs) expect(resolveCell(snapshots, r), `${r.col} of row ${r.row}`).toBeDefined();
  expect(desks.open?.steps.map((s) => [s.kind, s.label, s.alias])).toEqual([
    ["route", "stock", null],
    ["model", "reason:muse-spark", "muse-spark"],
    ["answer", "ok", null],
  ]);
  const text = sourcedInBoth(el);
  expect(text).toContain(DESKS.en.desksTitle);
  expect(text).toContain(STEP.model?.en as string);
  expect(text).toContain(OUTCOME.abstained?.en as string);
  expect(text).toContain(TRIGGER.inbox?.en as string);
  expect(text).toContain("muse-spark");
  expect(document.querySelectorAll(".desk-steps li")).toHaveLength(3);
  expect(document.querySelectorAll("button.fig").length).toBeGreaterThanOrEqual(refs.length);
  // Each row's link has its own name (the run's time); the open run's is current; none claims to expand anything.
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a.desk-open")];
  expect(links).toHaveLength(7);
  expect(new Set(links.map((l) => l.getAttribute("aria-label"))).size).toBe(7);
  expect(links.filter((l) => l.getAttribute("aria-current") === "true").map((l) => l.getAttribute("aria-label"))).toEqual([
    expect.stringMatching(/^Close the steps of Munshi's run at /),
  ]);
  expect(document.querySelectorAll("a[aria-expanded]")).toHaveLength(0);
  expect(screen.getAllByRole("link", { name: /^Steps of [A-Za-z]+'s run at / })).toHaveLength(6);
  cleanup();

  // The filter is the read's: Ledger's runs only, its card's count and its log agree.
  const ledger = (await office({ cast: "ledger" })).desks;
  expect(ledger.filter).toBe("ledger");
  expect(ledger.log.map((r) => r.id)).toEqual([runs.ledger]);
  expect(ledger.open).toBeNull();
  expect(unsourced(document.body)).toEqual([]);
});

test("the desks' words carry no digit, and the English ones no Devanagari", () => {
  const words = (lang: "en" | "hi") => [...Object.values(DESKS[lang]), ...[OUTCOME, TRIGGER, STEP].flatMap((m) => Object.values(m).map((l) => l[lang]))];
  expect(words("en").filter((w) => /[0-9०-९]/.test(w))).toEqual([]);
  expect(words("hi").filter((w) => /[0-9०-९]/.test(w))).toEqual([]);
  expect(words("en").filter((w) => /[ऀ-ॿ]/.test(w))).toEqual([]);
});

test("only a run the log shows opens: not one older than the window, another shop's, or one the filter hides", async () => {
  await signIn(a.owner);
  expect((await office({ run: runs.tally })).desks.open?.id).toBe(runs.tally);
  expect((await office({ run: runs.old })).desks.open).toBeNull();
  expect((await office({ run: runs.other })).desks.open).toBeNull();
  expect((await office({ cast: "ledger", run: runs.tally })).desks.open).toBeNull();
  // And the backdated run is in no filtered log either.
  expect((await office({ cast: "tally" })).desks.log.map((r) => r.id)).toEqual([runs.tally]);
});

test("a run as the agent port writes it today (a question, filed under ask) counts under Munshi", async () => {
  const [row] = (
    await tx(db.app, { tenant_id: a.owner.tenantId }, (cl) =>
      cl.query("select trigger, desk, outcome, model_calls, started_by::text from ai.run where id = $1", [runs.answered]),
    )
  ).rows;
  expect(row).toEqual({ trigger: "question", desk: "ask", outcome: "answered", model_calls: 1, started_by: a.owner.memberId });
  const { desks } = await loadOffice(a.owner, { cast: "munshi" });
  expect(desks?.log.map((r) => [r.id, r.cast])).toContainEqual([runs.answered, "munshi"]);
  expect(desks && counts(desks, desks.snapshots).munshi?.runs).toBe(3);
});
