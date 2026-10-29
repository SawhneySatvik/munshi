"use client";

import { useState } from "react";
import { fill } from "../../lib/i18n";
import { GRID } from "../../lib/grid/i18n";
import { cellView, diff, errors, pendingCount, type Store } from "../../lib/grid/store";
import { Button } from "../Button";
import { Figure } from "../shell/Figure";
import { useLang } from "../LangProvider";
import { typedValue } from "./CellDisplay";

const ERROR_KEY = { empty: "errEmpty", number: "errNumber", decimals: "errDecimals", range: "errRange", choice: "errChoice", long: "errLong" } as const;

/**
 * Every pending change, old to new: the old figure through its source chip, the new one the person's own and labelled so.
 * "Send for approval" only shows the draft it would send; the approval wiring comes with grid.apply, so nothing is
 * written, and the digits in the payload are the person's draft, not a figure from the books.
 */
export function Review({ store, onUndo, onDiscard }: { store: Store; onUndo: () => void; onDiscard: () => void }) {
  const { lang } = useLang();
  const g = GRID[lang];
  const [shown, setShown] = useState(false);
  const d = diff(store);
  const bad = errors(store);
  const n = pendingCount(store);
  const label = (col: string) => store.columns.find((c) => c.key === col)?.label[lang] ?? col;
  const nameCol = store.columns[0]?.key ?? "";
  const name = (rowKey: string) => cellView(store, rowKey, nameCol).text;
  const count = (k: number) => <span data-said="">{k}</span>;

  return (
    <section id="gt-review" className="sheet gt-review" aria-labelledby="gt-review-h">
      <div className="sheet-top">
        <h2 id="gt-review-h">{g.reviewHeading}</h2>
        {n > 0 && <span className="kicker">{fill(g.changesN, { n: count(n) })}</span>}
      </div>
      {n === 0 ? (
        <p className="field-note">{g.noChanges}</p>
      ) : (
        <>
          {d.changes.length > 0 && (
            <div>
              <h3 className="gt-group kicker">{g.groupEdited}</h3>
              <ul className="gt-changes">
                {d.changes.map((c) => (
                  <li key={`${c.rowKey}:${c.column}`}>
                    <span data-name="">{name(c.rowKey)}</span> · {label(c.column)}
                    <span className="gt-delta">
                      {g.was} {c.old.ref ? <Figure cell={c.old.ref} /> : typedValue(c.old.value, lang)} → {g.nowIs}{" "}
                      <span className="amt" data-said="">
                        {typedValue(c.new.value, lang)}
                      </span>{" "}
                      <span className="gc-tag">{g.yourEdit}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.adds.length > 0 && (
            <div>
              <h3 className="gt-group kicker">{g.groupAdded}</h3>
              <ul className="gt-changes">
                {d.adds.map((a) => (
                  <li key={a.rowKey}>
                    <span data-said="">{Object.entries(a.cells).map(([col, c]) => `${label(col)}: ${typedValue(c.value, lang)}`).join(" · ")}</span>{" "}
                    <span className="gc-tag">{g.yourEdit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.removes.length > 0 && (
            <div>
              <h3 className="gt-group kicker">{g.groupRemoved}</h3>
              <ul className="gt-changes">
                {d.removes.map((k) => (
                  <li key={k}>
                    <span data-name="">{name(k)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bad.length > 0 && (
            <div role="alert" className="gt-bad">
              <p>{fill(g.fixFirst, { n: count(bad.length) })}</p>
              <ul className="gt-changes">
                {bad.map((b) => (
                  <li key={`${b.rowKey}:${b.column}`}>
                    <span data-name="">{name(b.rowKey) || label(nameCol)}</span> · {label(b.column)}: {g[ERROR_KEY[b.error]]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="gt-actions">
        <Button disabled={store.history.length === 0} onClick={onUndo}>
          {g.undo}
        </Button>
        <Button
          disabled={n === 0}
          onClick={() => {
            setShown(false);
            onDiscard();
          }}
        >
          {g.discardAll}
        </Button>
        <Button variant="primary" disabled={n === 0 || bad.length > 0} onClick={() => setShown(true)}>
          {g.send}
        </Button>
      </div>
      <div aria-live="polite">
        {shown && n > 0 && bad.length === 0 && (
          <div className="gt-payload">
            <h3 className="gt-group kicker">{g.payloadHeading}</h3>
            <pre data-said="">{JSON.stringify(d, null, 2)}</pre>
            <p className="field-note">{g.payloadNote}</p>
            <Button onClick={() => setShown(false)}>{g.hidePayload}</Button>
          </div>
        )}
      </div>
    </section>
  );
}
