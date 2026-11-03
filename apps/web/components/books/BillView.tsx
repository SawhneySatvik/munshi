"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { fill } from "../../lib/i18n";
import { BOOKS } from "../../lib/i18n-books";
import type { BillPage } from "../../lib/books";
import { findSnapshot, resolveCell } from "../../lib/snapshot";
import { calendarDate, dateAndTime } from "../../lib/time";
import { useLang } from "../LangProvider";
import { LedgerCard } from "../LedgerCard";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Stamp } from "../Stamp";
import { Sticker } from "../Sticker";
import { Figure } from "../shell/Figure";
import { ReadLine, Sheet } from "./Sheet";

/**
 * One supplier's bill: its date, line count and total (cells of bills.recent), who entered it, the price rises it
 * carries (each line's cost against the bill before it, both cited), and its lines. Just recorded by the viewer, it
 * carries the stamp.
 */
export function BillView({ data }: { data: BillPage }) {
  const { lang, t } = useLang();
  const b = BOOKS[lang];
  const { bill } = data;
  const day = resolveCell(data.snapshots, bill.date);
  const first = data.lines[0];
  const linesSnap = first ? findSnapshot(data.snapshots, first.cost.snapshotId) : undefined;
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data.justRecorded) done.current?.focus();
  }, [data.justRecorded]);
  const supplier = <span data-name="">{bill.supplier.name}</span>;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={bill.total}>
      <main className="wrap book">
        <div className="book-a">
          <Link className="bk-back" href="/app/bills">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {b.allBills}
          </Link>
          <Sheet
            id="bill-h"
            kicker={fill(b.billKicker, { date: day?.t === "date" ? <time dateTime={day.v}>{calendarDate(day.v, lang)}</time> : t.cannotVerify })}
            title={<span data-name="">{bill.billNo}</span>}
          >
            <p className="bk-sheet-sub">
              <span className="bk-sheet-firm">{supplier}</span>
              {bill.supplier.simulated && <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>}
            </p>
          </Sheet>
          <div className="bk-card bk-bill-card">
            <p className="bk-bill-facts">
              {fill(b.billLine, { date: <Figure cell={bill.date} />, lines: <Figure cell={bill.lines} />, total: <Figure cell={bill.total} /> })}
            </p>
            <div className="bk-entered" ref={done} tabIndex={-1}>
              {data.justRecorded && <Stamp tone="approved">{b.recordedStamp}</Stamp>}
              <p>
                {fill(b.enteredBy, {
                  name: <strong data-name="">{data.entered.by}</strong>,
                  when: <time dateTime={data.entered.at}>{dateAndTime(data.entered.at, lang)}</time>,
                })}
                {data.justRecorded && (
                  <>
                    <br />
                    {fill(b.recordedNote, { supplier })}
                  </>
                )}
              </p>
            </div>
          </div>
          {data.rises.length > 0 && (
            <section className="book-sec" aria-labelledby="rises-h">
              <h2 id="rises-h" className="book-h">
                {b.risesHeading}
              </h2>
              <LedgerCard findings={data.rises} />
            </section>
          )}
          <section className="book-sec" aria-labelledby="lines-h">
            <h2 id="lines-h" className="book-h">
              {b.linesHeading}
            </h2>
            <div className="bk-card">
              {linesSnap && first ? (
                <>
                  <ReadLine snapshot={linesSnap} label={first.cost.label[lang]} />
                  <table className="ledger book-table bk-lines-table">
                    <thead>
                      <tr>
                        <th scope="col">{b.colItem}</th>
                        <th scope="col" className="n">
                          {b.colQty}
                        </th>
                        <th scope="col" className="n">
                          {b.colUnitCost}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lines.map((line) => (
                        <tr key={`${line.cost.snapshotId}:${line.cost.row}`}>
                          <th scope="row">
                            <span data-name="">{line.item}</span>
                            {line.rise && (
                              <>
                                {" "}
                                <span className="bk-rise">
                                  <Sticker tone="yellow">{t.priceRise}</Sticker>
                                </span>
                              </>
                            )}
                          </th>
                          <td className="n">
                            <Figure cell={line.qty} table />
                          </td>
                          <td className="n">
                            <Figure cell={line.cost} table />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="bk-card-note">{t.cannotVerify}</p>
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
