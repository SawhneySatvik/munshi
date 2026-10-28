// The stock table's pure core: parsers, the pending store, paste and import. No database and no DOM: nothing here can
// write anywhere, which is also what these tests rely on (a store is a value).
import { describe, expect, test } from "vitest";
import { type ColumnDef, editText, parseCell } from "../lib/grid/columns";
import { exportMatrix, importTable, pasteGrid, parseTsv, rangeToTsv } from "../lib/grid/paste";
import { declaredUnzippedSize } from "../lib/grid/files";
import { addRow, cellView, createStore, diff, discardAll, errors, pendingCount, setCell, toggleRemove, undo } from "../lib/grid/store";
import type { SourceRef } from "../lib/types";

const money: ColumnDef = { key: "price", kind: "money", label: { en: "Price", hi: "दाम" } };
const ref = (row: number): SourceRef => ({ label: { en: "Stock ledger", hi: "स्टॉक बही" }, snapshotId: "snap-1", row, col: "on_hand" });
const COLUMNS: ColumnDef[] = [
  { key: "item", kind: "text", label: { en: "Item", hi: "वस्तु" }, readOnly: true, required: true },
  { key: "category", kind: "text", label: { en: "Category", hi: "श्रेणी" }, readOnly: true },
  { key: "unit", kind: "choice", label: { en: "Unit", hi: "इकाई" }, readOnly: true, required: true, options: ["kg", "pack"] },
  { key: "on_hand", kind: "qty", label: { en: "On hand", hi: "हाथ में" }, required: true },
];
const row = (key: string, name: string, unit: string, milli: number, n: number) => ({
  key,
  cells: {
    item: { value: { t: "text" as const, v: name }, ref: null },
    category: { value: { t: "text" as const, v: "Grocery" }, ref: null },
    unit: { value: { t: "text" as const, v: unit }, ref: null },
    on_hand: { value: { t: "qty" as const, milli, unit }, ref: ref(n) },
  },
});
const fresh = () => createStore("snap-1", COLUMNS, [row("a", "Sugar 1 kg", "kg", 12_500, 1), row("b", "Biscuits 70 g", "pack", 40_000, 2)]);

describe("parsers", () => {
  const m = (raw: string) => parseCell(money, raw, { unit: "" });

  test("a money string is whole minor units, never a float", () => {
    for (const [raw, minor] of [
      ["19.99", 1999],
      ["0.29", 29],
      ["1,234.56", 123_456],
      ["₹12", 1200],
      ["Rs. 1,00,000.50", 10_000_050],
      ["१२.५०", 1250],
      ["12345678901234.56", 1_234_567_890_123_456],
    ] as const) {
      const r = m(raw);
      expect(r.ok && r.value.t === "money" && r.value.minor, raw).toBe(minor);
      expect(r.ok && Number.isInteger((r.value as { minor: number }).minor), raw).toBe(true);
    }
  });

  test("more places than the unit has is refused, not rounded; so is a number past what an integer holds", () => {
    expect(m("1.234")).toEqual({ ok: false, error: "decimals" });
    expect(m("1.999")).toEqual({ ok: false, error: "decimals" });
    expect(m("99999999999999999999")).toEqual({ ok: false, error: "range" });
    expect(m("-5")).toEqual({ ok: false, error: "number" });
    expect(m("1e3")).toEqual({ ok: false, error: "number" });
    expect(m("")).toEqual({ ok: false, error: "empty" });
  });

  test("a quantity is milli-units in the row's unit; a count is a whole number; a choice is one of the listed values", () => {
    expect(parseCell(COLUMNS[3] as ColumnDef, "1.5", { unit: "kg" })).toEqual({ ok: true, value: { t: "qty", milli: 1500, unit: "kg" } });
    expect(parseCell(COLUMNS[3] as ColumnDef, "0.0005", { unit: "kg" })).toEqual({ ok: false, error: "decimals" });
    expect(parseCell({ key: "n", kind: "int", label: { en: "", hi: "" } }, "12", { unit: "" })).toEqual({ ok: true, value: { t: "int", v: 12 } });
    expect(parseCell({ key: "n", kind: "int", label: { en: "", hi: "" } }, "1.5", { unit: "" })).toEqual({ ok: false, error: "decimals" });
    expect(parseCell(COLUMNS[2] as ColumnDef, "KG", { unit: "" })).toEqual({ ok: true, value: { t: "text", v: "kg" } });
    expect(parseCell(COLUMNS[2] as ColumnDef, "tonne", { unit: "" })).toEqual({ ok: false, error: "choice" });
  });

  test("what a person edits is the canonical value written back out", () => {
    expect(editText({ t: "qty", milli: 12_500, unit: "kg" })).toBe("12.5");
    expect(editText({ t: "money", minor: 1999, currency: "INR" })).toBe("19.99");
    expect(editText({ t: "money", minor: 2000, currency: "INR" })).toBe("20");
    expect(editText({ t: "qty", milli: 5, unit: "kg" })).toBe("0.005");
  });
});

