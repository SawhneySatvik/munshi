// Every page: the demo banner ("simulated means labelled"), the header, the page, the footer. The nav drops an entry
// whose capability the release has off; the footer shows each branch's hours as the API publishes them.
import business from "@business";
import type { Site } from "@munshi/sdk";
import type { ReactNode } from "react";
import { type BrowserApi, has } from "../lib/api.ts";
import type { Lang } from "../lib/business.ts";
import { href, ui } from "../lib/i18n.ts";
import { demo } from "../lib/variant.ts";
import { ApiProvider } from "./Api.tsx";
import { ModeToggle } from "./ModeToggle.tsx";

/** Labelled unless the site is live and the deploy says so: a build that forgets the flag still says it is a sample. */
export function Banner({ site, lang }: { site: Site; lang: Lang }) {
  if (!demo && site.label === null && site.dataClass === "live") return null;
  return (
    <div className="banner" role="note" data-banner="">
      <span className="banner-badge">{ui.bannerBadge[lang]}</span>
      <span className="banner-line">{ui.bannerLine[lang]}</span>
    </div>
  );
}

function Wordmark({ lang }: { lang: Lang }) {
  const { profile, art } = business;
  return (
    <a className="wordmark" href={href(lang, "/")} aria-label={`${profile.wordmark.en}, ${profile.wordmark.hi}`}>
      <span className="wordmark-mark" aria-hidden="true">
        <art.Mark />
      </span>
      <span className="wordmark-en">{profile.wordmark.en}</span>
      <span className="wordmark-hi" lang="hi">
        {profile.wordmark.hi}
      </span>
      <span className="wordmark-sub">{profile.wordmark.sub[lang]}</span>
    </a>
  );
}

export function Hours({ shop, lang }: { shop: Site["shops"][number]; lang: Lang }) {
  const names = ui.days[lang].split(",");
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const rows = [...shop.hours].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
  if (!rows.length) return null;
  // Consecutive days with the same hours share a line ("Mon–Sun 10:00–20:00").
  const runs: { from: string; to: string; text: string }[] = [];
  for (const h of rows) {
    const text = h.closed || !h.opens || !h.closes ? ui.closed[lang] : `${h.opens}–${h.closes}`;
    const last = runs.at(-1);
    if (last && last.text === text && order.indexOf(h.day) === order.indexOf(last.to) + 1) last.to = h.day;
    else runs.push({ from: h.day, to: h.day, text });
  }
  const name = (d: string) => names[order.indexOf(d)];
  return (
    <dl className="hours">
      {runs.map((r) => (
        <div key={r.from}>
          <dt>{r.from === r.to ? name(r.from) : `${name(r.from)}–${name(r.to)}`}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Shell({ lang, path, site, api, children }: { lang: Lang; path: string; site: Site; api: BrowserApi; children: ReactNode }) {
  const { profile } = business;
  const other: Lang = lang === "en" ? "hi" : "en";
  const nav = profile.nav.filter((l) => !l.cap || has(site, l.cap));
  const current = (h: string) => (path === h || (h !== "/" && path.startsWith(`${h}/`)) ? "page" : undefined);
  return (
    <ApiProvider api={api}>
      <Banner site={site} lang={lang} />
      <header className="top">
        <Wordmark lang={lang} />
        <nav className="nav" aria-label={ui.menu[lang]}>
          {nav.map((l) => (
            <a key={l.href} href={href(lang, l.href)} aria-current={current(l.href)} data-nav={l.href}>
              {l.label[lang]}
            </a>
          ))}
        </nav>
        <div className="tools">
          <a className="lang-switch" href={href(other, path)} lang={other} hrefLang={other} aria-label={ui.switchLabel[lang]}>
            {ui.switchTo[lang]}
          </a>
          {profile.modes ? <ModeToggle lang={lang} /> : null}
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="foot">
        <div className="foot-shops">
          {site.shops.map((s) => (
            <section key={s.id} className="foot-shop">
              <h2>{s.name}</h2>
              {s.area ? <p>{s.area}</p> : null}
              <Hours shop={s} lang={lang} />
            </section>
          ))}
        </div>
        <p className="foot-line">{ui.fromBooks[lang]}</p>
        <p className="foot-base">
          <span>{site.name}</span>
          <a href={href(lang, "/privacy")}>{ui.privacy[lang]}</a>
          <span>{ui.builtWith[lang]}</span>
        </p>
      </footer>
    </ApiProvider>
  );
}
