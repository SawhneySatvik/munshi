// The day report (apps/web/lib/server/reports.ts shows it): sales.by_day and sales.by_item for the chosen period, and
// sales.week_total for the week, minted as the signed-in member in the page's one transaction. Nothing is added up here.
// The report is the owner's and a manager's (read-roles.ts): null for anyone whose role may not read it (the page's 404).
import { mayReadIn } from './read-roles.ts';
import type { Session } from './session.ts';
import { addDays } from './time.ts';
import { asOfDate, type Client, mint, viewer } from './views-common.ts';

const BEST_SELLERS = 10;

export type ReportPeriod = 'yesterday' | 'today' | 'week';

export async function viewReport(c: Client, session: Session, period: ReportPeriod) {
  if (!(await mayReadIn(c, 'sales.by_day'))) return null;
  const me = await viewer(c, session);
  const asOf = await asOfDate(c, me.timeZone);
  // The morning's business date has had no counter yet when the brief runs, so the report opens on yesterday, the last
  // whole day; Today and the week (the seven days to today) are a tap away.
  const to = period === 'yesterday' ? addDays(asOf, -1) : asOf;
  const from = period === 'week' ? addDays(asOf, -6) : to;
  const days = await mint(c, 'sales.by_day', { from, to });
  const items = await mint(c, 'sales.by_item', { from, to, limit: BEST_SELLERS });
  const week = period === 'week' ? await mint(c, 'sales.week_total', { from, to }) : null;
  return { viewer: me, asOf, from, to, days, items, week };
}
