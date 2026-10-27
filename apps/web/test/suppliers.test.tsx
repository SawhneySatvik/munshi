// Suppliers on the kirana seed: every supplier is labelled simulated; each one's last bill and the last price of every
// item on it are cells that match the books' own latest bill lines; the reorder draft is decided from this page through
// the app's decideDraft as the signed-in member (approved: the books written under that member and the audit chain
// verifies; rejected: nothing written), and the counter staff's role is refused and offered no buttons.
import { cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { proposeDemoDraft } from "../../../db/src/dev.ts";
import { decideDraft } from "../app/actions";
import { SuppliersView } from "../components/books/SuppliersView";
import { loadSuppliers } from "../lib/server/suppliers";
import type { Lang } from "../lib/types";
import { state } from "./app-state";
import { one, renderPage, storedValue } from "./books-render";
import { AS_OF, type Home, openHome, rows, signInAs } from "./home-db";
import { fakeMatchMedia, unsourced } from "./render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.cookies.clear();
});

const decide = (draftId: string, verdict: "approved" | "rejected") => {
  const form = new FormData();
  form.set("draft", draftId);
  form.set("verdict", verdict);
  return decideDraft(null, form);
};
const count = async (table: string) => (await one<{ n: number }>(h, `select count(*)::int as n from ${table}`)).n;

describe("the suppliers and their last prices", () => {
  test("each supplier's last bill, and every item on it at its latest bill price, as the line table holds them", async () => {
    const data = await loadSuppliers(h.k.owner);
    expect(data.suppliers.map((s) => [s.supplier.name, s.supplier.simulated])).toEqual([
      ["Balaji Agencies", true],
      ["Gupta Traders", true],
      ["Mehta Distributors", true],
    ]);
    // Independently: each supplier's latest live bill in the month, and for each of its lines whose item was last
    // billed by that supplier, that item's latest bill line.
    const expected = await rows<{ supplier_id: string; purchase_id: string; item: string; cost: number }>(
      h,
      `with last_bill as (
         select distinct on (supplier_id) id, supplier_id from books.purchase
          where reverses_id is null and bill_date > $1::date - 31 and bill_date <= $1::date
          order by supplier_id, bill_date desc, bill_no
       ), latest_line as (
         select distinct on (pl.item_id) pl.item_id, pl.unit_cost_minor, p.supplier_id
           from books.purchase_line pl join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
          where p.reverses_id is null order by pl.item_id, p.bill_date desc, p.created_at desc, pl.line_no desc
       )
       select lb.supplier_id::text, lb.id::text as purchase_id, i.name as item, ll.unit_cost_minor::int as cost
         from last_bill lb
         join books.purchase_line pl on pl.purchase_id = lb.id
         join books.item i on i.id = pl.item_id
         join latest_line ll on ll.item_id = pl.item_id and ll.supplier_id = lb.supplier_id
        order by lb.supplier_id, pl.line_no`,
      [AS_OF],
    );
    expect(expected.length).toBeGreaterThan(5);
    for (const card of data.suppliers) {
      const mine = expected.filter((e) => e.supplier_id === card.id);
      expect(card.lastBill?.id).toBe(mine[0]?.purchase_id);
      expect(card.prices.map((p) => [p.item, storedValue(data.snapshots, p.cost)])).toEqual(mine.map((e) => [e.item, e.cost]));
    }
  });

  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: every supplier labelled "Simulated supplier"; a figure per price, two per last bill, and no loose digit`, async () => {
      const data = await loadSuppliers(h.k.owner);
      renderPage(<SuppliersView data={data} />, lang);
      const firms = [...document.querySelectorAll(".bk-firm")] as HTMLElement[];
      expect(firms).toHaveLength(3);
      for (const f of firms) expect(within(f).getByText(lang === "en" ? "Simulated supplier" : "सिम्युलेटेड सप्लायर")).toBeTruthy();
      const prices = data.suppliers.reduce((n, s) => n + s.prices.length, 0);
      const bills = data.suppliers.filter((s) => s.lastBill).length;
      // The waiting reorder's quantity, the price rise's two cells, then each supplier's figures.
      expect(document.querySelectorAll(".pair").length).toBe(1 + 2 + prices + 2 * bills);
      expect(unsourced(document.body)).toEqual([]);
    });
  }
});

describe("deciding a reorder from the suppliers page", () => {
  test("the counter staff's role is offered no buttons, is refused, and nothing changes", async () => {
    const staff = h.k.staff[0] as typeof h.k.owner;
    const data = await loadSuppliers(staff);
    renderPage(<SuppliersView data={data} />);
    const card = document.querySelector(".pending") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(card.textContent).toContain("Waiting for someone allowed to approve it.");
    signInAs(staff);
    const before = await count("books.outbound_message");
    expect(await decide(h.draftId, "approved")).toEqual({ error: "refused" });
    expect(await count("books.outbound_message")).toBe(before);
    expect(await count("approval.decision")).toBe(0);
  });

  test("approved by the owner: the order is written under the owner, the audit chain verifies, and the page shows it stamped", async () => {
    signInAs(h.k.owner);
    expect(await decide(h.draftId, "approved")).toBeNull();
    // decideDraft revalidates; Next re-renders the page the action came from whenever a path was revalidated.
    expect(state.revalidated.length).toBeGreaterThan(0);
    const msg = await one<{ created_by: string; recipient_id: string }>(
      h,
      "select created_by::text, recipient_id::text from books.outbound_message where decision_id = (select id from approval.decision where draft_id = $1)",
      [h.draftId],
    );
    expect(msg).toEqual({ created_by: h.k.owner.memberId, recipient_id: h.k.suppliers.get("Gupta Traders (simulated)") });
    expect(await one<{ broken: string | null }>(h, "select audit.verify_chain($1)::text as broken", [h.k.tenantId])).toEqual({ broken: null });

    const data = await loadSuppliers(h.k.owner);
    expect(data.drafts.find((x) => x.id === h.draftId)).toMatchObject({ status: "executed", decision: { by: "Rajesh Sharma" } });
    renderPage(<SuppliersView data={data} />);
    const card = [...document.querySelectorAll(".pending")].find((c) => c.querySelector(".stamp-approved")) as HTMLElement;
    expect(within(card).getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(unsourced(document.body)).toEqual([]);
  });

  test("rejected by the manager: closed under the manager, nothing written to the books", async () => {
    // A new draft from the same shelf gap (one draft per finding waits at a time; the first was approved above).
    const draftId = await proposeDemoDraft(h.db.app, h.k.tenantId);
    const before = await count("books.outbound_message");
    signInAs(h.k.manager);
    expect(await decide(draftId, "rejected")).toBeNull();
    expect(await count("books.outbound_message")).toBe(before);
    const d = await one<{ verdict: string; decided_by: string }>(h, "select verdict, decided_by::text from approval.decision where draft_id = $1", [draftId]);
    expect(d).toEqual({ verdict: "rejected", decided_by: h.k.manager.memberId });
    const data = await loadSuppliers(h.k.owner);
    expect(data.drafts.find((x) => x.id === draftId)?.status).toBe("rejected");
  });
});
