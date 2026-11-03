// Approve and Reject through the server action. The approver is the signed-in member and nobody else: an approval
// writes the books under that member in one transaction with the audit entries, and the chain verifies; the counter
// staff's role cannot approve a reorder; evidence that changed makes the draft stale. The card then shows the status
// from the books, stamped with the name and time of its audit entry.
import { recordWaste, type Session } from "@munshi/core";
import { cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { proposeDemoDraft } from "../../../db/src/dev.ts";
import { decideDraft } from "../app/actions";
import { clock } from "../lib/time";
import { state } from "./app-state";
import { type Home, homeFor, openHome, rows, signInAs, urlAs } from "./home-db";
import { fakeMatchMedia, renderHome, unsourced } from "./render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const post = (draftId: string, verdict: "approved" | "rejected") => {
  const form = new FormData();
  form.set("draft", draftId);
  form.set("verdict", verdict);
  return decideDraft(null, form);
};
const count = async (table: string) => ((await rows<{ n: number }>(h, `select count(*)::int as n from ${table}`))[0] as { n: number }).n;
const status = async (id: string) => (await rows<{ status: string }>(h, "select status from approval.draft where id = $1", [id]))[0]?.status;

test("the counter staff role cannot approve (or reject) a reorder, is not shown one that is not theirs, and nothing changes", async () => {
  const staff = h.k.staff[0] as Session;
  const before = await count("books.outbound_message");
  const decided = await count("approval.decision"); // the seed's own (its surplus gift was approved)
  signInAs(staff);
  expect(await post(h.draftId, "approved")).toEqual({ error: "refused" });
  expect(await post(h.draftId, "rejected")).toEqual({ error: "refused" }); // the same rule for turning it down
  expect(await status(h.draftId)).toBe("proposed");
  expect(await count("books.outbound_message")).toBe(before);
  expect(await count("approval.decision")).toBe(decided);

  // D-082: counter staff see only their own drafts on Home, and this reorder is the demo's, not theirs.
  const theirs = await homeFor(staff);
  expect(theirs.drafts.map((d) => d.id)).not.toContain(h.draftId);
  renderHome(theirs);
  expect(document.querySelector(".pending")).toBeNull();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(unsourced(document.body)).toEqual([]); // the staff view holds the guarantee too
});

