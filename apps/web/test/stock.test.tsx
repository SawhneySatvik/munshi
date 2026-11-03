// Stock on the demo shop's books. A shelf count is the owner's or a manager's and carries the on-hand cell the person
// saw: it records only while the books still hold it. Counter staff record waste, never below what the books hold. Each
// on-hand shown is a cell, equal to the stock ledger's own sum, read after the write; what is running low is marked.
import { recordWaste } from "@munshi/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { recordStockAction } from "../app/app/stock/actions";
import { LangProvider } from "../components/LangProvider";
import { StockBook } from "../components/StockBook";
import type { StockPage } from "../lib/ops-types";
import { resolveCell } from "../lib/snapshot";
import { loadStock } from "../lib/server/stock";
import type { Lang, SourceRef } from "../lib/types";
import { type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { bookCounts, formOf, pinDay } from "./helpers/ops-db";
import { fakeMatchMedia, unsourced } from "./helpers/render";

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
const staff = () => h.k.staff[0] as NonNullable<Home["k"]["staff"][0]>;
const show = (data: StockPage, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <StockBook data={data} formKey="test-form-key" />
    </LangProvider>,
  );
const held = async (id: string) => Number((await rows<{ n: string }>(h, "select coalesce(sum(qty_milli), 0)::text as n from books.stock_move where item_id = $1", [id]))[0]?.n);
const milli = (snapshots: StockPage["snapshots"], ref: SourceRef | null) => {
  const cell = ref && resolveCell(snapshots, ref);
  return cell?.t === "qty" ? cell.milli : null;
};
const seenOf = (data: StockPage, id: string) => {
  const row = data.items.find((i) => i.id === id);
  if (!row) throw new Error("the item is on the page");
  return `${row.onHand.snapshotId}:${row.onHand.row - 1}`;
};

test("the owner records a shelf count through the screen: the books' figure comes from the cell shown, the adjustment is theirs", async () => {
  const sugar = item("Sugar 1 kg");
  const before = await held(sugar);
  expect(before).toBeGreaterThan(2000);
  signInAs(h.k.owner);
  const data = await loadStock(h.k.owner);
  expect(milli(data.snapshots, data.items.find((i) => i.id === sugar)?.onHand ?? null)).toBe(before);
  show(data);
  fireEvent.click(within(document.querySelector(".every") as HTMLElement).getByRole("button", { name: "Record for Sugar 1 kg" }));
  expect((screen.getByRole("combobox", { name: "Item" }) as HTMLSelectElement).value).toBe(sugar);
  fireEvent.change(screen.getByRole("textbox", { name: "Counted on the shelf" }), { target: { value: String((before - 2000) / 1000) } });
  fireEvent.click(screen.getByRole("button", { name: "Record count" }));
  const status = await screen.findByText(/on hand now/, {}, { timeout: 30_000 });
  // The recorded count clears the quantity with its result; the item stays chosen.
  expect((screen.getByRole("textbox", { name: "Counted on the shelf" }) as HTMLInputElement).value).toBe("");

  expect(await held(sugar)).toBe(before - 2000);
  const [move] = await rows<{ id: string; kind: string; qty_milli: string; created_by: string }>(
    h,
    "select id, kind, qty_milli::text, created_by from books.stock_move where item_id = $1 order by created_at desc limit 1",
    [sugar],
  );
  expect(move).toMatchObject({ kind: "count_adjust", qty_milli: "-2000", created_by: h.k.owner.memberId });
  const [audit] = await rows<{ actor_id: string }>(h, "select actor_id from audit.audit_log where entity = 'books.stock_move' and entity_id = $1", [move?.id]);
  expect(audit?.actor_id).toBe(h.k.owner.memberId);
  expect(status.closest(".recorded")?.textContent).toContain("Rajesh Sharma");
  expect(within(status).getByRole("button").textContent).toContain(new Intl.NumberFormat("en-IN").format((before - 2000) / 1000));
  expect(unsourced(document.body)).toEqual([]);
});

test("a count against a figure the books no longer hold is a conflict, and writes nothing", async () => {
  const oil = item("Mustard oil 1 l");
  signInAs(h.k.owner);
  const data = await loadStock(h.k.owner);
  await recordWaste(h.db.app, h.k.manager, { itemId: oil, qtyMilli: 1000 }); // after the page was read
  const before = await bookCounts(h);
  const form = formOf({ kind: "count", item: oil, seen: seenOf(data, oil), qty: "1" });
  expect(await recordStockAction(null, form)).toEqual({ error: "conflict" });
  // A ref that is not the item's on-hand cell (another item's row) is no figure the person saw for it.
  const fresh = await loadStock(h.k.owner);
  expect(await recordStockAction(null, formOf({ kind: "count", item: oil, seen: seenOf(fresh, item("Sugar 1 kg")), qty: "1" }))).toEqual({
    error: "conflict",
  });
  expect(await bookCounts(h)).toEqual(before);
});

describe("counter staff", () => {
  test("record waste; the on-hand cell read after it is the stock ledger's sum", async () => {
    const biscuits = item("Cream biscuits 100 g");
    const before = await held(biscuits);
    signInAs(staff());
    const result = await recordStockAction(null, formOf({ kind: "waste", item: biscuits, qty: "1" }));
    if (!result || !("done" in result)) throw new Error(`expected a recorded entry, got ${JSON.stringify(result)}`);
    expect(await held(biscuits)).toBe(before - 1000);
    expect(milli(result.done.snapshots, result.done.onHand)).toBe(before - 1000);
    expect(result.done.stamp?.by).toBe("Pooja Yadav");
  });

  test("cannot take the books below zero, and cannot record a count: both refused, nothing written", async () => {
    const tea = item("Tea leaves 250 g");
    const on = await held(tea);
    signInAs(staff());
    const before = await bookCounts(h);
    expect(await recordStockAction(null, formOf({ kind: "waste", item: tea, qty: String(on / 1000 + 1) }))).toEqual({ error: "short" });
    const data = await loadStock(staff());
    expect([data.canCount, data.canWaste]).toEqual([false, true]);
    expect(await recordStockAction(null, formOf({ kind: "count", item: tea, seen: seenOf(data, tea), qty: "1" }))).toEqual({ error: "refused" });
    expect(await bookCounts(h)).toEqual(before);
    show(data);
    expect((screen.getByRole("radio", { name: "Shelf count" }) as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("A shelf count is recorded by the owner or a manager.");
  });
});

describe("the page holds the guarantee for every role and language", () => {
  for (const who of ["owner", "staff"] as const) {
    for (const lang of ["en", "hi"] as Lang[]) {
      test(`${who}, ${lang}: running low listed and marked, every on-hand a chip, every digit sourced`, async () => {
        const data = await loadStock(who === "owner" ? h.k.owner : staff());
        const low = data.snapshots.find((s) => s.query === "stock.below_reorder");
        expect(data.low.length).toBeGreaterThan(0);
        expect(data.low.length).toBe(low?.rows.length);
        expect(data.items.filter((i) => i.low).map((i) => i.id).sort()).toEqual(data.low.map((l) => l.id).sort());
        expect(data.items).toHaveLength(60); // the seed's catalogue (db/seed/kirana.ts)
        show(data, lang);
        expect(document.querySelectorAll(".every .pair")).toHaveLength(60);
        expect(document.querySelectorAll(".every mark")).toHaveLength(data.low.length);
        expect(document.querySelectorAll(".low .pair").length).toBeGreaterThanOrEqual(data.low.length * 2);
        expect(unsourced(document.body)).toEqual([]);
      });
    }
  }
});
