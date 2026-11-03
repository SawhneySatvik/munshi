"use client";

import { useActionState } from "react";
import { type DecideError, decideDraft } from "../app/actions";
import { fill } from "../lib/i18n";
import { AGENTS } from "../lib/i18n-agents";
import { PAYPAL } from "../lib/i18n-paypal";
import { clock } from "../lib/time";
import type { TrayCard as Card } from "../lib/types";
import { Button } from "./Button";
import { CannotVerify } from "./CannotVerify";
import { noteError } from "../lib/note-errors";
import { NoteField } from "./NoteField";
import { Figure } from "./shell/Figure";
import { useLang } from "./LangProvider";
import { Stamp } from "./Stamp";
import { Sticker } from "./Sticker";
import "./DraftCard.css";

const ERROR = { refused: "errRefused", not_proposed: "errNotProposed", signed_out: "errSignedOut", other: "errOther", note_number: "errOther", note_script: "errOther", note_length: "errOther", note_masked: "errOther", note_refused: "errOther" } as const satisfies Record<
  DecideError,
  string
>;
const TITLE = { "customer.remind": "trayRemind", "package.expire": "trayExpire", "message.reply": "trayReply", "surplus.give": "traySurplus" } as const;
const PAYPAL_MESSAGE = {
  drafted: "msg_drafted",
  waiting: "msg_waiting",
  pending: "msg_pending",
  not_made: "msg_not_made",
  messaged: "msg_messaged",
  messaging_off: "msg_messaging_off",
  no_contact: "msg_no_contact",
  no_consent: "msg_no_consent",
  failed: "msg_failed",
} as const;
const DONE = {
  executed: ["approved", "trayApprovedNote"],
  rejected: ["rejected", "trayRejectedNote"],
  stale: ["stale", "trayStaleNote"],
  failed: ["failed", "trayFailedNote"],
} as const;

/**
 * An agent's other draft in the tray (a reminder, a package lapsed, a reply, a gift), decided like a reorder: Approve and
 * Reject go to decideDraft as the signed-in member, and only a member whose role holds the command is offered them. Each
 * figure is the cell the draft cites; a reply's words are the stored words with their figures as cells. A gift names its
 * recipient with the simulated sticker, always: every recipient is simulated. A PayPal link carries the PayPal
 * sandbox sticker (or, with no sandbox keys, the recorded one) and says Munshi never moves money; approving it makes the
 * link and drafts its WhatsApp message, whose own card shows its words in full for a separate approval.
 */
