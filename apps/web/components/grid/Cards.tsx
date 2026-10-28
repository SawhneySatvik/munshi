"use client";

import { useState } from "react";
import { fillText } from "../../lib/i18n";
import { GRID } from "../../lib/grid/i18n";
import { parseTsv } from "../../lib/grid/paste";
import { cellView, type Store, viewRows } from "../../lib/grid/store";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { CellDisplay, ChoiceLists, errorId } from "./CellDisplay";

export type CardsProps = {
  store: Store;
  onEdit: (rowKey: string, col: string, raw: string) => void;
  onPaste: (anchor: { row: number; col: number }, block: string[][]) => void;
  onAddRow: () => void;
  onToggleRemove: (rowKey: string) => void;
};

/** Under 600 px: the same store as a card per row. Each editable field is a 16px input; "Paste rows" takes the place of a
 *  focused-cell paste, which a phone cannot do. */
export function Cards({ store, onEdit, onPaste, onAddRow, onToggleRemove }: CardsProps) {
  const { lang } = useLang();
  const g = GRID[lang];
  const [pasted, setPasted] = useState("");
  const rows = viewRows(store);
  const [nameCol, ...rest] = store.columns;

  return (
    <div className="gt-cards">
      <ChoiceLists store={store} />
      <ol className="gt-card-list" aria-label={g.gridLabel}>
        {rows.map((r) => (
          <li key={r.key} className={`gt-card${r.removed ? " is-removed" : ""}${r.added ? " is-added" : ""}`}>
            <div className="gt-card-head">
              <div className="gt-card-name">
                {nameCol && r.added ? <Field store={store} rowKey={r.key} col={nameCol.key} onEdit={onEdit} /> : nameCol && <CellDisplay store={store} rowKey={r.key} col={nameCol.key} />}
                {(r.added || r.removed) && <span className="gc-tag">{r.removed ? g.toRemove : g.newRow}</span>}
              </div>
              <Button onClick={() => onToggleRemove(r.key)}>{r.removed ? g.keepRow : g.removeRow}</Button>
            </div>
            <dl className="gt-card-fields">
              {rest.map((c) => {
                const editable = (!c.readOnly || r.added) && !r.removed;
                return (
                  <div key={c.key} className="gt-card-field">
                    <dt className="kicker">{c.label[lang]}</dt>
                    <dd>
                      {!r.added && <CellDisplay store={store} rowKey={r.key} col={c.key} />}
                      {editable && <Field store={store} rowKey={r.key} col={c.key} onEdit={onEdit} />}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ol>
      <div className="gt-card-actions">
        <Button onClick={onAddRow}>{g.addRow}</Button>
      </div>
      <div className="field gt-pastebox">
        <label htmlFor="gt-paste" className="kicker field-label">
          {g.pasteRows}
        </label>
        <textarea id="gt-paste" className="input" rows={3} placeholder={g.pasteHint} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <Button
          disabled={!pasted.trim()}
          onClick={() => {
            onPaste({ row: rows.length, col: 0 }, parseTsv(pasted));
            setPasted("");
          }}
        >
          {g.pasteApply}
        </Button>
      </div>
    </div>
  );
}

// Uncontrolled and keyed by the stored text: it commits on blur or Enter, and a paste or undo that changes the cell
// remounts it with the new text.
function Field({ store, rowKey, col, onEdit }: { store: Store; rowKey: string; col: string; onEdit: CardsProps["onEdit"] }) {
  const { lang } = useLang();
  const g = GRID[lang];
  const def = store.columns.find((c) => c.key === col);
  const v = cellView(store, rowKey, col);
  if (!def) return null;
  return (
    <input
      key={v.text}
      className="input gt-card-in"
      defaultValue={v.text}
      aria-label={fillText(g.changeField, { label: def.label[lang] })}
      aria-invalid={v.error ? true : undefined}
      aria-describedby={v.error ? errorId(rowKey, col) : undefined}
      inputMode={def.kind === "text" || def.kind === "choice" ? "text" : "decimal"}
      list={def.kind === "choice" ? `gt-opts-${def.key}` : undefined}
      autoComplete="off"
      onBlur={(e) => {
        if (e.currentTarget.value !== v.text) onEdit(rowKey, col, e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
