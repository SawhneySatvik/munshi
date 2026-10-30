"use client";

import { creditNoteAction, registerAction } from "../../app/app/invoices/actions";
import { fill } from "../../lib/i18n";
import { APP, type AppDict } from "../../lib/i18n-app";
import type { InvoicePage, InvoicesPage } from "../../lib/server/sell";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Label, Name, Row, Screen, Tabs, When } from "./Kit";

const KIND: Record<string, keyof AppDict> = { tax_invoice: "kindTax", bill_of_supply: "kindSupply", credit_note: "kindCredit" };
const SCHEME: Record<string, keyof AppDict> = { regular: "schemeRegular", composition: "schemeComposition", unregistered: "schemeUnregistered" };
const kindWord = (a: AppDict, kind: string) => a[KIND[kind] ?? "kindTax"];

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** /app/invoices: a branch's invoices in a month and the month's GST by rate (cells), and the registration. */
export function InvoicesView({ data }: { data: InvoicesPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const reg = data.registration;
  const shop = data.shops.find((s) => s.id === data.shopId);
  const month = (m: string) => <time dateTime={m}>{new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`))}</time>;
  return (
    <Screen
      frame={data}
      id="invoices-h"
      kicker={fill(a.invoicesKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.invoicesTitle}
      lede={a.invoicesLede}
      aside={
        data.may.includes("tax.registration.set") && (
          <ActForm action={registerAction} formKey={data.formKey} tag="register" title={a.regSet} submit={a.regSubmit} primary>
            <input type="hidden" name="shop" value={data.shopId} />
            <Field label={a.regScheme}>
              <select name="scheme" className="input" defaultValue="regular">
                <option value="regular">{a.schemeRegular}</option>
                <option value="composition">{a.schemeComposition}</option>
                <option value="unregistered">{a.schemeUnregistered}</option>
              </select>
            </Field>
            <Field label={a.regGstin}>
              <input name="gstin" className="input" autoComplete="off" maxLength={15} />
            </Field>
            <div className="act-pair">
              <Field label={a.regState}>
                <input name="state" className="input" inputMode="numeric" required maxLength={2} autoComplete="off" />
              </Field>
              <Field label={a.regSeries}>
                <input name="series" className="input" required maxLength={8} autoComplete="off" defaultValue={shop?.series ?? ""} />
              </Field>
            </div>
            <p className="field-note">
              <Label>{a.synthetic}</Label> {a.regNote}
            </p>
          </ActForm>
        )
      }
    >
      {data.shops.length > 1 && (
        <Tabs
          label={a.branch}
          items={data.shops.map((s) => ({ href: `/app/invoices?shop=${s.id}&month=${data.month}`, text: <Name>{s.name}</Name>, on: s.id === data.shopId }))}
        />
      )}
      <Tabs
        label={a.month}
        items={[-1, 0, 1].map((by) => {
          const m = shiftMonth(data.month, by);
          return { href: `/app/invoices?shop=${data.shopId}&month=${m}`, text: month(m), on: by === 0 };
        })}
      />
      <Group id="reg-h" title={a.regHeading} empty={a.regNone}>
        {reg && (
          <Row
            title={fill(a.regLine, {
              scheme: a[SCHEME[reg.scheme] ?? "schemeRegular"],
              state: <Name>{reg.stateCode}</Name>,
              gstin: <Name>{reg.gstin ?? "—"}</Name>,
            })}
            sub={fill(a.regSince, { day: <When at={reg.effectiveFrom} day /> })}
          />
        )}
      </Group>
      <Group id="inv-list" title={a.invoicesHeading} empty={a.invoicesEmpty}>
        {data.invoices.map((v) => (
          <Row
            key={v.id}
            href={`/app/invoices/${v.id}`}
            title={
              <>
                {kindWord(a, v.kind)}{" "}
                <Name>
                  {v.series}/{v.fy}/
                </Name>
                <Figure cell={v.number} />
              </>
            }
            sub={v.issuedAt && <When at={v.issuedAt} />}
            amt={<Figure cell={v.total} />}
          >
            <p className="l-sub">{fill(a.invoiceLine, { total: <Figure cell={v.total} />, cgst: <Figure cell={v.cgst} />, sgst: <Figure cell={v.sgst} /> })}</p>
          </Row>
        ))}
      </Group>
      <Group id="gst-h" title={a.summaryHeading} empty={a.summaryEmpty}>
        {data.summary.map((s, i) => (
          <Row
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per rate, in the read's order
            key={i}
            title={fill(a.summaryRate, { rate: <Figure cell={s.rate} read="percent" />, lines: <Figure cell={s.lines} /> })}
            sub={fill(a.summaryLine, { taxable: <Figure cell={s.taxable} />, cgst: <Figure cell={s.cgst} />, sgst: <Figure cell={s.sgst} /> })}
            amt={<Figure cell={s.total} />}
          />
        ))}
      </Group>
    </Screen>
  );
}

/** /app/invoices/[id]: one invoice with its GST lines, every printed figure a cell of invoice.detail; a credit note. */
export function InvoiceView({ data }: { data: InvoicePage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const canCancel = data.kind !== "credit_note" && !data.reversed && data.may.includes("sale.reverse");
  return (
    <Screen
      frame={data}
      id="invoice-h"
      kicker={fill(a.invoiceKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={
        <>
          {kindWord(a, data.kind)}{" "}
          <Name>
            {data.series}/{data.fy}/
          </Name>
          <Figure cell={data.number} />
        </>
      }
      lede={a.invoiceLede}
      aside={
        canCancel && (
          <ActForm action={creditNoteAction} formKey={data.formKey} tag="credit" title={a.invoiceCredit} submit={a.invoiceCredit}>
            <input type="hidden" name="invoice" value={data.id} />
            <input type="hidden" name="sale" value={data.saleId} />
            <Field label={a.reason}>
              <select name="reason" className="input" defaultValue="returned_goods">
                <option value="returned_goods">{a.reasonCancelled}</option>
                <option value="entered_in_error">{a.reasonWrong}</option>
              </select>
            </Field>
            <p className="field-note">{a.invoiceCreditNote}</p>
          </ActForm>
        )
      }
    >
      <Group id="inv-head" title={a.invoiceIssued}>
        <Row title={data.issuedAt ? <When at={data.issuedAt} /> : "—"} sub={<>GSTIN <Name>{data.gstin || "—"}</Name></>} />
        {data.customer && <Row title={a.invoiceBuyer} sub={<Name>{data.customer}</Name>} />}
        {data.reversed && (
          <Row title={a.invoiceCancelled} sub={data.creditNoteId && <a href={`/app/invoices/${data.creditNoteId}`}>{a.invoiceOpenNote}</a>} />
        )}
        {data.originalId && <Row title={a.invoiceOriginal} sub={<a href={`/app/invoices/${data.originalId}`}>{a.invoiceOpenOriginal}</a>} />}
      </Group>
      <Group id="inv-lines" title={a.invoiceLinesHeading}>
        {data.lines.map((l, i) => (
          <Row
            // biome-ignore lint/suspicious/noArrayIndexKey: the invoice's own line order
            key={i}
            title={<Name>{l.description}</Name>}
            sub={fill(a.invoiceLineSub, {
              qty: <Figure cell={l.qty} />,
              taxable: <Figure cell={l.taxable} />,
              rate: <Figure cell={l.rate} read="percent" />,
              cgst: <Figure cell={l.cgst} />,
              sgst: <Figure cell={l.sgst} />,
            })}
            amt={<Figure cell={l.total} />}
          />
        ))}
      </Group>
      {data.totals && (
        <Group id="inv-totals" title={a.invoiceTotals}>
          <Row title={a.invoiceTaxable} amt={<Figure cell={data.totals.taxable} />} />
          <Row title={a.invoiceCgst} amt={<Figure cell={data.totals.cgst} />} />
          <Row title={a.invoiceSgst} amt={<Figure cell={data.totals.sgst} />} />
          <Row lead title={a.invoiceTotal} amt={<Figure cell={data.totals.total} />} />
        </Group>
      )}
      <p>
        <a href="/app/invoices">{a.back}</a>
      </p>
    </Screen>
  );
}