export function TrayCard({ draft }: { draft: Card }) {
  const { lang, t } = useLang();
  const a = AGENTS[lang];
  const p = PAYPAL[lang];
  const [state, action, pending] = useActionState(decideDraft, null);
  const waiting = draft.status === "proposed";
  const done = waiting ? null : DONE[draft.status as keyof typeof DONE];
  const customer = <span data-name="">{draft.customer ?? a.someone}</span>;
  const amount = draft.figure ? <Figure cell={draft.figure} /> : <CannotVerify />;
  return (
    <section className={`pending${waiting ? "" : " is-decided"}`} aria-labelledby={`tray-h-${draft.id}`}>
      {waiting && draft.canDecide && <Sticker tone="flag">{t.waitingForYou}</Sticker>}
      <div className="pending-top">
        <h2 id={`tray-h-${draft.id}`}>{draft.command === "paypal.request" ? p.trayTitle : a[TITLE[draft.command]]}</h2>
        <Sticker tone="ink">{t.draft}</Sticker>
      </div>
      {draft.command === "customer.remind" && draft.template !== "paypal_link" && (
        <p className="pending-what">{fill(draft.template === "package_expiring" ? a.remindPackage : a.remindCredit, { customer, amount })}</p>
      )}
      {(draft.command === "paypal.request" || draft.template === "paypal_link") && (
        <>
          <p className="pending-what">
            {fill(
              draft.command === "paypal.request"
                ? draft.paypalPurpose === "invoice"
                  ? p.trayLineInvoice
                  : p.trayLine
                : draft.paypalPurpose === "invoice"
                  ? p.trayMessageInvoice
                  : p.trayMessage,
              { customer, amount },
            )}
          </p>
          {/* Recorded mode (no sandbox keys) says so where the person decides, and claims no call to PayPal. */}
          <p className="pending-why">
            <Sticker tone="ink">{draft.paypalMode === "sandbox" ? p.label : p.recordedLabel}</Sticker>{" "}
            {draft.command === "paypal.request" ? (draft.paypalMode === "sandbox" ? p.trayNote : p.trayNoteRecorded) : p.neverMoves}
          </p>
          {draft.template === "paypal_link" &&
            (draft.paypalMessage ? (
              // The words as the approval writes them: the template's own words as text (the digit check reads them),
              // the shop and the link as names, the amount its cell.
              <blockquote className="app-quote" aria-label={p.messageWords}>
                {draft.paypalMessage.map((part, i) =>
                  part.t === "text" ? (
                    part.v
                  ) : part.t === "name" ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the template's parts are fixed; their order is their identity.
                    <span key={i} data-name="">
                      {part.v}
                    </span>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the template's parts are fixed; their order is their identity.
                    <Figure key={i} cell={part.ref} />
                  ),
                )}
              </blockquote>
            ) : (
              <CannotVerify />
            ))}
        </>
      )}
      {draft.command === "package.expire" && <p className="pending-what">{fill(a.expireLine, { amount })}</p>}
      {draft.command === "surplus.give" && draft.gift && (
        <>
          <p className="pending-what">
            {fill(a.giftLine, {
              qty: draft.gift.qty ? <Figure cell={draft.gift.qty} /> : <CannotVerify />,
              item: draft.gift.item !== null ? <span data-name="">{draft.gift.item}</span> : <CannotVerify />,
              recipient: (
                <span data-recipient="">
                  {draft.gift.recipient !== null ? <span data-name="">{draft.gift.recipient}</span> : <CannotVerify />}{" "}
                  <Sticker tone="yellow">{a.simulated}</Sticker>
                </span>
              ),
            })}
          </p>
          <p className="pending-why">{a.giftNote}</p>
        </>
      )}
      {draft.command === "message.reply" && (
        <>
          <p className="pending-what">{fill(a.replyTo, { customer })}</p>
          {draft.words ? (
            <blockquote className="app-quote">
              {draft.words.map((p, i) =>
                p.t === "text" ? (
                  p.v
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the stored words are fixed; their order is their identity.
                  <Figure key={i} cell={p.ref} />
                ),
              )}
            </blockquote>
          ) : (
            <CannotVerify />
          )}
          <p className="pending-why">{a.trayDisclosure}</p>
        </>
      )}
      {waiting &&
        (draft.canDecide ? (
          <>
            <p className="pending-why">{a.trayWhy}</p>
            <form className="decide" action={action}>
              <input type="hidden" name="draft" value={draft.id} />
              <NoteField id={draft.id} />
              <Button type="submit" variant="primary" name="verdict" value="approved" disabled={pending}>
                {t.approve}
              </Button>
              <Button type="submit" name="verdict" value="rejected" disabled={pending}>
                {t.reject}
              </Button>
            </form>
          </>
        ) : (
          <p className="pending-wait">{t.waitsForApprover}</p>
        ))}
      <div role="status">
        {state?.error && <p className="pending-error">{noteError(state.error, lang) ?? t[ERROR[state.error]]}</p>}
        {state?.paypal && (draft.command === "paypal.request" || draft.template === "paypal_link") && (
          <p className="pending-why">
            {state.paypal === "drafted" && draft.paypalMode !== "sandbox" ? p.msg_drafted_recorded : p[PAYPAL_MESSAGE[state.paypal]]}
          </p>
        )}
        {done && (
          <div className="done">
            <Stamp tone={draft.status === "executed" ? "approved" : "rejected"}>{t[done[0]]}</Stamp>
            <p>
              {draft.decision && (
                <span className="by">
                  <span data-name="">{draft.decision.by}</span> · <time dateTime={draft.decision.at}>{clock(draft.decision.at, lang)}</time>
                </span>
              )}
              {draft.command === "surplus.give" && draft.status === "executed" ? a.trayGiftApprovedNote : a[done[1]]}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
