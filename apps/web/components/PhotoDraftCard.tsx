"use client";

import { useActionState, useEffect, useRef } from "react";
import { decidePhotoDraft } from "../app/app/hero-actions";
import type { PhotoDraft } from "../lib/hero-types";
import { fill } from "../lib/i18n";
import { HERO } from "../lib/i18n-hero";
import { clock } from "../lib/time";
import type { Snapshot, SourceRef } from "../lib/types";
import { Button } from "./Button";
import { CannotVerify } from "./CannotVerify";
import { Cell } from "./Cell";
import { useLang } from "./LangProvider";
import { useLentSnapshots } from "./Sources";
import { Stamp } from "./Stamp";
import { Sticker } from "./Sticker";
import "./DraftCard.css";

const NONE: Snapshot[] = [];
const ERROR = { refused: "errRefused", not_proposed: "errNotProposed", signed_out: "errSignedOut", other: "errOther" } as const;

const figure = (ref: SourceRef | null) => (ref ? <Cell sourceRef={ref} /> : <CannotVerify />);

/**
 * A draft a photo left: a stock.count (the shelf photo's count against the books) or a purchase.record (a bill read
 * from a photo). Every figure is the cell its payload cites. Approve and Reject go to decidePhotoDraft, which decides as
 * the signed-in member; the card then shows the draft's state from the books, stamped with who and when, and what the
 * books hold after. A member whose role cannot decide it sees that it waits for someone who can.
 */
export function PhotoDraftCard({ draft: shown }: { draft: PhotoDraft }) {
  const { lang, t } = useLang();
  const h = HERO[lang];
  const [state, action, pending] = useActionState(decidePhotoDraft, null);
  const decided = state && "draft" in state ? state : null;
  const draft = decided?.draft ?? shown;
  useLentSnapshots(`draft:${draft.id}`, decided?.snapshots ?? NONE);
  const result = useRef<HTMLDivElement>(null);
  const waiting = draft.status === "proposed";

  useEffect(() => {
    if (decided) result.current?.focus();
  }, [decided]);

  const supplier = draft.command === "purchase.record" ? <span data-name="">{draft.supplier.name}</span> : null;
  const note = (() => {
    switch (draft.status) {
      case "executed":
        if (draft.command === "purchase.record") return h.billApproved;
        return decided?.after ? fill(h.countApproved, { after: <Cell sourceRef={decided.after} /> }) : h.countApprovedPlain;
      case "rejected":
        return t.rejectedNote;
      case "stale":
        return h.photoStale;
      default:
        return t.failedNote;
    }
  })();

  return (
    <section className={`pending photo-draft${waiting ? "" : " is-decided"}`} aria-labelledby={`pd-h-${draft.id}`}>
      {waiting && draft.canDecide && <Sticker tone="flag">{t.waitingForYou}</Sticker>}
      <div className="pending-top">
        <h3 id={`pd-h-${draft.id}`}>{draft.command === "stock.count" ? h.countTitle : h.billTitle}</h3>
        <Sticker tone="ink">{t.draft}</Sticker>
      </div>
      {draft.command === "stock.count" ? (
        <p className="pending-what">
          {fill(h.countLine, { item: <span data-name="">{draft.item}</span>, expected: figure(draft.expected), counted: figure(draft.counted) })}
        </p>
      ) : (
        <>
          <p className="pending-what">
            {fill(h.billLine, {
              billNo: draft.billNo ? <span data-name="">{draft.billNo}</span> : <CannotVerify />,
              supplier,
              sim: draft.supplier.simulated ? <Sticker tone="yellow">{t.simulated}</Sticker> : null,
              date: figure(draft.billDate),
            })}
          </p>
          <ul className="pending-lines">
            {draft.lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a draft's lines are fixed; their order is their identity.
              <li key={i}>{fill(h.billItem, { qty: figure(line.qty), item: <span data-name="">{line.item}</span>, cost: figure(line.cost) })}</li>
            ))}
          </ul>
        </>
      )}
      {waiting &&
        (draft.canDecide ? (
          <>
            <p className="pending-why">{draft.command === "stock.count" ? h.countWhy : h.billDraftWhy}</p>
            <form className="decide" action={action}>
              <input type="hidden" name="draft" value={draft.id} />
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
        {state && "error" in state && <p className="pending-error">{t[ERROR[state.error]]}</p>}
        {!waiting && (
          <div className="done" ref={result} tabIndex={-1}>
            <Stamp tone={draft.status === "executed" ? "approved" : "rejected"}>
              {t[draft.status === "executed" ? "approved" : draft.status === "rejected" ? "rejected" : draft.status === "stale" ? "stale" : "failed"]}
            </Stamp>
            <p>
              {draft.decision && (
                <span className="by">
                  <span data-name="">{draft.decision.by}</span> · <time dateTime={draft.decision.at}>{clock(draft.decision.at, lang)}</time>
                </span>
              )}
              {note}{" "}
              {decided?.billId && (
                <a className="press press-open" href={`/app/bills/${decided.billId}`}>
                  {h.openBill}
                </a>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
