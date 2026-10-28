"use client";

import Link from "next/link";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import "./StatusNotice.css";

/** The one look of the error, not-found and loading pages. Never shows error text: only a fixed, translated line. */
export function StatusNotice({ kind, onRetry }: { kind: "error" | "notFound" | "loading"; onRetry?: () => void }) {
  const { t } = useLang();
  if (kind === "loading") {
    return (
      <main className="wrap status" aria-busy="true">
        <p className="status-wait">{t.loadingPage}</p>
      </main>
    );
  }
  const error = kind === "error";
  return (
    <main className="wrap status">
      <section className="pending" aria-labelledby="status-h">
        <h1 id="status-h">{error ? t.errorTitle : t.notFoundTitle}</h1>
        <p className="status-body">{error ? t.errorBody : t.notFoundBody}</p>
        <div className="status-actions">
          {error && onRetry ? (
            <Button variant="primary" onClick={onRetry}>
              {t.tryAgain}
            </Button>
          ) : null}
          <Link className="press" href="/">
            {t.goHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
