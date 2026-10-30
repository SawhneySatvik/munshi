"use client";

import { confirmRequestAction, decideOrderAction, stepAction } from "../../app/app/orders/actions";
import { fill } from "../../lib/i18n";
import { APP, type AppDict, POINT, STEP } from "../../lib/i18n-app";
import type { CardRow, DraftRow, OrdersPage, WaitingRow } from "../../lib/server/orders";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen, Tag, When } from "./Kit";

const CHANNEL: Record<string, keyof AppDict> = {
  site: "channelSite",
  widget: "channelWidget",
  whatsapp: "channelWhatsapp",
  instagram: "channelInstagram",
  voice: "channelVoice",
  photo: "channelPhoto",
};
const KIND: Record<string, keyof AppDict> = { goods: "kindGoods", stitching: "kindStitching", alteration: "kindAlteration" };
// The board's columns, in the order work moves.
const ORDER = ["confirmed", "packed", "cutting", "stitching", "trial", "ready", "out_for_delivery", "rescheduled"];

/** /app/orders: the requests waiting (each line against its source), the agent's drafts, then the board by step. */
export function OrdersView({ data }: { data: OrdersPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const steps = ORDER.filter((s) => data.cards.some((c) => c.step === s));
  return (
    <Screen frame={data} id="orders-h" kicker={fill(a.ordersKicker, { shop: <span data-name="">{data.shop}</span> })} title={a.ordersTitle} lede={a.ordersLede}>
      <Group id="waiting-h" title={a.waitingHeading} empty={a.waitingEmpty}>
        {data.waiting.map((w) => (
          <Waiting key={w.id} w={w} data={data} />
        ))}
      </Group>
      {data.drafts.length > 0 && (
        <Group id="drafts-h" title={a.draftsHeading} note={a.draftNote}>
          {data.drafts.map((d) => (
            <Drafted key={d.id} d={d} formKey={data.formKey} />
          ))}
        </Group>
      )}
      <section className="app-board" aria-labelledby="board-h">
        <h2 id="board-h" className="ops-h">
          {a.boardHeading}
        </h2>
        {steps.length === 0 && <p className="empty-line">{a.boardEmpty}</p>}
        <div className="app-cols">
          {steps.map((s) => (
            <Group key={s} id={`step-${s}`} title={STEP[s]?.[lang] ?? s}>
              {data.cards
                .filter((c) => c.step === s)
                .map((c) => (
                  <Card key={c.id} c={c} formKey={data.formKey} />
                ))}
            </Group>
          ))}
        </div>
        {data.more.length > 0 && (
          <p className="field-note">
            {a.moreCards}:{" "}
            {data.more.map((m) => (
              <Name key={m.code}>{m.code} </Name>
            ))}
          </p>
        )}
        <p className="field-note">{a.stepNote}</p>
      </section>
    </Screen>
  );
}

function Waiting({ w, data }: { w: WaitingRow; data: OrdersPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Row
      title={
        <>
          <Name>{w.code}</Name> <Tag>{a[KIND[w.kind] ?? "kindGoods"]}</Tag>
        </>
      }
      sub={
        <>
          {fill(a.waitingFrom, { channel: a[CHANNEL[w.channel] ?? "channelSite"] })} · <When at={w.at} />
        </>
      }
      amt={w.total && <Figure cell={w.total} />}
    >
      {w.lines.map((l, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: the request's own line order
          key={i}
          className="app-line"
        >
          {fill(a.waitingLines, {
            qty: <Figure cell={l.qty} />,
            item: <Name>{l.item}</Name>,
            price: <Figure cell={l.price} />,
            amount: <Figure cell={l.amount} />,
          })}
        </p>
      ))}
      {w.total && <p className="app-line">{fill(a.waitingTotal, { total: <Figure cell={w.total} /> })}</p>}
      {w.message && <p className="l-sub">{a.waitingMessage}</p>}
      {!w.message && !w.priced && <p className="l-sub">{a.waitingNoPrice}</p>}
      {!w.message && w.priced && data.may.includes("order.confirm") && (
        <ActForm action={confirmRequestAction} formKey={data.formKey} tag={`confirm-${w.id.slice(-12)}`} submit={a.confirmSubmit} inline primary>
          <input type="hidden" name="request" value={w.id} />
          <Field label={a.confirmCustomer}>
            <select name="customer" className="input" defaultValue="" required>
              <option value="" disabled>
                {a.pick}
              </option>
              {data.customers.map((k) => (
                <option key={k.id} value={k.id} data-name="">
                  {k.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.confirmDue}>
            <input name="due" type="date" className="input" />
          </Field>
        </ActForm>
      )}
    </Row>
  );
}

function Drafted({ d, formKey }: { d: DraftRow; formKey: string }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Row title={<Tag tone="warn">{a.draftWaiting}</Tag>} sub={d.customer && <Name>{d.customer}</Name>}>
      {d.message && (
        <blockquote className="app-quote" data-said="" aria-label={a.draftTheirWords}>
          {d.message}
        </blockquote>
      )}
      <dl className="app-mini">
        {d.refs.map((r) => (
          <div key={r.path} style={{ display: "contents" }}>
            <dt>
              <Name>{r.path}</Name>
            </dt>
            <dd>
              <Figure cell={r.ref} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="app-steps">
        <ActForm action={decideOrderAction} formKey={formKey} tag={`approve-${d.id.slice(-12)}`} submit={a.approve} inline primary>
          <input type="hidden" name="draft" value={d.id} />
          <input type="hidden" name="verdict" value="approved" />
        </ActForm>
        <ActForm action={decideOrderAction} formKey={formKey} tag={`reject-${d.id.slice(-12)}`} submit={a.reject} inline>
          <input type="hidden" name="draft" value={d.id} />
          <input type="hidden" name="verdict" value="rejected" />
        </ActForm>
      </div>
    </Row>
  );
}

function Card({ c, formKey }: { c: CardRow; formKey: string }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Row
      title={
        <>
          <Name>{c.codeText}</Name> <Tag>{a[KIND[c.kind] ?? "kindGoods"]}</Tag>
        </>
      }
      sub={
        <>
          <Name>{c.customer}</Name>
          {c.due && <> · {fill(a.cardDue, { day: <Figure cell={c.due} /> })}</>}
          {c.trial && <> · {fill(a.cardTrial, { day: <Figure cell={c.trial} /> })}</>}
        </>
      }
      amt={c.total && <Figure cell={c.total} />}
    >
      {c.lines.map((l, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: the order's own line order
          key={i}
          className="app-line"
        >
          {fill(a.cardLine, { qty: <Figure cell={l.qty} />, item: <Name>{l.item}</Name>, price: <Figure cell={l.price} /> })}
          {l.quoted && <Tag>{a.cardQuote}</Tag>}
        </p>
      ))}
      <dl className="app-mini">
        {c.total && (
          <>
            <dt>{a.cardTotal}</dt>
            <dd>
              <Figure cell={c.total} />
            </dd>
          </>
        )}
        {c.advance && (
          <>
            <dt>{a.cardAdvance}</dt>
            <dd>
              <Figure cell={c.advance} />
            </dd>
          </>
        )}
      </dl>
      {c.measurements.map((m) => (
        <div key={m.lineNo}>
          <p className="kicker">{a.measureHeading}</p>
          <dl className="app-mini">
            {m.points.map((p) => (
              <div key={p.point} style={{ display: "contents" }}>
                <dt>{POINT[p.point]?.[lang] ?? p.point}</dt>
                <dd>{p.mm ? <Figure cell={p.mm} /> : a.measureErased}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {c.next.length > 0 && (
        <div className="app-steps">
          {c.next.map((s) => (
            <ActForm key={s} action={stepAction} formKey={formKey} tag={`step-${c.id.slice(-12)}-${s}`} submit={fill(a.stepTo, { step: STEP[s]?.[lang] ?? s })} inline>
              <input type="hidden" name="order" value={c.id} />
              <input type="hidden" name="step" value={s} />
            </ActForm>
          ))}
        </div>
      )}
    </Row>
  );
}
