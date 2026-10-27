// The day report (server only): sales.by_day and sales.by_item for the chosen period, minted as the signed-in member
// and read back as stored. Every figure is a ref into those two snapshots; nothing is added up here (a week's total has
// no cell, so the week shows its days).
import type { Session } from "@munshi/core";
import type { DayRow, ItemRow, ReportPage, ReportView } from "../books";
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
  const [days, items] = await readOnly(session, (c) => stored(c, [byDay, byItem])) as [Snapshot, Snapshot];

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
  return { shop, member, view, from, to, snapshots: [days, items], days: dayRows, items: itemRows };
}
