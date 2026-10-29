"use client";

import { useActionState, useRef, useState } from "react";
import { lastPrice, type RecordError, recordBill } from "../../app/app/bills/actions";
import { type BillFormData, type LastPrice, parseRupees } from "../../lib/books";
import { fill, fillText } from "../../lib/i18n";
import { BOOKS, type BooksDict } from "../../lib/i18n-books";
import { resolveCell } from "../../lib/snapshot";
import { calendarDate } from "../../lib/time";
import type { Snapshot, SourceRef } from "../../lib/types";
import { Button } from "../Button";
import { CannotVerify } from "../CannotVerify";
import { Figure } from "../shell/Figure";
import { useLang } from "../LangProvider";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Sticker } from "../Sticker";
import { Sheet } from "./Sheet";
// The line counter badge (.seq), as the brief numbers its rows.
import "../LedgerCard.css";

type Line = { key: number; itemId: string; qty: string; cost: string; expires: string; last: LastPrice | "loading" | "failed" | null };

const ERROR: Record<RecordError, keyof BooksDict> = {
  invalid: "errInvalid",
  conflict: "errConflict",
  refused: "errRefused",
  signed_out: "errSignedOut",
  other: "errOther",
};
const blank = (key: number): Line => ({ key, itemId: "", qty: "", cost: "", expires: "", last: null });

/**
 * A supplier's paper bill, typed in by hand. The figures typed are the person's own entry and stay in the inputs; the
 * one figure Munshi shows is each item's last bill price, a cell minted when the item is picked, and a typed price above
 * it is flagged with that cell cited. Recording runs purchase.record as the signed-in member (recordBill); the books work
 * out the amounts, so no total is shown here.
 */