describe("the pending store", () => {
  test("an edit becomes a diff entry holding the books' value with its source ref, and the person's value as theirs", () => {
    const s = setCell(fresh(), "a", "on_hand", "9").store;
    expect(diff(s)).toEqual({
      snapshotId: "snap-1",
      changes: [{ rowKey: "a", column: "on_hand", old: { value: { t: "qty", milli: 12_500, unit: "kg" }, ref: ref(1) }, new: { value: { t: "qty", milli: 9000, unit: "kg" }, by: "user" } }],
      adds: [],
      removes: [],
    });
  });

  test("the diff of an undone edit is empty, and so is an edit set back to what the books say", () => {
    const edited = setCell(fresh(), "a", "on_hand", "9").store;
    expect(diff(undo(edited)).changes).toEqual([]);
    expect(pendingCount(undo(edited))).toBe(0);
    const back = setCell(edited, "a", "on_hand", "12.5").store; // the books' own figure, typed again
    expect(diff(back).changes).toEqual([]);
    expect(pendingCount(back)).toBe(0);
    expect(diff(discardAll(edited))).toEqual({ snapshotId: "snap-1", changes: [], adds: [], removes: [] });
  });

  test("a read-only column refuses an edit on an existing row, and the row is untouched", () => {
    const before = fresh();
    const r = setCell(before, "a", "item", "Renamed");
    expect(r.refused).toBe("readonly");
    expect(r.store).toBe(before);
    expect(cellView(r.store, "a", "item").text).toBe("Sugar 1 kg");
  });

  test("a row marked for removal refuses edits and leaves the diff; taking the mark back restores them", () => {
    let s = setCell(fresh(), "a", "on_hand", "9").store;
    s = toggleRemove(s, "a");
    expect(diff(s).removes).toEqual(["a"]);
    expect(diff(s).changes).toEqual([]);
    expect(setCell(s, "a", "on_hand", "3").refused).toBe("removed");
    expect(diff(toggleRemove(s, "a")).changes).toHaveLength(1);
  });

  test("a typed cell that does not parse is kept and flagged; it never reaches the diff", () => {
    const s = setCell(fresh(), "a", "on_hand", "abc").store;
    expect(cellView(s, "a", "on_hand")).toMatchObject({ text: "abc", value: null, edited: true, error: "number" });
    expect(errors(s)).toEqual([{ rowKey: "a", column: "on_hand", error: "number" }]);
    expect(diff(s).changes).toEqual([]);
  });

  test("an added row is the person's in every column; blank required cells are errors, and the unit decides the quantity's unit", () => {
    let { store: s, key } = addRow(fresh());
    expect(errors(s).map((e) => e.column).sort()).toEqual(["item", "on_hand", "unit"]);
    s = setCell(s, key, "item", "Jaggery 500 g").store;
    s = setCell(s, key, "unit", "pack").store;
    s = setCell(s, key, "on_hand", "7").store;
    expect(errors(s)).toEqual([]);
    expect(diff(s).adds).toEqual([
      {
        rowKey: key,
        cells: {
          item: { value: { t: "text", v: "Jaggery 500 g" }, by: "user" },
          unit: { value: { t: "text", v: "pack" }, by: "user" },
          on_hand: { value: { t: "qty", milli: 7000, unit: "pack" }, by: "user" },
        },
      },
    ]);
    expect(diff(undo(undo(undo(undo(s))))).adds).toEqual([]);
  });
});

