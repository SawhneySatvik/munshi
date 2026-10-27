"use client";

import { useRef, useState } from "react";
import { fill } from "../lib/i18n";
import { clock } from "../lib/time";
import type { Draft } from "../lib/types";
import { Button } from "./Button";
import { Cell } from "./Cell";
import { useLang } from "./LangProvider";
import { Stamp } from "./Stamp";
import { Sticker } from "./Sticker";
import "./DraftCard.css";

type Decision = "waiting" | "approved" | "rejected";

/**
 * The draft waiting for the owner. TODO(core): Approve and Reject only change local state here ("Reset mock" undoes
 * them); once core is wired they call decide(), which executes the draft under the approver in one transaction.
 */
export function DraftCard({ draft }: { draft: Draft }) {
  const { lang, t } = useLang();
  const [decision, setDecision] = useState<Decision>("waiting");
  const result = useRef<HTMLDivElement>(null);
  const supplier = draft.supplier.name[lang];

  const decide = (next: Decision) => {
    setDecision(next);
    if (next !== "waiting") requestAnimationFrame(() => result.current?.focus());
  };

  return (
    <section className={`pending${decision === "waiting" ? "" : " is-decided"}`} aria-labelledby="draft-h">
      {decision === "waiting" && <Sticker tone="flag">{t.waitingForYou}</Sticker>}
      <div className="pending-top">
        <h2 id="draft-h">{t.reorder}</h2>
        <Sticker tone="ink">{t.draft}</Sticker>
      </div>
      <p className="pending-what">
        {fill(t.reorderLine, {
          qty: <Cell sourceRef={draft.qty} />,
          item: draft.item[lang],
          supplier,
          sim: draft.supplier.simulated ? <Sticker tone="yellow">{t.simulated}</Sticker> : null,
        })}
      </p>
      {decision === "waiting" && (
        <>
          <p className="pending-why">{t.draftWhy}</p>
          <div className="decide">
            <Button variant="primary" onClick={() => decide("approved")}>
              {t.approve}
            </Button>
            <Button onClick={() => decide("rejected")}>{t.reject}</Button>
          </div>
        </>
      )}
      <div role="status">
        {decision !== "waiting" && (
          <div className="done" ref={result} tabIndex={-1}>
            <Stamp tone={decision}>{decision === "approved" ? t.approved : t.rejected}</Stamp>
            <p>
              <span className="by">
                {draft.mockDecision.by} · {clock(draft.mockDecision.at, lang)}
              </span>
              {decision === "approved" ? fill(t.approvedNote, { supplier }) : t.rejectedNote}
            </p>
            <button type="button" className="reset" onClick={() => decide("waiting")}>
              {t.resetMock}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
