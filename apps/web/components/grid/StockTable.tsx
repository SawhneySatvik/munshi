"use client";

import { type ChangeEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { fill } from "../../lib/i18n";
import { downloadCsv, downloadXlsx, FileRefused, readTable } from "../../lib/grid/files";
import { GRID } from "../../lib/grid/i18n";
import { exportMatrix, importTable, type PasteReport, pasteGrid } from "../../lib/grid/paste";
import { addRow, discardAll, pendingCount, setCell, toggleRemove, undo } from "../../lib/grid/store";
import { stockStore } from "../../lib/grid/stock";
import type { StockPage } from "../../lib/ops-types";
import { Button } from "../Button";
import { Foot } from "../Foot";
import { useLang } from "../LangProvider";
import { PageHead } from "../PageHead";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Cards } from "./Cards";
import { Grid } from "./Grid";
import { Review } from "./Review";
import { useNarrow } from "./useNarrow";
import "../Ops.css";
import "./grid.css";

/**
 * The stock list as a spreadsheet. The books' figures are the base; everything typed, pasted or imported is held here in
 * the page's own state and reviewed as a diff. Nothing is saved and nothing is sent: the draft payload is only shown.
 */
export function StockTable({ data }: { data: StockPage }) {
  const { lang } = useLang();
  const g = GRID[lang];
  const [store, setStore] = useState(() => stockStore(data));
  const [note, setNote] = useState<ReactNode>(null);
  const narrow = useNarrow();
  const file = useRef<HTMLInputElement>(null);
  const pending = pendingCount(store);
  const count = (k: number) => <span data-said="">{k}</span>;
  const refuse = (why: "readonly" | "removed") => setNote(why === "removed" ? g.refusedRemoved : g.refusedReadonly);
  const said = (r: PasteReport, extra?: ReactNode) => (
    <>
      {extra ?? fill(g.pasted, { n: count(r.applied) })}
      {r.added > 0 && <> · {fill(g.pastedAdded, { n: count(r.added) })}</>}
      {r.refused > 0 && <> · {fill(g.pastedRefused, { n: count(r.refused) })}</>}
      {r.clipped > 0 && <> · {fill(g.pastedClipped, { n: count(r.clipped) })}</>}
    </>
  );
  const fileError = useMemo(() => ({ big: g.fileBig, long: g.fileLong, type: g.fileType, unreadable: g.fileUnreadable }), [g]);

  const onEdit = (rowKey: string, col: string, raw: string) => {
    const r = setCell(store, rowKey, col, raw);
    setStore(r.store);
    setNote(r.refused ? (r.refused === "removed" ? g.refusedRemoved : g.refusedReadonly) : null);
  };
  const onPaste = (anchor: { row: number; col: number }, block: string[][]) => {
    const r = pasteGrid(store, anchor, block);
    setStore(r.store);
    setNote(said(r.report));
  };
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const r = importTable(store, await readTable(f));
      setStore(r.store);
      setNote(said(r.report, fill(g.imported, { n: count(r.report.applied), file: <span data-name="">{f.name}</span> })));
    } catch (err) {
      setNote(fileError[err instanceof FileRefused ? err.reason : "unreadable"]);
    }
  };

  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={null}>
      <main className="wrap gt">
        <PageHead id="gt-h" kicker={fill(g.kicker, { shop: <span data-name="">{data.shop}</span> })} title={g.title} lede={g.lede} />
        <div className="gt-layout">
          <div className="gt-main">
            <div className="gt-tools">
              <Button onClick={() => setStore(addRow(store).store)}>{g.addRow}</Button>
              <Button disabled={store.history.length === 0} onClick={() => setStore(undo(store))}>
                {g.undo}
              </Button>
              <Button onClick={() => file.current?.click()}>{g.importFile}</Button>
              <input ref={file} type="file" accept=".csv,.tsv,.txt,.xlsx" hidden aria-label={g.importFile} onChange={onImport} />
              <Button onClick={() => downloadCsv(exportMatrix(store, lang), "stock-table")}>{g.exportCsv}</Button>
              <Button onClick={() => downloadXlsx(exportMatrix(store, lang), "stock-table")}>{g.exportXlsx}</Button>
            </div>
            <p className="field-note">{g.exportNote}</p>
            <div role="status" className="gt-note">
              {note}
            </div>
            {narrow ? (
              <Cards store={store} onEdit={onEdit} onPaste={onPaste} onAddRow={() => setStore(addRow(store).store)} onToggleRemove={(k) => setStore(toggleRemove(store, k))} />
            ) : (
              <Grid
                store={store}
                onEdit={onEdit}
                onPaste={onPaste}
                onRefuse={refuse}
                onUndo={() => setStore(undo(store))}
                onToggleRemove={(k) => setStore(toggleRemove(store, k))}
              />
            )}
            <Review store={store} onUndo={() => setStore(undo(store))} onDiscard={() => setStore(discardAll(store))} />
          </div>
          <div className="gt-side">
            <SourceDrawer />
          </div>
        </div>
        {narrow && pending > 0 && (
          <div className="gt-bar">
            <a className="press press-primary" href="#gt-review">
              {fill(g.changesN, { n: count(pending) })} · {g.reviewLink}
            </a>
          </div>
        )}
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}
