"use client";

import { createOfferAction, endOfferAction } from "../../app/app/offers/actions";
import { APP } from "../../lib/i18n-app";
import { fill } from "../../lib/i18n";
import type { OfferRow, OffersPage } from "../../lib/server/sell";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen, Tag, When } from "./Kit";

/** /app/offers: every offer with what it takes off, its caps and its redemptions so far (cells); the owner creates and ends. */
export function OffersView({ data }: { data: OffersPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const owner = data.may.includes("offer.create");
  return (
    <Screen
      frame={data}
      id="offers-h"
      kicker={fill(a.offersKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.offersTitle}
      lede={a.offersLede}
      aside={
        owner ? (
          <ActForm action={createOfferAction} formKey={data.formKey} tag="create" title={a.offerCreate} submit={a.offerCreateSubmit} primary>
            <Field label={a.offerName}>
              <input name="name" className="input" required maxLength={80} autoComplete="off" />
            </Field>
            <Field label={a.offerKind}>
              <select name="kind" className="input" defaultValue="percent_off">
                <option value="percent_off">{a.kindPercent}</option>
                <option value="amount_off">{a.kindAmount}</option>
              </select>
            </Field>
            <Field label={a.offerValue}>
              <input name="value" className="input" inputMode="decimal" required autoComplete="off" />
            </Field>
            <Field label={a.offerScope}>
              <select name="scope" className="input" defaultValue="all">
                <option value="all">{a.offerScopeAll}</option>
                <option value="category">{a.offerCategory}</option>
              </select>
            </Field>
            <Field label={a.offerCategory}>
              <select name="category" className="input" defaultValue="">
                <option value="">{a.none}</option>
                {data.categories.map((cat) => (
                  <option key={cat} value={cat} data-name="">
                    {cat}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={a.offerCodeField}>
              <input name="code" className="input" autoComplete="off" pattern="[A-Za-z0-9]{4,16}" />
            </Field>
            <div className="act-pair">
              <Field label={a.offerMinField}>
                <input name="min" className="input" inputMode="decimal" autoComplete="off" />
              </Field>
              <Field label={a.offerCapField}>
                <input name="cap" className="input" inputMode="numeric" autoComplete="off" />
              </Field>
            </div>
            <Field label={a.offerPerField}>
              <input name="per" className="input" inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label={a.offerEndsField}>
              <input name="ends" type="date" className="input" required />
            </Field>
            <label className="check">
              <input type="checkbox" name="published" />
              <span>{a.offerPublish}</span>
            </label>
            <p className="field-note">{a.offerOwnerNote}</p>
          </ActForm>
        ) : (
          <p className="field-note">{a.ownerOnly}</p>
        )
      }
    >
      <Group id="offers-list" title={a.offersHeading} empty={a.offersEmpty}>
        {data.offers.map((o) => (
          <OfferLine key={o.id} offer={o} canEnd={data.may.includes("offer.end")} formKey={data.formKey} />
        ))}
      </Group>
    </Screen>
  );
}

function OfferLine({ offer: o, canEnd, formKey }: { offer: OfferRow; canEnd: boolean; formKey: string }) {
  const { lang } = useLang();
  const a = APP[lang];
  const off = <Figure cell={o.off} read={o.percent ? "percent" : "card"} />;
  const scope = o.scope === "category" ? fill(a.offerScopeCategory, { name: <Name>{o.category}</Name> }) : o.scope === "items" ? a.offerScopeItems : a.offerScopeAll;
  return (
    <Row
      title={
        <>
          <Name>{o.name}</Name>
          {o.state === "live" ? <Tag tone="ok">{a.offerLive}</Tag> : o.state === "ended" ? <Tag>{a.offerEnded}</Tag> : <Tag tone="warn">{a.offerNotYet}</Tag>}
          {o.published && <Tag>{a.offerPublished}</Tag>}
        </>
      }
      sub={
        <>
          {o.code ? fill(a.offerCode, { code: <Name>{o.code}</Name> }) : a.offerNoCode} · {scope}
          {o.endsAt && <> · {fill(a.offerEnds, { at: <When at={o.endsAt} /> })}</>}
        </>
      }
      amt={fill(o.percent ? a.offerPercent : a.offerAmount, { n: off })}
    >
      <p className="app-line">
        {o.cap ? fill(a.offerCap, { used: <Figure cell={o.used} />, cap: <Figure cell={o.cap} /> }) : fill(a.offerUsed, { used: <Figure cell={o.used} /> })}
        {o.minSpend && <> · {fill(a.offerMin, { n: <Figure cell={o.minSpend} /> })}</>}
        {o.perCustomer && <> · {fill(a.offerPerCustomer, { n: <Figure cell={o.perCustomer} /> })}</>}
      </p>
      {canEnd && o.state === "live" && (
        <ActForm action={endOfferAction} formKey={formKey} tag={`end-${o.id.slice(-12)}`} submit={a.offerEnd} inline label={a.offerEnd}>
          <input type="hidden" name="offer" value={o.id} />
        </ActForm>
      )}
    </Row>
  );
}
