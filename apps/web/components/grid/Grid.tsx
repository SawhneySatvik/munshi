"use client";

import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { GRID } from "../../lib/grid/i18n";
import { parseTsv, rangeToTsv } from "../../lib/grid/paste";
import { cellView, type Store, type ViewRow, viewRows } from "../../lib/grid/store";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { CellDisplay, ChoiceLists, errorId } from "./CellDisplay";
import "./grid.css";

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, ViewRow>();
export const ROW_HEIGHT = 52;
const WIDTH = { text: "minmax(150px, 1.6fr)", choice: "minmax(90px, 0.7fr)", qty: "minmax(170px, 1.2fr)", money: "minmax(130px, 1fr)", int: "minmax(110px, 0.8fr)" } as const;

type Pos = { row: number; col: number };
type Editing = Pos & { draft: string };

export type GridProps = {
  store: Store;
  onEdit: (rowKey: string, col: string, raw: string) => void;
  onPaste: (anchor: Pos, block: string[][]) => void;
  onRefuse: (why: "readonly" | "removed") => void;
  onUndo: () => void;
  onToggleRemove: (rowKey: string) => void;
  /** Rows beyond this many are windowed by @tanstack/react-virtual; a stock list is far below it. */
  virtualAbove?: number;
};

/**
 * The table: a DOM ARIA grid over the pending store. Arrow keys, Enter or F2 to edit, Escape to cancel, Tab, Shift to
 * extend a range, Ctrl/Cmd+C copies the range as TSV, Ctrl/Cmd+V pastes TSV from the focused cell. It holds no data of
 * its own: every edit goes out through onEdit/onPaste into the store, and nothing is written anywhere.
 */
