"use client";

import { useActionState } from "react";
import { type DecideError, decideDraft } from "../app/actions";
import { fill } from "../lib/i18n";
import { AGENTS } from "../lib/i18n-agents";
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
const TITLE = { "customer.remind": "trayRemind", "package.expire": "trayExpire", "message.reply": "trayReply" } as const;
const DONE = {
  executed: ["approved", "trayApprovedNote"],
  rejected: ["rejected", "trayRejectedNote"],
  stale: ["stale", "trayStaleNote"],
  failed: ["failed", "trayFailedNote"],
} as const;

/**
 * An agent's other draft in the tray (a reminder, a package lapsed, a reply), decided like a reorder: Approve and Reject
 * go to decideDraft as the signed-in member, and only a member whose role holds the command is offered them. Each figure
 * is the cell the draft cites; a reply's words are the stored words with their figures as cells.
 */
export function TrayCard({ draft }: { draft: Card }) {
  const { lang, t } = useLang();
  const a = AGENTS[lang];
  const [state, action, pending] = useActionState(decideDraft, null);
  const waiting = draft.status === "proposed";
  const done = waiting ? null : DONE[draft.status as keyof typeof DONE];
  const customer = <span data-name="">{draft.customer ?? a.someone}</span>;
  const amount = draft.figure ? <Figure cell={draft.figure} /> : <CannotVerify />;
  return (
    <section className={`pending${waiting ? "" : " is-decided"}`} aria-labelledby={`tray-h-${draft.id}`}>
      {waiting && draft.canDecide && <Sticker tone="flag">{t.waitingForYou}</Sticker>}
      <div className="pending-top">
        <h2 id={`tray-h-${draft.id}`}>{a[TITLE[draft.command]]}</h2>
        <Sticker tone="ink">{t.draft}</Sticker>
      </div>
      {draft.command === "customer.remind" && (
        <p className="pending-what">{fill(draft.template === "package_expiring" ? a.remindPackage : a.remindCredit, { customer, amount })}</p>
      )}
      {draft.command === "package.expire" && <p className="pending-what">{fill(a.expireLine, { amount })}</p>}
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
        {done && (
          <div className="done">
            <Stamp tone={draft.status === "executed" ? "approved" : "rejected"}>{t[done[0]]}</Stamp>
            <p>
              {draft.decision && (
                <span className="by">
                  <span data-name="">{draft.decision.by}</span> · <time dateTime={draft.decision.at}>{clock(draft.decision.at, lang)}</time>
                </span>
              )}
              {a[done[1]]}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
