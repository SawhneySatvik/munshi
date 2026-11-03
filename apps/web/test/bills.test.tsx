// Bills on the kirana seed. The list and a bill's page show only cells (bills.recent; each line its row of the item's
// purchases.price_history), match what the journal and the line table hold, and carry every supplier's "simulated"
// label. Recording a bill by hand runs purchase.record as the signed-in member: the owner's lands in the books under
// the owner with its audit entries (the chain verifies), the counter staff's role is refused and nothing is written, a
// duplicate bill number and a malformed figure are refused, and a price above the last bill is flagged with that cell.
import { randomUUID } from "node:crypto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lastPrice, recordBill } from "../app/app/bills/actions";
import { BillForm } from "../components/books/BillForm";
import { BillView } from "../components/books/BillView";
import { BillsView } from "../components/books/BillsView";
import { loadBill, loadBillForm, loadBills } from "../lib/server/bills";
import type { Lang } from "../lib/types";
import { Redirect, state } from "./helpers/app-state";
import { one, renderPage, storedValue } from "./helpers/books-render";
import { AS_OF, type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { DIGIT, fakeMatchMedia, unsourced } from "./helpers/render";

let h: Home;
let gupta: string;
let butter: string;
beforeAll(async () => {
  h = await openHome();
  gupta = h.k.suppliers.get("Gupta Traders (simulated)") as string;
  butter = h.k.items.get("Butter 100 g") as string;
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.cookies.clear();
});

const count = async (table: string) => (await one<{ n: number }>(h, `select count(*)::int as n from ${table}`)).n;
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ key: randomUUID(), ...fields })) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
// Gupta Traders' paper bill: twelve packs of butter at ₹62.50, above the last bill's ₹60.
const PAPER = { supplier: "", billNo: "GT-9001", billDate: AS_OF, line: "0", "item-0": "", "qty-0": "12", "cost-0": "62.50" };
const paper = (over: Record<string, string | string[]> = {}) => form({ ...PAPER, supplier: gupta, "item-0": butter, ...over });
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) return err.to;
    throw err;
  }
  return null;
};

