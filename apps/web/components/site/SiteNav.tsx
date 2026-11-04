"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Lang } from "../../lib/types";
import { useLang } from "../LangProvider";
import { Mark } from "./Mark";
import { SITE_WORDS } from "./words";

export const SITE_LINKS = { features: "/features", how: "/how-it-works", shops: "/#shops", logIn: "/sign-in", signUp: "/sign-up", demo: "/demo", developers: "/developers" } as const;

/**
 * The site's floating pill: the wordmark, two links, the language, Log in and Sign up. It stays on top as the page
 * scrolls. Changing the language also re-renders the server's part of the page (the sign-in forms read the cookie).
 */
export function SiteNav() {
  const { lang, setLang } = useLang();
  const router = useRouter();
  const path = usePathname();
  const w = SITE_WORDS[lang];
  const choose = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    router.refresh();
  };
  return (
    <header className="s-top">
      <a className="s-skip" href="#s-main">
        {w.skip}
      </a>
      <div className="s-pill">
        <Link className="s-mark" href="/" aria-label={w.home}>
          <Mark />
          <span lang="en">Munshi</span>
        </Link>
        <nav className="s-links" aria-label={w.navLabel}>
          <Link href={SITE_LINKS.features} aria-current={path === SITE_LINKS.features ? "page" : undefined}>
            {w.navFeatures}
          </Link>
          <Link href={SITE_LINKS.how} aria-current={path === SITE_LINKS.how ? "page" : undefined}>
            {w.navHow}
          </Link>
          <Link href={SITE_LINKS.shops}>{w.navShops}</Link>
        </nav>
        <fieldset className="s-lang">
          <legend className="vh">{w.language}</legend>
          <input type="radio" name="site-lang" id="site-lang-en" checked={lang === "en"} onChange={() => choose("en")} />
          <label htmlFor="site-lang-en" lang="en">
            EN
          </label>
          <input type="radio" name="site-lang" id="site-lang-hi" checked={lang === "hi"} onChange={() => choose("hi")} />
          <label htmlFor="site-lang-hi" lang={lang === "en" ? "en" : "hi"}>
            {lang === "en" ? "HI" : "हिंदी"}
          </label>
        </fieldset>
        <div className="s-acts">
          <Link className="s-login" href={SITE_LINKS.logIn}>
            {w.navLogIn}
          </Link>
          <Link className="s-btn" href={SITE_LINKS.signUp}>
            {w.navSignUp}
          </Link>
        </div>
      </div>
    </header>
  );
}
