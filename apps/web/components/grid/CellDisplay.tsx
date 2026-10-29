"use client";

import { formatMoney, formatQty } from "../../lib/snapshot";
import type { CellValue, Lang } from "../../lib/types";
import { cellView, type Store } from "../../lib/grid/store";
import { GRID } from "../../lib/grid/i18n";
import { Figure } from "../shell/Figure";
import { useLang } from "../LangProvider";

const ERROR_KEY = {
  empty: "errEmpty",
  number: "errNumber",
  decimals: "errDecimals",
  range: "errRange",
  choice: "errChoice",
  long: "errLong",
} as const;

/** A value the person typed, as the screen prints it. It is theirs, not the books': no source, always labelled so. */
export function typedValue(v: CellValue, lang: Lang): string {
  switch (v.t) {
    case "qty":
      return formatQty(v.milli, v.unit, lang);
    case "money":
      return formatMoney(v.minor, v.currency, "exact");
    case "int":
      return new Intl.NumberFormat("en-IN").format(v.v);
    case "text":
    case "date":
    case "time":
      return v.v;
    default:
      return "";
  }
}

export const errorId = (rowKey: string, col: string) => `gt-err-${rowKey}-${col}`;

/** What a cell shows: the books' figure through its source chip, or the person's own edit labelled "your edit", or the
 *  text they typed with why it does not parse. */
export function CellDisplay({ store, rowKey, col }: { store: Store; rowKey: string; col: string }) {
  const { lang } = useLang();
  const g = GRID[lang];
  const v = cellView(store, rowKey, col);
  if (v.error) {
    return (
      <>
        <span className="gc-val" data-said="">
          {v.text}
        </span>
        <span className="gc-err" id={errorId(rowKey, col)}>
          {g[ERROR_KEY[v.error]]}
        </span>
      </>
    );
  }
  if (v.edited && v.value) {
    return (
      <>
        <span className={v.value.t === "text" ? "gc-val" : "gc-val amt"} data-said="">
          {typedValue(v.value, lang)}
        </span>
        <span className="gc-tag">{g.yourEdit}</span>
      </>
    );
  }
  if (v.base?.ref) return <Figure cell={v.base.ref} />;
  return v.value?.t === "text" && v.value.v ? <span data-name="">{v.value.v}</span> : null;
}

/** The values a choice column accepts, offered while typing. */
export function ChoiceLists({ store }: { store: Store }) {
  return store.columns
    .filter((c) => c.kind === "choice")
    .map((c) => (
      <datalist key={c.key} id={`gt-opts-${c.key}`}>
        {c.options?.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    ));
}
