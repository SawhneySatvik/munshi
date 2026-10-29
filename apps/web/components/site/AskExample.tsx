"use client";

import { useState } from "react";
import { useLang } from "../LangProvider";
import { exampleIn, type RecordId } from "./example";
import { Mark, Ring, Wave } from "./Mark";
import { SITE_WORDS } from "./words";

type Verdict = "waiting" | "approved" | "rejected";

/**
 * The worked example (site-F, D-046): a spoken question, an answer whose underlined figures open their record in the
 * side sheet, and a draft that waits for a yes. Local state only: nothing here reaches a server. The whole block is
 * marked data-example and says on screen that it is an example on synthetic data.
 */
export function AskExample() {
  const { lang } = useLang();
  const w = SITE_WORDS[lang];
  const ex = exampleIn(lang);
  const [open, setOpen] = useState<RecordId | null>("owing");
  const [verdict, setVerdict] = useState<Verdict>("waiting");
  const record = open ? ex.records[open] : null;
  return (
    <section className="s-example" id="example" aria-labelledby="example-k" data-example="">
      <p className="s-kicker" id="example-k">
        {w.exampleKicker}
      </p>
      <p className="s-example-note">{w.exampleNote}</p>
      <div className="s-thread">
        <div className="s-q">
          <Wave />
          <p className="s-q-said" lang="hi">
            {ex.question}
          </p>
          <p className="s-q-tr" lang="en">
            {ex.translation}
          </p>
          <p className="s-q-by">{w.exampleBy}</p>
        </div>
        <div className="s-a">
          <p className="s-who">
            <Mark />
            {w.exampleWho}
          </p>
          <p className="s-a-text">
            {ex.answer.map((part, i) =>
              typeof part === "string" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the answer's runs are fixed and never reorder.
                <span key={i}>{part}</span>
              ) : (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                  key={i}
                  type="button"
                  className="s-fig"
                  aria-expanded={open === part.opens}
                  aria-controls="s-sheet"
                  onClick={() => setOpen(part.opens)}
                >
                  {part.fig}
                </button>
              ),
            )}
          </p>
          <p className="s-a-src">{w.exampleSource}</p>
          <div className="s-draft" data-verdict={verdict}>
            <div className="s-draft-h">
              <b>{w.draftTitle}</b>
              {verdict === "waiting" ? <span className="s-status">{w.draftWaiting}</span> : null}
            </div>
            {verdict === "waiting" ? (
              <>
                <p className="s-msg" lang="hi">
                  {ex.message}
                </p>
                <p className="s-msg-n">{w.draftNote}</p>
                <div className="s-draft-acts">
                  <button type="button" className="s-ghost" onClick={() => setVerdict("rejected")}>
                    {w.notNow}
                  </button>
                  <button type="button" className="s-btn" onClick={() => setVerdict("approved")}>
                    {w.approve}
                  </button>
                </div>
              </>
            ) : (
              <div className={`s-done${verdict === "rejected" ? " is-no" : ""}`} role="status">
                {verdict === "approved" ? (
                  <span className="s-stamp" aria-hidden="true">
                    <span className="s-ringed">
                      {w.stampApproved}
                      <Ring />
                    </span>
                  </span>
                ) : null}
                <div>
                  <b>{verdict === "approved" ? w.approvedTitle : w.rejectedTitle}</b>
                  <p>{verdict === "approved" ? w.approvedBody : w.rejectedBody}</p>
                  <button type="button" className="s-again" onClick={() => setVerdict("waiting")}>
                    {w.again}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <aside className="s-sheet" id="s-sheet" aria-label={w.sheetLabel} aria-live="polite">
          <div className="s-sheet-k">
            <span>{w.sheetLabel}</span>
            {record ? (
              <button type="button" className="s-sheet-x" onClick={() => setOpen(null)} aria-label={w.sheetClose}>
                ×
              </button>
            ) : null}
          </div>
          {record ? (
            <div className="s-rec" key={open}>
              <p className="s-rec-t">{record.title}</p>
              <ul className="s-rec-l">
                {[...record.rows, ...(record.total ? [record.total] : [])].map((r, i) => (
                  <li key={r[0]} className={record.total && i === record.rows.length ? "is-tot" : undefined}>
                    <span>{r[0]}</span>
                    <span>{r[1]}</span>
                    <span>{r[2]}</span>
                  </li>
                ))}
              </ul>
              <p className="s-rec-n">{record.note}</p>
            </div>
          ) : (
            <p className="s-none">{w.sheetEmpty}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
