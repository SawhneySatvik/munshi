import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LANG_COOKIE, parseLang } from "../../lib/i18n";
import { AUTH_WORDS, type AuthWords } from "./words";

// The sign-in screens' one frame, in the product site's look (components/site/site.css, loaded by the site frame these
// pages sit in). Server-rendered forms that post to server actions; a failure comes back as one line.

/** The words of the request's language (the same cookie the rest of the app reads). */
export async function words(): Promise<AuthWords> {
  return AUTH_WORDS[parseLang((await cookies()).get(LANG_COOKIE)?.value)];
}

export function Panel({
  id,
  title,
  lede,
  notice,
  kicker,
  wide,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  notice?: string | undefined;
  kicker?: string | undefined;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`s-screen${wide ? " is-wide" : ""}`} aria-labelledby={id}>
      {kicker ? <p className="s-kicker">{kicker}</p> : null}
      <h1 className="s-h1" id={id}>
        {title}
      </h1>
      <p className="s-screen-lede">{lede}</p>
      {notice ? (
        <p className="s-alert" role="alert">
          {notice}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, ...input }: { label: string; name: string; type: string; autoComplete: string }) {
  return (
    <label className="s-field">
      <span className="s-field-l">{label}</span>
      <input className="s-input" required {...input} />
    </label>
  );
}

/** The forms' submit: the site's coral pill. */
export function Submit({ children }: { children: ReactNode }) {
  return (
    <button type="submit" className="s-btn is-lg">
      {children}
    </button>
  );
}
