// The growth page on the demo shop (db/seed/bansal.ts): an owner's or a manager's (staff get 404), every
// figure on it a cell of a snapshot minted for the page, and nothing on it written. The shop's own sales and payments
// are the only source: no figure is typed.
import type { Session } from "@munshi/core";
import { cleanup, render, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { type BansalSeed, seedBansal } from "../../../db/seed/bansal.ts";
import { Growth } from "../components/Growth";
import { LangProvider } from "../components/LangProvider";
import { loadGrowth } from "../lib/server/growth";
import { state } from "./app-state";
import { AS_OF, openWebDb, urlAs, type WebDb } from "./home-db";
import { tx } from "../../../db/test/v2/db.ts";
import { pinDay } from "./ops-db";
import { unsourced } from "./render";

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

const counts = async () =>
  (await tx(db.app, { tenant_id: b.tenantId }, (c) => c.query("select (select count(*) from books.sale)::int s, (select count(*) from books.payment)::int p, (select count(*) from books.settlement)::int t, (select count(*) from audit.audit_log)::int a"))).rows[0];

const show = (data: NonNullable<Awaited<ReturnType<typeof loadGrowth>>>) =>
  render(
    <LangProvider initial="en">
      <Growth data={data} />
    </LangProvider>,
  );

test("GROWWEB the page is an owner's or a manager's; staff get null (404)", async () => {
  expect(await loadGrowth(b.staff[0] as Session)).toBeNull();
  expect(await loadGrowth(b.manager)).not.toBeNull();
});

test("GROWWEB every figure is a cell, the readings are there, and reading writes nothing", async () => {
  const before = await counts();
  const data = await loadGrowth(b.owner);
  if (!data) throw new Error("test: no page");
  // The seed rings up 24 bills a day for 30 days: every weekday has a busiest hour; one SKU never sells; UPI and cash only.
  expect(data.peak.map((p) => p.weekday).sort()).toEqual(["Fri", "Mon", "Sat", "Sun", "Thu", "Tue", "Wed"]);
  expect(data.basket.length).toBe(4);
  expect(data.slow.length).toBeGreaterThanOrEqual(1);
  expect(data.mix.map((m) => m.method)).toEqual(["cash", "upi"]);
  expect(data.customers).not.toBeNull();
  const view = show(data);
  const text = document.body.textContent ?? "";
  expect(text).toContain("Busiest hour, by weekday");
  expect(text).toContain("Slow movers");
  expect(text).not.toContain("Cannot verify");
  expect(within(view.container).getAllByRole("button").length).toBeGreaterThan(30); // each figure is a tap for its source
  expect(unsourced(document.body)).toEqual([]);
  expect(await counts()).toEqual(before);
});

test("GROWWEB a figure typed beside the cells is caught by the gate (red proof)", async () => {
  const data = await loadGrowth(b.owner);
  if (!data) throw new Error("test: no page");
  const view = show(data);
  const p = document.createElement("p");
  p.textContent = "Sales rose 12 percent";
  view.container.appendChild(p);
  expect(unsourced(document.body)).toEqual(['P: "Sales rose 12 percent"']);
});
