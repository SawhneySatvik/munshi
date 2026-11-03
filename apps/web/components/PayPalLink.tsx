"use client";

import { useActionState } from "react";
import {
  cancelPaypalLinkAction,
  decidePaypalAction,
  messagePaypalLinkAction,
  type PaypalActState,
  recordPaypalAction,
  sendPaypalLinkAction,
} from "../app/app/credit/paypal-actions";
import { fill, fillText } from "../lib/i18n";
import { PAYPAL, type PaypalDict } from "../lib/i18n-paypal";
import type { MessageOutcome } from "../lib/server/paypal-deliver";
import type { PaypalDraftView, PaypalLinkView, PaypalPanel } from "../lib/server/paypal-panel";
import { dayAndTime } from "../lib/time";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { OpsError } from "./OpsError";
import { Figure } from "./shell/Figure";
import { Sticker } from "./Sticker";

/** The words for how a link's WhatsApp message went. */
/** In recorded mode PayPal made nothing: the note says the link is recorded here only. */
export const messageNote = (p: PaypalDict, m: MessageOutcome, mode: "sandbox" | "recorded") =>
  m === "drafted" && mode === "recorded" ? p.msg_drafted_recorded : p[`msg_${m}`];

function Status({ state, mode }: { state: PaypalActState; mode: "sandbox" | "recorded" }) {
  const { lang } = useLang();
  const p = PAYPAL[lang];
  const message = state && "message" in state ? state.message : null;
  return (
    <div role="status">
      {state && "error" in state && <OpsError code={state.error} />}
      {state && "drafted" in state && <p className="field-note">{p.drafted}</p>}
      {state && "decided" in state && <p className="field-note">{state.decided === "stale" ? p.stale : p.decided}</p>}
      {message && <p className="field-note">{messageNote(p, message, mode)}</p>}
    </div>
  );
}

/**
 * PayPal (sandbox) beside a customer's balance or an invoice. "Send PayPal link" proposes a draft, offered only while
 * the customer has no live link and no link draft waiting (and, on an invoice, only while its sale still owes credit,
 * shown from its cell). Each link shows its status with its source (PayPal sandbox and PayPal's invoice id, or recorded:
 * nothing is sent) and, while live, "Cancel link". A payment PayPal reported that the books do not hold yet offers
 * "Record this payment", unless its currency differs. A waiting draft shows its amount from the cell it cites, with
 * Approve and Reject for a member who may decide it. No amount is ever posted from here.
 */
export function PayPalLink({
  panel,
  links,
  drafts = [],
  busy = false,
  more = false,
  customerId,
  invoiceId,
  name,
}: {
  panel: PaypalPanel;
  links: PaypalLinkView[];
  drafts?: PaypalDraftView[];
  busy?: boolean;
  more?: boolean;
  customerId?: string;
  invoiceId?: string;
  name: string;
}) {
  const { lang } = useLang();
  const p = PAYPAL[lang];
  const [sent, send, sending] = useActionState<PaypalActState, FormData>(sendPaypalLinkAction, null);
  const offer = panel.canSend && !busy && (!invoiceId || panel.open !== null);
  return (
    <div className="paypal" data-paypal="">
      <p className="field-note">
        <Sticker tone="ink">{panel.mode === "sandbox" ? p.label : p.recordedLabel}</Sticker> {p.neverMoves}
      </p>
      {invoiceId && panel.open && <p>{fill(p.openCredit, { amount: <Figure cell={panel.open} /> })}</p>}
      {links.map((l) => (
        <LinkLine key={l.id} link={l} canSend={panel.canSend} canRecord={panel.canRecord} mode={panel.mode} />
      ))}
      {drafts.map((d) => (
        <DraftLine key={d.id} draft={d} canDecide={d.command === "payment.record" ? panel.canRecord : panel.canSend} mode={panel.mode} />
      ))}
      {more && <p className="field-note">{p.more}</p>}
      {offer && (
        <form action={send}>
          {invoiceId ? <input type="hidden" name="invoice" value={invoiceId} /> : <input type="hidden" name="customer" value={customerId ?? ""} />}
          <Button type="submit" disabled={sending} aria-label={fillText(p.sendLinkFor, { name })}>
            {p.sendLink}
          </Button>
        </form>
      )}
      <Status state={sent} mode={panel.mode} />
    </div>
  );
}