describe("the month's bills", () => {
  test("every live bill dated in the month to as_of, each total the journal's inventory debit for it", async () => {
    const data = await loadBills(h.k.owner);
    const expected = await rows<{ id: string; total: number }>(
      h,
      `select p.id::text, l.amount_minor::int as total
         from books.purchase p
         join books.journal_entry e on e.tenant_id = p.tenant_id and e.source_rel = 'books.purchase' and e.source_id = p.id
         join books.journal_line l on l.tenant_id = e.tenant_id and l.entry_id = e.id and l.account = 'inventory'
        where p.reverses_id is null and p.bill_date > $1::date - 31 and p.bill_date <= $1::date`,
      [AS_OF],
    );
    expect(expected.length).toBeGreaterThan(10);
    expect(data.bills.map((b) => [b.id, storedValue(data.snapshots, b.total)]).sort()).toEqual(expected.map((e) => [e.id, e.total]).sort());
    expect(data.canRecord).toBe(true);
  });

  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: two figures a bill and no loose digit; every supplier labelled simulated; the photo slot is marked`, async () => {
      const data = await loadBills(h.k.owner);
      renderPage(<BillsView data={data} />, lang);
      const figures = document.querySelectorAll(".pair");
      expect(figures.length).toBe(2 * data.bills.length);
      for (const f of figures) expect(f.querySelector(".amt")?.textContent ?? "").toMatch(DIGIT);
      expect(unsourced(document.body)).toEqual([]);
      const rowsShown = document.querySelectorAll(".bk-bills-table tbody tr");
      expect(rowsShown.length).toBe(data.bills.length);
      for (const r of rowsShown) expect(r.querySelector(".sticker-yellow")?.textContent).toBe(lang === "en" ? "Simulated supplier" : "सिम्युलेटेड सप्लायर");
      const slot = document.querySelector('[data-slot="bill-photo"]') as HTMLElement;
      expect(within(slot).getByRole("button")).toHaveProperty("disabled", true);
      expect(slot.textContent).toContain(lang === "en" ? "Coming soon" : "जल्द आ रहा है");
    });
  }

  test("the counter staff are not shown the bills: no bills for their role, and nothing is minted", async () => {
    const before = await count("snap.snapshot");
    expect(await loadBills(h.k.staff[0] as typeof h.k.owner)).toBeNull();
    expect(await count("snap.snapshot")).toBe(before);
    // A manager still sees them, with the way to record one.
    expect((await loadBills(h.k.manager))?.canRecord).toBe(true);
  });
});

describe("a bill's page", () => {
  test("Gupta Traders' bill after the rise: its lines are the line table's, and both rises are cited against the bill before", async () => {
    const { id } = await one<{ id: string }>(
      h,
      "select id::text from books.purchase where supplier_id = $1 and bill_date = $2::date - 27 and reverses_id is null",
      [gupta, AS_OF],
    );
    const data = await loadBill(h.k.owner, id, false);
    if (!data) throw new Error("the bill loads");
    const lines = await rows<{ item: string; qty: number; cost: number }>(
      h,
      `select i.name as item, pl.qty_milli::int as qty, pl.unit_cost_minor::int as cost
         from books.purchase_line pl join lateral (select r.name from books.item_revision r where r.tenant_id = pl.tenant_id and r.item_id = pl.item_id order by r.effective_from desc, r.created_at desc, r.id desc limit 1) i on true
        where pl.purchase_id = $1 order by pl.line_no`,
      [id],
    );
    expect(lines.length).toBeGreaterThan(2);
    expect(data.lines.map((l) => ({ item: l.item, qty: storedValue(data.snapshots, l.qty), cost: storedValue(data.snapshots, l.cost) }))).toEqual(lines);
    expect(storedValue(data.snapshots, data.bill.lines)).toBe(lines.length);
    // The seed's answer key: Butter rose from ₹56 to ₹60 on this bill; Cream biscuits from ₹20 to ₹20.40 (a control under
    // the watcher's 5%, still a rise on the bill).
    expect(data.rises.map((r) => (r.kind === "price_rise" ? [r.item, storedValue(data.snapshots, r.was), storedValue(data.snapshots, r.now)] : null))).toEqual([
      ["Cream biscuits 100 g", 2000, 2040],
      ["Butter 100 g", 5600, 6000],
    ]);
    expect(data.entered.by).toBe("Anil Verma");
    expect(data.justRecorded).toBe(false);
    renderPage(<BillView data={data} />);
    expect(document.querySelectorAll(".bk-lines-table .sticker-yellow")).toHaveLength(2);
    expect(screen.getAllByText("Simulated supplier").length).toBeGreaterThan(0);
    expect(document.querySelector(".stamp")).toBeNull();
    expect(unsourced(document.body)).toEqual([]);
  });

  test("an id that is not one of this shop's bills is not found", async () => {
    expect(await loadBill(h.k.owner, "00000000-0000-4000-8000-000000000000", false)).toBeNull();
    expect(await loadBill(h.k.owner, "not-a-uuid", false)).toBeNull();
  });
});

describe("recording a bill by hand", () => {
  test("the form's last-bill price is the item's latest bill cell, and a typed price above it is flagged with that cell", async () => {
    signInAs(h.k.owner);
    const last = await lastPrice(butter);
    expect(last.cost && storedValue([last.snapshot], last.cost)).toBe(6000); // the answer key's latest cost for Butter
    expect(last.cost?.label.en).toBe("Gupta Traders' bill");
    // No read behind it, no statement: a bad id or no session is an error the form shows as Cannot verify.
    await expect(lastPrice("not-a-uuid")).rejects.toThrow();

    renderPage(<BillForm data={await loadBillForm(h.k.owner)} formKey="test-form-key" />);
    fireEvent.change(document.querySelector('select[name="item-0"]') as HTMLSelectElement, { target: { value: butter } });
    await screen.findByText(/Last bill:/);
    const cost = document.querySelector('input[name="cost-0"]') as HTMLInputElement;
    fireEvent.change(cost, { target: { value: "62.50" } });
    const flag = document.querySelector(".bk-price.is-rise") as HTMLElement;
    expect(flag.textContent).toContain("Price rise");
    expect(within(flag).getByRole("button").textContent).toContain("₹60");
    fireEvent.change(cost, { target: { value: "60" } });
    await waitFor(() => expect(document.querySelector(".bk-price.is-rise")).toBeNull());
    expect(unsourced(document.body)).toEqual([]);
  });

  test("the counter staff's role is refused, is shown no form, and nothing is written", async () => {
    const staff = h.k.staff[0] as typeof h.k.owner;
    const before = await count("books.purchase");
    signInAs(staff);
    expect(await recordBill(null, paper())).toEqual({ error: "refused" });
    expect(await count("books.purchase")).toBe(before);
    // The form is the office's too, so staff have no form page at all (the page answers 404).
    expect(await loadBillForm(staff)).toBeNull();
  });

  test("malformed figures are refused field by field, before anything is written", async () => {
    const before = await count("books.purchase");
    signInAs(h.k.owner);
    expect(await recordBill(null, paper({ "qty-0": "1.5", "cost-0": "6O" }))).toEqual({ error: "invalid", fields: ["qty-0", "cost-0"] });
    expect(await recordBill(null, paper({ supplier: "nobody" }))).toEqual({ error: "invalid", fields: ["supplier"] });
    expect(await count("books.purchase")).toBe(before);
  });

  test("not signed in: nothing is written, and no last price is read", async () => {
    const before = await count("books.purchase");
    await expect(lastPrice(butter)).rejects.toThrow();
    expect(await recordBill(null, paper())).toEqual({ error: "signed_out" });
    expect(await count("books.purchase")).toBe(before);
  });

  test("the owner's bill is written under the owner, the books re-derive its amounts, the audit chain verifies, and the bill's page stamps it", async () => {
    signInAs(h.k.owner);
    // A total in the form is not an input: the command takes none and the action sends none.
    const to = await redirectOf(recordBill(null, paper({ total: "1" })));
    const id = /^\/app\/bills\/([0-9a-f-]{36})\?recorded=1$/.exec(to ?? "")?.[1];
    if (!id) throw new Error(`redirected to ${to}`);
    expect(state.revalidated).toContain("/app/bills");
    const p = await one<{ created_by: string; total: number; bill_no: string; supplier_id: string }>(
      h,
      "select created_by::text, total_minor::int as total, bill_no, supplier_id::text from books.purchase where id = $1",
      [id],
    );
    expect(p).toEqual({ created_by: h.k.owner.memberId, total: 12 * 6250, bill_no: "GT-9001", supplier_id: gupta });
    const moved = await one<{ qty: number }>(h, "select sum(qty_milli)::int as qty from books.stock_move where source_id = $1", [id]);
    expect(moved.qty).toBe(12_000);
    const audit = await rows<{ entity: string; actor_id: string }>(
      h,
      "select entity, actor_id::text from audit.audit_log where entity = 'books.purchase' and entity_id = $1",
      [id],
    );
    expect(audit).toEqual([{ entity: "books.purchase", actor_id: h.k.owner.memberId }]);
    expect(await one<{ broken: string | null }>(h, "select audit.verify_chain($1)::text as broken", [h.k.tenantId])).toEqual({ broken: null });

    const data = await loadBill(h.k.owner, id, true);
    if (!data) throw new Error("the new bill loads");
    expect(data.justRecorded).toBe(true);
    expect(storedValue(data.snapshots, data.bill.total)).toBe(75_000);
    expect(data.rises.map((r) => (r.kind === "price_rise" ? [storedValue(data.snapshots, r.was), storedValue(data.snapshots, r.now)] : null))).toEqual([[6000, 6250]]);
    renderPage(<BillView data={data} />);
    expect(document.querySelector(".stamp")?.textContent).toBe("Recorded");
    expect(document.body.textContent).toContain("Entered by Rajesh Sharma");
    expect(unsourced(document.body)).toEqual([]);
    // Only the person who entered it sees it stamped as theirs.
    expect((await loadBill(h.k.manager, id, true))?.justRecorded).toBe(false);

    // The same supplier's bill number again is a conflict, and nothing more is written.
    const before = await count("books.purchase");
    expect(await recordBill(null, paper())).toEqual({ error: "conflict" });
    expect(await count("books.purchase")).toBe(before);
  });
});
