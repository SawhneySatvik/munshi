// <Figure> (components/shell/Figure.tsx) on the demo shop's own snapshots, as the server stored them:
// it shows the cell's formatted value, tapping it opens the source drawer at that very cell, its accessible name says
// where the number comes from, and a ref that does not resolve reads "Cannot verify" with no digit. The type side (it
// takes a ref, never a number) is test/figure.types.tsx, run by tsc.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { LangProvider } from "../components/LangProvider";
import { Figure } from "../components/shell/Figure";
import { SourceDrawer } from "../components/SourceDrawer";
import { DRAWER_ID, SourcesProvider } from "../components/Sources";
import { formatTableCell, keyRef, resolveCell, resolveNumber } from "../lib/snapshot";
import type { Lang, OwnerHome, SourceRef } from "../lib/types";
import { type Home, homeFor, openHome } from "./helpers/home-db";
import { DIGIT, fakeMatchMedia } from "./helpers/render";

let h: Home;
let data: OwnerHome;
let ref: SourceRef;
beforeAll(async () => {
  h = await openHome();
  data = await homeFor(h.k.owner);
  ref = keyRef(data.findings[0] as OwnerHome["findings"][number]);
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (cell: SourceRef | null, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <SourcesProvider snapshots={data.snapshots} deskRef={null}>
        <p>
          <Figure cell={cell} />
        </p>
        <SourceDrawer />
      </SourcesProvider>
    </LangProvider>,
  );

describe("<Figure>", () => {
  test("shows the stored cell's value, as one button named for its source", () => {
    show(ref);
    const value = resolveNumber(data.snapshots, ref) as string;
    expect(value).toMatch(DIGIT);
    const button = screen.getByRole("button", { name: `${value}, source: ${ref.label.en}` });
    expect(button.querySelector(".amt")?.textContent).toBe(value);
    expect(button.getAttribute("aria-controls")).toBe(DRAWER_ID);
  });

  test("tapping it opens the source drawer at that exact row and cell", () => {
    show(ref);
    expect(document.getElementById(DRAWER_ID)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /, source: / }));
    const drawer = document.getElementById(DRAWER_ID) as HTMLElement;
    expect(drawer.className).toContain("is-open");
    const cell = within(drawer).getByRole("cell", { current: true });
    expect(cell.textContent).toBe(formatTableCell(resolveCell(data.snapshots, ref)));
    expect(cell.closest("tr")?.firstElementChild?.textContent).toBe(String(ref.row));
    expect(document.activeElement).toBe(within(drawer).getByRole("heading", { name: "Where this number comes from" }));
  });

  test("a ref that does not resolve, or no ref, reads Cannot verify: no button, no digit", () => {
    for (const cell of [{ ...ref, row: ref.row + 10_000 }, { ...ref, snapshotId: "00000000-0000-0000-0000-000000000000" }, { ...ref, col: "no_such_column" }, null]) {
      const { container } = show(cell);
      expect(container.textContent).toBe("Cannot verify");
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.textContent).not.toMatch(DIGIT);
      cleanup();
    }
  });

  test("in Hindi the source is named in Hindi, and Cannot verify is in Hindi", () => {
    show(ref, "hi");
    expect(screen.getByRole("button", { name: new RegExp(`, स्रोत: ${ref.label.hi}$`) })).toBeTruthy();
    cleanup();
    const { container } = show(null, "hi");
    expect(container.textContent).toBe("पुष्टि नहीं हो सकती");
  });
});
