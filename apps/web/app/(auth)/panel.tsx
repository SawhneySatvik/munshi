import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LANG_COOKIE, parseLang } from "../../lib/i18n";
import { AUTH_WORDS, type AuthWords } from "./words";
import "../../components/Ops.css";
import "../../components/SignIn.css";

// The sign-in screens' one frame, in today's components (the demo picker's sheet, the ops pages' fields and buttons):
// Surfaces restyles them later. Server-rendered forms that post to server actions; a failure comes back as one line.

/** The words of the request's language (the same cookie the rest of the app reads). */
export async function words(): Promise<AuthWords> {
  return AUTH_WORDS[parseLang((await cookies()).get(LANG_COOKIE)?.value)];
}

export function Panel({ id, title, lede, notice, children }: { id: string; title: string; lede: string; notice?: string | undefined; children: ReactNode }) {
  return (
    <main className="wrap sign-in">
      <section className="pending" aria-labelledby={id}>
        <h1 id={id}>{title}</h1>
        <p className="sign-in-lede">{lede}</p>
        {notice ? (
          <p className="field-note" role="alert">
            {notice}
          </p>
        ) : null}
        {children}
      </section>
    </main>
  );
}

export function Field({ label, ...input }: { label: string; name: string; type: string; autoComplete: string }) {
  return (
    <label className="field">
      <span className="kicker field-label">{label}</span>
      <input className="input" required {...input} />
    </label>
  );
}
