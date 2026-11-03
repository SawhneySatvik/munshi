// W1-A, the idle agents wired, on the demo kirana as `pnpm dev` builds it and on recorded model responses
// (hero-script.ts; rewrite with MUNSHI_WEB_FIXTURES=write): a finding's Why? (an answer whose figures are cells its run
// minted; the overdue card's explains its own total), Draft the fix (a draft that waits in Home's tray), Snooze and
// Dismiss (the finding's status, an owner's or a manager's); the tick's brief narrator (Munshi's words for the brief's
// lines, whatever their severity, checked again by core, the template the fallback); the inbox's Draft reply and Draft
// order (once each while one waits) and a voice note heard from an attached clip (an owner's or a manager's, labelled as
// heard; a run that read the customer's words is tainted); a campaign's Write the copy (figures as cells, edited as
// marks, the disclosure kept on every later version). Every move leaves every books table as it was: nothing changes
// the books before a named person approves. Red-proofs: db/test/v2/sabotage/agents-wired.ts.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AI_DISCLOSURE,
  createCampaign,
  formatRef,
  proposeDraft,
  runCommand,
  type Session,
  saveClipTranscript,
  sendTest,
  snoozeFinding,
  switchCapability,
  withTx,
} from "@munshi/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { wordsIn } from "../../../packages/agent/src/intake.ts";
import pg from "pg";
import { briefLines, writeBrief } from "../../../packages/core/src/brief.ts";
import { mintIn } from "../../../packages/core/src/snapshots.ts";
import { tx } from "../../../db/test/v2/db.ts";
import { decideDraft } from "../app/actions";
import { draftCopyAction, writeCopyAction } from "../app/app/campaigns/actions";
import CampaignsPage from "../app/app/campaigns/page";
import { dismissAction, fixAction, snoozeAction, whyAction } from "../app/app/findings/actions";
import { draftOrderAction, draftReplyAction, hearAction } from "../app/app/inbox/actions";
import InboxPage from "../app/app/inbox/page";
import { FindingMoves } from "../components/FindingMoves";
import { LangProvider } from "../components/LangProvider";
import { SourceDrawer } from "../components/SourceDrawer";
import { SourcesProvider } from "../components/Sources";
import type { AskTurn } from "../lib/hero-types";
import { briefNarrator, type Flow, fixturesDir, inRun, startRun } from "../lib/server/agent-port";
import { appPool } from "../lib/server/db";
import type { CampaignsPage as Camps, InboxPage as Inbox } from "../lib/server/office";
import { resolveCell } from "../lib/snapshot";
import { dataOf } from "./app-render";
import { depsFor, hideNavigatorWhileWriting, prepare, script, type Turn, WRITING } from "./hero-script";
import { AS_OF, type Home, homeFor, openHome, rows, signInAs, urlAs } from "./home-db";
import { state } from "./app-state";
import { formOf } from "./ops-db";
import { fakeMatchMedia, renderHome, unsourced } from "./render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: Flow) => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const PHONE = "+919800000077";
const media = (name: string) => new Uint8Array(readFileSync(new URL(`../../../packages/agent/fixtures/media/${name}`, import.meta.url)));

let h: Home;
let customerId: string;
// The seed's findings by kind, in the order the watchers raised them (one snapshot per kind, a row per finding).
const found = new Map<string, string[]>();

beforeAll(async () => {
  for (const flow of ["finding", "brief", "inbox", "campaign"] as const) prepare(fixturesDir(flow));
  h = await openHome();
  const app = await appPool();
  for (const cap of ["messaging", "campaigns", "offers"] as const) await switchCapability(app, h.k.owner, cap, true).catch(() => {});
  // A customer whose phone the inbox's messages come from.
  customerId = ((await runCommand(app, h.k.owner, "customer.create", { name: "Inbox regular", phone: PHONE })) as { customerId: string }).customerId;
  for (const f of await rows<{ id: string; kind: string }>(h, "select id::text, kind from ai.finding order by created_at, snapshot_row")) {
    found.set(f.kind, [...(found.get(f.kind) ?? []), f.id]);
  }
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]); // write mode: every turn written was asked for
});

const first = (kind: string, n = 0) => {
  const id = found.get(kind)?.[n];
  if (!id) throw new Error(`test: the kirana seed has no ${kind} finding ${n}`);
  return id;
};

