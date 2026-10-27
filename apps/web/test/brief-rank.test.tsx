// The morning brief shows the three findings with the most rupees at stake, then a "+N more" row that opens the rest in
// place. "Rupees at stake" is a stored money cell (never computed): the watcher's own column per kind; price_creep has
// none and ranks last. The approval card comes before the "+N more" row in the page, so on a phone it stays above the fold.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveCell } from "../lib/snapshot";
import type { Finding, OwnerHome } from "../lib/types";
import { type Home, homeFor, openHome } from "./home-db";
import { fakeMatchMedia, renderHome, unsourced } from "./render";

let h: Home;
let data: OwnerHome;
beforeAll(async () => {
  h = await openHome();
  data = await homeFor(h.k.owner);
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The money column a kind ranks by, found from the finding's own ref (same snapshot and row) in the stored cells.
function stake(f: Finding): number | null {
  const [ref, col] =
    f.kind === "shelf_gap" ? [f.books, "loss"] : f.kind === "expiry" ? [f.value, "at_risk_value"] : f.kind === "short_settlement" ? [f.short, "short"] : f.kind === "overdue_credit" ? [f.owed, "overdue"] : [null, ""];
  const cell = ref && resolveCell(data.snapshots, { ...ref, col });
  return cell?.t === "money" ? cell.minor : null;
}

describe("the brief ranks by the money cell, most first", () => {
  test("the findings arrive in descending stored-cell order, the kind with no money cell last", () => {
    // Independent of the code: the answer key's planted figures (kirana.answers.json), in minor units.
    expect(data.findings.map((f) => [f.kind, stake(f)])).toEqual([
      ["overdue_credit", 235_000], // 120000 + 65000 + 50000
      ["expiry", 137_565],
      ["short_settlement", 45_000],
      ["shelf_gap", 12_800], // Bath soap
      ["shelf_gap", 5_100], // Glucose biscuits
      ["price_rise", null], // price_creep has no money column
    ]);
  });

  test("the top three show, the approval card comes before the +N more row, and the row opens the rest in place", () => {
    renderHome(data, "en", true);
    expect(document.querySelectorAll(".find")).toHaveLength(3);
    const card = document.querySelector(".pending") as HTMLElement;
    const row = screen.getByRole("button", { name: /more findings/ });
    expect(row.textContent).toBe("+3 more findings");
    expect(card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);
    expect(document.querySelectorAll(".find")).toHaveLength(6);
    expect([...document.querySelectorAll(".seq")].map((e) => e.textContent)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toBe("Show fewer");
    expect(unsourced(document.body)).toEqual([]);

    fireEvent.click(row);
    expect(document.querySelectorAll(".find")).toHaveLength(3);
  });

  test("Hindi carries the same row", () => {
    renderHome(data, "hi", true);
    expect(screen.getByRole("button", { name: /और निष्कर्ष/ }).textContent).toBe("+3 और निष्कर्ष");
  });
});
