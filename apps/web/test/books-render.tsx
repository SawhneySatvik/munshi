// Rendering the bills, suppliers and day-report pages as the root layout composes them (the top bar, then the page,
// under one language provider), and the facts their tests check against: read straight from the books with SQL that
// shares nothing with the named reads (the journal for money, the line tables for counts).
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { LangProvider } from "../components/LangProvider";
import { TopBar } from "../components/TopBar";
import { resolveCell } from "../lib/snapshot";
import type { Lang, Snapshot, SourceRef } from "../lib/types";
import { type Home, rows } from "./home-db";

export function renderPage(page: ReactElement, lang: Lang = "en") {
  return render(
    <LangProvider initial={lang}>
      <TopBar />
      {page}
    </LangProvider>,
  );
}

/** The stored value a ref points at: minor units for money, milli-units for a quantity, the number for an integer. */
export function storedValue(snapshots: Snapshot[], ref: SourceRef): number | string | null {
  const c = resolveCell(snapshots, ref);
  if (!c) return null;
  if (c.t === "money") return c.minor;
  if (c.t === "qty") return c.milli;
  if (c.t === "int") return c.v;
  if (c.t === "date" || c.t === "text") return c.v;
  return null;
}

export const one = async <R,>(h: Home, sql: string, params: unknown[] = []): Promise<R> => {
  const [row] = await rows<R>(h, sql, params);
  if (!row) throw new Error(`test: no row for ${sql}`);
  return row;
};