export function Grid({ store, onEdit, onPaste, onRefuse, onUndo, onToggleRemove, virtualAbove = 200 }: GridProps) {
  const { lang } = useLang();
  const g = GRID[lang];
  const rows = useMemo(() => viewRows(store), [store]);
  const [focus, setFocus] = useState<Pos>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Pos>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  // Enter closes the editor and the unmounting input may still blur: the edit is committed once.
  const settled = useRef(true);
  const cols = store.columns;
  const virtual = rows.length > virtualAbove;

  const columns = useMemo(() => cols.map((c) => helper.display({ id: c.key, header: c.label[lang] })), [cols, lang]);
  const table = useTable({ features, columns, data: rows });
  const model = table.getRowModel().rows;
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: virtual,
    initialRect: { width: 900, height: 480 },
  });
  const shown = virtual ? virt.getVirtualItems().map((v) => v.index) : rows.map((_, i) => i);
  const template = cols.map((c) => WIDTH[c.kind]).join(" ");

  // Focus follows the keyboard: after a move or an edit closes, the new cell takes focus once it is in the DOM.
  useEffect(() => {
    if (!wantFocus.current || editing) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-r="${focus.row}"][data-c="${focus.col}"]`);
    if (el) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  });

  const clamp = (p: Pos): Pos => ({ row: Math.max(0, Math.min(rows.length - 1, p.row)), col: Math.max(0, Math.min(cols.length - 1, p.col)) });
  const go = (to: Pos, extend = false) => {
    const p = clamp(to);
    wantFocus.current = true;
    setFocus(p);
    if (!extend) setAnchor(p);
    if (virtual) virt.scrollToIndex(p.row);
  };

  const begin = (at: Pos, typed?: string) => {
    const row = rows[at.row];
    const def = cols[at.col];
    if (!row || !def) return;
    if (row.removed) return onRefuse("removed");
    if (def.readOnly && !row.added) return onRefuse("readonly");
    settled.current = false;
    setEditing({ ...at, draft: typed ?? cellView(store, row.key, def.key).text });
  };

  const finish = (save: boolean, then?: Pos) => {
    if (!editing || settled.current) return;
    settled.current = true;
    const row = rows[editing.row];
    const def = cols[editing.col];
    if (save && row && def && editing.draft !== cellView(store, row.key, def.key).text) onEdit(row.key, def.key, editing.draft);
    setEditing(null);
    go(then ?? editing);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return onUndo();
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const to = (dr: number, dc: number) => {
      e.preventDefault();
      go({ row: focus.row + dr, col: focus.col + dc }, e.shiftKey);
    };
    switch (e.key) {
      case "ArrowDown":
        return to(1, 0);
      case "ArrowUp":
        return to(-1, 0);
      case "ArrowRight":
        return to(0, 1);
      case "ArrowLeft":
        return to(0, -1);
      case "Home":
        return to(0, -cols.length);
      case "End":
        return to(0, cols.length);
      case "Tab": {
        const last = focus.row === rows.length - 1 && focus.col === cols.length - 1;
        const first = focus.row === 0 && focus.col === 0;
        if (e.shiftKey ? first : last) return;
        e.preventDefault();
        const flat = focus.row * cols.length + focus.col + (e.shiftKey ? -1 : 1);
        return go({ row: Math.floor(flat / cols.length), col: flat % cols.length });
      }
      case "Enter":
      case "F2":
        e.preventDefault();
        return begin(focus);
      case "Escape":
        return go(focus);
      case "Delete": {
        const row = rows[focus.row];
        if (row) {
          e.preventDefault();
          onToggleRemove(row.key);
        }
        return;
      }
      default:
        if (e.key.length === 1) {
          e.preventDefault();
          begin(focus, e.key);
        }
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", rangeToTsv(store, anchor, focus));
  };
  const onPasteEvent = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    e.preventDefault();
    onPaste(focus, parseTsv(e.clipboardData.getData("text/plain")));
  };

  const inRange = (r: number, c: number) =>
    r >= Math.min(anchor.row, focus.row) && r <= Math.max(anchor.row, focus.row) && c >= Math.min(anchor.col, focus.col) && c <= Math.max(anchor.col, focus.col);
  const focusedRow = rows[focus.row];
  const multi = anchor.row !== focus.row || anchor.col !== focus.col;

  return (
    <div className="gt-grid-wrap">
      <p className="gt-help" id="gt-help">
        {g.editHelp}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: an editable spreadsheet is the ARIA grid pattern, not a data table */}
      <div
        ref={root}
        className="gt-grid"
        role="grid"
        aria-label={g.gridLabel}
        aria-describedby="gt-help"
        aria-rowcount={rows.length + 1}
        aria-colcount={cols.length}
        aria-multiselectable="true"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPasteEvent}
      >
        <div ref={scroller} className="gt-scroll">
          <div className="gt-sizer" style={{ minWidth: 560 }}>
            {table.getHeaderGroups().map((group) => (
              // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: the ARIA grid pattern (roles on divs, one cell holds the roving tabindex), not a data table
              <div key={group.id} role="row" aria-rowindex={1} className="gt-row gt-head" style={{ gridTemplateColumns: template }}>
                {group.headers.map((h, c) => (
                  // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: the ARIA grid pattern (roles on divs, one cell holds the roving tabindex), not a data table
                  <div key={h.id} role="columnheader" aria-colindex={c + 1} className="gc gc-head kicker">
                    <table.FlexRender header={h} />
                    {cols[c]?.readOnly && <span className="vh"> ({g.readOnly})</span>}
                  </div>
                ))}
              </div>
            ))}
            <div className="gt-body" style={virtual ? { height: virt.getTotalSize(), position: "relative" } : undefined}>
              {shown.map((i) => {
                const tr = model[i];
                const vr = rows[i];
                if (!tr || !vr) return null;
                return (
                  // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: the ARIA grid pattern (roles on divs, one cell holds the roving tabindex), not a data table
                  <div
                    key={tr.id}
                    role="row"
                    aria-rowindex={i + 2}
                    className={`gt-row${vr.removed ? " is-removed" : ""}${vr.added ? " is-added" : ""}`}
                    style={{ gridTemplateColumns: template, ...(virtual ? { position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${i * ROW_HEIGHT}px)` } : {}) }}
                  >
                    {tr.getAllCells().map((cell, c) => {
                      const def = cols[c];
                      if (!def) return null;
                      const v = cellView(store, vr.key, def.key);
                      const locked = def.readOnly && !vr.added;
                      const here = focus.row === i && focus.col === c;
                      const open = editing?.row === i && editing.col === c;
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: keys are handled once on the grid (roving tabindex); the ARIA grid pattern, not a data table
                        <div
                          key={cell.id}
                          role="gridcell"
                          aria-colindex={c + 1}
                          aria-selected={inRange(i, c)}
                          data-multi={multi && inRange(i, c) ? "" : undefined}
                          aria-readonly={locked || undefined}
                          aria-invalid={v.error ? true : undefined}
                          aria-describedby={v.error ? errorId(vr.key, def.key) : undefined}
                          tabIndex={here ? 0 : -1}
                          data-r={i}
                          data-c={c}
                          className={`gc${locked ? " gc-locked" : ""}${v.edited ? " gc-edited" : ""}${v.error ? " gc-bad" : ""}${def.kind === "qty" || def.kind === "money" || def.kind === "int" ? " gc-num" : ""}`}
                          onClick={(e) => {
                            wantFocus.current = true;
                            setFocus({ row: i, col: c });
                            if (!e.shiftKey) setAnchor({ row: i, col: c });
                          }}
                          onDoubleClick={() => begin({ row: i, col: c })}
                        >
                          {open && editing ? (
                            <input
                              ref={(el) => el?.focus()}
                              className="gc-input"
                              aria-label={def.label[lang]}
                              inputMode={def.kind === "text" || def.kind === "choice" ? "text" : "decimal"}
                              list={def.kind === "choice" ? `gt-opts-${def.key}` : undefined}
                              autoComplete="off"
                              value={editing.draft}
                              onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                              onBlur={() => finish(true, undefined)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  finish(true, { row: i + 1, col: c });
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  finish(false);
                                } else if (e.key === "Tab") {
                                  e.preventDefault();
                                  finish(true, { row: i, col: c + (e.shiftKey ? -1 : 1) });
                                }
                              }}
                            />
                          ) : (
                            <CellDisplay store={store} rowKey={vr.key} col={def.key} />
                          )}
                          {c === 0 && (vr.added || vr.removed) && <span className="gc-tag">{vr.removed ? g.toRemove : g.newRow}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <ChoiceLists store={store} />
      </div>
      <div className="gt-under">
        {focusedRow && (
          <Button onClick={() => onToggleRemove(focusedRow.key)}>{focusedRow.removed ? g.keepRow : g.removeRow}</Button>
        )}
      </div>
    </div>
  );
}
