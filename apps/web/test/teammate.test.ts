// A message in the staff group (lib/server/teammate.ts). TEAM1: an unlinked account reads nothing, and only its own
// link makes it a member. TEAM2: the brief's figures are stored cells, each with its source, and a sample shop says so.
// TEAM3: a decision from chat runs as the linked member: staff are refused by the database and nothing moves; the owner's
// approval executes in the books under the owner. TEAM4: a rejection needs a reason, and a code that names no draft
// decides nothing. TEAM5: the route admits only the relay's secret, and gives a bad body nothing. TEAM6: a question is
// answered from the books, each figure a cited cell. TEAM7: a fix is drafted and changes nothing by itself. Red-proofs:
// db/test/v2/sabotage/chat-link.ts.
import { issueChatCode } from "@munshi/core";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { POST } from "../app/api/internal/teammate/route";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { keyRef, resolveNumber } from "../lib/snapshot";
import type { Finding } from "../lib/types";
import { answerTurn, parseTurn } from "../lib/server/teammate";
import { type Home, homeFor, openHome, rows, sessionOf } from "./helpers/home-db";

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());
afterEach(() => {
  delete process.env.MUNSHI_TEAMMATE_SECRET;
});

const say = (sender: string, text: string) => answerTurn(h.k.tenantId, { channel: "telegram", sender, text });
const link = async (sender: string, memberId: string) => {
  const { code } = await issueChatCode(h.db.app, sessionOf(memberId));
  return say(sender, `@munshi link ${code}`);
};
const tail = () => h.draftId.slice(-6);
// The numbers a reply's figures cite, and the numbers its footer explains: every one of each must be the other.
const cited = (reply: string) => [...new Set([...reply.split("\n\n[1]")[0].matchAll(/ \[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const footnotes = (reply: string) => [...reply.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]));

test("parseTurn reads commands, and anything else is a question", () => {
  expect(parseTurn("@munshi approve AB12CD")).toEqual({ kind: "approve", tail: "ab12cd" });
  expect(parseTurn("reject ab12cd not now")).toEqual({ kind: "reject", tail: "ab12cd", reason: "not_now" });
  expect(parseTurn("reject ab12cd because")).toEqual({ kind: "reject", tail: "ab12cd", reason: null });
  expect(parseTurn("@munshi how much is overdue?")).toEqual({ kind: "ask", question: "how much is overdue?" });
  expect(parseTurn("approve the reorder")).toEqual({ kind: "ask", question: "approve the reorder" });
});

test("TEAM1 an unlinked account reads nothing, and a link makes it that member", async () => {
  const brief = await say("stranger", "brief");
  expect(brief).toContain("Chat link");
  expect(brief).not.toContain("₹");
  expect(await say("stranger", "link ZZZZ-ZZZZ")).toContain("didn't work");
  const linked = await link("tg-owner", h.k.owner.memberId);
  expect(linked).toContain("Linked");
  expect(linked).toContain("(owner)");
});

test("TEAM2 the brief's figures are stored cells with their sources, and a sample shop says so", async () => {
  const brief = await say("tg-owner", "brief");
  const home = await homeFor(sessionOf(h.k.owner.memberId));
  const first = home.findings[0] as Finding;
  expect(brief).toContain(`${resolveNumber(home.snapshots, keyRef(first))} [1]`);
  expect(brief).toMatch(/\[1\] .+, row \d+/);
  expect(brief).toContain("Sample shop");
  // One footnote per stored row: two snapshots with the same label and row number are still two sources.
  const refs = home.findings.flatMap((f) => (f.kind === "shelf_gap" ? [f.books, f.shelf] : [keyRef(f)]));
  expect(footnotes(brief)).toEqual(cited(brief));
  expect(footnotes(brief)).toHaveLength(new Set(refs.map((r) => `${r.snapshotId}:${r.row}`)).size);
  expect(brief).not.toContain("Cannot verify");
});

test("TEAM6 a question is answered from the books, each figure a cell with its source", async () => {
  const answer = await say("tg-owner", `@munshi ${RECORDED_QUESTIONS[0]}`);
  expect(answer).toMatch(/₹[\d,.]+ \[1\]/);
  expect(answer).toMatch(/\[1\] .+, row \d+/);
  expect(answer).not.toContain("Cannot verify");
});

test("TEAM6 a question with no recorded answer says Cannot verify, and never guesses", async () => {
  const answer = await say("tg-owner", "What is the weather in Delhi?");
  expect(answer).toContain("Cannot verify");
  expect(answer).not.toContain("₹");
});

test("TEAM7 a fix is drafted from chat and changes nothing until someone decides it", async () => {
  const home = await homeFor(sessionOf(h.k.owner.memberId));
  const finding = home.findings.find((f) => f.fix && f.kind !== "shelf_gap") as Finding;
  const before = await rows<{ n: number }>(h, "select count(*)::int as n from approval.decision");
  const drafted = await say("tg-owner", `fix ${finding.id.slice(-6)}`);
  expect(drafted).toContain("Nothing changes until");
  expect(drafted).toMatch(/approve [0-9a-f]{6}/);
  expect(drafted).not.toContain("Reorder"); // only what this fix drafted, and only its sources
  expect(footnotes(drafted)).toEqual(cited(drafted));
  expect(await rows(h, "select count(*)::int as n from approval.decision")).toEqual(before);
  expect(await say("tg-owner", "drafts")).toContain("approve");
});

test("TEAM3 staff are refused by the database, and the owner's approval runs under the owner", async () => {
  const cashier = h.k.staff[0] as { memberId: string };
  await link("tg-cashier", cashier.memberId);
  const refused = await say("tg-cashier", `approve ${tail()}`);
  expect(refused).toContain("refused");
  const waiting = await rows<{ status: string }>(h, `select status from approval.draft where id = '${h.draftId}'`);
  expect(waiting).toEqual([{ status: "proposed" }]);

  const receipt = await say("tg-owner", `approve ${tail()}`);
  expect(receipt).toContain("Approved by");
  expect(receipt).toContain("(owner)");
  const done = await rows<{ status: string; decided_by: string }>(
    h,
    `select d.status, x.decided_by::text from approval.draft d join approval.decision x on x.tenant_id = d.tenant_id and x.draft_id = d.id where d.id = '${h.draftId}'`,
  );
  expect(done).toEqual([{ status: "executed", decided_by: h.k.owner.memberId }]);
  expect(await say("tg-owner", `approve ${tail()}`)).toContain("No draft");
});

test("TEAM4 a rejection needs a reason, and a code naming no draft decides nothing", async () => {
  expect(await say("tg-owner", "reject abcdef")).toContain("Say why");
  expect(await say("tg-owner", "approve abcdef")).toContain("No draft abcdef");
});

test("TEAM5 the route admits only the relay's secret", async () => {
  const call = (auth: string | null, body: unknown) =>
    POST(new Request("http://local/api/internal/teammate", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }));
  const good = { shop: "sharma-general-store", channel: "telegram", sender: "stranger", text: "brief" };
  expect((await call("Bearer anything", good)).status).toBe(404);
  process.env.MUNSHI_TEAMMATE_SECRET = "relay-secret";
  expect((await call(null, good)).status).toBe(404);
  expect((await call("Bearer wrong", good)).status).toBe(404);
  expect((await call("Bearer relay-secret", { ...good, extra: 1 })).status).toBe(400);
  const ok = await call("Bearer relay-secret", good);
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { reply: string }).reply).toContain("Chat link");
});
