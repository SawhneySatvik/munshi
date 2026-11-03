// The day report (server only): sales.by_day and sales.by_item for the chosen period, and sales.week_total for the week,
// minted by core's viewReport as the signed-in member in the page's one transaction. Every figure is a ref into those
// snapshots; nothing is added up here. Null for a role the report is not for (core's map, D-082): the page's 404.
import { type Session, viewReport } from "@munshi/core";
import type { DayRow, ItemRow, PeriodTotal, ReportPage, ReportView } from "../books";
import { me, page, refTo, stored, textOf, words } from "./ledger";

export async function loadReport(session: Session, view: ReportView): Promise<ReportPage | null> {
  const v = await page(session, (c) => viewReport(c, session, view));
  if (!v) return null;
  const { shop, member } = me(v.viewer);
  const [days, items] = [stored(v.days), stored(v.items)];
  const weekSnap = v.week ? stored(v.week) : null;

  const book = words("labelSalesBook");
  const dayRows: DayRow[] = days.rows.map((_, r) => ({
    day: textOf(days, r, "day"),
    bills: refTo(book, days, r, "bills"),
    total: refTo(book, days, r, "total"),
    cash: refTo(book, days, r, "cash"),
    upi: refTo(book, days, r, "upi"),
    card: refTo(book, days, r, "card"),
    onCredit: refTo(book, days, r, "on_credit"),
  }));
  const itemRows: ItemRow[] = items.rows.map((_, r) => ({
    item: textOf(items, r, "item"),
    sold: refTo(book, items, r, "sold"),
    revenue: refTo(book, items, r, "revenue"),
    bills: refTo(book, items, r, "bills"),
  }));
  const week: PeriodTotal | null = weekSnap
    ? {
        bills: refTo(book, weekSnap, 0, "bills"),
        total: refTo(book, weekSnap, 0, "total"),
        cash: refTo(book, weekSnap, 0, "cash"),
        upi: refTo(book, weekSnap, 0, "upi"),
        card: refTo(book, weekSnap, 0, "card"),
        onCredit: refTo(book, weekSnap, 0, "on_credit"),
      }
    : null;
  return { shop, member, view, from: v.from, to: v.to, snapshots: weekSnap ? [days, items, weekSnap] : [days, items], days: dayRows, items: itemRows, week };
}
