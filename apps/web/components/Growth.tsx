"use client";

import { fill } from "../lib/i18n";
import { GROWTH } from "../lib/i18n-growth";
import type { GrowthPage } from "../lib/server/growth";
import { useLang } from "./LangProvider";
import { PageHead } from "./PageHead";
import { Figure } from "./shell/Figure";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import "./Growth.css";
import "./Ops.css";

/**
 * Growth: five readings of the shop's own sales and payments over the last four weeks. Read-only; every
 * figure is a cell of a snapshot core minted for this page, and a figure that cannot be traced reads "Cannot verify".
 */
export function Growth({ data }: { data: GrowthPage }) {
  const { lang } = useLang();
  const t = GROWTH[lang];
  const word = (k: string) => (k in t ? (t as Record<string, string>)[k] : k);
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={null}>
      <main className="wrap ops growth">
        <PageHead id="growth-h" kicker={fill(t.kicker, { shop: <span data-name="">{data.shop}</span> })} title={t.title} lede={t.lede} />
        <p className="field-note">{t.noteBooks}</p>
        <Section id="peak" title={t.peakHeading} note={t.peakNote}>
          {data.peak.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.colWeekday}</th>
                  <th scope="col">{t.colHour}</th>
                  <th scope="col">{t.colBills}</th>
                  <th scope="col">{t.colTakings}</th>
                </tr>
              </thead>
              <tbody>
                {data.peak.map((p) => (
                  <tr key={p.weekday}>
                    <td>{word(p.weekday)}</td>
                    <td>
                      <Figure cell={p.hour} table />
                    </td>
                    <td>
                      <Figure cell={p.bills} table />
                    </td>
                    <td>
                      <Figure cell={p.total} table />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-line">{t.noPeak}</p>
          )}
        </Section>
        <Section id="cust" title={t.custHeading} note={t.custNote}>
          {data.customers && (
            <dl className="growth-stats">
              {(
                [
                  [t.custCustomers, data.customers.customers],
                  [t.custNew, data.customers.newCustomers],
                  [t.custRepeat, data.customers.repeatCustomers],
                  [t.custNamed, data.customers.namedBills],
                  [t.custAnon, data.customers.anonymousBills],
                ] as const
              ).map(([label, cell]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <Figure cell={cell} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
        <Section id="basket" title={t.basketHeading} note={t.basketNote}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.colWeekFrom}</th>
                <th scope="col">{t.colBills}</th>
                <th scope="col">{t.colAverage}</th>
                <th scope="col">{t.colTrend}</th>
              </tr>
            </thead>
            <tbody>
              {data.basket.map((b) => (
                <tr key={`${b.weekFrom.row}`}>
                  <td>
                    <Figure cell={b.weekFrom} table />
                  </td>
                  <td>
                    <Figure cell={b.bills} table />
                  </td>
                  <td>{b.average ? <Figure cell={b.average} table /> : t.noBills}</td>
                  <td>{word(b.trend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section id="slow" title={t.slowHeading} note={t.slowNote}>
          {data.slow.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.colItem}</th>
                  <th scope="col">{t.colOnHand}</th>
                  <th scope="col">{t.colLastSold}</th>
                </tr>
              </thead>
              <tbody>
                {data.slow.map((s) => (
                  <tr key={s.onHand.row}>
                    <td>
                      <span data-name="">{s.item}</span>
                    </td>
                    <td>
                      <Figure cell={s.onHand} table />
                    </td>
                    <td>{s.lastSold ? <Figure cell={s.lastSold} table /> : t.neverSold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-line">{t.noSlow}</p>
          )}
        </Section>
        <Section id="mix" title={t.mixHeading} note={t.mixNote}>
          {data.mix.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.colMethod}</th>
                  <th scope="col">{t.colPayments}</th>
                  <th scope="col">{t.colTakings}</th>
                  <th scope="col">{t.colShare}</th>
                </tr>
              </thead>
              <tbody>
                {data.mix.map((m) => (
                  <tr key={m.method}>
                    <td>{word(m.method)}</td>
                    <td>
                      <Figure cell={m.payments} table />
                    </td>
                    <td>
                      <Figure cell={m.amount} table />
                    </td>
                    <td>
                      <Figure cell={m.share} read="percent" table />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-line">{t.noMix}</p>
          )}
        </Section>
        <SourceDrawer />
      </main>
    </SourcesProvider>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="ops-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="ops-h">
        {title}
      </h2>
      <p className="field-note">{note}</p>
      {children}
    </section>
  );
}
