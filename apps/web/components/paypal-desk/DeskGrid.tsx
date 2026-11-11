"use client";

import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnAutoSizeModule,
  ExternalFilterModule,
  type GetRowIdParams,
  type GridApi,
  type IRowNode,
  QuickFilterModule,
  RowAutoHeightModule,
  type RowClassParams,
  RowStyleModule,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PAYPAL_DESK } from "../../lib/i18n-paypal-desk";
import { resolveCell } from "../../lib/snapshot";
import { DESK_BUCKETS, DESK_STATES, type DeskRow } from "../../lib/paypal-desk";
import type { Lang, SourceRef } from "../../lib/types";
import { useLang } from "../LangProvider";
import { useSources } from "../Sources";
import { DaysCell, LinkAmountCell, NameCell, NextCell, OwesCell, ReminderCell, StackCell, StatePill } from "./cells";
import { deskTheme } from "./theme";

const DEFAULT_COL: ColDef<DeskRow> = { sortable: true, resizable: true, suppressMovable: true, cellClass: "pd-cell" };
const rowId = (p: GetRowIdParams<DeskRow>) => p.data.customer.id;
const rowClass = (p: RowClassParams<DeskRow>) => (p.data?.late ? "pd-late" : undefined);
const MODULES = [ClientSideRowModelModule, ClientSideRowModelApiModule, QuickFilterModule, ExternalFilterModule, ColumnAutoSizeModule, RowAutoHeightModule, RowStyleModule, CellStyleModule];

/** What the charts picked: the rows of one age bucket or one PayPal state. */
export type DeskPick = { by: "bucket"; value: DeskRow["bucket"] } | { by: "state"; value: DeskRow["state"] } | null;

// Sorting compares what a stored cell holds (its minor units, its day, its count); nothing is added or subtracted.
const order = (a: number | string | null, b: number | string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);

/** The words a row is found by in the quick filter: its name, its PayPal state and how late it is. */
const wordsOf = (r: DeskRow, lang: Lang) => {
  const d = PAYPAL_DESK[lang];
  return [r.customer.name, d[`state_${r.state}`], d[`bucket_${r.bucket}`]].join(" ");
};

/**
 * The desk's grid (AG Grid Community): a row per customer, every figure a source chip from its stored cell, a quick
 * filter, sorting by the cells' own values, and the charts' pick as an external filter. On a phone it is two columns:
 * the customer (name, what they owe, the link's state) and the next move.
 */
export function DeskGrid({ rows, quick, pick, narrow }: { rows: DeskRow[]; quick: string; pick: DeskPick; narrow: boolean }) {
  const { lang } = useLang();
  const { snapshots } = useSources();
  const d = PAYPAL_DESK[lang];
  const api = useRef<GridApi<DeskRow> | null>(null);

  const cellValue = useCallback(
    (ref: SourceRef | null): number | string | null => {
      const v = ref ? resolveCell(snapshots, ref) : null;
      return v?.t === "money" ? v.minor : v?.t === "int" ? v.v : v?.t === "date" ? v.v : null;
    },
    [snapshots],
  );

  const columns = useMemo<ColDef<DeskRow>[]>(() => {
    const figure = (get: (r: DeskRow) => SourceRef | null): Partial<ColDef<DeskRow>> => ({
      valueGetter: (p) => (p.data ? cellValue(get(p.data)) : null),
      comparator: order,
      getQuickFilterText: () => "",
      type: "rightAligned",
      cellClass: ["pd-cell", "pd-fig-cell"],
    });
    const who: ColDef<DeskRow> = {
      colId: "customer",
      headerName: d.colCustomer,
      valueGetter: (p) => p.data?.customer.name ?? "",
      getQuickFilterText: (p) => (p.data ? wordsOf(p.data, lang) : ""),
      cellRenderer: NameCell,
      minWidth: 120,
      flex: 1.3,
    };
    const next: ColDef<DeskRow> = {
      colId: "next",
      headerName: d.colNext,
      cellRenderer: NextCell,
      sortable: false,
      getQuickFilterText: () => "",
      minWidth: 200,
      flex: 2,
      autoHeight: true,
      cellClass: "pd-next-cell",
    };
    if (narrow) {
      return [
        { ...who, cellRenderer: StackCell, autoHeight: true, minWidth: 140, flex: 1 },
        { ...next, minWidth: 150, flex: 1 },
      ];
    }
    return [
      who,
      { colId: "owes", headerName: d.colOwes, ...figure((r) => r.balance), cellRenderer: OwesCell, minWidth: 120, flex: 1, autoHeight: true },
      {
        colId: "days",
        headerName: d.colDays,
        // How late first (the bucket's place), then the finding's own days cell.
        valueGetter: (p) => (p.data ? DESK_BUCKETS.indexOf(p.data.bucket) : null),
        comparator: (a, b, x, y) => order(a, b) || order(x.data ? cellValue(x.data.days) : null, y.data ? cellValue(y.data.days) : null),
        getQuickFilterText: (p) => (p.data ? d[`bucket_${p.data.bucket}`] : ""),
        cellRenderer: DaysCell,
        minWidth: 130,
        flex: 1,
        autoHeight: true,
      },
      { colId: "reminder", headerName: d.colReminder, valueGetter: (p) => p.data?.reminder?.status ?? "", cellRenderer: ReminderCell, minWidth: 120, flex: 1, wrapText: true, autoHeight: true },
      {
        colId: "state",
        headerName: d.colState,
        valueGetter: (p) => (p.data ? DESK_STATES.indexOf(p.data.state) : null),
        comparator: order,
        getQuickFilterText: (p) => (p.data ? d[`state_${p.data.state}`] : ""),
        cellRenderer: StatePill,
        minWidth: 170,
        flex: 1.4,
        autoHeight: true,
      },
      { colId: "link", headerName: d.colLinkAmount, ...figure((r) => (r.state === "none" ? null : r.linkAmount)), cellRenderer: LinkAmountCell, minWidth: 100, flex: 0.8 },
      next,
    ];
  }, [d, lang, narrow, cellValue]);

  // The charts' pick filters the rows; the grid is told whenever it changes.
  const picked = useRef(pick);
  const isPicked = useCallback(() => picked.current !== null, []);
  const passes = useCallback((node: IRowNode<DeskRow>) => {
    const p = picked.current;
    return !p || !node.data || (p.by === "bucket" ? node.data.bucket === p.value : node.data.state === p.value);
  }, []);
  useEffect(() => {
    picked.current = pick;
    api.current?.onFilterChanged();
  }, [pick]);
  // A refreshed row (a draft made, a link sent) can grow: its auto height is measured again.
  useEffect(() => {
    if (rows.length) api.current?.resetRowHeights();
  }, [rows]);

  return (
    <section className="pd-grid" aria-label={d.gridLabel}>
      <AgGridReact<DeskRow>
        modules={MODULES}
        theme={deskTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={DEFAULT_COL}
        getRowId={rowId}
        getRowClass={rowClass}
        quickFilterText={quick}
        isExternalFilterPresent={isPicked}
        doesExternalFilterPass={passes}
        domLayout="autoHeight"
        suppressColumnVirtualisation
        suppressCellFocus
        overlayNoRowsTemplate={`<span class="pd-quiet">${d.noRows}</span>`}
        onGridReady={(e) => {
          api.current = e.api;
        }}
        onGridPreDestroyed={() => {
          api.current = null;
        }}
      />
    </section>
  );
}
