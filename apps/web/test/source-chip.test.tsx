import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DRAWER_ID } from "../components/Sources";
import { sharmaHome } from "../lib/fixture";
import { fakeMatchMedia, renderHome } from "./render";

const drawer = () => document.getElementById(DRAWER_ID) as HTMLElement;
const highlighted = () => within(drawer()).getByRole("cell", { current: true });
const asNumber = (text: string) => Number(text.replace(/[₹,]/g, ""));

// Counted from the fixture itself, not from the page: every object that names a snapshot cell is one chip on the home.
function countRefs(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countRefs(v), 0);
  if (value && typeof value === "object") {
    if ("snapshotId" in value) return 1;
    return Object.values(value).reduce((n: number, v) => n + countRefs(v), 0);
  }
  return 0;
}

beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SourceChip", () => {
  test("shows the plain name of the source, and its accessible name says which number it backs", () => {
    renderHome();
    const chip = screen.getByRole("button", { name: "24, source: Stock ledger" });
    expect(chip.querySelector(".ref")?.textContent).toBe("Stock ledger");
    expect(chip.textContent).not.toMatch(/snap|row|⟨/);
    expect(screen.getByRole("button", { name: "18, source: Shelf photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "₹60, source: Gupta Traders' bill" })).toBeTruthy();
  });

  test("tapping it opens the source drawer at that exact cell and moves focus there", () => {
    renderHome();
    // Before any tap the desk shows the first finding's source (the shelf count), as the reference does.
    expect(drawer().className).toContain("is-desk");
    expect(highlighted().textContent).toBe("18");

    fireEvent.click(screen.getByRole("button", { name: "24, source: Stock ledger" }));
    expect(drawer().className).toContain("is-open");
    expect(highlighted().textContent).toBe("24");
    expect(document.activeElement).toBe(within(drawer()).getByRole("heading", { name: "Where this number comes from" }));

    fireEvent.click(screen.getByRole("button", { name: "₹60, source: Gupta Traders' bill" }));
    expect(within(drawer()).getByText("supplier_bill_lines", { exact: false })).toBeTruthy();
    expect(highlighted().textContent).toBe("₹60.00");
    expect(highlighted().closest("tr")?.firstElementChild?.textContent).toBe("2");
  });

  test("every chip on the home opens a highlighted cell holding the very number it sits beside", () => {
    renderHome();
    const chips = screen.getAllByRole("button", { name: /, source: / });
    expect(chips.length).toBe(countRefs(sharmaHome));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      fireEvent.click(chip);
      const shown = chip.querySelector(".amt")?.textContent ?? "";
      expect(asNumber(highlighted().textContent ?? "")).toBe(asNumber(shown));
    }
  });

  test("closing returns the desk to its default and focus to the chip", async () => {
    renderHome();
    const chip = screen.getByRole("button", { name: "₹2,350, source: Credit book" });
    fireEvent.click(chip);
    fireEvent.click(within(drawer()).getByRole("button", { name: "Close" }));
    expect(drawer().className).toContain("is-desk");
    await waitFor(() => expect(document.activeElement).toBe(chip));
  });

  test("on a phone the drawer opens as a modal dialog and closes back", () => {
    vi.stubGlobal("matchMedia", fakeMatchMedia(true));
    // jsdom has no dialog methods; these stand in for the browser's and record the calls.
    const calls: string[] = [];
    const names = ["show", "showModal", "close"] as const;
    for (const name of names) {
      Object.defineProperty(HTMLDialogElement.prototype, name, {
        configurable: true,
        value(this: HTMLDialogElement) {
          calls.push(name);
          this.open = name !== "close";
        },
      });
    }
    try {
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: "48, source: Reorder calculation" }));
      expect(calls).toEqual(["close", "showModal"]);
      expect(highlighted().textContent).toBe("48");
      fireEvent.click(within(drawer()).getByRole("button", { name: "Close" }));
      expect(calls).toEqual(["close", "showModal", "close", "show"]);
    } finally {
      for (const name of names) Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
  });
});