// formKey: this render's idempotency key (lib/server/form-key.ts), so one bill posted twice records once.
export function BillForm({ data, formKey }: { data: BillFormData; formKey: string }) {
  const { lang, t } = useLang();
  const b = BOOKS[lang];
  const [state, action, pending] = useActionState(recordBill, null);
  const [supplier, setSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(data.asOf);
  const [lines, setLines] = useState<Line[]>([blank(0)]);
  const next = useRef(1);
  const invalid = new Set(state?.error === "invalid" ? (state.fields ?? []) : []);
  const bad = (name: string) => (invalid.has(name) ? true : undefined);

  const update = (key: number, patch: Partial<Line>, onlyIfItem?: string) =>
    setLines((ls) => ls.map((l) => (l.key === key && (onlyIfItem === undefined || l.itemId === onlyIfItem) ? { ...l, ...patch } : l)));
  const pick = async (key: number, itemId: string) => {
    update(key, { itemId, last: itemId ? "loading" : null });
    if (!itemId) return;
    try {
      update(key, { last: await lastPrice(itemId) }, itemId);
    } catch {
      update(key, { last: "failed" }, itemId);
    }
  };

  const snapshots = lines.flatMap((l): Snapshot[] => (l.last && typeof l.last === "object" && l.last.snapshot ? [l.last.snapshot] : []));
  const firstPrice = lines.map((l) => (l.last && typeof l.last === "object" ? l.last.cost : null)).find((c): c is SourceRef => c !== null);
  const chosen = data.suppliers.find((s) => s.id === supplier);
  const categories = [...new Set(data.items.map((i) => i.category))];

  return (
    <SourcesProvider snapshots={snapshots} deskRef={firstPrice ?? null}>
      <main className="wrap book">
        <div className="book-a">
          <a className="bk-back" href="/app/bills">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {b.allBills}
          </a>
          <Sheet
            id="form-h"
            kicker={fill(b.kicker, { shop: <span data-name="">{data.shop}</span>, date: <time dateTime={data.asOf}>{calendarDate(data.asOf, lang)}</time> })}
            title={b.formTitle}
            lede={b.formLede}
          />
          {data.canRecord ? (
            <form className="bk-card bk-form" action={action} noValidate>
              <input type="hidden" name="key" value={formKey} />
              <label className="bk-field">
                <span>
                  {b.supplier} {chosen?.simulated && <Sticker tone="yellow">{t.simulatedSupplier}</Sticker>}
                </span>
                <select name="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-invalid={bad("supplier")} required>
                  <option value="">{b.chooseSupplier}</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id} data-name="">
                      {s.simulated ? `${s.name} (${t.simulated.toLowerCase()})` : s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bk-row-2">
                <label className="bk-field">
                  <span>{b.billNo}</span>
                  <input name="billNo" value={billNo} onChange={(e) => setBillNo(e.target.value)} aria-invalid={bad("billNo")} autoComplete="off" required />
                </label>
                <label className="bk-field">
                  <span>{b.billDate}</span>
                  <input type="date" name="billDate" value={billDate} onChange={(e) => setBillDate(e.target.value)} aria-invalid={bad("billDate")} required />
                </label>
              </div>
              {lines.map((line, i) => {
                const item = data.items.find((x) => x.id === line.itemId);
                const unit = item ? (b[`unit_${item.unit}` as keyof BooksDict] ?? item.unit) : "";
                const n = String(i + 1);
                return (
                  <fieldset className="bk-line" key={line.key} aria-label={fillText(b.lineN, { n })}>
                    <input type="hidden" name="line" value={line.key} />
                    <div className="bk-line-top">
                      <span className="seq">{n}</span>
                      {lines.length > 1 && (
                        <Button className="bk-line-x" aria-label={fillText(b.removeLine, { n })} onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>
                          {b.remove}
                        </Button>
                      )}
                    </div>
                    <label className="bk-field">
                      <span>{b.item}</span>
                      <select
                        name={`item-${line.key}`}
                        value={line.itemId}
                        onChange={(e) => void pick(line.key, e.target.value)}
                        aria-invalid={bad(`item-${line.key}`)}
                        required
                      >
                        <option value="">{b.chooseItem}</option>
                        {categories.map((c) => (
                          <optgroup key={c} label={c}>
                            {data.items
                              .filter((x) => x.category === c)
                              .map((x) => (
                                <option key={x.id} value={x.id} data-name="">
                                  {x.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <div className="bk-row-2">
                      <label className="bk-field">
                        <span>{item ? fillText(b.qtyUnit, { unit }) : b.qty}</span>
                        <input
                          name={`qty-${line.key}`}
                          inputMode={item && item.unit !== "pack" && item.unit !== "piece" ? "decimal" : "numeric"}
                          value={line.qty}
                          onChange={(e) => update(line.key, { qty: e.target.value })}
                          aria-invalid={bad(`qty-${line.key}`)}
                          autoComplete="off"
                          required
                        />
                      </label>
                      <label className="bk-field">
                        <span>{b.unitCost}</span>
                        <input
                          name={`cost-${line.key}`}
                          inputMode="decimal"
                          value={line.cost}
                          onChange={(e) => update(line.key, { cost: e.target.value })}
                          aria-invalid={bad(`cost-${line.key}`)}
                          autoComplete="off"
                          required
                        />
                      </label>
                    </div>
                    <label className="bk-field">
                      <span>
                        {b.expires} <small>({b.optional})</small>
                      </span>
                      <input
                        type="date"
                        name={`expires-${line.key}`}
                        value={line.expires}
                        onChange={(e) => update(line.key, { expires: e.target.value })}
                        aria-invalid={bad(`expires-${line.key}`)}
                      />
                    </label>
                    <PriceCheck line={line} snapshots={snapshots} />
                  </fieldset>
                );
              })}
              <Button
                onClick={() => {
                  setLines((ls) => [...ls, blank(next.current)]);
                  next.current += 1;
                }}
              >
                {b.addLine}
              </Button>
              <div className="bk-form-actions" role="status">
                {state?.error && <p className="bk-form-err">{b[ERROR[state.error]]}</p>}
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? b.recording : b.recordBill}
                </Button>
              </div>
            </form>
          ) : (
            <p className="bk-empty">{b.cannotRecord}</p>
          )}
          <p className="book-foot">{b.footNote}</p>
        </div>
        <div className="book-b">
          {data.canRecord && (
            <section className="bk-slot bk-what" aria-labelledby="what-h">
              <h2 id="what-h">{b.recordWhatHeading}</h2>
              <ul>
                <li>{b.recordWhat1}</li>
                <li>{b.recordWhat2}</li>
                <li>{b.recordWhat3}</li>
              </ul>
            </section>
          )}
          <SourceDrawer />
        </div>
      </main>
    </SourcesProvider>
  );
}

/** The line's item at its last bill price (a cell, cited), and the flag when the typed price is above it. */
function PriceCheck({ line, snapshots }: { line: Line; snapshots: Snapshot[] }) {
  const { lang, t } = useLang();
  const b = BOOKS[lang];
  if (!line.last) return null;
  if (line.last === "loading") return <p className="bk-price">{b.checking}</p>;
  if (line.last === "failed") {
    return (
      <p className="bk-price">
        <CannotVerify />
      </p>
    );
  }
  if (!line.last.cost) return <p className="bk-price">{b.noLastBill}</p>;
  const last = resolveCell(snapshots, line.last.cost);
  const typed = parseRupees(line.cost);
  // A comparison of the person's figure with the cell; neither is changed or combined.
  const rise = last?.t === "money" && typed !== null && typed > last.minor;
  return (
    <p className={`bk-price${rise ? " is-rise" : ""}`} aria-live="polite">
      {rise && <Sticker tone="yellow">{t.priceRise}</Sticker>}
      {fill(rise ? b.riseFlag : b.lastPaid, { cost: <Figure cell={line.last.cost} /> })}
    </p>
  );
}
