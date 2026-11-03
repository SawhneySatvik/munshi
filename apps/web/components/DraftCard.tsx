"use client";

import { Fragment, useActionState, useEffect, useRef } from "react";
import { type DecideError, decideDraft } from "../app/actions";
import { fill } from "../lib/i18n";
import { clock } from "../lib/time";
import type { Draft } from "../lib/types";
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
const DONE = {
  executed: ["approved", "approvedNote"],
  rejected: ["rejected", "rejectedNote"],
  stale: ["stale", "staleNote"],
  failed: ["failed", "failedNote"],
} as const;

/**
 * A draft waiting for a decision. Approve and Reject submit to the decideDraft server action, which decides as the
 * signed-in member; the card then shows the draft's status from the books, stamped with the name and time of its audit
 * entry. Only a member whose role holds the draft's command is offered the buttons.
 */
export function DraftCard({ draft }: { draft: Draft }) {
  const { lang, t } = useLang();
  const [state, action, pending] = useActionState(decideDraft, null);
  const result = useRef<HTMLDivElement>(null);
  const waiting = draft.status === "proposed";
  const wasWaiting = useRef(waiting);
  const supplier = <span data-name="">{draft.supplier.name}</span>;

  useEffect(() => {
    if (wasWaiting.current && !waiting) result.current?.focus(); // decided on this page: move to the outcome
    wasWaiting.current = waiting;
  }, [waiting]);

  const done = waiting ? null : DONE[draft.status as keyof typeof DONE];
  return (
    <section className={`pending${waiting ? "" : " is-decided"}`} aria-labelledby={`draft-h-${draft.id}`}>
      {waiting && draft.canDecide && <Sticker tone="flag">{t.waitingForYou}</Sticker>}
      <div className="pending-top">
        <h2 id={`draft-h-${draft.id}`}>{t.reorder}</h2>
        <Sticker tone="ink">{t.draft}</Sticker>
      </div>
      <p className="pending-what">
        {fill(t.reorderLine, {
          lines: draft.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a draft's lines are fixed; their order is their identity.
            <Fragment key={i}>
              {i > 0 && ", "}
              {fill(t.reorderItem, {
                qty: line.qty ? <Figure cell={line.qty} /> : <CannotVerify />,
                item: <span data-name="">{line.item}</span>,
              })}
            </Fragment>
          )),
          supplier,
          sim: draft.supplier.simulated ? <Sticker tone="yellow">{t.simulated}</Sticker> : null,
        })}
      </p>
      {waiting &&
        (draft.canDecide ? (
          <>
            <p className="pending-why">{t.draftWhy}</p>
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
          <div className="done" ref={result} tabIndex={-1}>
            <Stamp tone={draft.status === "executed" ? "approved" : "rejected"}>{t[done[0]]}</Stamp>
            <p>
              {draft.decision && (
                <span className="by">
                  <span data-name="">{draft.decision.by}</span> · <time dateTime={draft.decision.at}>{clock(draft.decision.at, lang)}</time>
                </span>
              )}
              {fill(t[done[1]], { supplier })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
