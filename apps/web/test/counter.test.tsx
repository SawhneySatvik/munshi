// The counter on the demo shop's books. The bill's prices and total are cells of sale.quote; a sale is recorded through
// the screen as the person signed in, priced by core from the books, on credit, in cash or by UPI (recorded, never
// processed); the receipt's figures are cells of sale.receipt and the ledgers, read after the commit. Every digit on
// the page is sourced.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { recordSaleAction } from "../app/counter/actions";
import { Counter } from "../components/Counter";
import { LangProvider } from "../components/LangProvider";
import type { CounterPage } from "../lib/ops-types";
import { loadCounter } from "../lib/server/counter";
import type { Lang } from "../lib/types";
import { state } from "./app-state";
import { AS_OF, type Home, openHome, rows, signInAs } from "./home-db";
import { bookCounts, formOf, pinDay } from "./ops-db";
import { fakeMatchMedia, unsourced } from "./render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
  pinDay();
});
afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (name: string) => h.k.items.get(name) as string;
const customer = (name: string) => h.k.customers.get(name) as string;
const staff = () => h.k.staff[0] as NonNullable<Home["k"]["staff"][0]>;
const show = (data: CounterPage, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <Counter data={data} />
    </LangProvider>,
  );
const todaySales = () => rows<{ id: string; created_by: string; customer_id: string }>(h, "select id, created_by, customer_id from books.sale where sold_at >= $1", [`${AS_OF}T00:00:00+05:30`]);
const owed = async (id: string) => Number((await rows<{ n: string }>(h, "select coalesce(sum(amount_minor), 0)::text as n from books.credit_entry where customer_id = $1", [id]))[0]?.n);

