// D-082 on the demo kirana as `pnpm dev` builds it: counter staff see the counter, the credit book and stock, and Home
// with only their own drafts and the stock findings, in quantities only (what stock cost the shop is the office's, and
// never leaves the server for them). A finding is explained or fixed only for a member who sees its whole row: a staff
// Why? abstains and mints nothing, its fix drafts nothing. The office's pages answer 404 when typed in, and the office's
// actions (a bill photo, the inbox's and campaigns' agents) refuse before any run. A staff question on the credit book is
// answered (recorded) and the Ask screen offers them only that recorded question. Every gate is core's map
// (packages/core/src/read-roles.ts). Red-proofs: db/test/v2/sabotage/roles.ts. Model turns: hero-script.ts (rewrite the
// staff router's with MUNSHI_WEB_FIXTURES=write).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { recordSale, runCommand, type Session, switchCapability } from "@munshi/core";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { askAction } from "../app/app/ask/actions";
import AskPage from "../app/app/ask/page";
import BillPage from "../app/app/bills/[id]/page";
import NewBillPage from "../app/app/bills/new/page";
import BillsPage from "../app/app/bills/page";
import { readBillAction } from "../app/app/bills/photo-actions";
import CalendarPage from "../app/app/calendar/page";
import { draftCopyAction } from "../app/app/campaigns/actions";
import CampaignsPage from "../app/app/campaigns/page";
import CounterPage from "../app/app/counter/page";
import CreditPage from "../app/app/credit/page";
import CustomerPage from "../app/app/customers/[id]/page";
import CustomersPage from "../app/app/customers/page";
import { fixAction, whyAction } from "../app/app/findings/actions";
import GrowthPage from "../app/app/growth/page";
import { draftOrderAction, draftReplyAction } from "../app/app/inbox/actions";
import InboxPage from "../app/app/inbox/page";
import InvoicePage from "../app/app/invoices/[id]/page";
import InvoicesPage from "../app/app/invoices/page";
import LoyaltyPage from "../app/app/loyalty/page";
import OfficePage from "../app/app/office/page";
import OffersPage from "../app/app/offers/page";
import OrdersPage from "../app/app/orders/page";
import PackagesPage from "../app/app/packages/page";
import HomePage from "../app/app/page";
import ReportsPage from "../app/app/reports/page";
import RequestsPage from "../app/app/requests/page";
import SettlementsPage from "../app/app/settlements/page";
import StaffPage from "../app/app/staff/page";
import SalaryPage from "../app/app/staff/salary/page";
import StockPage from "../app/app/stock/page";
import SuppliersPage from "../app/app/suppliers/page";
import type { AskPage as AskData } from "../components/AskView";
import type { AskTurn } from "../lib/hero-types";
import { RECORDED_QUESTIONS } from "../lib/i18n-hero";
import { appPool } from "../lib/server/db";
import { billSuppliers } from "../lib/server/hero";
import { loadBrief } from "../lib/server/office";
import { spokenText } from "../lib/server/speak";
import { writeBrief } from "../../../packages/core/src/brief.ts";
import { dataOf } from "./app-render";
import { NotFound } from "./app-state";
import { hideNavigatorWhileWriting, script, type Turn, WRITING } from "./hero-script";
import { type Home, homeFor, openHome, rows, signInAs } from "./home-db";
import { formOf } from "./ops-db";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: "ask" | "bill") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const [EN, , CREDIT] = RECORDED_QUESTIONS as [string, string, string];
// The credit question's turns, as hero-ask.test.tsx writes them: staff's router is shown two desks, so its request (and
// its recorded response) is its own; the desk's read, note and answer are the same requests as the owner's.
const CREDIT_TURNS: Turn[] = [
  { json: { desk: "credit" } },
  { tools: [{ name: "credit_balances", args: {} }] },
  { text: "Read 1, row 0 is the most overdue customer." },
  { json: { segments: [{ text: "⟦1⟧ owes ⟦2⟧, and ⟦3⟧ of it is past due since ⟦4⟧.", refs: ["customer_id", "balance", "overdue", "oldest_due_on"].map((col) => ({ read: 1, row: 0, col })) }] } },
];
const BILL = readFileSync(new URL("../../../packages/agent/fixtures/media/bill.png", import.meta.url));
const OFFICE_COLS = /"(unit_cost|at_risk_value|stock_value|loss)"/;

