import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DRAWER_ID } from "../components/Sources";
import type { OwnerHome } from "../lib/types";
import { type Home, homeFor, openHome } from "./home-db";
import { countRefs, fakeMatchMedia, renderHome } from "./render";

const drawer = () => document.getElementById(DRAWER_ID) as HTMLElement;
const highlighted = () => within(drawer()).getByRole("cell", { current: true });
// A card shows "₹2,350", its stored cell "₹2,350.00"; a quantity or a date reads the same in both.
const same = (text: string) => text.replace(/[₹,]/g, "").replace(/\.00$/, "");

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

describe("SourceChip on the books' own figures", () => {
  test("shows the plain name of the source, and its accessible name says which number it backs", () => {
    renderHome(data);
    // From the answer key: Butter's latest Gupta bill is ₹60; three customers owe ₹2,350; the largest gap is 6 packs.
    const butter = screen.getByRole("button", { name: "₹60, source: Gupta Traders' bill" });
    expect(butter.querySelector(".ref")?.textContent).toBe("Gupta Traders' bill");
    expect(butter.textContent).not.toMatch(/snap|row|⟨/);
    expect(screen.getByRole("button", { name: "₹2,350, source: Credit book" })).toBeTruthy();
    const draft = document.querySelector(".pending") as HTMLElement;
    expect(within(draft).getByRole("button", { name: "6, source: Stock count" })).toBeTruthy();
  });

  test("tapping it opens the source drawer at that exact cell and moves focus there", () => {
    renderHome(data);
    // Before any tap the desk shows the first finding's source, its figure ringed.
    expect(drawer().className).toContain("is-desk");
    const ringed = document.querySelector(".ringed.is-desk .amt")?.textContent ?? "";
    expect(ringed).not.toBe("");
    expect(same(highlighted().textContent ?? "")).toBe(same(ringed));

    fireEvent.click(screen.getByRole("button", { name: "₹60, source: Gupta Traders' bill" }));
    expect(drawer().className).toContain("is-open");
    expect(within(drawer()).getByText("watch.price_creep", { exact: false })).toBeTruthy();
    expect(highlighted().textContent).toBe("₹60.00");
    expect(highlighted().closest("tr")?.firstElementChild?.textContent).toBe("1");
    expect(document.activeElement).toBe(within(drawer()).getByRole("heading", { name: "Where this number comes from" }));
  });

  test("every chip on the home opens a highlighted cell holding the very figure it sits beside", () => {
    renderHome(data);
    const chips = screen.getAllByRole("button", { name: /, source: / });
    expect(chips.length).toBe(countRefs(data));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      fireEvent.click(chip);
      expect(same(highlighted().textContent ?? ""), chip.getAttribute("aria-label") ?? chip.textContent ?? "").toBe(
        same(chip.querySelector(".amt")?.textContent ?? "missing"),
      );
    }
  });

  test("closing returns the desk to its default and focus to the chip", async () => {
    renderHome(data);
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
      renderHome(data);
      const draft = document.querySelector(".pending") as HTMLElement;
      fireEvent.click(within(draft).getByRole("button", { name: "6, source: Stock count" }));
      expect(calls).toEqual(["close", "showModal"]);
      expect(highlighted().textContent).toBe("6");
      fireEvent.click(within(drawer()).getByRole("button", { name: "Close" }));
      expect(calls).toEqual(["close", "showModal", "close", "show"]);
    } finally {
      for (const name of names) Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
  });
});
