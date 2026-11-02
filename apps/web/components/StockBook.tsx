"use client";

import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { recordStockAction } from "../app/app/stock/actions";
import { fill, fillText } from "../lib/i18n";
import { OPS, UNIT_WORD } from "../lib/i18n-ops";
import type { LowRow, StockPage, StockRow } from "../lib/ops-types";
import { Button } from "./Button";
import { Figure } from "./shell/Figure";
import { Foot } from "./Foot";
import { useLang } from "./LangProvider";
import { OpsError } from "./OpsError";
import { PageHead } from "./PageHead";
import { Recorded } from "./Recorded";
import { Segmented } from "./Segmented";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { Sticker } from "./Sticker";
import "./LedgerCard.css";
import "./Ops.css";
import "./StockBook.css";

/**
 * Stock: what the books hold for every item, what is running low (highlighted), and a sheet to record a shelf count or
 * waste under your name. A count carries the on-hand cell the person saw, so it records only while the books still
 * hold that figure. Counter staff record waste; a count is the owner's or a manager's (the database refuses anyone else).
 * `photo` is the shelf-photo count, first in the entry column.
 */
// formKey: this render's idempotency key (lib/server/form-key.ts), so one count posted twice records once.
export function StockBook({ data, photo, formKey }: { data: StockPage; photo?: ReactNode; formKey: string }) {
  const { lang } = useLang();
  const o = OPS[lang];
  const [state, action, pending] = useActionState(recordStockAction, null);
  const [itemId, setItemId] = useState("");
  const [kind, setKind] = useState(data.canCount ? "count" : "waste");
  const [qty, setQty] = useState("");
  const [filter, setFilter] = useState("");
  const sheet = useRef<HTMLFormElement>(null);
  const qtyField = useRef<HTMLInputElement>(null);
  const done = state && "done" in state ? state.done : null;
  const error = state && "error" in state ? state.error : null;
  const chosen = data.items.find((i) => i.id === itemId);
  const f = filter.trim().toLowerCase();
  const shown = f ? data.items.filter((i) => i.name.toLowerCase().includes(f)) : data.items;

  useEffect(() => {
    if (done) setQty("");
  }, [done]);

  const pick = (id: string) => {
    setItemId(id);
    // jsdom lacks scrollIntoView; a person who asked for less motion gets the jump without the glide.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sheet.current?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
    qtyField.current?.focus({ preventScroll: true });
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  const unitWord = chosen ? o[UNIT_WORD[chosen.unit] ?? "unitPack"] : "";

  return (
    <SourcesProvider snapshots={done ? [...data.snapshots, ...done.snapshots] : data.snapshots} deskRef={null}>
      <main className="wrap ops stock">
        <PageHead id="stock-h" kicker={fill(o.stockKicker, { shop: <span data-name="">{data.shop}</span> })} title={o.stockTitle} lede={o.stockLede} />
        <div className="ops-a">
          {data.low.length > 0 && (
            <section className="ops-sec low" aria-labelledby="low-h">
              <h2 id="low-h" className="ops-h">
                {o.lowHeading}
              </h2>
              <ol className="finds">
                {data.low.map((row) => (
                  <li key={row.id}>
                    <LowLine row={row} onPick={pick} />
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section className="ops-sec every" aria-labelledby="every-h">
            <h2 id="every-h" className="ops-h">
              {o.allHeading}
            </h2>
            <label className="field">
              <span className="kicker field-label">{o.filterLabel}</span>
              <input type="search" className="input" value={filter} placeholder={o.findHint} autoComplete="off" onChange={(e) => setFilter(e.target.value)} />
            </label>
            {shown.length ? (
              <ol className="finds">
                {shown.map((row) => (
                  <li key={row.id}>
                    <ItemLine row={row} onPick={pick} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="finds empty-line">{o.noItems}</p>
            )}
          </section>
        </div>
        <div className="ops-b">
          {photo}
          <form ref={sheet} className="sheet entry" aria-labelledby="entry-h" onSubmit={submit}>
              <input type="hidden" name="key" value={formKey} />
            <div className="sheet-top">
              <h2 id="entry-h">{o.entryStock}</h2>
            </div>
            <label className="field">
              <span className="kicker field-label">{o.item}</span>
              <select name="item" className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="" disabled>
                  {o.pickItem}
                </option>
                {data.items.map((i) => (
                  <option key={i.id} value={i.id} data-name="">
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <>
                <input type="hidden" name="seen" value={`${chosen.onHand.snapshotId}:${chosen.onHand.row - 1}`} />
                <p className="field-line">{fill(o.booksHold, { onHand: <Figure cell={chosen.onHand} /> })}</p>
              </>
            )}
            <Segmented
              name="kind"
              legend={o.whatKind}
              value={kind}
              onChange={setKind}
              options={[
                { value: "count", label: o.kindCount, disabled: !data.canCount },
                { value: "waste", label: o.kindWaste, disabled: !data.canWaste },
              ]}
            />
            {!data.canCount && <p className="field-note">{o.countRoleOnly}</p>}
            <div className="field">
              <label htmlFor="stock-qty" className="kicker field-label">
                {kind === "count" ? o.countedQty : o.wastedQty}
              </label>
              <span className="input-unit">
                <input
                  ref={qtyField}
                  id="stock-qty"
                  name="qty"
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={qty}
                  aria-describedby={unitWord ? "stock-unit" : undefined}
                  onChange={(e) => setQty(e.target.value)}
                />
                {unitWord && <span id="stock-unit">{unitWord}</span>}
              </span>
            </div>
            <div role="status">
              {error && <OpsError code={error} />}
              {done && (
                <Recorded stamp={done.stamp}>
                  {!done.stamp && <p>{o.countSame}</p>}
                  {done.onHand && (
                    <p>{fill(o.onHandNow, { item: <span data-name="">{done.item}</span>, qty: <Figure cell={done.onHand} /> })}</p>
                  )}
                </Recorded>
              )}
            </div>
            <Button type="submit" variant="primary" disabled={pending}>
              {kind === "count" ? o.recordCount : o.recordWaste}
            </Button>
          </form>
          <SourceDrawer />
        </div>
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}

function LowLine({ row, onPick }: { row: LowRow; onPick: (id: string) => void }) {
  const { lang, t } = useLang();
  const o = OPS[lang];
  return (
    <div className="row">
      <p className="row-title">
        <mark data-name="">{row.name}</mark>
      </p>
      <Button className="press-row" aria-label={fillText(o.recordFor, { name: row.name })} onClick={() => onPick(row.id)}>
        {o.recordShort}
      </Button>
      <p>{fill(o.lowLine, { onHand: <Figure cell={row.onHand} />, days: <Figure cell={row.cover} /> })}</p>
      {row.supplier && (
        <p>
          {fill(o.lowSuggest, { qty: <Figure cell={row.suggested} />, supplier: <span data-name="">{row.supplier.name}</span> })}{" "}
          {row.supplier.simulated && <Sticker tone="yellow">{t.simulated}</Sticker>}
        </p>
      )}
    </div>
  );
}

function ItemLine({ row, onPick }: { row: StockRow; onPick: (id: string) => void }) {
  const { lang } = useLang();
  const o = OPS[lang];
  return (
    <div className="row">
      <p className="row-title">
        {row.low ? <mark data-name="">{row.name}</mark> : <span data-name="">{row.name}</span>}
        {row.low && <Sticker tone="ink">{o.lowMark}</Sticker>}
      </p>
      <Button className="press-row" aria-label={fillText(o.recordFor, { name: row.name })} onClick={() => onPick(row.id)}>
        {o.recordShort}
      </Button>
      <p>{fill(o.booksHold, { onHand: <Figure cell={row.onHand} /> })}</p>
    </div>
  );
}