function LinkLine({ link, canSend, canRecord, mode }: { link: PaypalLinkView; canSend: boolean; canRecord: boolean; mode: "sandbox" | "recorded" }) {
  const { lang } = useLang();
  const p = PAYPAL[lang];
  const [state, record, recording] = useActionState<PaypalActState, FormData>(recordPaypalAction, null);
  const [cancelled, cancel, cancelling] = useActionState<PaypalActState, FormData>(cancelPaypalLinkAction, null);
  const [messaged, message, messaging] = useActionState<PaypalActState, FormData>(messagePaypalLinkAction, null);
  const recorded = link.mode === "recorded";
  const word =
    link.status === "queued"
      ? p.queued
      : link.status === "failed"
        ? p.failed
        : link.status === "cancel_queued"
          ? p.cancelQueued
          : link.status === "cancelled"
            ? p.cancelled
            : recorded
              ? p.sentRecorded
              : p.sent;
  return (
    <div className="paypal-link">
      <p>
        {word} <time dateTime={link.at}>{dayAndTime(link.at, lang)}</time>
      </p>
      <p className="field-note">
        {link.paypalId ? fill(p.source, { source: recorded ? p.recordedLabel : p.label, id: <span data-name="">{link.paypalId}</span> }) : fill(p.sourceQueued, { source: p.label })}
        {link.payerUrl && !recorded && (
          <>
            {" "}
            <a href={link.payerUrl} target="_blank" rel="noopener noreferrer">
              {p.openPayer}
            </a>
          </>
        )}
      </p>
      {link.messaged && <p className="field-note">{p.messaged}</p>}
      {!link.messaged && link.messageWaiting && <p className="field-note">{p.messageWaiting}</p>}
      {link.live && canSend && link.status === "sent" && !link.messaged && !link.messageWaiting && (
        <form action={message}>
          <input type="hidden" name="link" value={link.id} />
          <Button type="submit" disabled={messaging}>
            {p.sendMessage}
          </Button>
        </form>
      )}
      {link.events.map((e) => (
        <div key={e.id}>
          <p>
            {recorded ? p.paidRecorded : p.paid} <time dateTime={e.at}>{dayAndTime(e.at, lang)}</time>
            {e.recorded && (
              <>
                {" "}
                <Sticker tone="ink">{p.recordedInBooks}</Sticker>
              </>
            )}
          </p>
          {!e.matchesLink && e.sameCurrency && <p className="field-note">{p.amountDiffers}</p>}
          {!e.sameCurrency && <p className="field-note">{p.currencyDiffers}</p>}
          {!e.recorded && e.sameCurrency && canRecord && (
            <form action={record}>
              <input type="hidden" name="event" value={e.id} />
              <Button type="submit" variant="primary" disabled={recording}>
                {p.recordPayment}
              </Button>
              <p className="field-note">{p.recordNote}</p>
            </form>
          )}
        </div>
      ))}
      {link.live && canSend && (link.status === "queued" || link.status === "sent") && (
        <form action={cancel}>
          <input type="hidden" name="link" value={link.id} />
          <Button type="submit" disabled={cancelling}>
            {p.cancelLink}
          </Button>
        </form>
      )}
      <Status state={state ?? cancelled ?? messaged} mode={mode} />
    </div>
  );
}

function DraftLine({ draft, canDecide, mode }: { draft: PaypalDraftView; canDecide: boolean; mode: "sandbox" | "recorded" }) {
  const { lang } = useLang();
  const p = PAYPAL[lang];
  const [state, decide, deciding] = useActionState<PaypalActState, FormData>(decidePaypalAction, null);
  const amount = draft.amount ? <Figure cell={draft.amount} /> : null;
  const line = draft.command === "paypal.request" ? p.draftLink : draft.command === "paypal.cancel" ? p.draftCancel : p.draftRecord;
  return (
    <div className="paypal-draft">
      <p>{fill(line, { amount })}</p>
      {canDecide && (
        <form action={decide}>
          <input type="hidden" name="draft" value={draft.id} />
          <Button type="submit" variant="primary" name="verdict" value="approved" disabled={deciding}>
            {p.approve}
          </Button>
          <Button type="submit" name="verdict" value="rejected" disabled={deciding}>
            {p.reject}
          </Button>
        </form>
      )}
      <Status state={state} mode={mode} />
    </div>
  );
}