let h: Home;
let staff: Session;
let billId: string;
let customerId: string;
let invoiceId: string;
beforeAll(async () => {
  h = await openHome();
  staff = h.k.staff[0] as Session;
  billId = (await rows<{ id: string }>(h, "select id::text from books.purchase where reverses_id is null order by bill_date desc limit 1"))[0]?.id as string;
  customerId = h.k.customers.values().next().value as string;
  // The kirana's pack lacks these: switched on so their pages exist, for the owner (each requires staff or the counter).
  const pool = await appPool();
  for (const cap of ["bookings", "salary", "loyalty", "packages", "campaigns"] as const) await switchCapability(pool, h.k.owner, cap, true);
  // One invoiced sale (a package plan with a tax class, at a registered shop) for an invoice's page, as page-tx's.
  const [shop] = await rows<{ id: string }>(h, "select id::text from ops.shop order by created_at limit 1");
  await runCommand(pool, h.k.owner, "tax.registration.set", { scheme: "regular", gstin: "07AAAAA0000A1Z5", stateCode: "07", shops: [{ shopId: shop?.id as string, invoiceSeries: "SK" }] });
  const service = await runCommand(pool, h.k.owner, "item.create", { kind: "service", name: "Home delivery (sample)", durationMin: 30 });
  const plan = await runCommand(pool, h.k.owner, "package.plan.create", {
    name: "Delivery pass (sample)",
    priceMinor: 50_000,
    validityDays: 30,
    lines: [{ itemId: service.itemId as string, sessions: 4 }],
    taxClass: "general_18",
  });
  await recordSale(pool, h.k.owner, { shopId: shop?.id as string, customerId, lines: [{ itemId: plan.itemId as string, qtyMilli: 1000 }], payments: [{ method: "cash", amountMinor: 50_000 }] });
  invoiceId = (await rows<{ id: string }>(h, "select id::text from books.invoice limit 1"))[0]?.id as string;
  // The morning brief, its template lines (the jobs role's, as the tick writes it): the office's to read.
  await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: h.k.asOf });
});
afterAll(() => h.close());
beforeEach(() => {
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(staff);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]);
});

const count = async (sql: string, values: unknown[] = []) => Number((await rows<{ n: string }>(h, `select count(*)::text as n from ${sql}`, values))[0]?.n);
const findingOf = async (kind: string) =>
  (await rows<{ id: string }>(h, "select id::text from ai.finding where kind = $1 and status = 'open' order by created_at limit 1", [kind]))[0]?.id as string;
const sideEffects = async () => ({ runs: await count("ai.run"), snaps: await count("snap.snapshot"), reads: await count("ops.bill_read"), drafts: await count("approval.draft") });

test("R2 a counter staff member's Why? on a short settlement abstains and mints nothing; its fix drafts nothing", async () => {
  const id = await findingOf("short_settlement");
  expect(id).toBeTruthy();
  const [snaps, drafts] = [await count("snap.snapshot"), await count("approval.draft")];
  const r = (await whyAction(null, formOf({ finding: id }))) as { turn: AskTurn };
  expect(r.turn.reply).toEqual({ kind: "abstain", missing: ["unresolved"] });
  expect(r.turn.snapshots).toEqual([]); // the source drawer has nothing of the finding's row to show
  // A stock finding of theirs too: Why? hands a model the whole row, cost and all, so it is not theirs either.
  const shelf = (await whyAction(null, formOf({ finding: await findingOf("shrinkage") }))) as { turn: AskTurn };
  expect(shelf.turn.reply).toEqual({ kind: "abstain", missing: ["unresolved"] });
  // The overdue card's Why? (the office's credit total) abstains too, before its read.
  const card = (await whyAction(null, formOf({ card: "overdue_credit" }))) as { turn: AskTurn };
  expect(card.turn.reply).toEqual({ kind: "abstain", missing: ["not_for_role"] });
  expect(await fixAction(null, formOf({ finding: id }))).toEqual({ note: "fix_not_found", ok: false });
  expect(await count("snap.snapshot")).toBe(snaps);
  expect(await count("approval.draft")).toBe(drafts);

  // Home shows them the stock findings only, in quantities: no move hands a model their row, and no figure of what the
  // stock cost is in what the server sends (the screen's data, which the device also keeps offline).
  const theirs = await homeFor(staff);
  expect(new Set(theirs.findings.map((f) => f.kind))).toEqual(new Set(["shelf_gap", "expiry"]));
  for (const f of theirs.findings) expect([f.kind, f.why, f.fix]).toEqual([f.kind, false, false]);
  for (const f of theirs.findings) if (f.kind === "expiry") expect(f.value).toBeNull();
  expect(JSON.stringify(theirs)).not.toMatch(OFFICE_COLS);
  expect(theirs.unverified).toEqual([]);
  // The owner's carries them: the check above can fail.
  const owners = await homeFor(h.k.owner);
  expect(owners.findings.map((f) => f.kind)).toEqual(expect.arrayContaining(["shelf_gap", "price_rise", "overdue_credit", "expiry", "short_settlement"]));
  expect(JSON.stringify(owners)).toMatch(OFFICE_COLS);
  // The brief is the office's: none of it is loaded for staff, nor read aloud; the owner's is there.
  const brief = await loadBrief(staff);
  expect([brief.briefs, brief.snapshots]).toEqual([[], []]);
  const ownersBrief = await loadBrief(h.k.owner);
  expect(ownersBrief.briefs.length).toBeGreaterThan(0);
  expect(await spokenText(staff, { kind: "brief", id: ownersBrief.briefs[0]?.id as string }, "en")).toBeNull();
});

