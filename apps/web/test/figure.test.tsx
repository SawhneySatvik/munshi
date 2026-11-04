// <Figure> (components/shell/Figure.tsx) on the demo shop's own snapshots, as the server stored them:
// it shows the cell's formatted value, tapping it opens the source drawer at that very cell, its accessible name says
// where the number comes from, and a ref that does not resolve reads "Cannot verify" with no digit. The type side (it
// takes a ref, never a number) is test/figure.types.tsx, run by tsc.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Words } from "../components/app/BriefView";
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

describe("a brief's slots", () => {
  const stored = {
    id: "brief-cells",
    query: "finding expiry",
    readAt: "2026-11-05T01:36:00.000Z",
    title: { en: "Finding", hi: "निष्कर्ष" },
    columns: [{ key: "item" }, { key: "arrived_at" }, { key: "left", numeric: true }],
    rows: [{ item: { t: "text", v: "Cheese slices 200 g" }, arrived_at: { t: "time", v: "2026-11-04T09:30:00.000Z" }, left: { t: "int", v: 16 } }],
  } as OwnerHome["snapshots"][number];
  const at = (col: string): SourceRef => ({ snapshotId: stored.id, row: 1, col, label: { en: "Finding", hi: "निष्कर्ष" } });

  test("a name or a time the narrator cited shows the stored cell, not Cannot verify", () => {
    render(
      <LangProvider initial="en">
        <SourcesProvider snapshots={[stored]} deskRef={null}>
          <p data-testid="line">
            <Words text="⟦1⟧ has ⟦3⟧ left, in since ⟦2⟧." refs={[at("item"), at("arrived_at"), at("left")]} slot={/⟦(\d+)⟧/g} />
          </p>
        </SourcesProvider>
      </LangProvider>,
    );
    const line = screen.getByTestId("line").textContent ?? "";
    expect(line).toContain("Cheese slices 200 g");
    expect(line).toContain("16");
    expect(line).toMatch(/4 Nov/);
    expect(line).not.toContain("Cannot verify");
  });

  test("a card's figure still refuses a text cell: only a brief's slot may show one", () => {
    render(
      <LangProvider initial="en">
        <SourcesProvider snapshots={[stored]} deskRef={null}>
          <Figure cell={at("item")} />
        </SourcesProvider>
      </LangProvider>,
    );
    expect(document.body.textContent).toContain("Cannot verify");
  });
});

describe("the page stays where it opened", () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    scrolled.mockClear();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  test("the panel a desk opens with moves nothing; a figure a person taps is brought into view", () => {
    render(
      <LangProvider initial="en">
        <SourcesProvider snapshots={data.snapshots} deskRef={ref}>
          <p>
            <Figure cell={ref} />
          </p>
          <SourceDrawer />
        </SourcesProvider>
      </LangProvider>,
    );
    expect(document.querySelector('[aria-current="true"]'), "the desk's panel shows its cell").not.toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.classList.contains("fig")) as HTMLElement);
    expect(scrolled).toHaveBeenCalled();
  });
});