test("counter staff record a sale on credit through the screen: written under their name, priced from the books, the receipt read after it", async () => {
  const before = await owed(customer("Ramesh K."));
  signInAs(staff());
  const data = await loadCounter(staff());
  show(data);

  // Two packs of toor dal found by search (one tap, then the stepper), one tile tap for the best seller.
  fireEvent.change(screen.getByRole("searchbox", { name: "Find an item" }), { target: { value: "toor" } });
  fireEvent.click(within(document.querySelector(".found") as HTMLElement).getByRole("button", { name: "Toor dal 1 kg" }));
  fireEvent.click(screen.getByRole("button", { name: "One more Toor dal 1 kg" }));
  const tile = data.quick.find((id) => id !== item("Toor dal 1 kg"));
  const best = data.items.find((i) => i.id === tile) as { name: string; id: string };
  fireEvent.click(within(document.querySelector(".tiles") as HTMLElement).getByRole("button", { name: best.name }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: customer("Ramesh K.") } });

  // The bill's prices and total are cells of sale.quote, read as the bill was built: the total is the sum of the line
  // amounts (worked out here from the books' prices), and nothing on the bill is "Cannot verify".
  await waitFor(() => expect(document.querySelector(".bill .bill-total")).toBeTruthy(), { timeout: 30_000 });
  const billTotal = document.querySelector(".bill .bill-total") as HTMLElement;
  const [bestPrice] = await rows<{ amount_minor: string }>(h, "select amount_minor::text from books.price where item_id = $1 order by effective_from desc, created_at desc limit 1", [best.id]);
  const expectTotal = 30_000 + Number(bestPrice?.amount_minor);
  expect(billTotal.textContent).toContain(new Intl.NumberFormat("en-IN").format(expectTotal / 100));
  expect(document.querySelectorAll(".bill .line-cost .pair")).toHaveLength(4);
  expect(within(billTotal).getAllByRole("button", { name: /source: Price list/ })).toHaveLength(1);
  expect(document.querySelector(".bill .unverified")).toBeNull();
  expect(unsourced(document.body)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Record sale" }));
  await screen.findByRole("heading", { name: "Sale recorded" }, { timeout: 30_000 });

  const [sale, ...more] = await todaySales();
  expect(more).toEqual([]);
  expect(sale).toMatchObject({ created_by: staff().memberId, customer_id: customer("Ramesh K.") });
  const lines = await rows<{ item_id: string; qty_milli: string; unit_price_minor: string }>(
    h,
    "select item_id::text, qty_milli::text, unit_price_minor::text from books.sale_line where sale_id = $1 order by line_no",
    [sale?.id],
  );
  // Toor dal sells at ₹150 in the seed's catalogue (db/seed/kirana.ts): core priced the line from the books.
  expect(lines[0]).toEqual({ item_id: item("Toor dal 1 kg"), qty_milli: "2000", unit_price_minor: "15000" });
  expect(lines[1]).toMatchObject({ item_id: best.id, qty_milli: "1000" });
  const [audit] = await rows<{ actor_id: string }>(h, "select actor_id from audit.audit_log where entity = 'books.sale' and entity_id = $1", [sale?.id]);
  expect(audit?.actor_id).toBe(staff().memberId);
  const [chain] = await rows<{ broken: string | null }>(h, "select audit.verify_chain($1)::text as broken", [h.k.tenantId]);
  expect(chain).toEqual({ broken: null });

  // The receipt: stamped with the seller, and the customer's balance is the cell read after the sale, equal to the
  // credit book's own sum.
  const receipt = document.querySelector(".receipt") as HTMLElement;
  expect(receipt.textContent).toContain("Pooja Yadav");
  const after = await owed(customer("Ramesh K."));
  expect(after).toBe(before + 30_000 + Number(lines[1]?.unit_price_minor));
  const owes = within(receipt).getAllByRole("button", { name: /source: Credit book/ });
  expect(owes).toHaveLength(1);
  expect(owes[0]?.textContent).toContain(new Intl.NumberFormat("en-IN").format(after / 100));
  expect(within(receipt).getAllByRole("button", { name: /source: Stock ledger/ })).toHaveLength(2);
  // Its lines, total and tender are cells of sale.receipt, equal to what the books recorded.
  expect(receipt.textContent).not.toContain("Cannot verify");
  expect(within(receipt).getAllByRole("button", { name: /source: Sale receipt/ })).toHaveLength(2 * 3 + 1);
  expect(receipt.querySelector(".bill-total")?.textContent).toContain(new Intl.NumberFormat("en-IN").format(expectTotal / 100));
  const [booked] = await rows<{ total_minor: string }>(h, "select total_minor::text from books.sale where id = $1", [sale?.id]);
  expect(Number(booked?.total_minor)).toBe(expectTotal);
  expect(unsourced(document.body)).toEqual([]);

  // Today's line, read again: one bill, from a fresh cell.
  const again = await loadCounter(staff());
  const day = again.snapshots.find((s) => s.query === "sales.by_day");
  expect(day?.rows[0]?.bills).toEqual({ t: "int", v: 1 });
});

describe("what the counter refuses, with nothing written", () => {
  test("a sale posted with a part of a pack or an unknown item is refused", async () => {
    signInAs(staff());
    const before = await bookCounts(h);
    expect(await recordSaleAction(null, formOf({ tender: "cash", customer: "", item: item("Sugar 1 kg"), qty: "0" }))).toEqual({ error: "qty" });
    expect(await recordSaleAction(null, formOf({ tender: "bitcoin", customer: "", item: item("Sugar 1 kg"), qty: "1" }))).toEqual({ error: "other" });
    expect(await bookCounts(h)).toEqual(before);
  });

  test("no customer, a part of a pack, nothing in the bill, a signed-out request", async () => {
    signInAs(staff());
    const before = await bookCounts(h);
    const sale = (fields: Record<string, string | string[]>) => recordSaleAction(null, formOf({ tender: "credit", ...fields }));
    expect(await sale({ item: item("Sugar 1 kg"), qty: "1" })).toEqual({ error: "customer" });
    expect(await sale({ customer: customer("Ramesh K."), item: item("Sugar 1 kg"), qty: "1.5" })).toEqual({ error: "qty" });
    expect(await sale({ customer: customer("Ramesh K."), item: item("Sugar 1 kg"), qty: "0" })).toEqual({ error: "qty" });
    expect(await sale({ customer: customer("Ramesh K.") })).toEqual({ error: "empty" });
    state.cookies.clear();
    expect(await sale({ customer: customer("Ramesh K."), item: item("Sugar 1 kg"), qty: "1" })).toEqual({ error: "signed_out" });
    expect(await bookCounts(h)).toEqual(before);
  });
});

