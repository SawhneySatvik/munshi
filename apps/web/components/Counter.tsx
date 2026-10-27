"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { recordSaleAction } from "../app/counter/actions";
import { fill, fillText } from "../lib/i18n";
import { OPS, UNIT_WORD } from "../lib/i18n-ops";
import type { CounterPage, CounterState, Receipt } from "../lib/ops-types";
import { Button } from "./Button";
import { CannotVerify } from "./CannotVerify";
import { Cell } from "./Cell";
import { Foot } from "./Foot";
import { useLang } from "./LangProvider";
import { OpsError } from "./OpsError";
import { PageHead } from "./PageHead";
import { Recorded } from "./Recorded";
import { Segmented } from "./Segmented";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import "./LedgerCard.css";
import "./Ops.css";
import "./Counter.css";

type Line = { id: string; qty: string };

const MEASURED = new Set(["kg", "g", "l", "ml"]);
const FOUND_MAX = 8;

// The stepper moves a typed quantity by whole units (the person's own entry, not a figure from the books).
const whole = (qty: string) => {
  const n = Number.parseInt(qty, 10);
  return Number.isFinite(n) ? n : 0;
};
const stepped = (qty: string, by: number) => String(Math.max(1, whole(qty) + by));

function Glyph({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The counter: find items (a search and the best sellers as tiles), set how many, and record the sale under your name.
 * The only figures are cells: today's counter sales, and on the receipt what the sale moved. The bill's prices and
 * total have no read yet, so they say "Cannot verify", and cash and UPI wait ("Coming soon"): a sale goes on a
 * customer's credit, priced by core from the books.
 */
export function Counter({ data }: { data: CounterPage }) {
  const { lang, t } = useLang();
  const o = OPS[lang];
  const [state, action, pending] = useActionState(recordSaleAction, null);
  const [cart, setCart] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("");
  const [tender, setTender] = useState("credit");
  const [closed, setClosed] = useState<CounterState>(null);
  const receipt = state && "receipt" in state && state !== closed ? state.receipt : null;
  const error = state && "error" in state ? state.error : null;
  const byId = new Map(data.items.map((i) => [i.id, i]));

  useEffect(() => {
    if (receipt) {
      setCart([]);
      setCustomer("");
    }
  }, [receipt]);

  const add = (id: string) =>
    setCart((c) => (c.some((l) => l.id === id) ? c.map((l) => (l.id === id ? { ...l, qty: stepped(l.qty, 1) } : l)) : [...c, { id, qty: "1" }]));
  const setQty = (id: string, qty: string) => setCart((c) => c.map((l) => (l.id === id ? { ...l, qty } : l)));
  const remove = (id: string) => setCart((c) => c.filter((l) => l.id !== id));

  const q = query.trim().toLowerCase();
  const found = q ? data.items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, FOUND_MAX) : [];
  const inBill = new Set(cart.map((l) => l.id));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };

  return (
    <SourcesProvider snapshots={receipt ? [...data.snapshots, ...receipt.snapshots] : data.snapshots} deskRef={null}>
      <main className="wrap ops counter">
        <div className="ops-a">
          <PageHead
            id="counter-h"
            kicker={fill(o.counterKicker, { shop: <span data-name="">{data.shop}</span> })}
            title={o.counterTitle}
            lede={o.counterLede}
          />
          {data.today && (
            <p className="today">
              {fill(o.todayLine, {
                bills: <Cell sourceRef={data.today.bills} />,
                total: <Cell sourceRef={data.today.total} />,
                credit: <Cell sourceRef={data.today.onCredit} />,
              })}
            </p>
          )}
          <section className="ops-sec pick" aria-label={o.findLabel}>
            <label className="field">
              <span className="kicker field-label">{o.findLabel}</span>
              <input
                type="search"
                className="input"
                value={query}
                placeholder={o.findHint}
                autoComplete="off"
                enterKeyHint="search"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {q && (
              <ul className="finds found">
                {found.length ? (
                  found.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        className="found-a"
                        onClick={() => {
                          add(i.id);
                          setQuery("");
                        }}
                      >
                        <span data-name="">{i.name}</span>
                        <Glyph d="M12 5.5v13M5.5 12h13" />
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="empty-line">{o.noMatch}</li>
                )}
              </ul>
            )}
            {data.quick.length > 0 && (
              <>
                <h2 className="kicker quick-h">{o.quickHeading}</h2>
                <ul className="tiles">
                  {data.quick.map((id) => (
                    <li key={id}>
                      <button type="button" className={`tile${inBill.has(id) ? " is-in" : ""}`} onClick={() => add(id)}>
                        <span data-name="">{byId.get(id)?.name}</span>
                        {inBill.has(id) && (
                          <span className="tile-in">
                            <Glyph d="m5 12.5 4.5 4.5L19 7.5" />
                            {o.inBill}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
        <div className="ops-b">
          {receipt ? (
            <ReceiptSheet receipt={receipt} onNew={() => setClosed(state)} />
          ) : (
            <form className="sheet bill" aria-labelledby="bill-h" onSubmit={submit}>
              <div className="sheet-top">
                <h2 id="bill-h">{o.billHeading}</h2>
              </div>
              {cart.length === 0 ? (
                <p className="field-note">{o.billEmpty}</p>
              ) : (
                <ul className="lines">
                  {cart.map((l) => {
                    const item = byId.get(l.id);
                    const name = item?.name ?? "";
                    return (
                      <li key={l.id} className="line">
                        <input type="hidden" name="item" value={l.id} />
                        <span className="line-name" data-name="">
                          {name}
                        </span>
                        <button type="button" className="line-x" aria-label={fillText(o.removeItem, { item: name })} onClick={() => remove(l.id)}>
                          <Glyph d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
                        </button>
                        <div className="stepper">
                          <button
                            type="button"
                            className="step"
                            aria-label={fillText(o.oneLess, { item: name })}
                            disabled={whole(l.qty) <= 1}
                            onClick={() => setQty(l.id, stepped(l.qty, -1))}
                          >
                            <Glyph d="M5.5 12h13" />
                          </button>
                          <input
                            name="qty"
                            className="input qty"
                            inputMode="decimal"
                            autoComplete="off"
                            value={l.qty}
                            aria-label={fillText(o.qtyOf, { item: name })}
                            onChange={(e) => setQty(l.id, e.target.value)}
                          />
                          <button type="button" className="step" aria-label={fillText(o.oneMore, { item: name })} onClick={() => setQty(l.id, stepped(l.qty, 1))}>
                            <Glyph d="M12 5.5v13M5.5 12h13" />
                          </button>
                          {item && MEASURED.has(item.unit) && <span className="unit">{o[UNIT_WORD[item.unit] ?? "unitPack"]}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <CannotVerify>{fill(t.unverifiedLine, { what: o.pricesWhat, reason: o.pricesWhy })}</CannotVerify>
              <Segmented
                name="tender"
                legend={o.paidBy}
                value={tender}
                onChange={setTender}
                options={[
                  { value: "cash", label: o.tenderCash, note: o.comingSoon, disabled: true },
                  { value: "upi", label: o.tenderUpi, note: o.comingSoon, disabled: true },
                  { value: "credit", label: o.tenderCredit },
                ]}
              />
              <p className="field-note">{o.tenderSoon}</p>
              <label className="field">
                <span className="kicker field-label">{o.customer}</span>
                <select name="customer" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  <option value="" disabled>
                    {o.pickCustomer}
                  </option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id} data-name="">
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-note">{o.paymentsNote}</p>
              <div role="status">{error && <OpsError code={error} />}</div>
              <Button type="submit" variant="primary" disabled={pending || cart.length === 0 || !data.canSell}>
                {o.recordSale}
              </Button>
            </form>
          )}
          <SourceDrawer />
        </div>
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}

function ReceiptSheet({ receipt, onNew }: { receipt: Receipt; onNew: () => void }) {
  const { lang, t } = useLang();
  const o = OPS[lang];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const customer = <span data-name="">{receipt.customer}</span>;
  return (
    <section className="sheet receipt" aria-labelledby="receipt-h">
      <div className="sheet-top">
        <h2 id="receipt-h" ref={heading} tabIndex={-1}>
          {o.saleRecorded}
        </h2>
      </div>
      <Recorded stamp={{ by: receipt.by, at: receipt.at }}>
        <p>{fill(o.onCreditTo, { customer })}</p>
      </Recorded>
      <ul className="receipt-lines">
        {receipt.lines.map((l) => (
          <li key={l.item}>
            {fill(o.leftLine, { item: <span data-name="">{l.item}</span>, left: l.left ? <Cell sourceRef={l.left} /> : <CannotVerify /> })}
          </li>
        ))}
      </ul>
      <p className="field-line">{receipt.owes ? fill(o.nowOwes, { customer, owes: <Cell sourceRef={receipt.owes} /> }) : fill(o.owesNothing, { customer })}</p>
      <CannotVerify>{fill(t.unverifiedLine, { what: o.receiptWhat, reason: o.receiptWhy })}</CannotVerify>
      <p className="field-note">{o.paymentsNote}</p>
      <Button onClick={onNew}>{o.newSale}</Button>
    </section>
  );
}