test("approving through the server action writes the books under the session's member, and the audit chain verifies", async () => {
  const manager = h.k.manager;
  signInAs(manager);
  // The jobs pool configured, as on a deploy: the approval flushes the outbox at once (BP-F3b).
  state.tick = { cronSecret: "", jobsDatabaseUrl: urlAs(h.db, "munshi_jobs") };
  expect(await post(h.draftId, "approved")).toBeNull();
  state.tick = undefined;
  expect(state.revalidated).toContain("/app");

  const [decision] = await rows<{ id: string; verdict: string; decided_by: string }>(
    h,
    "select id, verdict, decided_by from approval.decision where draft_id = $1",
    [h.draftId],
  );
  expect(decision).toMatchObject({ verdict: "approved", decided_by: manager.memberId });
  const messages = await rows<{ id: string; created_by: string; decision_id: string; body: string }>(
    h,
    "select o.id, o.created_by, o.decision_id, t.body from books.outbound_message o join ops.message_text t on t.tenant_id = o.tenant_id and t.id = o.text_id",
  );
  expect(messages).toEqual([
    { id: expect.any(String), created_by: manager.memberId, decision_id: decision?.id, body: "Reorder from Sharma General Store (synthetic): 6 × Glucose biscuits 70 g." },
  ]);
  // The approval flushed the outbox at once, before any tick: the jobs role swept this shop's outbox (its slot claimed and
  // finished). The simulated supplier has no number, so its delivery is recorded and blocked by the database.
  const swept = (await h.db.admin.query<{ outcome: string }>("select outcome from ops.job_claim where job = 'outbox' and slot like $1", [`outbox:${h.k.tenantId}:%`])).rows;
  expect(swept).toEqual([{ outcome: "ok" }]);
  expect(await rows(h, "select mode, status from ops.delivery where message_id = $1", [messages[0]?.id])).toEqual([{ mode: "recorded", status: "blocked" }]);
  const audit = await rows<{ entity: string; action: string; actor_id: string; decision_id: string }>(
    h,
    "select entity, action, actor_id, decision_id from audit.audit_log where entity_id = any($1::uuid[]) order by seq",
    [[messages[0]?.id, h.draftId]],
  );
  expect(audit).toEqual([
    { entity: "books.outbound_message", action: "insert", actor_id: manager.memberId, decision_id: decision?.id },
    { entity: "approval.draft", action: "draft.executed", actor_id: manager.memberId, decision_id: decision?.id },
  ]);
  const [chain] = await rows<{ broken: string | null }>(h, "select audit.verify_chain($1)::text as broken", [h.k.tenantId]);
  expect(chain).toEqual({ broken: null });

  // The owner's home stamps it with the approver's name and the audit entry's time.
  const [entry] = await rows<{ at: Date }>(h, "select created_at as at from audit.audit_log where entity_id = $1 and action = 'draft.executed'", [h.draftId]);
  const home = await homeFor(h.k.owner);
  const card = home.drafts.find((d) => d.id === h.draftId);
  expect(card).toMatchObject({ status: "executed", decision: { by: "Anil Verma", at: entry?.at.toISOString() } });
  renderHome(home);
  const shown = document.querySelector(".pending .done") as HTMLElement;
  expect(within(shown).getByText("Approved")).toBeTruthy();
  expect(shown.textContent).toContain(`Anil Verma · ${clock(entry?.at.toISOString() as string, "en")}`);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(unsourced(document.body)).toEqual([]); // the stamp's name and time are sourced; no digit stands loose
});

test("a draft whose evidence changed goes stale and shows as stale; nothing is ordered", async () => {
  const draftId = await proposeDemoDraft(h.db.app, h.k.tenantId);
  // Waste recorded before yesterday's count changes what the books said at the count, a cell the draft cited.
  const [line] = await rows<{ item: string }>(h, "select payload->'lines'->0->>'itemId' as item from approval.draft where id = $1", [draftId]);
  await recordWaste(h.db.app, h.k.manager, { itemId: line?.item as string, qtyMilli: 1000, at: "2026-10-20T10:00:00+05:30" });
  const before = await count("books.outbound_message");
  signInAs(h.k.owner);
  expect(await post(draftId, "approved")).toBeNull();
  expect(await status(draftId)).toBe("stale");
  expect(await count("books.outbound_message")).toBe(before);

  renderHome(await homeFor(h.k.owner));
  const card = [...document.querySelectorAll(".pending")].at(-1) as HTMLElement;
  expect(within(card).getByText("Stale")).toBeTruthy();
  expect(card.textContent).toContain("Rajesh Sharma");
  expect(unsourced(document.body)).toEqual([]);
});

test("rejecting closes the draft under the member, with nothing written to the books", async () => {
  const draftId = await proposeDemoDraft(h.db.app, h.k.tenantId);
  const before = await count("books.outbound_message");
  signInAs(h.k.owner);
  expect(await post(draftId, "rejected")).toBeNull();
  expect(await status(draftId)).toBe("rejected");
  expect(await count("books.outbound_message")).toBe(before);
  const [decision] = await rows<{ decided_by: string }>(h, "select decided_by from approval.decision where draft_id = $1", [draftId]);
  expect(decision?.decided_by).toBe(h.k.owner.memberId);
  renderHome(await homeFor(h.k.owner));
  const card = [...document.querySelectorAll(".pending")].at(-1) as HTMLElement;
  expect(within(card).getByText("Rejected")).toBeTruthy();
  expect(unsourced(document.body)).toEqual([]);
});

test("a draft already decided cannot be decided again", async () => {
  signInAs(h.k.owner);
  expect(await post(h.draftId, "rejected")).toEqual({ error: "not_proposed" });
});