describe("cash and UPI are recorded (never processed) at exactly the quoted total", () => {
  for (const [tender, account, customerName] of [
    ["cash", "cash", ""],
    ["upi", "upi_clearing", "Ramesh K."],
  ] as const) {
    test(`${tender}${customerName ? " for a named customer" : ", a walk-in"}: one payment equal to the sale, nothing on credit`, async () => {
      signInAs(staff());
      const before = await owed(customerName ? customer(customerName) : customer("Ramesh K."));
      const result = await recordSaleAction(null, formOf({ tender, customer: customerName ? customer(customerName) : "", item: [item("Sugar 1 kg"), item("Toor dal 1 kg")], qty: ["2", "1"] }));
      if (!result || !("receipt" in result)) throw new Error(`the sale was refused: ${JSON.stringify(result)}`);
      const sales = await rows<{ id: string; total_minor: string; customer_id: string | null }>(h, "select id, total_minor::text, customer_id from books.sale order by created_at desc limit 1");
      const sale = sales[0] as { id: string; total_minor: string; customer_id: string | null };
      const pay = await rows<{ method: string; amount_minor: string }>(h, "select method, amount_minor::text from books.payment where sale_id = $1", [sale.id]);
      expect(pay).toEqual([{ method: tender, amount_minor: sale.total_minor }]);
      expect(sale.customer_id).toBe(customerName ? customer(customerName) : null);
      expect(await rows(h, "select 1 from books.credit_entry where sale_id = $1", [sale.id])).toEqual([]);
      const [journal] = await rows<{ account: string; n: string }>(h, "select account, amount_minor::text as n from books.journal_line l join books.journal_entry e on e.id = l.entry_id where e.source_id = $1 and l.amount_minor > 0", [sale.id]);
      expect(journal).toEqual({ account, n: sale.total_minor });
      expect(await owed(customer("Ramesh K."))).toBe(before);
      // The receipt: tender and total are cells of sale.receipt, equal to the books' total.
      expect(result.receipt.tender).toBe(tender);
      const paid = result.receipt.snapshots[0]?.rows[0]?.[result.receipt.paid.col];
      expect(paid).toMatchObject({ t: "money", minor: Number(sale.total_minor) });
    });
  }
});

describe("the page holds the guarantee for every role and language", () => {
  for (const who of ["owner", "staff"] as const) {
    for (const lang of ["en", "hi"] as Lang[]) {
      test(`${who}, ${lang}: every digit sourced; all three tenders open; nothing to price on an empty bill`, async () => {
        const session = who === "owner" ? h.k.owner : staff();
        const data = await loadCounter(session);
        expect(data.quick).toHaveLength(8);
        expect(data.canSell).toBe(true);
        show(data, lang);
        const chips = document.querySelectorAll(".today .pair");
        expect(chips).toHaveLength(3);
        for (const chip of chips) expect(chip.querySelector(".amt")?.textContent).toMatch(/[0-9]/);
        const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="tender"]')];
        expect(radios.map((r) => [r.value, r.disabled])).toEqual([
          ["cash", false],
          ["upi", false],
          ["credit", false],
        ]);
        expect(document.body.textContent).not.toContain(lang === "en" ? "Coming soon" : "जल्द आ रहा है");
        expect(document.querySelector(".bill .unverified")).toBeNull();
        expect(unsourced(document.body)).toEqual([]);
      });
    }
  }
});
