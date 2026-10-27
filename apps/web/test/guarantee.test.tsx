import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readEdition } from "../lib/edition";
import { sharmaHome } from "../lib/fixture";
import { resolveCell } from "../lib/snapshot";
import type { OwnerHome } from "../lib/types";
import { fakeMatchMedia, renderHome } from "./render";

beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a number with no source is never shown", () => {
  test("a ref that lands on no cell renders Cannot verify and no chip", () => {
    const broken: OwnerHome = structuredClone(sharmaHome);
    const shelf = broken.findings[0];
    if (shelf?.kind !== "shelf_gap") throw new Error("fixture changed: the first finding is the shelf gap");
    shelf.books = { ...shelf.books, row: 9 };
    renderHome("en", broken);
    expect(screen.queryByRole("button", { name: /Stock ledger/ })).toBeNull();
    const line = screen.getByText(/Books say/);
    expect(line.textContent).toBe("Books say Cannot verify");
  });

  test("the UPI line says Cannot verify and carries no digit", () => {
    renderHome();
    const line = document.querySelector(".unverified");
    expect(line?.textContent).toContain("Cannot verify");
    expect(line?.textContent).not.toMatch(/\d/);
  });

  test("the shelf drawing agrees with the cells it illustrates", () => {
    const shelf = sharmaHome.findings[0];
    if (shelf?.kind !== "shelf_gap") throw new Error("fixture changed: the first finding is the shelf gap");
    const photo = sharmaHome.snapshots.find((s) => s.id === shelf.shelf.snapshotId)?.photo;
    const slots = photo?.shelves.join("") ?? "";
    expect(resolveCell(sharmaHome.snapshots, shelf.shelf)).toEqual({ t: "int", v: [...slots].filter((c) => c === "#").length });
    expect(resolveCell(sharmaHome.snapshots, shelf.books)).toEqual({ t: "int", v: slots.length });
  });
});

describe("MUNSHI_EDITION", () => {
  test("unset is meta; meta and paytm are accepted; anything else is refused", () => {
    expect(readEdition(undefined)).toBe("meta");
    expect(readEdition("")).toBe("meta");
    expect(readEdition("paytm")).toBe("paytm");
    expect(() => readEdition("Paytm")).toThrow(/MUNSHI_EDITION/);
  });
});
