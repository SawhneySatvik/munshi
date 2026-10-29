"use client";

import type { ReactNode } from "react";
import { fill } from "../../lib/i18n";
import { BOOKS } from "../../lib/i18n-books";
import { dateAndTime } from "../../lib/time";
import type { Snapshot } from "../../lib/types";
import { useLang } from "../LangProvider";
import "../shell/Figure.css";
import "./books.css";

/**
 * The top of a page in the shop's ledger: the ruled sheet with the red margin, as on the home. `lede` and `mark` (the
 * guarantee, highlighted) show on the desk only, as the home's do.
 */
export function Sheet(props: { id: string; kicker: ReactNode; title: ReactNode; lede?: ReactNode; mark?: ReactNode; children?: ReactNode }) {
  return (
    <section className="bk-sheet" aria-labelledby={props.id}>
      <p className="kicker bk-sheet-kicker">{props.kicker}</p>
      <h1 id={props.id}>{props.title}</h1>
      {props.lede && (
        <p className="bk-sheet-lede">
          {props.lede} {props.mark && <mark>{props.mark}</mark>}
        </p>
      )}
      {props.children}
    </section>
  );
}

/** The line over a ledger table naming where every figure in it was read from, once: the plain name and the read time. */
export function ReadLine({ snapshot, label }: { snapshot: Snapshot; label: string }) {
  const { lang } = useLang();
  return (
    <p className="bk-tsrc">
      <span className="ref">{label}</span>{" "}
      <span>{fill(BOOKS[lang].tableSource, { when: <time dateTime={snapshot.readAt}>{dateAndTime(snapshot.readAt, lang)}</time> })}</span>
    </p>
  );
}
