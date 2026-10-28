import business from "@business";
import type { ReactNode } from "react";
import type { Lang } from "../lib/business.ts";
import { href, linkProps, ui } from "../lib/i18n.ts";
import { site } from "../lib/source.ts";
import { demo } from "../lib/variant.ts";
import { Cross, Lines } from "./Icons.tsx";

function Wordmark({ lang }: { lang: Lang }) {
  const { profile, art } = business;
  const name = profile.name[lang];
  return (
    <a className="wordmark" href={href(lang, "/")}>
      <span className="logo">
        <art.Logo />
      </span>
      <span>
        {name.lead} <span className="accent-word full">{name.accent}</span>
        <span className="accent-word short">{name.short}</span>
      </span>
    </a>
  );
}

function Ribbon({ lang }: { lang: Lang }) {
  if (!demo) return null;
  return (
    <div className="ribbon" role="note">
      <div className="wrap">
        <span className="ribbon-badge">{ui.ribbonBadge[lang]}</span>
        <span className="ribbon-short">{ui.ribbonShort[lang]}</span>
        <span className="ribbon-long">{ui.ribbonLong[lang]}</span>
      </div>
    </div>
  );
}

function Header({ lang, path }: { lang: Lang; path: string }) {
  const { profile } = business;
  const other: Lang = lang === "en" ? "hi" : "en";
  const current = (h: string) => (path === h || path.startsWith(`${h}/`) ? "page" : undefined);
  return (
    <header className="site-header">
      <div className="wrap">
        <Wordmark lang={lang} />
        <nav className="nav" aria-label={ui.menu[lang]}>
          {profile.nav.map((l) => (
            <a key={String(l.href)} {...linkProps(l, lang)} aria-current={typeof l.href === "string" ? current(l.href) : undefined}>
              {l.label[lang]}
            </a>
          ))}
        </nav>
        <a className="lang-switch" href={href(other, path)} lang={other} hrefLang={other} aria-label={ui.switchLabel[lang]}>
          {ui.switchTo[lang]}
        </a>
        <a className="btn btn-outline header-cta" {...linkProps(profile.headerCta, lang)}>
          {profile.headerCta.label[lang]}
        </a>
        <details className="menu">
          <summary aria-label={ui.menu[lang]}>
            <span className="icon-open">
              <Lines />
            </span>
            <span className="icon-close">
              <Cross />
            </span>
          </summary>
          <div className="menu-panel">
            <a href={href(lang, "/")}>{ui.home[lang]}</a>
            {profile.nav.map((l) => (
              <a key={String(l.href)} {...linkProps(l, lang)} aria-current={typeof l.href === "string" ? current(l.href) : undefined}>
                {l.label[lang]}
              </a>
            ))}
            <a className="btn btn-primary" {...linkProps(profile.headerCta, lang)}>
              {profile.headerCta.label[lang]}
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}

async function Footer({ lang }: { lang: Lang }) {
  const { profile } = business;
  const { sample } = await site();
  return (
    <footer className="site-footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <Wordmark lang={lang} />
          <p>{profile.copy.footerLine?.[lang]}</p>
        </div>
        <ul className="footer-links">
          {profile.nav.map((l) => (
            <li key={String(l.href)}>
              <a {...linkProps(l, lang)}>{l.label[lang]}</a>
            </li>
          ))}
          <li>
            <a {...linkProps(profile.headerCta, lang)}>{profile.headerCta.label[lang]}</a>
          </li>
        </ul>
      </div>
      <div className="wrap footer-base">
        <span>
          {ui.pricesFromBooks[lang]}
          {sample ? ` (${ui.sampleForNow[lang]})` : ""}
        </span>
        <a href={href(lang, "/privacy")}>{ui.privacy[lang]}</a>
        <span>{ui.builtWith[lang]}</span>
        {demo ? <span className="demo">{ui.demoFooter[lang]}</span> : null}
      </div>
    </footer>
  );
}

/** Every page: the ribbon (demo only), the header, the page, the footer. `path` has no language prefix. */
export function Shell({ lang, path, children }: { lang: Lang; path: string; children: ReactNode }) {
  return (
    <>
      <Ribbon lang={lang} />
      <Header lang={lang} path={path} />
      <main>{children}</main>
      <Footer lang={lang} />
    </>
  );
}
