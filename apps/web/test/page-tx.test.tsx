// CORE-2 "one transaction per page" (BLUEPRINT §1.5, §4.2): an /app screen reads everything it shows in ONE member
// transaction (core's withPage), after the cookie's own check (sessionFrom: one system-scoped read of the session row).
// Each screen is rendered as the server renders it, against the test database, with every `begin` on the app's pool
// counted and sorted by the scope its set_config names (an actor: the page's; none: the session check).
import { renderToString } from "react-dom/server";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import AskPage from "../app/app/ask/page";
import BillPage from "../app/app/bills/[id]/page";
import NewBillPage from "../app/app/bills/new/page";
import BillsPage from "../app/app/bills/page";
import CounterPage from "../app/app/counter/page";
import CreditPage from "../app/app/credit/page";
import HomePage from "../app/app/page";
import ReportsPage from "../app/app/reports/page";
import StockPage from "../app/app/stock/page";
import StockTablePage from "../app/app/stock/table/page";
import SuppliersPage from "../app/app/suppliers/page";
import CustomerPage from "../app/app/customers/[id]/page";
import CustomersPage from "../app/app/customers/page";
import InvoicePage from "../app/app/invoices/[id]/page";
import InvoicesPage from "../app/app/invoices/page";
import LoyaltyPage from "../app/app/loyalty/page";
import OffersPage from "../app/app/offers/page";
import OrdersPage from "../app/app/orders/page";
import PackagesPage from "../app/app/packages/page";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { recordSale, runCommand, switchCapability } from "@munshi/core";
import { appPool } from "../lib/server/db";
import { type Home, openHome, rows, signInAs } from "./home-db";

let h: Home;
let billId: string;
let customerId: string;
let invoiceId: string;
beforeAll(async () => {
  h = await openHome();
  const [bill] = await rows<{ id: string }>(h, "select id::text from books.purchase where reverses_id is null order by bill_date desc limit 1");
  billId = bill?.id as string;
  // The kirana's pack lacks some BP-APP capabilities: switched on here (each requires the counter or staff, which it has),
  // and one invoiced sale (a package plan with a tax class, at a registered shop) for the invoice page.
  const pool = await appPool();
  for (const cap of ["packages", "loyalty", "bookings"] as const) await switchCapability(pool, h.k.owner, cap, true);
  customerId = h.k.customers.values().next().value as string;
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
  const [invoice] = await rows<{ id: string }>(h, "select id::text from books.invoice limit 1");
  invoiceId = invoice?.id as string;
});
afterAll(() => h.close());

type Count = { page: number; session: number };

// Wraps the pool's connect so every client it hands out reports its `begin`s; the scope is read from the set_config
// that withTx sends next (its second value is the actor: empty for a system-scoped transaction).
let restore: (() => void) | undefined;
async function counting(): Promise<Count> {
  const pool = (await appPool()) as pg.Pool;
  const count: Count = { page: 0, session: 0 };
  const connect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
  const wrapped = new WeakSet<pg.PoolClient>();
  let opening = false;
  (pool as { connect: unknown }).connect = async () => {
    const client = await connect();
    if (!wrapped.has(client)) {
      wrapped.add(client);
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      (client as { query: unknown }).query = (...a: unknown[]) => {
        const sql = typeof a[0] === "string" ? a[0].trim().toLowerCase() : "";
        if (sql === "begin") opening = true;
        else if (opening && sql.includes("set_config('munshi.actor_id'")) {
          opening = false;
          const actor = (a[1] as unknown[] | undefined)?.[1];
          count[actor ? "page" : "session"] += 1;
        }
        return query(...a);
      };
    }
    return client;
  };
  restore = () => {
    (pool as { connect: unknown }).connect = connect;
  };
  return count;
}
afterEach(() => {
  restore?.();
  restore = undefined;
});

const shown = (el: Awaited<ReturnType<typeof HomePage>>) =>
  renderToString(
    <LangProvider initial="en">
      <AskProvider who="test">{el}</AskProvider>
    </LangProvider>,
  );

const SCREENS: [string, () => ReturnType<typeof HomePage>][] = [
  ["/app (the owner home)", () => HomePage()],
  ["/app/counter", () => CounterPage()],
  ["/app/credit", () => CreditPage()],
  ["/app/ask", () => AskPage()],
  ["/app/stock", () => StockPage()],
  ["/app/stock/table", () => StockTablePage()],
  ["/app/bills", () => BillsPage()],
  ["/app/bills/new", () => NewBillPage()],
  ["/app/bills/[id]", () => BillPage({ params: Promise.resolve({ id: billId }), searchParams: Promise.resolve({}) })],
  ["/app/suppliers", () => SuppliersPage()],
  ["/app/reports", () => ReportsPage({ searchParams: Promise.resolve({}) })],
  ["/app/offers", () => OffersPage()],
  ["/app/packages", () => PackagesPage({ searchParams: Promise.resolve({}) })],
  ["/app/loyalty", () => LoyaltyPage()],
  ["/app/customers", () => CustomersPage()],
  ["/app/customers/[id]", () => CustomerPage({ params: Promise.resolve({ id: customerId }) })],
  ["/app/invoices", () => InvoicesPage({ searchParams: Promise.resolve({}) })],
  ["/app/invoices/[id]", () => InvoicePage({ params: Promise.resolve({ id: invoiceId }) })],
  ["/app/orders", () => OrdersPage()],
];

describe("one transaction per page", () => {
  for (const [name, render] of SCREENS) {
    test(`${name} opens exactly one page transaction (plus the cookie's session check) per render`, async () => {
      signInAs(h.k.owner);
      const count = await counting();
      const html = shown(await render());
      expect(html.length).toBeGreaterThan(500);
      expect(count).toEqual({ page: 1, session: 1 });
    });
  }
});