describe("paste and import", () => {
  test("TSV from a spreadsheet, quoted cells included", () => {
    expect(parseTsv('a\tb\n"x\ty"\t"line1\nline2"\n')).toEqual([["a", "b"], ["x\ty", "line1\nline2"]]);
  });

  test("a range over a read-only column and an editable one: the read-only cells refuse, the editable one lands, in one undo step", () => {
    const before = fresh();
    const { store, report } = pasteGrid(before, { row: 0, col: 2 }, [["pack", "3"], ["kg", "4"]]);
    expect(report).toEqual({ applied: 2, refused: 2, clipped: 0, added: 0 });
    expect(cellView(store, "a", "unit").text).toBe("kg"); // unit is read-only: the paste did not change it
    expect(cellView(store, "a", "on_hand").text).toBe("3");
    expect(cellView(store, "b", "on_hand").text).toBe("4");
    expect(diff(store).changes.map((c) => c.column)).toEqual(["on_hand", "on_hand"]);
    expect(undo(store).state).toBe(before.state);
  });

  test("rows past the end become adds; columns past the last are left out; nothing else changes", () => {
    const { store, report } = pasteGrid(fresh(), { row: 1, col: 0 }, [["x", "", "kg", "1", "extra"], ["Rice 5 kg", "Grocery", "kg", "2", "extra"], ["Dal 1 kg", "", "kg", "3", "extra"]]);
    expect(report.added).toBe(2);
    expect(report.clipped).toBe(3);
    expect(report.refused).toBe(3); // row b is existing: item, category, unit refused
    expect(diff(store).adds.map((a) => a.cells.item?.value)).toEqual([{ t: "text", v: "Rice 5 kg" }, { t: "text", v: "Dal 1 kg" }]);
    expect(errors(store)).toEqual([]);
  });

  test("copy gives the range as TSV, as the person sees it (their edit, not the books' figure)", () => {
    const s = setCell(fresh(), "a", "on_hand", "9").store;
    expect(rangeToTsv(s, { row: 0, col: 0 }, { row: 1, col: 3 })).toBe("Sugar 1 kg\tGrocery\tkg\t9\nBiscuits 70 g\tGrocery\tpack\t40");
  });

  test("import maps columns by header in either language; a known id edits that row, an unknown row is added", () => {
    const { store, report } = importTable(fresh(), [
      ["id", "हाथ में", "Item"],
      ["a", "2", "ignored name"],
      ["zzz", "5", "Salt 1 kg"],
    ]);
    expect(report).toEqual({ applied: 3, refused: 1, clipped: 0, added: 1 });
    expect(diff(store).changes.map((c) => [c.rowKey, c.new.value])).toEqual([["a", { t: "qty", milli: 2000, unit: "kg" }]]);
    expect(diff(store).adds).toHaveLength(1);
  });

  test("export is the books' snapshot, not the pending state, with the row id and snapshot id, and formulas kept as text", () => {
    const base = fresh();
    const edited = setCell(base, "a", "on_hand", "1").store;
    expect(exportMatrix(edited, "en")).toEqual(exportMatrix(base, "en"));
    expect(exportMatrix(base, "en")[1]).toEqual(["a", "Sugar 1 kg", "Grocery", "kg", "12.5", "snap-1"]);
    const evil = createStore("s", COLUMNS, [row("e", "=HYPERLINK(1)", "kg", 1000, 1)]);
    expect(exportMatrix(evil, "en")[1]?.[1]).toBe("'=HYPERLINK(1)");
  });
});

