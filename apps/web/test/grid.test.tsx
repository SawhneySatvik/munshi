// The stock table on the demo shop's books (read through the app, never mocked): the grid's roles and keyboard, editing
// and pasting into the pending store, the review and the draft payload. Every digit on the page is a chip, the shop's
// own name, or marked as the person's own typing; nothing is written to the books, and nothing is sent.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { LangProvider } from "../components/LangProvider";
import { Grid } from "../components/grid/Grid";
import { StockTable } from "../components/grid/StockTable";
import { cellView, createStore, setCell, type Store } from "../lib/grid/store";
import { stockStore } from "../lib/grid/stock";
import type { StockPage } from "../lib/ops-types";
import { loadStock } from "../lib/server/stock";
import type { Lang } from "../lib/types";
import { type Home, openHome, signInAs } from "./home-db";
import { bookCounts, pinDay } from "./ops-db";
import { fakeMatchMedia, unsourced } from "./render";

let h: Home;
let data: StockPage;
beforeAll(async () => {
  h = await openHome();
  pinDay();
  signInAs(h.k.owner);
  data = await loadStock(h.k.owner);
});
afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const show = (lang: Lang = "en", phone = false) => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(phone));
  return render(
    <LangProvider initial={lang}>
      <StockTable data={data} />
    </LangProvider>,
  );
};
const cell = (r: number, c: number) => document.querySelector(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`) as HTMLElement;
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key: k, ...init });
const grid = () => screen.getByRole("grid");
const typeInto = (r: number, c: number, value: string) => {
  fireEvent.click(cell(r, c));
  key(cell(r, c), "Enter");
  const input = within(cell(r, c)).getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  key(input, "Enter");
};
const paste = (text: string) => fireEvent.paste(grid(), { clipboardData: { getData: () => text } });
const sendSpy = () => vi.spyOn(globalThis, "fetch");

describe("the grid as the base read from the stock ledger", () => {
  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: ARIA grid with absolute indices, one source chip per figure, every digit sourced`, () => {
      show(lang);
      expect(data.items).toHaveLength(60);
      expect(grid().getAttribute("aria-rowcount")).toBe("61");
      expect(grid().getAttribute("aria-colcount")).toBe("4");
      expect(screen.getAllByRole("columnheader")).toHaveLength(4);
      const body = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex") !== "1");
      expect(body).toHaveLength(60);
      expect(body[0]?.getAttribute("aria-rowindex")).toBe("2");
      expect(body[59]?.getAttribute("aria-rowindex")).toBe("61");
      expect(document.querySelectorAll(".gt-grid .pair")).toHaveLength(60);
      expect(cell(0, 0).getAttribute("aria-readonly")).toBe("true");
      expect(cell(0, 3).getAttribute("aria-readonly")).toBeNull();
      expect(unsourced(document.body)).toEqual([]);
    });
  }

  test("a base figure on screen equals the snapshot cell it names", () => {
    show();
    const first = data.items[0];
    const snapshot = data.snapshots.find((s) => s.id === first?.onHand.snapshotId);
    expect(snapshot?.rows[(first?.onHand.row ?? 1) - 1]?.on_hand?.t).toBe("qty");
    expect(within(cell(0, 3)).getByRole("button").textContent).toContain(first?.onHand.label.en);
  });
});

describe("keyboard", () => {
  test("arrows move with a roving tab stop, Shift extends a range, Tab walks cells, Enter edits and Escape cancels", () => {
    show();
    fireEvent.click(cell(0, 0));
    key(cell(0, 0), "ArrowDown");
    expect(document.activeElement).toBe(cell(1, 0));
    expect(cell(1, 0).tabIndex).toBe(0);
    expect(cell(0, 0).tabIndex).toBe(-1);
    key(cell(1, 0), "ArrowRight", { shiftKey: true });
    key(cell(1, 1), "ArrowDown", { shiftKey: true });
    expect(document.querySelectorAll('[role="gridcell"][aria-selected="true"]')).toHaveLength(4);
    key(grid(), "Escape");
    expect(document.querySelectorAll('[role="gridcell"][aria-selected="true"]')).toHaveLength(1);
    key(document.activeElement as Element, "Tab");
    expect(document.activeElement).toBe(cell(2, 2));
    fireEvent.click(cell(0, 3));
    key(cell(0, 3), "F2");
    const input = within(cell(0, 3)).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "77" } });
    key(input, "Escape");
    expect(within(cell(0, 3)).queryByRole("textbox")).toBeNull();
    expect(cellView(stockStore(data), data.items[0]?.id as string, "on_hand").edited).toBe(false);
    expect(document.querySelector(".gc-edited")).toBeNull();
    expect(document.activeElement).toBe(cell(0, 3));
  });

  test("Enter on a read-only cell does not open an editor and says why; nothing changes", () => {
    show();
    fireEvent.click(cell(0, 0));
    key(cell(0, 0), "Enter");
    expect(within(cell(0, 0)).queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("read-only");
    expect(document.querySelector(".gc-edited")).toBeNull();
  });
});

