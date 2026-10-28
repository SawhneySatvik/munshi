// The pending-changes store: an immutable base read from one snapshot, and what the person has typed on top of it.
// Pure functions, no I/O: nothing here writes anywhere. Each base number keeps the ref of the snapshot cell it came
// from, so the review can show "was" with its source. What the person typed is kept as text and parsed against the
// column whenever it is read, so a qty never carries a stale unit and an edit set back to the books' value is no edit.
import type { CellValue, SourceRef } from "../types";
import { type ColumnDef, editText, type ParseError, parseCell, sameValue } from "./columns";

export type BaseCell = { value: CellValue; ref: SourceRef | null };
export type BaseRow = { key: string; cells: Record<string, BaseCell> };

type Typed = Record<string, string>;
type State = { edits: Record<string, Typed>; adds: Array<{ key: string; cells: Typed }>; removes: string[]; seq: number };

export type Store = {
  snapshotId: string;
  columns: ColumnDef[];
  base: readonly BaseRow[];
  state: State;
  history: State[];
};

export type Refusal = "readonly" | "removed" | "unknown";

const HISTORY_CAP = 200;
const EMPTY: State = { edits: {}, adds: [], removes: [], seq: 0 };

export const createStore = (snapshotId: string, columns: ColumnDef[], base: readonly BaseRow[]): Store => ({
  snapshotId,
  columns,
  base,
  state: EMPTY,
  history: [],
});

const column = (s: Store, key: string) => s.columns.find((c) => c.key === key);

// Lookups are indexed once per array (the arrays are never mutated after they are shared), so an import of thousands of
// rows is linear, not quadratic.
const baseIndex = new WeakMap<readonly BaseRow[], Map<string, BaseRow>>();
const baseRow = (s: Store, key: string): BaseRow | undefined => {
  let idx = baseIndex.get(s.base);
  if (!idx) {
    idx = new Map(s.base.map((r) => [r.key, r]));
    baseIndex.set(s.base, idx);
  }
  return idx.get(key);
};
const addIndex = new WeakMap<State["adds"], Map<string, number>>();
const addAt = (adds: State["adds"], key: string): number => {
  let idx = addIndex.get(adds);
  if (!idx) {
    idx = new Map(adds.map((r, i) => [r.key, i]));
    addIndex.set(adds, idx);
  }
  return idx.get(key) ?? -1;
};
const removedSets = new WeakMap<string[], Set<string>>();
const isRemoved = (s: Store, key: string) => {
  let set = removedSets.get(s.state.removes);
  if (!set) {
    set = new Set(s.state.removes);
    removedSets.set(s.state.removes, set);
  }
  return set.has(key);
};
const addedRow = (s: Store, key: string) => s.state.adds[addAt(s.state.adds, key)];

export type ViewRow = { key: string; added: boolean; removed: boolean };
export const viewRows = (s: Store): ViewRow[] => [
  ...s.base.map((r) => ({ key: r.key, added: false, removed: isRemoved(s, r.key) })),
  ...s.state.adds.map((r) => ({ key: r.key, added: true, removed: false })),
];

export type CellView = {
  /** What the cell shows and what a copy carries. */
  text: string;
  /** The parsed value; null while the text does not parse. */
  value: CellValue | null;
  /** The snapshot cell behind an untouched base number. */
  base: BaseCell | null;
  edited: boolean;
  error: ParseError | null;
};

/** The unit a qty in this row is in: the row's parsed unit cell, so "KG " and "kg" are one unit. */
function unitOf(s: Store, rowKey: string): string {
  const unitCol = s.columns.find((c) => c.key === "unit");
  const v = unitCol ? cellView(s, rowKey, unitCol.key, false).value : null;
  return v?.t === "text" ? v.v : "";
}

export function cellView(s: Store, rowKey: string, col: string, withUnit = true): CellView {
  const def = column(s, col);
  const row = baseRow(s, rowKey);
  const typed = row ? s.state.edits[rowKey]?.[col] : addedRow(s, rowKey)?.cells[col];
  const base = row?.cells[col] ?? null;
  if (!def || (typed === undefined && base)) return { text: editText(base?.value), value: base?.value ?? null, base, edited: false, error: null };
  const text = typed ?? "";
  const parsed = parseCell(def, text, { unit: withUnit ? unitOf(s, rowKey) : "" });
  return { text, value: parsed.ok ? parsed.value : null, base, edited: typed !== undefined && (!!row || text !== ""), error: parsed.ok ? null : parsed.error };
}

const record = (before: Store, after: Store): Store => ({ ...after, history: [...before.history, before.state].slice(-HISTORY_CAP) });

// A batch (one paste, one import, one edit) works on a private copy of the state and mutates it in place; commit() then
// closes it as ONE undo step. Nothing outside the batch ever sees the copy half-built.
export function begin(s: Store): Store {
  return { ...s, state: { edits: { ...s.state.edits }, adds: s.state.adds.slice(), removes: s.state.removes, seq: s.state.seq } };
}

