// "Fetch from payments feed" on the demo shop: the simulated feed's statement goes down the same road as an uploaded file.
// Fetching previews and writes nothing; recording is still an owner's or manager's command; the feed's rows are made on
// the server from the books each time, so rows or totals a browser posts beside the intent are never read; the feed says
// it is simulated on the screen.
import { openDemoSession, type Session } from "@munshi/core";
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { type BansalSeed, seedBansal } from "../../../db/seed/bansal.ts";
import { tx } from "../../../db/test/v2/db.ts";
import { settleAction } from "../app/app/settlements/actions";
import { LangProvider } from "../components/LangProvider";
import { Settlements } from "../components/Settlements";
import { SESSION_COOKIE, signSession } from "../lib/server/session";
import { loadSettlements } from "../lib/server/settlements";
import { state } from "./app-state";
import { AS_OF, openWebDb, urlAs, type WebDb } from "./home-db";
import { pinDay } from "./ops-db";

let db: WebDb;
let b: BansalSeed;
beforeAll(async () => {
  db = await openWebDb();
  b = await seedBansal(db.app, { asOf: AS_OF });
  pinDay();
  state.config = { databaseUrl: urlAs(db, "munshi_app"), agentDatabaseUrl: undefined, sessionSecret: Buffer.alloc(32, 7), demoTenantId: b.tenantId };
}, 240_000);
afterAll(async () => {
  vi.useRealTimers();
  await db.close();
});
afterEach(cleanup);

async function signInAs(who: Session) {
  const o = await openDemoSession(db.app, who.tenantId, who.memberId);
  if (!o || !state.config) throw new Error("test: no demo session");
  state.cookies.set(SESSION_COOKIE, signSession({ tenantId: who.tenantId, memberId: who.memberId, sessionId: o.session.sessionId as string, via: "demo" }, o.expiresAt, state.config.sessionSecret));
}
const q = async (sql: string) => (await tx(db.app, { tenant_id: b.tenantId }, (c) => c.query(sql))).rows;
const formFor = (intent: string, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("intent", intent);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
};

test("FEEDWEB the page offers the feed and says it is simulated", async () => {
  const data = await loadSettlements(b.owner);
  render(
    <LangProvider initial="en">
      <Settlements data={data as NonNullable<typeof data>} />
    </LangProvider>,
  );
  expect(document.body.textContent).toContain("Simulated payments feed (sample)");
  expect(document.querySelector('button[value="feed"]')?.textContent).toBe("Fetch from payments feed");
});

test("FEEDWEB fetching previews the unpaid day and the held day, and writes nothing", async () => {
  await signInAs(b.manager);
  const before = (await q("select count(*)::int as n from books.settlement"))[0]?.n;
  const done = await settleAction(null, formFor("feed"));
  if (!done || !("preview" in done)) throw new Error(`test: no preview ${JSON.stringify(done)}`);
  expect(done.preview.source).toBe("feed");
  expect(done.recorded).toBe(false);
  expect(done.preview.lines.map((l) => [l.txnDate, l.channel, l.status, l.verdict])).toEqual([
    ["2026-10-24", "upi", "SETTLED", "matched"], // day -3: the books lack its payout; the feed announces exactly the receipts
    ["2026-10-26", "upi", "ON_HOLD", "matched"], // yesterday: announced but held, so never recorded
  ]);
  expect(done.preview.canRecord).toBe(true);
  expect((await q("select count(*)::int as n from books.settlement"))[0]?.n).toBe(before);
});

test("FEEDWEB recording from the feed records what the feed announces, whatever rows or totals the browser posts", async () => {
  await signInAs(b.staff[0] as Session);
  const refused = await settleAction(null, formFor("record-feed"));
  expect(refused).toEqual({ error: "refused" });
  expect(await q("select 1 from books.settlement where utr like 'SIMFEED-%'")).toEqual([]);

  await signInAs(b.manager);
  const evil = JSON.stringify([["x"], ["2026-10-25", "2026-10-24", "UPI", "9999.00", "0.00", "9999.00", "EVIL-1", "SETTLED"]]);
  const done = await settleAction(null, formFor("record-feed", { rows: evil, total: "999900", statement: "ignored" }));
  expect(done && "recorded" in done && done.recorded).toBe(true);
  const [paid] = await q("select business_date::text as day, amount_minor::int as amount, utr, created_by::text as by from books.settlement where utr like 'SIMFEED-%'");
  const [took] = await q("select sum(amount_minor)::int as n from books.payment where method = 'upi' and direction = 'in' and (paid_at at time zone 'Asia/Kolkata')::date = date '2026-10-24'");
  expect(paid).toEqual({ day: "2026-10-24", amount: took?.n, utr: "SIMFEED-UPI-20261024", by: b.manager.memberId });
  expect(await q("select 1 from books.settlement where utr = 'EVIL-1'")).toEqual([]);
  // The held day is shown, never recorded.
  expect(await q("select 1 from books.settlement where utr = 'SIMFEED-UPI-20261026'")).toEqual([]);
  // Once the books hold the day, the feed has nothing new but the held day.
  const again = await settleAction(null, formFor("feed"));
  expect(again && "preview" in again && again.preview.lines.map((l) => l.status)).toEqual(["ON_HOLD"]);
});
