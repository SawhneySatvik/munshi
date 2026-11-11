"use client";

// /app/inbox: a customer's words are theirs ([data-said]); "Recorded · nothing is sent" stands while no channel of the
// shop sends for real (every demo shop).
import Link from "next/link";
import { draftOrderAction, draftReplyAction, handleMessageAction, hearAction } from "../../app/app/inbox/actions";
import { fill } from "../../lib/i18n";
import { AGENTS } from "../../lib/i18n-agents";
import { APP, type AppDict } from "../../lib/i18n-app";
import { OPS } from "../../lib/i18n-ops";
import { PAYPAL } from "../../lib/i18n-paypal";
import type { InboxPage, InboxRow } from "../../lib/server/office";
import { FeatureGate } from "../AiFeatures";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Label, Name, Row, Screen, Tag, When } from "./Kit";
import { AgentForm, Channel, shopName } from "./OfficeParts";

const KIND: Record<string, keyof AppDict> = { audio: "inboxVoice", image: "inboxImage", other: "inboxOther" };
const HANDLED: Record<string, keyof AppDict> = { new: "inboxNew", handled: "inboxHandled", ignored: "inboxIgnored" };

/** /app/inbox: what customers sent, the order a message quotes by its code, and the member's handle or ignore. */
export function InboxView({ data }: { data: InboxPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const waiting = data.messages.filter((m) => m.status === "new");
  const done = data.messages.filter((m) => m.status !== "new");
  return (
    <Screen
      frame={data}
      id="inbox-h"
      kicker={fill(a.inboxKicker, { shop: shopName(data.shop) })}
      title={a.inboxTitle}
      lede={a.inboxLede}
      aside={<Channel channels={data.channels} />}
    >
      <Group id="inbox-waiting" title={a.inboxWaiting} empty={a.inboxWaitingEmpty}>
        {waiting.map((m) => (
          <Message key={m.id} m={m} formKey={data.formKey} hears={data.member.role !== "staff"} />
        ))}
      </Group>
      <Group id="inbox-done" title={a.inboxDone} empty={a.inboxDoneEmpty}>
        {done.map((m) => (
          <Message key={m.id} m={m} formKey={data.formKey} hears={false} />
        ))}
      </Group>
    </Screen>
  );
}

function Message({ m, formKey, hears }: { m: InboxRow; formKey: string; hears: boolean }) {
  const { lang } = useLang();
  const a = APP[lang];
  const kind = KIND[m.kind];
  return (
    <Row
      title={
        <>
          {m.channel === "instagram" ? a.channelInstagram : a.channelWhatsapp}
          {kind && <> · {a[kind]}</>} · <When at={m.at} />
        </>
      }
      amt={<Tag tone={m.status === "new" ? "warn" : m.status === "handled" ? "ok" : "ink"}>{a[HANDLED[m.status] ?? "inboxNew"]}</Tag>}
    >
      {/* A voice note's words were heard by Munshi from a clip a person attached (simulated), not typed by the customer. */}
      {m.text && m.heard && (
        <p className="l-sub">
          <Label>{AGENTS[lang].heardLabel}</Label>
        </p>
      )}
      {m.text ? (
        <blockquote className="app-quote" data-said="" aria-label={m.heard ? AGENTS[lang].heardWords : a.inboxTheirWords}>
          {m.text}
        </blockquote>
      ) : (
        <p className="l-sub">{a.inboxNoText}</p>
      )}
      {m.orders && (
        <p className="app-line">
          {fill(a.inboxQuotes, { n: <Figure cell={m.orders.count} /> })}
          {m.orders.rows.map((o) => (
            <span key={o.code}>
              {" "}
              <Name>{o.code}</Name> <Tag>{o.state}</Tag>
            </span>
          ))}
          {m.orders.rows.length > 0 && (
            <>
              {" · "}
              <Link href="/app/orders">{a.inboxOpenOrders}</Link>
            </>
          )}
        </p>
      )}
      {m.order && <OrderLine order={m.order} />}
      {m.optOut && <p className="l-sub">{a.inboxStop}</p>}
      {m.status === "new" && !m.optOut && (
        <div className="app-steps">
          <ActForm action={handleMessageAction} formKey={formKey} tag={`handled-${m.id.slice(-12)}`} submit={a.markHandled} inline primary>
            <input type="hidden" name="message" value={m.id} />
            <input type="hidden" name="status" value="handled" />
          </ActForm>
          <ActForm action={handleMessageAction} formKey={formKey} tag={`ignored-${m.id.slice(-12)}`} submit={a.markIgnored} inline>
            <input type="hidden" name="message" value={m.id} />
            <input type="hidden" name="status" value="ignored" />
          </ActForm>
        </div>
      )}
      {/* A reply or an order drafted from a message goes back on WhatsApp to the sender's phone; an Instagram DM has none. */}
      {m.status === "new" && !m.optOut && m.channel !== "instagram" && !m.order && <MessageMoves m={m} hears={hears} />}
    </Row>
  );
}

/** The order a message became, and where its PayPal link stands (sandbox): states only, never an amount. */
function OrderLine({ order }: { order: NonNullable<InboxRow["order"]> }) {
  const { lang } = useLang();
  const p = PAYPAL[lang];
  const state = order.paypal && `state_${order.paypal}` in p ? p[`state_${order.paypal}` as keyof typeof p] : p.inboxNoLink;
  return (
    <p className="app-line">
      {fill(p.inboxOrder, { code: <Name>{order.code}</Name> })} · <Tag tone={order.paypal === "recorded" ? "ok" : "warn"}>{state}</Tag> ·{" "}
      <Link href="/app/orders">{OPS[lang].navOrders}</Link>
    </p>
  );
}

/** A new message's agent moves: a voice note with no words yet is heard first (the clip attached, simulated; an owner's
 *  or a manager's, `hears`); a message with words gets "Draft reply" and "Draft order", each a draft for approval, and
 *  neither again while the one drafted waits for a decision. */
function MessageMoves({ m, hears }: { m: InboxRow; hears: boolean }) {
  const { lang } = useLang();
  const g = AGENTS[lang];
  const id = <input type="hidden" name="message" value={m.id} />;
  if (!m.text) {
    if (m.kind !== "audio" || !hears) return null;
    return (
      <FeatureGate feature="voice">
        <AgentForm action={hearAction} submit={g.hear} label={g.hear}>
          {id}
          <Field label={g.voiceFile} note={<Label>{g.voiceSimulated}</Label>}>
            <input type="file" name="audio" accept="audio/wav,.wav" className="input" required />
          </Field>
        </AgentForm>
      </FeatureGate>
    );
  }
  // Inbox drafts switched off for the shop by the operator: the two moves are labelled, not offered.
  return (
    <FeatureGate feature="inbox_drafts">
      <div className="app-steps">
        {m.replyWaiting ? (
          <p className="l-sub">{g.replyAlready}</p>
        ) : (
          <AgentForm action={draftReplyAction} submit={g.draftReply} label={g.draftReply} primary>
            {id}
          </AgentForm>
        )}
        {m.orderWaiting ? (
          <p className="l-sub">
            {g.orderAlready} <Link href="/app/orders">{OPS[lang].navOrders}</Link>
          </p>
        ) : (
          <AgentForm action={draftOrderAction} submit={g.draftOrder} label={g.draftOrder}>
            {id}
          </AgentForm>
        )}
      </div>
    </FeatureGate>
  );
}
