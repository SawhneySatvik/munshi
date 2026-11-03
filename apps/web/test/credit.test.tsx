// The credit book on the demo shop's books. Counter staff record a payment received (recorded, never processed); credit
// given is the owner's or a manager's, and the database refuses staff whatever is posted. Each balance shown is a cell,
// equal to the credit book's own sum, read after the write. Every digit on the page is sourced.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { recordCreditAction } from "../app/app/credit/actions";
import { CreditBook } from "../components/CreditBook";
import { LangProvider } from "../components/LangProvider";
import type { CreditPage } from "../lib/ops-types";
import { resolveCell } from "../lib/snapshot";
import { loadCredit } from "../lib/server/credit";
import type { Lang, SourceRef } from "../lib/types";
import { type Home, openHome, rows, signInAs } from "./home-db";
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

const customer = (name: string) => h.k.customers.get(name) as string;
const staff = () => h.k.staff[0] as NonNullable<Home["k"]["staff"][0]>;
const show = (data: CreditPage, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <CreditBook data={data} formKey="test-form-key" />
    </LangProvider>,
  );
const owed = async (id: string) => Number((await rows<{ n: string }>(h, "select coalesce(sum(amount_minor), 0)::text as n from books.credit_entry where customer_id = $1", [id]))[0]?.n);
const cellMinor = (snapshots: CreditPage["snapshots"], ref: SourceRef | null) => {
  const cell = ref && resolveCell(snapshots, ref);
  return cell?.t === "money" ? cell.minor : null;
};

test("counter staff record a payment through the screen: written under their name, and the new balance is the cell read after it", async () => {
  const ramesh = customer("Ramesh K.");
  const before = await owed(ramesh);
  signInAs(staff());
  show(await loadCredit(staff()));
  fireEvent.click(screen.getByRole("button", { name: "Record for Ramesh K." }));
  expect((screen.getByRole("combobox", { name: "Customer" }) as HTMLSelectElement).value).toBe(ramesh);
  fireEvent.change(screen.getByRole("textbox", { name: "Amount (₹)" }), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("radio", { name: "UPI" }));
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  const status = await screen.findByText(/now owes/, {}, { timeout: 30_000 });

  const [payment, ...more] = await rows<{ id: string; created_by: string; method: string; amount_minor: string; direction: string }>(
    h,
    "select id, created_by, method, amount_minor::text, direction from books.payment where customer_id = $1 and sale_id is null and paid_at >= '2026-10-27T00:00:00+05:30'",
    [ramesh],
  );
  expect(more).toEqual([]);
  expect(payment).toMatchObject({ created_by: staff().memberId, method: "upi", amount_minor: "20000", direction: "in" });
  const [audit] = await rows<{ actor_id: string }>(h, "select actor_id from audit.audit_log where entity = 'books.payment' and entity_id = $1", [payment?.id]);
  expect(audit?.actor_id).toBe(staff().memberId);
  expect(await owed(ramesh)).toBe(before - 20_000);
  expect(status.closest(".recorded")?.textContent).toContain("Pooja Yadav");
  expect(within(status).getByRole("button").textContent).toContain(new Intl.NumberFormat("en-IN").format((before - 20_000) / 100));
  expect(unsourced(document.body)).toEqual([]);
});

describe("credit given: the owner's or a manager's", () => {
  test("counter staff are offered it disabled, and posting it anyway is refused by the database with nothing written", async () => {
    const data = await loadCredit(staff());
    expect([data.canPayment, data.canCredit]).toEqual([true, false]);
    show(data);
    expect((screen.getByRole("radio", { name: "Credit given" }) as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Credit given is recorded by the owner or a manager.");

    signInAs(staff());
    const before = await bookCounts(h);
    const form = formOf({ kind: "credit", customer: customer("Ramesh K."), amount: "500" });
    expect(await recordCreditAction(null, form)).toEqual({ error: "refused" });
    expect(await bookCounts(h)).toEqual(before);
  });

  test("the owner records credit given; the balance cell read after it equals the credit book's sum", async () => {
    const asha = [...h.k.customers.keys()].find((n) => !["Ramesh K.", "Sunita P."].includes(n)) as string;
    const before = await owed(customer(asha));
    signInAs(h.k.owner);
    const result = await recordCreditAction(null, formOf({ kind: "credit", customer: customer(asha), amount: "1,250.50" }));
    if (!result || !("done" in result)) throw new Error(`expected a recorded entry, got ${JSON.stringify(result)}`);
    expect(await owed(customer(asha))).toBe(before + 125_050);
    expect(cellMinor(result.done.snapshots, result.done.owes)).toBe(before + 125_050);
    expect(result.done.stamp.by).toBe("Rajesh Sharma");
    const [entry] = await rows<{ created_by: string }>(h, "select created_by from books.credit_entry where customer_id = $1 order by at desc limit 1", [customer(asha)]);
    expect(entry?.created_by).toBe(h.k.owner.memberId);
  });
});

test("an amount that is not rupees, or no customer, is refused before the books", async () => {
  signInAs(h.k.owner);
  const before = await bookCounts(h);
  for (const amount of ["", "0", "-5", "12.345", "abc", "1e3"]) {
    expect(await recordCreditAction(null, formOf({ kind: "payment", method: "cash", customer: customer("Ramesh K."), amount }))).toEqual({ error: "amount" });
  }
  expect(await recordCreditAction(null, formOf({ kind: "payment", method: "cash", amount: "10" }))).toEqual({ error: "customer" });
  expect(await bookCounts(h)).toEqual(before);
});

describe("the page holds the guarantee for every role and language", () => {
  for (const who of ["owner", "staff"] as const) {
    for (const lang of ["en", "hi"] as Lang[]) {
      test(`${who}, ${lang}: every balance a chip, overdue marked from its cell, every digit sourced`, async () => {
        const data = await loadCredit(who === "owner" ? h.k.owner : staff());
        const late = data.owing.filter((r) => {
          const cell = resolveCell(data.snapshots, r.overdue);
          return cell?.t === "money" && cell.minor > 0;
        });
        // The answer key plants three customers overdue (db/seed/kirana.answers.json); others may owe a little late too.
        expect(late.length).toBeGreaterThanOrEqual(3);
        expect(data.owing.filter((r) => r.late)).toEqual(late);
        show(data, lang);
        expect(document.querySelectorAll(".owing .pair .ref")).toHaveLength(data.owing.length * 2 + late.length);
        // The overdue marks; the office's PayPal panel (D-079) carries its own sandbox sticker on each row.
        expect([...document.querySelectorAll(".owing .sticker-ink")].filter((s) => !s.closest("[data-paypal]"))).toHaveLength(late.length);
        expect(unsourced(document.body)).toEqual([]);
      });
    }
  }
});
