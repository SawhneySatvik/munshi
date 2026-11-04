"use client";

import Link from "next/link";
import { useLang } from "../LangProvider";
import { MuseCredit } from "../pwa/MuseCredit";
import { Mark } from "./Mark";
import { SITE_LINKS } from "./SiteNav";
import { SITE_WORDS } from "./words";

/** The site's foot: the links again, the name set large in Devanagari, and the plain statement of what is simulated. */
export function SiteFoot() {
  const { lang } = useLang();
  const w = SITE_WORDS[lang];
  return (
    <footer className="s-foot">
      <div className="s-col">
        <div className="s-foot-row">
          <Link className="s-mark" href="/" aria-label={w.home}>
            <Mark />
            <span lang="en">Munshi</span>
          </Link>
          <nav aria-label={w.navLabel}>
            <Link href={SITE_LINKS.demo}>{w.tryDemo}</Link>
            <Link href={SITE_LINKS.features}>{w.navFeatures}</Link>
            <Link href={SITE_LINKS.how}>{w.navHow}</Link>
            <Link href={SITE_LINKS.shops}>{w.navShops}</Link>
            <Link href={SITE_LINKS.developers}>{w.navDevelopers}</Link>
            <Link href={SITE_LINKS.logIn}>{w.navLogIn}</Link>
            <Link href={SITE_LINKS.signUp}>{w.navSignUp}</Link>
          </nav>
        </div>
        <p className="s-big" lang={lang} aria-hidden="true">
          {lang === "hi" ? "मुंशी" : "Munshi"}
        </p>
        <p className="s-fence">{w.fence}</p>
        <p className="s-small">
          {w.footNote} {w.footPrivacy}
        </p>
        <MuseCredit className="s-small" />
      </div>
    </footer>
  );
}
