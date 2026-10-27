// The day report (server only): sales.by_day and sales.by_item for the chosen period, minted as the signed-in member
// and read back as stored, plus sales.week_total for the week. Every figure is a ref into those snapshots; nothing is
// added up here.
import type { Session } from "@munshi/core";
import type { DayRow, ItemRow, PeriodTotal, ReportPage, ReportView } from "../books";
import type { Snapshot } from "../types";
import { asOfDate, dayBefore, me, mint, readOnly, refTo, stored, textOf, words } from "./ledger";

const BEST_SELLERS = 10;

export async function loadReport(session: Session, view: ReportView): Promise<ReportPage> {
  const { shop, member, asOf } = await readOnly(session, async (c) => {
    const m = await me(c, session);
    return { ...m, asOf: await asOfDate(c, m.timeZone) };
  });
  // The morning's business date has had no counter yet when the brief runs, so the report opens on yesterday, the last
  // whole day; Today and the week (the seven days to today) are a tap away.
  const to = view === "yesterday" ? dayBefore(asOf) : asOf;
  const from = view === "week" ? dayBefore(asOf, 6) : to;
  const byDay = await mint(session, "sales.by_day", { from, to });
  const byItem = await mint(session, "sales.by_item", { from, to, limit: BEST_SELLERS });
  const weekId = view === "week" ? await mint(session, "sales.week_total", { from, to }) : null;
  const [days, items, weekSnap] = (await readOnly(session, (c) => stored(c, weekId ? [byDay, byItem, weekId] : [byDay, byItem]))) as [Snapshot, Snapshot, Snapshot?];

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
  return { shop, member, view, from, to, snapshots: weekSnap ? [days, items, weekSnap] : [days, items], days: dayRows, items: itemRows, week };
}