/** Every books table's rows for the shop: an agent's move must leave every one as it was. */
async function books(): Promise<Record<string, number>> {
  const tables = (await h.db.admin.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'books' and table_type = 'BASE TABLE' order by 1")).rows;
  const out: Record<string, number> = {};
  for (const { t } of tables) out[t] = Number((await h.db.admin.query<{ n: string }>(`select count(*)::text as n from books."${t}" where tenant_id = $1`, [h.k.tenantId])).rows[0]?.n);
  return out;
}

const decisions = async () => Number((await rows<{ n: string }>(h, "select count(*)::text as n from approval.decision"))[0]?.n);

/** A model's pick of a message's words (numbered from 0), first and last inclusive, by the phrase they spell. */
function pick(text: string, phrase: string) {
  const at = [...text.slice(0, text.indexOf(phrase))].length;
  const words = wordsIn(text);
  return { from: words.findIndex((w) => w.start === at), to: words.findIndex((w) => w.end === at + [...phrase].length) };
}

/** A message as the webhook stores it: munshi_public, the tenant's context, no actor. */
async function inbound(kind: "text" | "audio", text: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await tx(h.db.as("munshi_public"), { tenant_id: h.k.tenantId }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, $3, $4, $5, $6, now())`,
      [h.k.tenantId, id, `wamid.${id}`, PHONE, kind, text],
    ),
  );
  return id;
}

const turns = (t: Turn[]) => {
  if (WRITING) script.turns = [...t];
};

// ---- a finding's moves --------------------------------------------------------------------------------------------

const WHY_TURNS: Turn[] = [
  { text: "Read 0, row 0 is the finding: the count, the books and the loss." },
  {
    json: {
      segments: [
        {
          text: "The shelf count on ⟦1⟧ found ⟦2⟧ where the books hold ⟦3⟧, so ⟦4⟧ is at stake.",
          refs: ["counted_on", "counted", "expected", "loss"].map((col) => ({ read: 0, row: 0, col })),
        },
      ],
    },
  },
];

test("AGENTS1 Why on a finding is its desk's answer from the finding's own row, each figure a chip on a cell its run minted; no book row changes", async () => {
  const id = first("shrinkage");
  const before = await books();
  turns(WHY_TURNS);
  render(
    <LangProvider initial="en">
      <SourcesProvider snapshots={[]} deskRef={null}>
        <FindingMoves ids={[id]} why fix quiet />
        <SourceDrawer />
      </SourcesProvider>
    </LangProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Why?" }));
  const why = await screen.findByRole("region", { name: "Why this was raised" }, { timeout: 30_000 });
  const chips = within(why).getAllByRole("button", { name: /source:/ });
  expect(chips).toHaveLength(4);
  expect(why.textContent).toContain("Recorded response");
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // The same through the action: the run is the owner's, its answer cites the watcher's own snapshot of the finding.
  turns(WHY_TURNS);
  const r = (await whyAction(null, formOf({ finding: id }))) as { turn: AskTurn };
  expect(r.turn.reply.kind).toBe("answer");
  if (r.turn.reply.kind !== "answer") return;
  const refs = r.turn.reply.segments.flat().flatMap((p) => (p.t === "ref" ? [p.ref] : []));
  expect(refs.map((x) => x.col)).toEqual(["counted_on", "counted", "expected", "loss"]);
  for (const ref of refs) expect(resolveCell(r.turn.snapshots, ref), ref.col).toBeDefined();
  const [own] = await rows<{ snapshot_id: string }>(h, "select snapshot_id::text from ai.finding where id = $1", [id]);
  expect(new Set(refs.map((x) => x.snapshotId))).toEqual(new Set([own?.snapshot_id]));
  const [run] = await rows<{ desk: string; started_by: string; outcome: string }>(h, "select desk, started_by::text, outcome from ai.run where id = $1", [r.turn.id]);
  // Filed under the desk of the watcher that raised the finding.
  expect(run).toEqual({ desk: "stock", started_by: h.k.owner.memberId, outcome: "answered" });

  // The overdue card stands for every overdue customer: its Why explains the card's own figure, a read its run minted
  // now, not one customer's finding.
  turns([
    { text: "Read 1, row 0 is the card: the overdue total." },
    { json: { segments: [{ text: "Udhaar of ⟦1⟧ is past its due date.", refs: [{ read: 1, row: 0, col: "overdue" }] }] } },
  ]);
  const card = (await whyAction(null, formOf({ card: "overdue_credit" }))) as { turn: AskTurn };
  expect(card.turn.reply.kind).toBe("answer");
  if (card.turn.reply.kind !== "answer") return;
  const cited = card.turn.reply.segments.flat().flatMap((p) => (p.t === "ref" ? [p.ref] : []));
  expect(cited.map((x) => x.col)).toEqual(["overdue"]);
  const [total] = await rows<{ query_name: string; run_id: string }>(h, "select query_name, run_id::text from snap.snapshot where id = $1", [cited[0]?.snapshotId]);
  expect(total).toEqual({ query_name: "credit.overdue_total", run_id: card.turn.id });
  expect(await books()).toEqual(before);
});

test("AGENTS2 Draft the fix leaves each finding's recipe as a draft waiting in Home's tray, pending; nothing reaches the books before approval", async () => {
  const before = await books();
  const decided = await decisions();
  // A shelf gap → a reorder (its quantity a cell of the item's last bill); the overdue card → a reminder to each overdue
  // customer (the card names its kind; the server reads its findings).
  // A row of two where one already has its draft (the seed's demo reorder): drafted for one, and the note says so.
  expect(await fixAction(null, formOf({ finding: [first("shrinkage"), first("shrinkage", 1)] }))).toEqual({ note: "fixSome", ok: true });
  expect(await fixAction(null, formOf({ card: "overdue_credit" }))).toEqual({ note: "fixDrafted", ok: true });
  // The seed's demo reorder already answers the other shelf gap: no second draft.
  expect(await fixAction(null, formOf({ finding: first("shrinkage", 1) }))).toEqual({ note: "fix_open_draft", ok: false });
  // A kind with no recipe is explained only.
  expect(await fixAction(null, formOf({ finding: first("price_creep") }))).toEqual({ note: "fix_no_fix", ok: false });

  const drafts = await rows<{ id: string; command: string; status: string; source: string; finding: string; run: string; desk: string }>(
    h,
    `select d.id::text, d.command, d.status, d.source, d.finding_id::text as finding, d.run_id::text as run, r.desk
       from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id where d.run_id is not null order by d.created_at`,
  );
  expect(drafts.map((d) => [d.command, d.status, d.source, d.desk])).toEqual([
    ["reorder.place", "proposed", "run", "recipe"],
    ...(found.get("overdue_credit") ?? []).map(() => ["customer.remind", "proposed", "run", "recipe"]),
  ]);
  expect(drafts.map((d) => d.finding)).toEqual([first("shrinkage"), ...(found.get("overdue_credit") ?? [])]);
  expect(await decisions()).toBe(decided);
  expect(await books()).toEqual(before);

  // Home's tray: the reorder beside the seed's own, and each reminder, every figure a cell the draft cites.
  const home = await homeFor(h.k.owner);
  expect(home.drafts.map((d) => d.id)).toContain(drafts[0]?.id);
  const reminders = (home.tray ?? []).filter((d) => d.command === "customer.remind");
  expect(reminders.map((d) => [d.id, d.status, d.canDecide])).toEqual(drafts.slice(1).map((d) => [d.id, "proposed", true]));
  for (const d of reminders) {
    expect(d.customer).toBeTruthy();
    expect(d.figure && resolveCell(home.snapshots, d.figure)).toBeDefined();
  }
  renderHome(home);
  expect(screen.getAllByRole("heading", { name: "Payment reminder" })).toHaveLength(reminders.length);
  expect(screen.getAllByText("Waiting for you").length).toBeGreaterThanOrEqual(reminders.length + 1);
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // D-082: counter staff see only their own drafts on Home, so none of the owner's reminders (nor the reorder), and no
  // overdue-credit finding to draft one from.
  const staff = h.k.staff[0] as Session;
  const theirs = await homeFor(staff);
  expect((theirs.tray ?? []).filter((d) => d.command === "customer.remind")).toEqual([]);
  expect(theirs.drafts.map((d) => d.id)).not.toContain(drafts[0]?.id);
  expect(theirs.findings.map((f) => f.kind)).not.toContain("overdue_credit");
  renderHome(theirs);
  expect(screen.queryAllByRole("heading", { name: "Payment reminder" })).toEqual([]);
  cleanup();
  // A reminder from a run of their own does show in their tray, with no Approve or Reject: their role does not hold
  // customer.remind.
  const [owing] = await rows<{ id: string }>(h, "select customer_id::text as id from books.credit_entry where reverses_id is null order by created_at limit 1");
  const own = await startRun(staff, "recipe");
  const ownId = await inRun(own, async () => {
    const balance = await own.port.read("credit.balance", { customer_id: owing?.id });
    const figure = { snapshotId: balance.snapshotId, row: 0, col: "balance" };
    const payload = { customerId: owing?.id, template: "credit_due", figure: formatRef(figure) };
    return own.port.propose({ command: "customer.remind", payload, basedOn: [figure], payloadRefs: {} });
  });
  const mine = await homeFor(staff);
  expect((mine.tray ?? []).filter((d) => d.command === "customer.remind").map((d) => [d.id, d.canDecide])).toEqual([[ownId, false]]);
  renderHome(mine);
  const section = screen.getByRole("heading", { name: "Payment reminder" }).closest("section") as HTMLElement;
  expect(within(section).queryByRole("button", { name: "Approve" })).toBeNull();
  expect(section.textContent).toContain("Waiting for someone allowed to approve it.");
  cleanup();

  // Turning one down is the approver's own decision; it writes nothing to the books either.
  expect(await decideDraft(null, formOf({ draft: drafts[1]?.id as string, verdict: "rejected" }))).toBeNull();
  expect((await rows<{ status: string }>(h, "select status from approval.draft where id = $1", [drafts[1]?.id]))[0]?.status).toBe("rejected");
  expect(await books()).toEqual(before);
});

// ---- the tick's brief narrator --------------------------------------------------------------------------------------

// What the narrator says for each finding kind, and the money cell it cites (the finding's own row).
const SAYS: Record<string, [string, string]> = {
  shrinkage: ["Stock missing from a shelf is worth ⟦1⟧.", "loss"],
  overdue_credit: ["A customer's udhaar of ⟦1⟧ is past its due date.", "overdue"],
  price_creep: ["A supplier now charges ⟦1⟧ for an item.", "latest_cost"],
  expiry: ["Stock worth ⟦1⟧ may expire before it sells.", "at_risk_value"],
  short_settlement: ["A payout came in ⟦1⟧ short.", "short"],
};

test("AGENTS4 the tick's narrator writes the brief's lines in Munshi's words, kept only as checked; the office marks them; with no response the template stands", async () => {
  // The seed's findings as the brief ranks them (low and medium only): every one is narrated, in one call.
  const ranked = await withTx(h.db.jobs, { kind: "system", tenantId: h.k.tenantId }, (c) => mintIn(c, "brief.ranked", { as_of: AS_OF, shop_id: h.k.shopId }));
  const kindOf = new Map([...found].flatMap(([kind, ids]) => ids.map((id) => [id, kind] as const)));
  const order = ranked.rows.map((r) => (r.finding_id as { txt: string }).txt);
  expect(order.length).toBeGreaterThan(1);
  turns([
    {
      json: {
        segments: order.slice(0, 6).map((id, i) => {
          const [text, col] = SAYS[kindOf.get(id) as string] as [string, string];
          return { text, refs: [{ read: i + 1, row: 0, col }] };
        }),
      },
    },
  ]);
  const deps = depsFor((await import("../lib/server/agent-port")).agentDeps("brief"), fixturesDir("brief"));
  const b = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: AS_OF, narrate: briefNarrator(h.db.jobs, deps) });
  expect(b?.answerId).toBeTruthy();
  const lines = await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => briefLines(c, (b as { briefId: string }).briefId));
  const narrated = lines.filter((l) => l.narrated);
  expect(narrated.map((l) => l.findingId)).toEqual(order.slice(0, 6));
  expect(narrated.every((l) => /⟦1⟧/.test(l.text) && !/\p{Nd}/u.test(l.text.replace(/⟦\d⟧/g, "")))).toBe(true);
  const [run] = await rows<{ outcome: string; model_calls: number; started_by: string | null }>(h, "select outcome, model_calls, started_by from ai.run where id = $1", [b?.runId]);
  expect(run).toEqual({ outcome: "answered", model_calls: 1, started_by: null });
  const traced = await rows<{ kind: string; label: string }>(h, "select kind, label from ai.trace where run_id = $1 order by seq", [b?.runId]);
  expect(traced.map((t) => t.kind)).toEqual(expect.arrayContaining(["route", "model", "validate", "answer"]));

  // The office: Munshi's own lines say so; the rest are fixed words.
  const { default: OfficePage } = await import("../app/app/office/page");
  const el = await OfficePage();
  render(<LangProvider initial="en">{el}</LangProvider>);
  expect(screen.getAllByText("Munshi's words, every figure checked against the books")).toHaveLength(narrated.length);
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // No recorded response for the next day's request (an empty fixtures directory): the brief keeps its templates.
  const none = mkdtempSync(path.join(tmpdir(), "munshi-no-fixtures-"));
  const next = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: "2026-10-28", narrate: briefNarrator(h.db.jobs, { ...deps, fixturesDir: none }) });
  expect(next?.answerId).toBeNull();
  const fallback = await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => briefLines(c, (next as { briefId: string }).briefId));
  expect(fallback.some((l) => l.narrated)).toBe(false);
  expect((await rows<{ outcome: string }>(h, "select outcome from ai.run where id = $1", [next?.runId]))[0]?.outcome).toBe("abstained");

  // A narrator that throws after its model call (here the trace of its check cannot be written): the brief keeps its
  // templates, and its run says it failed, with the call allow() counted.
  const replay = depsFor((await import("../lib/server/agent-port")).agentDeps("brief"), fixturesDir("brief")); // the response recorded above
  const base = new pg.Pool({ connectionString: urlAs(h.db, "munshi_jobs"), max: 2 });
  const flaky = {
    query: base.query.bind(base),
    connect: async () => {
      const c = await base.connect();
      const query = c.query.bind(c) as (sql: unknown, params?: unknown) => Promise<unknown>;
      (c as unknown as { query: unknown }).query = (sql: unknown, params?: unknown) =>
        Array.isArray(params) && params.includes("validate") ? Promise.reject(new Error("the trace store is down")) : query(sql, params);
      return c;
    },
  } as unknown as pg.Pool;
  try {
    const thrown = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: "2026-10-29", narrate: briefNarrator(flaky, replay) });
    expect(thrown?.answerId).toBeNull();
    expect(await rows(h, "select outcome, model_calls from ai.run where id = $1", [thrown?.runId])).toEqual([{ outcome: "failed", model_calls: 1 }]);
  } finally {
    await base.end();
  }

  // Any narrator that throws (core's own catch): the templates stand and the run says it failed.
  const down = await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, {
    asOf: "2026-10-30",
    narrate: async () => {
      throw new Error("the narrator is down");
    },
  });
  expect(down?.answerId).toBeNull();
  expect(await rows(h, "select outcome from ai.run where id = $1", [down?.runId])).toEqual([{ outcome: "failed" }]);
});

test("AGENTS3 Snooze and Dismiss change the finding's status as an owner or a manager, and Home stops showing it; staff are refused; no book row changes", async () => {
  const before = await books();
  const creep = first("price_creep");
  const expiry = first("expiry");
  // Counter staff: refused by core, nothing moves, and their Home offers neither move.
  const staff = h.k.staff[0] as Session;
  signInAs(staff);
  expect(await snoozeAction(null, formOf({ finding: creep, days: "3" }))).toEqual({ note: "errStaff", ok: false });
  expect(await dismissAction(null, formOf({ finding: expiry, reason: "already_handled" }))).toEqual({ note: "errStaff", ok: false });
  await expect(snoozeFinding(await appPool(), staff, creep, 3)).rejects.toMatchObject({ code: "refused" });
  expect(await rows(h, "select status from ai.finding where id = any($1::uuid[]) order by id", [[creep, expiry]])).toEqual([{ status: "open" }, { status: "open" }]);
  renderHome(await homeFor(staff));
  expect(screen.queryAllByText("Snooze")).toEqual([]);
  expect(screen.queryAllByText("Dismiss")).toEqual([]);
  cleanup();

  signInAs(h.k.owner);
  expect(await snoozeAction(null, formOf({ finding: creep, days: "3" }))).toEqual({ note: "snoozed", ok: true });
  expect(await dismissAction(null, formOf({ finding: expiry, reason: "already_handled" }))).toEqual({ note: "dismissed", ok: true });
  const state = await rows<{ id: string; status: string; snoozed: boolean; close_reason: string | null }>(
    h,
    "select id::text, status, snoozed_until > now() + interval '2 days' as snoozed, close_reason from ai.finding where id = any($1::uuid[]) order by status",
    [[creep, expiry]],
  );
  expect(state).toEqual([
    { id: expiry, status: "dismissed", snoozed: null, close_reason: "already_handled" },
    { id: creep, status: "snoozed", snoozed: true, close_reason: null },
  ]);
  const shown = (await homeFor(h.k.owner)).findings.map((f) => f.id);
  expect(shown).not.toContain(creep);
  expect(shown).not.toContain(expiry);
  // A batch is one transaction: one finding that cannot move (none such) leaves the others as they were.
  const open = first("short_settlement");
  expect(await dismissAction(null, formOf({ finding: [open, crypto.randomUUID()], reason: "not_relevant" }))).toEqual({ note: "errOther", ok: false });
  // A snooze of a length not offered changes nothing.
  expect(await snoozeAction(null, formOf({ finding: open, days: "2" }))).toEqual({ note: "errOther", ok: false });
  expect((await rows<{ status: string }>(h, "select status from ai.finding where id = $1", [open]))[0]?.status).toBe("open");
  expect(await books()).toEqual(before);
});

// ---- the inbox ------------------------------------------------------------------------------------------------------

const ORDER_TEXT = "Please send 2 Basmati rice 1 kg today";
const ORDER_TURNS: Turn[] = [{ json: { lines: [{ item: pick(ORDER_TEXT, "Basmati rice 1 kg"), quantity: pick(ORDER_TEXT, "2") }] } }];

test("AGENTS5 Draft reply leaves a message.reply draft in Home's tray, pending, from a tainted run of the replies desk; nothing is sent", async () => {
  const orderMessage = await inbound("text", ORDER_TEXT);
  const before = await books();
  const decided = await decisions();
  turns([
    { json: { figures: [{ field: "quantity", words: pick(ORDER_TEXT, "2") }] } },
    { json: { segments: [{ text: "Ji, aaj hi bhej denge. Dhanyavaad!", refs: [] }] } },
  ]);
  expect(await draftReplyAction(null, formOf({ message: orderMessage }))).toEqual({ note: "replyDrafted", ok: true });
  const [draft] = await rows<{ id: string; status: string; payload: { messageId: string; customerId: string }; based_on: unknown; payload_refs: unknown; tainted: boolean; desk: string }>(
    h,
    `select d.id::text, d.status, d.payload, d.based_on, d.payload_refs, r.tainted, r.desk from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id
      where d.command = 'message.reply' and d.payload->>'messageId' = $1`,
    [orderMessage],
  );
  expect(draft).toMatchObject({ status: "proposed", payload: { messageId: orderMessage, customerId }, tainted: true, desk: "replies" });
  const home = await homeFor(h.k.owner);
  const card = home.tray?.find((d) => d.id === draft?.id);
  expect(card).toMatchObject({ command: "message.reply", status: "proposed", customer: "Inbox regular", canDecide: true });
  expect(card?.words?.map((p) => (p.t === "text" ? p.v : "")).join("")).toBe("Ji, aaj hi bhej denge. Dhanyavaad!");
  renderHome(home);
  expect(screen.getByRole("heading", { name: "Reply to a customer" })).toBeTruthy();
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // One reply at a time: a second tap drafts nothing, the inbox offers no second one, and core refuses a second draft.
  expect(await draftReplyAction(null, formOf({ message: orderMessage }))).toEqual({ note: "replyAlready", ok: false });
  const inbox = await InboxPage();
  expect(dataOf<Inbox>(inbox).messages.find((m) => m.id === orderMessage)?.replyWaiting).toBe(true);
  await expect(
    proposeDraft(await appPool(), { session: h.k.owner }, { command: "message.reply", payload: draft?.payload, basedOn: draft?.based_on as never, payloadRefs: draft?.payload_refs as never }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await rows(h, "select 1 from approval.draft where command = 'message.reply' and payload->>'messageId' = $1", [orderMessage])).toHaveLength(1);
  expect(await decisions()).toBe(decided);
  expect(await books()).toEqual(before);
});

test("AGENTS6 Draft order leaves an order.confirm draft on Orders, its request waiting on it, once; a run that drafts nothing leaves no request; no order before approval", async () => {
  const orderMessage = await inbound("text", ORDER_TEXT);
  const before = await books();
  turns(ORDER_TURNS);
  expect(await draftOrderAction(null, formOf({ message: orderMessage }))).toEqual({ note: "orderDrafted", ok: true });
  const ofMessage = async () =>
    rows<{ id: string; status: string; payload: { customerId: string; lines: { qtyMilli: number }[] }; tainted: boolean; desk: string }>(
      h,
      `select d.id::text, d.status, d.payload, r.tainted, r.desk from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id
        join ops.order_request q on q.tenant_id = d.tenant_id and q.id::text = d.payload->>'requestId'
        where d.command = 'order.confirm' and q.inbound_message_id = $1`,
      [orderMessage],
    );
  const [draft] = await ofMessage();
  expect(draft).toMatchObject({ status: "proposed", payload: { customerId, lines: [{ qtyMilli: 2000 }] }, tainted: true, desk: "chat_to_order" });
  const [request] = await rows<{ state: string; draft: string; message: string }>(
    h,
    "select state, draft_id::text as draft, inbound_message_id::text as message from ops.order_request where inbound_message_id = $1",
    [orderMessage],
  );
  expect(request).toEqual({ state: "drafted", draft: draft?.id, message: orderMessage });
  const { default: OrdersPage } = await import("../app/app/orders/page");
  const orders = dataOf<{ drafts: { id: string; message: string | null; heard: boolean }[] }>(await OrdersPage());
  expect(orders.drafts.find((d) => d.id === draft?.id)).toMatchObject({ message: ORDER_TEXT, heard: false });

  // Drafted once: a second tap drafts nothing more, and the inbox says so instead of offering the button.
  expect(await draftOrderAction(null, formOf({ message: orderMessage }))).toEqual({ note: "orderAlready", ok: false });
  expect(await ofMessage()).toHaveLength(1);
  const inbox = await InboxPage();
  expect(dataOf<Inbox>(inbox).messages.find((m) => m.id === orderMessage)?.orderWaiting).toBe(true);

  // A message the run drafts nothing from (no recorded response): the request the tap made is ended, not left waiting.
  const chat = await inbound("text", "Hello, is the shop open on Sunday?");
  expect(await draftOrderAction(null, formOf({ message: chat }))).toEqual({ note: "notDrafted", ok: false });
  expect(await rows(h, "select state, reason from ops.order_request where inbound_message_id = $1", [chat])).toEqual([{ state: "declined", reason: "other" }]);
  expect(await books()).toEqual(before);
});

test("AGENTS7 a voice note is heard from a clip an owner or a manager attached: stored once, labelled as heard, by a tainted run that proposes nothing; staff are refused", async () => {
  const note = await inbound("audio", null);
  const before = await books();
  const clip = () => {
    const form = formOf({ message: note });
    form.set("audio", new File([media("ask-en.wav") as BlobPart], "note.wav", { type: "audio/wav" }));
    return form;
  };
  // Counter staff may not attach a clip: refused before any model call, and by core's own writer.
  const staff = h.k.staff[0] as Session;
  signInAs(staff);
  expect(await hearAction(null, clip())).toEqual({ note: "hearOwnersOnly", ok: false });
  await expect(saveClipTranscript(await appPool(), staff, note, "typed by staff")).rejects.toMatchObject({ code: "refused" });
  expect(await rows(h, "select transcript from ops.inbound_message where id = $1", [note])).toEqual([{ transcript: null }]);

  signInAs(h.k.owner);
  turns([{ transcript: ORDER_TEXT }]);
  expect(await hearAction(null, clip())).toEqual({ note: "heard", ok: true });
  expect(await rows(h, "select transcript from ops.inbound_message where id = $1", [note])).toEqual([{ transcript: ORDER_TEXT }]);
  const [run] = await rows<{ desk: string; tainted: boolean; outcome: string; drafts: number }>(
    h,
    `select r.desk, r.tainted, r.outcome, (select count(*)::int from approval.draft d where d.run_id = r.id) as drafts from ai.run r
      where r.desk = 'voice' order by r.started_at desc limit 1`,
  );
  expect(run).toEqual({ desk: "voice", tainted: true, outcome: "answered", drafts: 0 });

  // The inbox labels the words as heard from the attached clip, not typed by the customer.
  const el = await InboxPage();
  expect(dataOf<Inbox>(el).messages.find((m) => m.id === note)).toMatchObject({ text: ORDER_TEXT, heard: true });
  render(<LangProvider initial="en">{el}</LangProvider>);
  expect(screen.getAllByText("Simulated: heard from an attached clip").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByLabelText("Words Munshi heard from the attached clip").textContent).toBe(ORDER_TEXT);
  cleanup();

  // An order drafted from those words carries the same label on Orders.
  turns(ORDER_TURNS);
  expect(await draftOrderAction(null, formOf({ message: note }))).toEqual({ note: "orderDrafted", ok: true });
  const { default: OrdersPage } = await import("../app/app/orders/page");
  const orders = await OrdersPage();
  const [mine] = await rows<{ draft: string }>(h, "select draft_id::text as draft from ops.order_request where inbound_message_id = $1", [note]);
  expect(dataOf<{ drafts: { id: string; heard: boolean }[] }>(orders).drafts.find((d) => d.id === mine?.draft)?.heard).toBe(true);
  render(<LangProvider initial="en">{orders}</LangProvider>);
  expect(screen.getAllByText("Simulated: heard from an attached clip").length).toBeGreaterThanOrEqual(1);
  cleanup();

  // A clip the voice model cannot hear (no recorded response for it): nothing stored, and the run says it abstained.
  const other = await inbound("audio", null);
  const form = formOf({ message: other });
  form.set("audio", new File([media("ask-en.wav") as BlobPart, new Uint8Array([0, 0])], "note.wav", { type: "audio/wav" }));
  expect(await hearAction(null, form)).toEqual({ note: "notHeard", ok: false });
  expect(await rows(h, "select transcript from ops.inbound_message where id = $1", [other])).toEqual([{ transcript: null }]);
  expect(await rows(h, "select outcome from ai.run where desk = 'voice' order by started_at desc limit 1")).toEqual([{ outcome: "abstained" }]);
  expect(await books()).toEqual(before);
});

// ---- campaigns ------------------------------------------------------------------------------------------------------

test("AGENTS8 Write the copy fills a campaign's words, each figure a cell; the owner edits them as marks and saves; every version keeps the disclosure; nothing is sent", async () => {
  const app = await appPool();
  const offerId = (
    (await runCommand(app, h.k.owner, "offer.create", {
      name: "Diwali offer",
      kind: "amount_off",
      amountOffMinor: 5000,
      scope: "all",
      startsAt: "2026-01-01T00:00:00+05:30",
      endsAt: "2031-01-01T00:00:00+05:30",
      published: true,
    })) as { offerId: string }
  ).offerId;
  const campaignId = await createCampaign(app, h.k.owner, { name: "Diwali for regulars", channel: "whatsapp", segment: "lapsed_regulars", offerId });
  const before = await books();
  turns([
    {
      json: {
        segments: [
          { text: "Is Diwali har khareed par ⟦1⟧ ki chhoot!", refs: [{ read: 2, row: 0, col: "amount_off" }] },
          { text: "Jaldi aaiye.", refs: [] },
        ],
      },
    },
  ]);
  // The form names the campaign only: its offer is the one the campaign names.
  expect(await draftCopyAction(null, formOf({ campaign: campaignId, brief: "Diwali offer for our regulars" }))).toEqual({ note: "copyWritten", ok: true });
  const [stored] = await rows<{ body: string; author: string }>(
    h,
    "select t.body, t.author from ops.campaign k join ops.message_text t on t.tenant_id = k.tenant_id and t.id = k.copy_text_id where k.id = $1",
    [campaignId],
  );
  expect(stored?.author).toBe("run");
  const token = /⟨snap:[0-9a-f-]{36}·0·amount_off⟩/.exec(stored?.body ?? "")?.[0] as string;
  expect(stored?.body).toBe(`Is Diwali har khareed par ${token} ki chhoot! Jaldi aaiye.`);

  // The page shows the copy's figure as a mark in the field and as a cell beside it; no snapshot id on the page.
  const el = await CampaignsPage();
  const row = dataOf<Camps>(el).campaigns.find((k) => k.id === campaignId);
  expect(row?.status).toBe("composing");
  render(<LangProvider initial="en">{el}</LangProvider>);
  const field = screen.getAllByRole("textbox", { name: /The words/ }).find((t) => (t as HTMLTextAreaElement).value.includes("⟦a⟧")) as HTMLTextAreaElement;
  expect(field.value).toBe("Is Diwali har khareed par ⟦a⟧ ki chhoot! Jaldi aaiye.");
  const figures = ((field.form as HTMLFormElement).querySelector("input[name=figures]") as HTMLInputElement).value;
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // The owner moves the figure and saves: the mark goes back to its cell; a mark that names no figure is refused.
  expect(await writeCopyAction(null, formOf({ campaign: campaignId, body: "Sirf ⟦b⟧ ki chhoot!", figures }))).toEqual({ error: "invalid" });
  expect(await writeCopyAction(null, formOf({ campaign: campaignId, body: "⟦a⟧ ki chhoot, is Diwali!", figures }))).toEqual({ done: true });
  const [saved] = await rows<{ body: string; author: string; status: string }>(
    h,
    "select t.body, t.author, k.status from ops.campaign k join ops.message_text t on t.tenant_id = k.tenant_id and t.id = k.copy_text_id where k.id = $1",
    [campaignId],
  );
  expect(saved).toEqual({ body: `${token} ki chhoot, is Diwali!`, author: "member", status: "composing" });

  // Munshi wrote a version of this campaign's copy, so the owner's edit still goes out with the disclosure line; a copy
  // no run ever wrote does not.
  const [{ name: shop }] = (await rows<{ name: string }>(h, "select name from ops.tenant")) as [{ name: string }];
  const disclosure = AI_DISCLOSURE.replace("{shop}", shop);
  const tested = async (id: string) => {
    const delivery = await sendTest(app, h.k.owner, id);
    return (await rows<{ body: string }>(h, "select t.body from ops.delivery d join ops.message_text t on t.tenant_id = d.tenant_id and t.id = d.test_text_id where d.id = $1", [delivery]))[0]?.body ?? "";
  };
  expect((await tested(campaignId)).endsWith(`\n\n${disclosure}`)).toBe(true);
  const own = await createCampaign(app, h.k.owner, { name: "Owner's own words", channel: "whatsapp", segment: "lapsed_regulars" });
  expect(await writeCopyAction(null, formOf({ campaign: own, body: "Naya stock aaya hai, aaiye!", figures: "[]" }))).toEqual({ done: true });
  expect(await tested(own)).toBe("Naya stock aaya hai, aaiye!");
  expect(await rows(h, "select 1 from approval.draft where payload->>'campaignId' = $1", [campaignId])).toEqual([]);
  expect(await books()).toEqual(before);
});

// ---- every run: its desk, and how it ended --------------------------------------------------------------------------

test("AGENTS10 a run whose flow throws ends as failed, never as answered", async () => {
  // The agent's read-only pool cannot connect: the finding's cells cannot be read, and the flow throws.
  const config = state.config as NonNullable<typeof state.config>;
  const held = globalThis as { munshiAgentPool?: Promise<{ end: () => Promise<void> }> | undefined };
  await held.munshiAgentPool?.then((p) => p.end(), () => {});
  held.munshiAgentPool = undefined;
  state.config = { ...config, agentDatabaseUrl: "postgres://munshi_agent:wrong@127.0.0.1:9/none" };
  try {
    expect(await whyAction(null, formOf({ finding: first("shrinkage") }))).toEqual({ note: "errOther", ok: false });
  } finally {
    state.config = config;
    held.munshiAgentPool = undefined;
  }
  const [run] = await rows<{ desk: string; outcome: string; ended: boolean }>(
    h,
    "select desk, outcome, ended_at is not null as ended from ai.run where trigger = 'question' order by started_at desc, id desc limit 1",
  );
  expect(run).toEqual({ desk: "stock", outcome: "failed", ended: true });
});

test("AGENTS11 each flow's run lands with its desk, and a run's draft with its run's desk", async () => {
  // Every flow, run here (each run's desk is set when it starts, whatever its outcome): a question, a finding's Why and
  // fix, a reply, an order, a voice note, a campaign's copy, a brief, a shelf count and a bill read.
  const { askAction } = await import("../app/app/ask/actions");
  await askAction(null, formOf({ question: "What is the weather in Delhi?" }));
  await whyAction(null, formOf({ finding: first("shrinkage") }));
  await fixAction(null, formOf({ finding: first("shrinkage") }));
  const message = await inbound("text", ORDER_TEXT);
  await draftReplyAction(null, formOf({ message }));
  await draftOrderAction(null, formOf({ message }));
  const note = formOf({ message: await inbound("audio", null) });
  note.set("audio", new File([media("ask-en.wav") as BlobPart], "note.wav", { type: "audio/wav" }));
  await hearAction(null, note);
  const campaign = await createCampaign(await appPool(), h.k.owner, { name: "Desk check", channel: "whatsapp", segment: "lapsed_regulars" });
  await draftCopyAction(null, formOf({ campaign, offer: "", brief: "A note for our regulars" }));
  await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: "2026-10-31" });
  const { billSuppliers, countShelfPhoto, readBillPhoto } = await import("../lib/server/hero");
  await countShelfPhoto(h.k.owner, media("shelf.png"));
  const [supplier] = await billSuppliers(h.k.owner);
  await readBillPhoto(h.k.owner, media("bill.png"), supplier?.id as string);
  const runs = await rows<{ trigger: string; desk: string }>(h, "select distinct trigger, desk from ai.run where trigger <> 'watcher' order by 1, 2");
  expect(runs).toEqual(
    expect.arrayContaining(
      [
        ["brief", "brief"],
        ["campaign", "campaigns"],
        ["inbox", "chat_to_order"],
        ["inbox", "replies"],
        ["photo", "bills"],
        ["photo", "shelf"],
        ["question", "ask"],
        ["question", "stock"],
        ["recipe", "recipe"],
        ["voice", "voice"],
      ].map(([trigger, desk]) => ({ trigger, desk })),
    ),
  );
  const drafts = await rows<{ command: string; draft: string | null; run: string }>(
    h,
    "select d.command, d.desk as draft, r.desk as run from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id order by d.created_at",
  );
  expect(drafts.length).toBeGreaterThanOrEqual(1);
  for (const d of drafts) expect(d.draft, d.command).toBe(d.run);
});
