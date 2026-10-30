"use client";

// "Tap for source": asks the API's refs route for each cell behind a figure and shows the book row it was published
// from. A ref the API cannot trace to a published cell (or cannot be asked about) reads "Cannot verify".
import type { RefAnswer } from "@munshi/sdk";
import { useId, useState } from "react";
import type { Lang } from "../lib/business.ts";
import { fill, ui } from "../lib/i18n.ts";
import { useApi } from "./Api.tsx";

type Row = { ref: string; answer: RefAnswer | null };

const when = (at: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(at));

export function Source({ refs, derived, lang, what }: { refs: string[]; derived: boolean; lang: Lang; what: string }) {
  const { client, slug } = useApi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const panel = useId();

  async function show() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setRows(null);
    const answers = await Promise.all(
      refs.map(async (ref) => ({ ref, answer: await client.ref(slug, ref).catch(() => null) })),
    );
    setRows(answers);
  }

  return (
    <span className="source">
      <button type="button" className="source-btn" aria-expanded={open} aria-controls={panel} aria-label={fill(ui.sourceOf[lang], { what })} onClick={show}>
        {ui.source[lang]}
      </button>
      {open ? (
        <span className="source-panel" id={panel} role="status">
          {rows === null ? (
            <span>{ui.sourceChecking[lang]}</span>
          ) : (
            <>
              {derived ? <span className="source-lead">{ui.sourceCells[lang]}</span> : null}
              {rows.map((r) =>
                r.answer?.verified ? (
                  <span key={r.ref} className="source-row" data-verified="true">
                    {fill(ui.sourceRow[lang], { when: when(r.answer.publishedAt, lang), table: r.answer.source.table })} <code>{r.answer.source.id}</code>
                  </span>
                ) : (
                  <span key={r.ref} className="source-row" data-verified="false">
                    {ui.cannotVerify[lang]}
                  </span>
                ),
              )}
            </>
          )}
          <button type="button" className="source-close" onClick={() => setOpen(false)}>
            {ui.sourceClose[lang]}
          </button>
        </span>
      ) : null}
    </span>
  );
}
