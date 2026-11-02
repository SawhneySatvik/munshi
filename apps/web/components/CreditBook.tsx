"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { recordCreditAction } from "../app/app/credit/actions";
import { fill, fillText } from "../lib/i18n";
import { OPS } from "../lib/i18n-ops";
import type { CreditPage, OwingRow } from "../lib/ops-types";
import { Button } from "./Button";
import { Figure } from "./shell/Figure";
import { Foot } from "./Foot";
import { useLang } from "./LangProvider";
import { OpsError } from "./OpsError";
import { PageHead } from "./PageHead";
import { PayPalLink } from "./PayPalLink";
import { PAYPAL } from "../lib/i18n-paypal";
import { Recorded } from "./Recorded";
import { Segmented } from "./Segmented";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { Sticker } from "./Sticker";
import "./LedgerCard.css";
import "./Ops.css";
import "./CreditBook.css";

/**
 * The credit book (udhaar khata): who owes the shop what, read from the books, and a sheet to record a payment received
 * or credit given under your name. Counter staff record payments; credit given is the owner's or a manager's (the
 * database refuses anyone else, whatever the screen offers). Payments are recorded, never processed.
 */
// formKey: this render's idempotency key (lib/server/form-key.ts), so one entry posted twice records once.
export function CreditBook({ data, formKey }: { data: CreditPage; formKey: string }) {
  const { lang } = useLang();
  const o = OPS[lang];
  const [state, action, pending] = useActionState(recordCreditAction, null);
  const [customer, setCustomer] = useState("");
  const [kind, setKind] = useState(data.canPayment ? "payment" : "credit");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const sheet = useRef<HTMLFormElement>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const done = state && "done" in state ? state.done : null;
  const error = state && "error" in state ? state.error : null;
  const chosen = data.owing.find((r) => r.customer.id === customer);

  const pick = (id: string) => {
    setCustomer(id);
    // jsdom lacks scrollIntoView; a person who asked for less motion gets the jump without the glide.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sheet.current?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
    amountField.current?.focus({ preventScroll: true });
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  // A recorded entry clears the amount; the customer stays chosen, so their new balance shows beside it.
  useEffect(() => {
    if (done) setAmount("");
  }, [done]);

  return (
    <SourcesProvider snapshots={[...data.snapshots, ...(data.paypal?.snapshots ?? []), ...(done ? done.snapshots : [])]} deskRef={null}>
      <main className="wrap ops credit">
        <PageHead
          id="credit-h"
          kicker={fill(o.creditKicker, { shop: <span data-name="">{data.shop}</span> })}
          title={
            <>
              {o.creditTitle} <small>{o.udhaar}</small>
            </>
          }
          lede={o.creditLede}
        />
        <div className="ops-a">
          <section className="ops-sec owing" aria-labelledby="owing-h">
            <h2 id="owing-h" className="ops-h">
              {o.owingHeading}
            </h2>
            {data.owing.length ? (
              <ol className="finds">
                {data.owing.map((row) => (
                  <li key={row.customer.id}>
                    <OwingLine row={row} onPick={pick} />
                    {data.paypal && (
                      <PayPalLink
                        panel={data.paypal}
                        links={data.paypal.links[row.customer.id] ?? []}
                        drafts={data.paypal.drafts[row.customer.id] ?? []}
                        busy={data.paypal.busy.includes(row.customer.id)}
                        customerId={row.customer.id}
                        name={row.customer.name}
                      />
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="finds empty-line">{o.nobodyOwes}</p>
            )}
            {data.paypal?.more && <p className="field-note">{PAYPAL[lang].more}</p>}
          </section>
        </div>
        <div className="ops-b">
          <form ref={sheet} className="sheet entry" aria-labelledby="entry-h" onSubmit={submit}>
              <input type="hidden" name="key" value={formKey} />
            <div className="sheet-top">
              <h2 id="entry-h">{o.entryCredit}</h2>
            </div>
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
            {chosen && <p className="field-line">{fill(o.owes, { balance: <Figure cell={chosen.balance} /> })}</p>}
            <Segmented
              name="kind"
              legend={o.whatHappened}
              value={kind}
              onChange={setKind}
              options={[
                { value: "payment", label: o.kindPayment, disabled: !data.canPayment },
                { value: "credit", label: o.kindCredit, disabled: !data.canCredit },
              ]}
            />
            {!data.canCredit && <p className="field-note">{o.creditRoleOnly}</p>}
            <label className="field">
              <span className="kicker field-label">{o.amount}</span>
              <input
                ref={amountField}
                name="amount"
                className="input amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {kind === "payment" && (
              <Segmented
                name="method"
                legend={o.paidBy}
                value={method}
                onChange={setMethod}
                options={[
                  { value: "cash", label: o.tenderCash },
                  { value: "upi", label: o.tenderUpi },
                ]}
              />
            )}
            <p className="field-note">{o.paymentsNote}</p>
            <div role="status">
              {error && <OpsError code={error} />}
              {done && (
                <Recorded stamp={done.stamp}>
                  <p>
                    {done.owes
                      ? fill(o.nowOwes, { customer: <span data-name="">{done.customer}</span>, owes: <Figure cell={done.owes} /> })
                      : fill(o.owesNothing, { customer: <span data-name="">{done.customer}</span> })}
                  </p>
                </Recorded>
              )}
            </div>
            <Button type="submit" variant="primary" disabled={pending}>
              {kind === "payment" ? o.recordPayment : o.recordCredit}
            </Button>
          </form>
          <SourceDrawer />
        </div>
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}

function OwingLine({ row, onPick }: { row: OwingRow; onPick: (id: string) => void }) {
  const { lang } = useLang();
  const o = OPS[lang];
  return (
    <div className={`row${row.late ? " is-late" : ""}`}>
      <p className="row-title">
        <span data-name="">{row.customer.name}</span>
        {row.late && <Sticker tone="ink">{o.overdueMark}</Sticker>}
      </p>
      <Button className="press-row" aria-label={fillText(o.recordFor, { name: row.customer.name })} onClick={() => onPick(row.customer.id)}>
        {o.recordShort}
      </Button>
      <p>{fill(o.owes, { balance: <Figure cell={row.balance} /> })}</p>
      <p>
        {row.late
          ? fill(o.overdueSince, { overdue: <Figure cell={row.overdue} />, due: <Figure cell={row.due} /> })
          : fill(o.nextDue, { due: <Figure cell={row.due} /> })}
      </p>
    </div>
  );
}