describe("editing is the person's own, labelled, and only a pending diff", () => {
  test("a typed quantity shows as 'your edit', the review shows the old figure through its source chip, nothing is written", async () => {
    const before = await bookCounts(h);
    const send = sendSpy();
    show();
    typeInto(0, 3, "9");
    expect(cell(0, 3).classList.contains("gc-edited")).toBe(true);
    expect(cell(0, 3).textContent).toContain("your edit");
    expect(within(cell(0, 3)).queryByRole("button")).toBeNull(); // the person's number carries no chip
    expect(cell(0, 3).querySelector("[data-said]")?.textContent).toMatch(/^9/);
    const review = screen.getByRole("region", { name: "Review changes" });
    expect(within(review).getAllByRole("button", { name: /source/ })).toHaveLength(1); // the old figure's chip
    expect(review.textContent).toContain("was");
    expect(unsourced(document.body)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(await bookCounts(h)).toEqual(before);
  });

  test("an invalid entry is kept, flagged, and blocks 'Send for approval'", () => {
    show();
    typeInto(0, 3, "abc");
    expect(cell(0, 3).getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(cell(0, 3).getAttribute("aria-describedby") as string)?.textContent).toBe("Enter a number.");
    expect((screen.getByRole("button", { name: "Send for approval" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Cells to fix");
    expect(unsourced(document.body)).toEqual([]);
  });

  test("Send for approval shows the draft payload, labelled, and sends and writes nothing; Discard all empties it", async () => {
    const before = await bookCounts(h);
    const send = sendSpy();
    show();
    typeInto(0, 3, "9");
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    const payload = document.querySelector(".gt-payload pre") as HTMLElement;
    const parsed = JSON.parse(payload.textContent as string);
    expect(parsed.snapshotId).toBe(data.items[0]?.onHand.snapshotId);
    expect(parsed.changes[0]).toMatchObject({ rowKey: data.items[0]?.id, column: "on_hand", new: { by: "user", value: { t: "qty", milli: 9000 } } });
    expect(parsed.changes[0].old.ref).toMatchObject({ snapshotId: data.items[0]?.onHand.snapshotId, col: "on_hand" });
    expect(screen.getByText(/Approval wiring comes with grid\.apply/)).toBeTruthy();
    expect(unsourced(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Discard all" }));
    expect(document.querySelector(".gt-payload")).toBeNull();
    expect(document.querySelector(".gc-edited")).toBeNull();
    expect(screen.getByText(/No changes yet/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(await bookCounts(h)).toEqual(before);
  });

  test("Undo takes the edit back, and the review is empty again", () => {
    show();
    typeInto(0, 3, "9");
    fireEvent.click(within(screen.getByRole("region", { name: "Review changes" })).getByRole("button", { name: "Undo" }));
    expect(document.querySelector(".gc-edited")).toBeNull();
    expect(screen.getByText(/No changes yet/)).toBeTruthy();
    expect(document.querySelectorAll(".gt-grid .pair")).toHaveLength(60);
  });
});

describe("paste and copy", () => {
  test("a range over read-only and editable columns lands only in the editable one; extra rows become adds", () => {
    show();
    fireEvent.click(cell(58, 0));
    paste("A\tB\tkg\t3\nNew item\t\tpack\t4\nSecond\t\tpack\t5\n");
    expect(cell(58, 0).textContent).toBe(data.items[58]?.name); // read-only: unchanged
    expect(cell(58, 3).classList.contains("gc-edited")).toBe(true);
    expect(grid().getAttribute("aria-rowcount")).toBe("62");
    expect(cell(60, 0).querySelector("[data-said]")?.textContent).toBe("Second");
    expect(screen.getByRole("status").textContent).toMatch(/Cells pasted/);
    expect(screen.getByRole("status").textContent).toMatch(/Rows added/);
    expect(screen.getByRole("status").textContent).toMatch(/Cells refused \(read-only\)/);
    expect(unsourced(document.body)).toEqual([]);
  });

  test("copy puts the range on the clipboard as TSV", () => {
    show();
    fireEvent.click(cell(0, 0));
    key(cell(0, 0), "ArrowRight", { shiftKey: true });
    key(cell(0, 1), "ArrowDown", { shiftKey: true });
    const set = vi.fn();
    fireEvent.copy(grid(), { clipboardData: { setData: set } });
    const [item0, item1] = data.items;
    expect(set).toHaveBeenCalledOnce();
    const text = set.mock.calls[0]?.[1] as string;
    expect(text.split("\n")).toHaveLength(2);
    expect(text.split("\n")[0]?.split("\t")[0]).toBe(item0?.name);
    expect(text.split("\n")[1]?.split("\t")[0]).toBe(item1?.name);
  });
});

describe("Hindi", () => {
  test("the edited, review and payload states hold the guarantee in Hindi too", () => {
    show("hi");
    typeInto(0, 3, "9");
    expect(cell(0, 3).textContent).toContain("आपका बदलाव");
    fireEvent.click(screen.getByRole("button", { name: "मंज़ूरी के लिए भेजें" }));
    expect(document.querySelector(".gt-payload pre")).not.toBeNull();
    expect(unsourced(document.body)).toEqual([]);
  });
});

describe("under 600 px", () => {
  test("a card list over the same store, with a Paste rows box; no grid", () => {
    show("en", true);
    expect(screen.queryByRole("grid")).toBeNull();
    expect(document.querySelectorAll(".gt-card")).toHaveLength(60);
    expect(document.querySelectorAll(".gt-card .pair")).toHaveLength(60);
    const field = within(document.querySelectorAll(".gt-card")[0] as HTMLElement).getByLabelText("Change On hand") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.blur(field);
    expect(document.querySelector(".gt-card .gc-edited, .gt-card .gc-tag")?.textContent).toContain("your edit");
    fireEvent.change(screen.getByLabelText("Paste rows"), { target: { value: "Peanuts 200 g\t\tpack\t6" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to table" }));
    expect(document.querySelectorAll(".gt-card")).toHaveLength(61);
    expect(document.querySelector(".gt-bar")?.textContent).toContain("Changes: 2");
    expect(unsourced(document.body)).toEqual([]);
  });
});

describe("virtual window", () => {
  test("a long list renders a window of rows, with absolute row indices and the full row count", () => {
    const columns = stockStore(data).columns;
    let store: Store = createStore("s", columns, Array.from({ length: 1000 }, (_, i) => ({
      key: `r${i}`,
      cells: { item: { value: { t: "text" as const, v: `Item ${i}` }, ref: null }, category: { value: { t: "text" as const, v: "" }, ref: null }, unit: { value: { t: "text" as const, v: "pack" }, ref: null }, on_hand: { value: { t: "qty" as const, milli: 1000, unit: "pack" }, ref: null } },
    })));
    store = setCell(store, "r0", "on_hand", "2").store;
    // jsdom has no layout: the virtualizer reads the scroller's client size, so the scroller is given one.
    const size = (name: "clientHeight" | "clientWidth", px: number) =>
      vi.spyOn(HTMLElement.prototype, name, "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("gt-scroll") ? px : 0;
      });
    size("clientHeight", 480);
    size("clientWidth", 900);
    render(
      <LangProvider initial="en">
        <Grid store={store} onEdit={() => {}} onPaste={() => {}} onRefuse={() => {}} onUndo={() => {}} onToggleRemove={() => {}} virtualAbove={100} />
      </LangProvider>,
    );
    const rows = screen.getAllByRole("row");
    expect(grid().getAttribute("aria-rowcount")).toBe("1001");
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.length).toBeLessThan(100);
    expect(rows[1]?.getAttribute("aria-rowindex")).toBe("2");
  });
});
