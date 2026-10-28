"use client";

import { useParams } from "next/navigation";
import type { Lang } from "../lib/business.ts";
import { href, isLang, ui } from "../lib/i18n.ts";

/** The one look of the error and not-found pages. Fixed, translated copy only: an error's own text is never shown. */
export function StatusPage({ kind, onRetry }: { kind: "error" | "notFound"; onRetry?: () => void }) {
  const { lang: param } = useParams<{ lang?: string }>();
  const lang: Lang = param && isLang(param) ? param : "en";
  const error = kind === "error";
  return (
    <main>
      <header className="page-head">
        <div className="wrap">
          <h1 className="page-title display">{(error ? ui.errorTitle : ui.notFoundTitle)[lang]}</h1>
          <p>{(error ? ui.errorBody : ui.notFoundBody)[lang]}</p>
          <div className="status-actions">
            {error && onRetry ? (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                {ui.tryAgain[lang]}
              </button>
            ) : null}
            <a className="btn btn-outline" href={href(lang, "/")}>
              {ui.home[lang]}
            </a>
          </div>
        </div>
      </header>
    </main>
  );
}
