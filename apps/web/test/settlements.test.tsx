// Settlements on the web: /app/settlements on the Bansal demo shop (db/seed/bansal.ts). The page is an owner's or a manager's
// (staff get 404), and every digit it shows of the books is a cell. Recording reads the uploaded file and nothing else
// of the form: rows or totals a browser adds beside the file are ignored, so the payout recorded is the file's.
import { readFileSync } from "node:fs";
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
import { unsourced } from "./render";

let db: WebDb;
let b: BansalSeed;
const SAMPLE = readFileSync(new URL("../../../db/seed/merchants/bansal/settlement-2026-10-27.csv", import.meta.url));
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
const imported = async () =>
  (await tx(db.app, { tenant_id: b.tenantId }, (c) => c.query("select business_date::text as day, amount_minor::int as amount from books.settlement where utr is not null"))).rows;

test("SETTLEWEB the page is an owner's or a manager's, and every figure of the books on it is a cell", async () => {
  expect(await loadSettlements(b.staff[0] as Session)).toBeNull();
  const data = await loadSettlements(b.owner);
  expect(data?.days.length).toBe(30); // days -30 … -1, each with UPI receipts
  render(
    <LangProvider initial="en">
      <Settlements data={data as NonNullable<typeof data>} />
    </LangProvider>,
  );
  expect(document.body.textContent).toContain("Sample statement");
  expect(unsourced(document.body)).toEqual([]);
});

test("SETTLEWEB a tampered total beside the file is ignored: the payout recorded is the file's", async () => {
  await signInAs(b.manager);
  const form = new FormData();
  form.set("statement", new File([SAMPLE], "settlement-2026-10-27.csv", { type: "text/csv" }));
  form.set("intent", "record");
  // What a browser that parsed the file itself might post: day -3's payout raised to ₹9,999.
  const rows = SAMPLE.toString("utf8").split("\n").map((l) => l.split(","));
  const day3 = rows.findIndex((r) => r[1] === "2026-10-24");
  rows[day3] = [rows[day3]?.[0] ?? "", "2026-10-24", "UPI", "9999.00", "0.00", "9999.00", "SAMPLE-UTR-20261024", "SETTLED"];
  form.set("rows", JSON.stringify(rows));
  form.set("total", "999900");
  const done = await settleAction(null, form);
  expect(done && "recorded" in done && done.recorded).toBe(true);
  expect(await imported()).toEqual([{ day: "2026-10-24", amount: 213_800 }]);
});