/** Writes typed text into the batch copy. Read-only columns refuse a different value; the books' own value is a no-op. */
export function putCell(w: Store, rowKey: string, col: string, raw: string): { refused?: Refusal; noop?: true } {
  const def = column(w, col);
  const row = baseRow(w, rowKey);
  if (!def) return { refused: "unknown" };
  if (row) {
    const parsed = parseCell(def, raw, { unit: unitOf(w, rowKey) });
    const baseCell = row.cells[col];
    const back = parsed.ok && baseCell !== undefined && sameValue(parsed.value, baseCell.value);
    if (def.readOnly) return back ? { noop: true } : { refused: "readonly" };
    if (isRemoved(w, rowKey)) return { refused: "removed" };
    const mine = { ...w.state.edits[rowKey] };
    if (back) delete mine[col];
    else mine[col] = raw;
    if (Object.keys(mine).length) w.state.edits[rowKey] = mine;
    else delete w.state.edits[rowKey];
    return {};
  }
  const i = addAt(w.state.adds, rowKey);
  const was = w.state.adds[i];
  if (!was) return { refused: "unknown" };
  w.state.adds[i] = { ...was, cells: { ...was.cells, [col]: raw } };
  return {};
}

export function putRow(w: Store): string {
  const key = `new:${w.state.seq + 1}`;
  w.state.seq++;
  const idx = addIndex.get(w.state.adds);
  w.state.adds.push({ key, cells: {} });
  idx?.set(key, w.state.adds.length - 1);
  return key;
}

/** Closes a batch as one undo step; a batch that changed nothing leaves the store as it was. */
export function commit(before: Store, w: Store): Store {
  const same = w.state.seq === before.state.seq && w.state.adds.length === before.state.adds.length && sameEdits(before.state.edits, w.state.edits) && w.state.adds.every((r, i) => r === before.state.adds[i]);
  return same ? before : record(before, w);
}
const sameEdits = (a: State["edits"], b: State["edits"]) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

export function setCell(s: Store, rowKey: string, col: string, raw: string): { store: Store; refused?: Refusal } {
  const w = begin(s);
  const r = putCell(w, rowKey, col, raw);
  const store = commit(s, w);
  return r.refused ? { refused: r.refused, store } : { store };
}

export function addRow(s: Store): { store: Store; key: string } {
  const w = begin(s);
  const key = putRow(w);
  return { key, store: commit(s, w) };
}

/** Marks an existing row for removal (or takes the mark back); a row the person added is simply dropped. */
export function toggleRemove(s: Store, rowKey: string): Store {
  if (addedRow(s, rowKey)) return record(s, { ...s, state: { ...s.state, adds: s.state.adds.filter((r) => r.key !== rowKey) } });
  if (!baseRow(s, rowKey)) return s;
  const removes = isRemoved(s, rowKey) ? s.state.removes.filter((k) => k !== rowKey) : [...s.state.removes, rowKey];
  return record(s, { ...s, state: { ...s.state, removes } });
}

export function undo(s: Store): Store {
  const state = s.history.at(-1);
  return state ? { ...s, state, history: s.history.slice(0, -1) } : s;
}

export const discardAll = (s: Store): Store => ({ ...s, state: EMPTY, history: [] });

export type CellError = { rowKey: string; column: string; error: ParseError };

/** Every typed cell that does not parse, and every blank required cell of an added row. A removed row is not checked. */
export function errors(s: Store): CellError[] {
  const out: CellError[] = [];
  for (const r of viewRows(s)) {
    if (r.removed) continue;
    for (const c of s.columns) {
      const v = cellView(s, r.key, c.key);
      if (v.error && (r.added ? c.required || v.text !== "" : true)) out.push({ rowKey: r.key, column: c.key, error: v.error });
    }
  }
  return out;
}

export const pendingCount = (s: Store): number =>
  Object.entries(s.state.edits).reduce((n, [key, cells]) => n + (isRemoved(s, key) ? 0 : Object.keys(cells).length), 0) +
  s.state.adds.length +
  s.state.removes.length;

export type Diff = {
  snapshotId: string;
  changes: Array<{ rowKey: string; column: string; old: { value: CellValue; ref: SourceRef | null }; new: { value: CellValue; by: "user" } }>;
  adds: Array<{ rowKey: string; cells: Record<string, { value: CellValue; by: "user" }> }>;
  removes: string[];
};

/** What would be sent for approval: only valid, real changes, each with the books' value it replaces. */
export function diff(s: Store): Diff {
  const changes: Diff["changes"] = [];
  for (const r of s.base) {
    if (isRemoved(s, r.key)) continue;
    for (const c of s.columns) {
      const v = cellView(s, r.key, c.key);
      const was = r.cells[c.key];
      if (v.edited && v.value && was) changes.push({ rowKey: r.key, column: c.key, old: { value: was.value, ref: was.ref }, new: { value: v.value, by: "user" } });
    }
  }
  const adds = s.state.adds.map((r) => {
    const cells: Record<string, { value: CellValue; by: "user" }> = {};
    for (const c of s.columns) {
      const v = cellView(s, r.key, c.key);
      if (v.value && v.text !== "") cells[c.key] = { value: v.value, by: "user" };
    }
    return { rowKey: r.key, cells };
  });
  return { snapshotId: s.snapshotId, changes, adds, removes: [...s.state.removes] };
}
