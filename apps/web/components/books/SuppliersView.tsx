"use client";

import Link from "next/link";
import { fill } from "../../lib/i18n";
import { BOOKS } from "../../lib/i18n-books";
import type { SuppliersPage } from "../../lib/books";
import { findSnapshot } from "../../lib/snapshot";
import { DraftCard } from "../DraftCard";
import { useLang } from "../LangProvider";
import { LedgerCard } from "../LedgerCard";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Sticker } from "../Sticker";
import { Figure } from "../shell/Figure";
import { ReadLine, Sheet } from "./Sheet";

/**
 * The shop's suppliers, every one simulated and labelled so: the orders waiting for a decision (the home's draft cards,
 * Approve and Reject deciding as the signed-in member), the price rises the watchers found, and each supplier's last
 * bill with the last price of every item on it.
 */
export function SuppliersView({ data }: { data: SuppliersPage }) {
  const { lang, t } = useLang();
  const b = BOOKS[lang];
  const deskRef = data.drafts.find((d) => d.status === "proposed")?.lines[0]?.qty ?? data.suppliers.find((s) => s.lastBill)?.lastBill?.total ?? null;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={deskRef}>
      <main className="wrap book book-firms">
        <div className="book-a">
          <Sheet id="suppliers-h" kicker={<span data-name="">{data.shop}</span>} title={b.suppliersTitle} lede={b.suppliersLede} mark={b.suppliersMark} />
          {data.rises.length > 0 && (
            <section className="book-sec bk-rises" aria-labelledby="rises-h">
              <h2 id="rises-h" className="book-h">
                {b.risesSupplierHeading}
              </h2>
              <LedgerCard findings={data.rises} />
            </section>
          )}
          <section className="book-sec" aria-labelledby="firms-h">
            <h2 id="firms-h" className="book-h">
              {b.directoryHeading}
            </h2>
            <ul className="bk-firms">
              {data.suppliers.map((s) => {
                const priceSnap = s.prices[0] ? findSnapshot(data.snapshots, s.prices[0].cost.snapshotId) : undefined;
                return (
                  <li key={s.id} className="bk-firm">
                    <div className="bk-firm-top">
                      <h3 data-name="">{s.supplier.name}</h3>
                      {s.supplier.simulated && <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>}
                    </div>
                    <p className="bk-firm-bill">
                      {s.lastBill
                        ? fill(b.lastBill, {
                            bill: (
                              <Link className="bk-bill-no" href={`/app/bills/${s.lastBill.id}`} data-name="">
                                {s.lastBill.billNo}
                              </Link>
                            ),
                            date: <Figure cell={s.lastBill.date} />,
                            total: <Figure cell={s.lastBill.total} />,
                          })
                        : b.noRecentBill}
                    </p>
                    {priceSnap && (
                      <>
                        <span className="kicker bk-prices-h">{b.lastPrices}</span>
                        <ReadLine snapshot={priceSnap} label={s.prices[0]?.cost.label[lang] ?? ""} />
                        <table className="ledger book-table">
                          <thead>
                            <tr>
                              <th scope="col">{b.colItem}</th>
                              <th scope="col" className="n">
                                {b.colLastCost}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.prices.map((p) => (
                              <tr key={p.cost.row}>
                                <th scope="row" data-name="">
                                  {p.item}
                                </th>
                                <td className="n">
                                  <Figure cell={p.cost} table />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="book-foot">{b.footNote}</p>
        </div>
        <div className="book-b">
          <section className="book-sec bk-waiting" aria-labelledby="waiting-h">
            {/* The draft cards carry their own "Waiting for you" flag; the heading is for screen readers. */}
            <h2 id="waiting-h" className="vh">
              {b.waitingHeading}
            </h2>
            {data.drafts.length ? data.drafts.map((d) => <DraftCard key={d.id} draft={d} />) : <p className="bk-empty">{b.noDrafts}</p>}
          </section>
          <SourceDrawer />
        </div>
      </main>
    </SourcesProvider>
  );
}
