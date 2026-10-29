"use client";

import type { ReactNode } from "react";
import { fill } from "../../lib/i18n";
import { BOOKS } from "../../lib/i18n-books";
import type { BillsPage } from "../../lib/books";
import { findSnapshot } from "../../lib/snapshot";
import { calendarDate } from "../../lib/time";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Sticker } from "../Sticker";
import { Figure } from "../shell/Figure";
import { ReadLine, Sheet } from "./Sheet";

/**
 * The month's bills from suppliers, newest first, each opening its own page; recording one by hand; and reading a bill
 * from a photo (`photo`, the slot data-slot="bill-photo"). Every figure is a cell of the bills.recent snapshot.
 */
export function BillsView({ data, photo }: { data: BillsPage; photo?: ReactNode }) {
  const { lang, t } = useLang();
  const b = BOOKS[lang];
  const snap = data.bills[0] ? findSnapshot(data.snapshots, data.bills[0].total.snapshotId) : undefined;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={data.bills[0]?.total ?? null}>
      <main className="wrap book">
        <div className="book-a">
          <Sheet
            id="bills-h"
            kicker={fill(b.kicker, { shop: <span data-name="">{data.shop}</span>, date: <time dateTime={data.asOf}>{calendarDate(data.asOf, lang)}</time> })}
            title={b.billsTitle}
            lede={b.billsLede}
            mark={b.billsMark}
          />
          <div className="book-actions">
            {data.canRecord ? (
              <a className="press" href="/app/bills/new">
                <PenIcon />
                {b.recordByHand}
              </a>
            ) : (
              <p className="bk-empty">{b.cannotRecord}</p>
            )}
          </div>
          <section className="book-sec" aria-labelledby="bills-list-h">
            <h2 id="bills-list-h" className="book-h">
              {b.billsHeading}
            </h2>
            <div className="bk-card">
              {snap ? (
                <>
                  <ReadLine snapshot={snap} label={b.labelPurchaseBills} />
                  <table className="ledger book-table bk-bills-table">
                    <thead>
                      <tr>
                        <th scope="col">{b.colBill}</th>
                        <th scope="col" className="n">
                          {b.colDate}
                        </th>
                        <th scope="col" className="n">
                          {b.colTotal}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bills.map((bill) => (
                        <tr key={bill.id}>
                          <th scope="row">
                            <span className="bk-bill-cell">
                              <a className="bk-bill-no" href={`/app/bills/${bill.id}`} data-name="">
                                {bill.billNo}
                              </a>
                              <span className="bk-bill-who">
                                <span data-name="">{bill.supplier.name}</span>
                                {bill.supplier.simulated && <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>}
                              </span>
                            </span>
                          </th>
                          <td className="n">
                            <Figure cell={bill.date} table />
                          </td>
                          <td className="n">
                            <Figure cell={bill.total} table />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="bk-card-note">{b.noBills}</p>
              )}
            </div>
          </section>
          <p className="book-foot">{b.footNote}</p>
        </div>
        <div className="book-b">
          {photo ?? <PhotoSlot />}
          <SourceDrawer />
        </div>
      </main>
    </SourcesProvider>
  );
}

/**
 * The bill-photo slot as it stood before the photo reader filled it (BillPhoto, passed in as `photo`): shown only if a page gives no
 * photo flow, disabled, as coming soon.
 */
function PhotoSlot() {
  const { lang } = useLang();
  const b = BOOKS[lang];
  return (
    <section className="bk-slot" data-slot="bill-photo" aria-labelledby="slot-h">
      <div className="bk-slot-top">
        <span className="kicker">{b.photoKicker}</span>
        <Sticker tone="ink">{b.comingSoon}</Sticker>
      </div>
      <h2 id="slot-h">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.6-2.2h5.4l1.6 2.2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
          <circle cx="12" cy="13" r="3.6" />
        </svg>
        {b.photoTitle}
      </h2>
      <p>{b.photoBody}</p>
      <Button disabled aria-describedby="slot-h">
        {b.photoButton}
      </Button>
    </section>
  );
}

function PenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4.2L19.4 8.8a2.2 2.2 0 0 0 0-3.1l-1.1-1.1a2.2 2.2 0 0 0-3.1 0L4 15.8Z" />
      <path d="M13.6 6.2l4.2 4.2" />
    </svg>
  );
}