describe("review fixes", () => {
  const qty = COLUMNS[3] as ColumnDef;

  test("a count unit takes whole quantities only: 12.5 on a pack is a cell error and never reaches the payload", () => {
    for (const unit of ["pack", "piece", "unit"]) expect(parseCell(qty, "12.5", { unit }), unit).toEqual({ ok: false, error: "decimals" });
    for (const unit of ["kg", "g", "l", "ml"]) expect(parseCell(qty, "12.5", { unit }), unit).toMatchObject({ ok: true });
    expect(parseCell(qty, "12", { unit: "pack" })).toEqual({ ok: true, value: { t: "qty", milli: 12_000, unit: "pack" } });
    const s = setCell(fresh(), "b", "on_hand", "12.5").store; // b is a pack item
    expect(errors(s)).toEqual([{ rowKey: "b", column: "on_hand", error: "decimals" }]);
    expect(JSON.stringify(diff(s))).not.toContain("12500");
  });

  test("an added row's quantity unit is its parsed unit cell: ' KG ' is kg, and ' PACK ' refuses a fraction", () => {
    let { store: s, key } = addRow(fresh());
    s = setCell(s, key, "unit", " KG ").store;
    s = setCell(s, key, "on_hand", "1.5").store;
    expect(cellView(s, key, "on_hand").value).toEqual({ t: "qty", milli: 1500, unit: "kg" });
    s = setCell(s, key, "unit", " PACK ").store;
    expect(cellView(s, key, "on_hand").error).toBe("decimals");
  });

  test("re-importing the books' own export is silent: equal values in read-only columns are skipped, no refusals, no diff", () => {
    const base = fresh();
    const { store, report } = importTable(base, exportMatrix(base, "en"));
    expect(report).toEqual({ applied: 2, refused: 0, clipped: 2, added: 0 }); // the on-hand cells, set to what they were; the snapshot column has no home
    expect(diff(store)).toEqual({ snapshotId: "snap-1", changes: [], adds: [], removes: [] });
    expect(store.history).toHaveLength(0);
    expect(importTable(base, [["id", "Item"], ["a", "Other name"]]).report.refused).toBe(1); // a different value still is
  });

  test("a 5000-row import is linear: it finishes well inside a second", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`Item ${i}`, "", "kg", "1.5"]);
    const t0 = performance.now();
    const { store, report } = pasteGrid(fresh(), { row: 2, col: 0 }, rows);
    const ms = performance.now() - t0;
    expect(report.added).toBe(5000);
    expect(diff(store).adds).toHaveLength(5000);
    expect(ms).toBeLessThan(1500);
  });

  test("only well-formed grouping is grouping", () => {
    const grouped = (raw: string) => parseCell(money, raw, { unit: "" });
    for (const bad of ["12,34", "1,15", "1,5", "1,2345", "12,3456.00"]) expect(grouped(bad), bad).toEqual({ ok: false, error: "number" });
    expect(grouped("1,23,456")).toMatchObject({ ok: true, value: { minor: 12_345_600 } });
    expect(grouped("123,456.5")).toMatchObject({ ok: true, value: { minor: 12_345_650 } });
    expect(grouped("12,345")).toMatchObject({ ok: true, value: { minor: 1_234_500 } });
  });

  test("a bare quote inside a pasted cell does not mis-split rows", () => {
    expect(parseTsv('5" pipe\t3\nb\t4')).toEqual([["5\" pipe", "3"], ["b", "4"]]);
    expect(parseTsv('"unterminated\t3\nb\t4')).toEqual([['"unterminated', "3"], ["b", "4"]]);
    expect(parseTsv('"say ""hi"""\t1\r\n"a\nb"\t2')).toEqual([['say "hi"', "1"], ["a\nb", "2"]]);
  });

  test("an xlsx that declares a huge unzipped size is read off its central directory, before anything is inflated", async () => {
    const zip = (declared: number) => {
      const name = new TextEncoder().encode("big.xml");
      const cd = new DataView(new ArrayBuffer(46 + name.length));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint32(24, declared, true);
      cd.setUint16(28, name.length, true);
      new Uint8Array(cd.buffer).set(name, 46);
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(10, 1, true);
      eocd.setUint32(12, cd.byteLength, true);
      eocd.setUint32(16, 0, true);
      return new Blob([cd.buffer, eocd.buffer]);
    };
    expect(await declaredUnzippedSize(zip(4_000_000_000))).toBe(4_000_000_000);
    expect(await declaredUnzippedSize(zip(1234))).toBe(1234);
    await expect(declaredUnzippedSize(new Blob(["not a zip"]))).rejects.toThrow();
  });
});
