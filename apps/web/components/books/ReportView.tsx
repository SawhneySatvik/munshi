"use client";

import Link from "next/link";
import { fill } from "../../lib/i18n";
import { BOOKS } from "../../lib/i18n-books";
import { REPORT_VIEWS, type ReportPage } from "../../lib/books";
import { findSnapshot, resolveCell } from "../../lib/snapshot";
import { calendarDate } from "../../lib/time";
import type { Snapshot } from "../../lib/types";
import { CannotVerify } from "../CannotVerify";
import { DemoDay } from "../DemoDay";
import { useLang } from "../LangProvider";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { DayChart } from "./DayChart";
import { Figure } from "../shell/Figure";
import { ReadLine, Sheet } from "./Sheet";

const VIEW_WORD = { yesterday: "viewYesterday", today: "viewToday", week: "viewWeek" } as const;

/**
 * The day report: one day's takings and how they were paid, or the week day by day with a chart of its totals; then the
 * best sellers. Every figure is a cell of the period's sales.by_day or sales.by_item snapshot. The source drawer sits
 * beside it on the desk, open at the period's last total.
 */
export function ReportView({ data }: { data: ReportPage }) {
  const { lang } = useLang();
  const b = BOOKS[lang];
  const last = data.days.at(-1);
  const daySnap = last ? findSnapshot(data.snapshots, last.total.snapshotId) : undefined;
  const date = (day: string) => <time dateTime={day}>{calendarDate(day, lang)}</time>;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={last?.total ?? null}>
      <main className="wrap book">
        <div className="book-a">
          <Sheet
            id="report-h"
            kicker={
              <>
                {fill(b.kicker, { shop: <span data-name="">{data.shop}</span>, date: date(data.to) })} <DemoDay day={data.demoDay} />
              </>
            }
            title={b.reportTitle}
            lede={b.reportLede}
            mark={b.reportMark}
          />
          <nav className="bk-tabs" aria-label={b.periodLabel}>
            {REPORT_VIEWS.map((v) => (
              <Link key={v} href={`/app/reports?view=${v}`} aria-current={v === data.view ? "page" : undefined}>
                {b[VIEW_WORD[v]]}
              </Link>
            ))}
          </nav>
          {data.view === "week" ? (
            <section className="book-sec" aria-labelledby="week-h">
              <h2 id="week-h" className="book-h">
                {fill(b.weekHeading, { date: date(data.to) })}
              </h2>
              <div className="bk-card">
                <DayChart days={data.days} />
              </div>
              <div className="bk-card">
                {daySnap && <ReadLine snapshot={daySnap} label={b.labelSalesBook} />}
                <div className="ledger-scroll">
                  <table className="ledger book-table bk-week-table">
                    <thead>
                      <tr>
                        <th scope="col">{b.colDay}</th>
                        <th scope="col" className="n">
                          {b.colBills}
                        </th>
                        <th scope="col" className="n">
                          {b.colTotal}
                        </th>
                        <th scope="col" className="n">
                          {b.colCash}
                        </th>
                        <th scope="col" className="n">
                          {b.colUpi}
                        </th>
                        <th scope="col" className="n">
                          {b.colCard}
                        </th>
                        <th scope="col" className="n">
                          {b.colOnCredit}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.days.map((d) => (
                        <tr key={d.day}>
                          <th scope="row">{date(d.day)}</th>
                          {[d.bills, d.total, d.cash, d.upi, d.card, d.onCredit].map((r) => (
                            <td key={r.col} className="n">
                              <Figure cell={r} table />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {data.week && (
                      <tfoot>
                        <tr>
                          <th scope="row">{b.weekRow}</th>
                          {[data.week.bills, data.week.total, data.week.cash, data.week.upi, data.week.card, data.week.onCredit].map((r) => (
                            <td key={r.col} className="n">
                              <Figure cell={r} table />
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </section>
          ) : (
            <DaySection data={data} />
          )}
          <section className="book-sec" aria-labelledby="best-h">
            <h2 id="best-h" className="book-h">
              {b.bestSellers}
            </h2>
            <div className="bk-card">
              {data.items.length ? (
                <>
                  <ReadLine snapshot={findSnapshot(data.snapshots, data.items[0]?.sold.snapshotId ?? "") as Snapshot} label={b.labelSalesBook} />
                  <div className="ledger-scroll">
                    <table className="ledger book-table">
                      <thead>
                        <tr>
                          <th scope="col">{b.colItem}</th>
                          <th scope="col" className="n">
                            {b.colSold}
                          </th>
                          <th scope="col" className="n">
                            {b.colRevenue}
                          </th>
                          <th scope="col" className="n">
                            {b.colBills}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((it) => (
                          <tr key={it.sold.row}>
                            <th scope="row" data-name="">
                              {it.item}
                            </th>
                            <td className="n">
                              <Figure cell={it.sold} table />
                            </td>
                            <td className="n">
                              <Figure cell={it.revenue} table />
                            </td>
                            <td className="n">
                              <Figure cell={it.bills} table />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="bk-card-note">{b.noItems}</p>
              )}
            </div>
          </section>
          <p className="book-foot">{b.footNote}</p>
        </div>
        <div className="book-b">
          <SourceDrawer />
        </div>
      </main>
    </SourcesProvider>
  );
}

/** One day: its takings in a sentence, then how they were paid, each figure with its chip. */
function DaySection({ data }: { data: ReportPage }) {
  const { lang } = useLang();
  const b = BOOKS[lang];
  const d = data.days[0];
  const bills = d && resolveCell(data.snapshots, d.bills);
  return (
    <section className="book-sec" aria-labelledby="day-h">
      <h2 id="day-h" className="book-h">
        {fill(b.dayHeading, { date: <time dateTime={data.to}>{calendarDate(data.to, lang)}</time> })}
      </h2>
      {d ? (
        <div className="bk-card bk-day-card">
          <p className="bk-takings">{fill(b.takings, { total: <Figure cell={d.total} />, bills: <Figure cell={d.bills} /> })}</p>
          {bills?.t === "int" && bills.v === 0 && <p className="bk-card-note">{b.noSales}</p>}
          <h3 className="kicker bk-tender-h">{b.paidHeading}</h3>
          <ul className="bk-tenders">
            {(
              [
                [b.cash, d.cash],
                [b.upi, d.upi],
                [b.card, d.card],
                [b.onCredit, d.onCredit],
              ] as const
            ).map(([name, ref]) => (
              <li key={ref.col}>
                <span className="bk-tender">{name}</span> <Figure cell={ref} />
              </li>
            ))}
          </ul>
          <p className="bk-card-note">{b.onCreditNote}</p>
        </div>
      ) : (
        <CannotVerify />
      )}
    </section>
  );
}