test("R2 the office's actions refuse counter staff before any run: a bill photo replayed, the inbox's and campaigns' agents", async () => {
  const gupta = h.k.suppliers.get("Gupta Traders (simulated)") as string;
  const photo = () => {
    const f = formOf({ supplier: gupta });
    f.set("photo", new Blob([BILL as BlobPart], { type: "image/png" }), "bill.png");
    return f;
  };
  // The owner reads the bill (its lines and unit costs are now stored); staff replay the very photo.
  signInAs(h.k.owner);
  const read = await readBillAction(null, photo());
  expect(read && "result" in read ? read.result.kind : read).toBe("read");
  signInAs(staff);
  const before = await sideEffects();
  const replay = await readBillAction(null, photo());
  expect(replay).toEqual({ error: "refused" });
  expect(JSON.stringify(replay)).not.toMatch(/unit_cost|bill_no/);
  expect(await billSuppliers(staff)).toBeTruthy();
  expect(await draftReplyAction(null, formOf({ message: randomUUID() }))).toEqual({ note: "errStaff", ok: false });
  expect(await draftOrderAction(null, formOf({ message: randomUUID() }))).toEqual({ note: "errStaff", ok: false });
  expect(await draftCopyAction(null, formOf({ campaign: randomUUID(), brief: "Diwali" }))).toEqual({ note: "errStaff", ok: false });
  expect(await sideEffects()).toEqual(before); // no run, no bill read stored, no snapshot, no draft (no model call)
});

test("R2 a counter staff member asks the credit book and is answered (recorded); Ask offers them only that question; they read their own answer aloud", async () => {
  const page = dataOf<AskData>(await AskPage());
  expect(page.questions).toEqual([CREDIT]);
  expect(page.questions).not.toContain(EN);
  if (WRITING) script.turns = [...CREDIT_TURNS];
  const r = (await askAction(null, formOf({ question: CREDIT }))) as { turn: AskTurn };
  expect(r.turn.reply.kind).toBe("answer");
  if (r.turn.reply.kind !== "answer") return;
  expect(r.turn.reply.desk).toBe("credit");
  expect(r.turn.snapshots.map((s) => s.query)).toEqual(["credit.balances"]);
  // Read aloud: their own answer, never another member's.
  expect(await spokenText(staff, { kind: "answer", id: r.turn.id }, "en")).toBeTruthy();
  expect(await spokenText(h.k.staff[1] as Session, { kind: "answer", id: r.turn.id }, "en")).toBeNull();
  signInAs(h.k.owner);
  expect(dataOf<AskData>(await AskPage()).questions).toEqual(RECORDED_QUESTIONS);
});

const OFFICE: [string, () => Promise<unknown>][] = [
  ["/app/reports", () => ReportsPage({ searchParams: Promise.resolve({}) })],
  ["/app/bills", () => BillsPage()],
  ["/app/bills/new", () => NewBillPage()],
  ["/app/bills/[id]", () => BillPage({ params: Promise.resolve({ id: billId }), searchParams: Promise.resolve({}) })],
  ["/app/suppliers", () => SuppliersPage()],
  ["/app/offers", () => OffersPage()],
  ["/app/invoices", () => InvoicesPage({ searchParams: Promise.resolve({}) })],
  ["/app/invoices/[id]", () => InvoicePage({ params: Promise.resolve({ id: invoiceId }) })],
  ["/app/staff", () => StaffPage()],
  ["/app/inbox", () => InboxPage()],
  ["/app/campaigns", () => CampaignsPage()],
  ["/app/requests", () => RequestsPage()],
  ["/app/staff/salary", () => SalaryPage({ searchParams: Promise.resolve({}) })],
  ["/app/loyalty", () => LoyaltyPage()],
  ["/app/growth", () => GrowthPage()],
  ["/app/settlements", () => SettlementsPage()],
  ["/app/orders", () => OrdersPage()],
  ["/app/packages", () => PackagesPage({ searchParams: Promise.resolve({}) })],
  ["/app/customers", () => CustomersPage()],
  ["/app/customers/[id]", () => CustomerPage({ params: Promise.resolve({ id: customerId }) })],
  ["/app/calendar", () => CalendarPage({ searchParams: Promise.resolve({}) })],
  ["/app/office", () => OfficePage()],
];

test("R5 counter staff get 404 on reports, bills, suppliers and the office's other pages; the owner gets each page; staff keep their own", async () => {
  const snaps = await count("snap.snapshot");
  for (const [path, page] of OFFICE) await expect(page(), path).rejects.toBeInstanceOf(NotFound);
  expect(await count("snap.snapshot")).toBe(snaps);
  for (const page of [HomePage, CounterPage, CreditPage, StockPage]) await expect(page()).resolves.toBeTruthy();
  signInAs(h.k.owner);
  for (const [path, page] of OFFICE) await expect(page(), path).resolves.toBeTruthy();
});
