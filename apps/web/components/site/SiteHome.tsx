"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useLang } from "../LangProvider";
import { AskExample } from "./AskExample";
import { ImpactExample } from "./ImpactExample";
import { Ring } from "./Mark";
import { SITE_LINKS } from "./SiteNav";
import { type SiteWords, SITE_WORDS } from "./words";

// The office scene is the landing's alone: loaded as its own chunk, so How it works (in this module too) never carries it.
const LandingOffice = dynamic(() => import("../office/LandingOffice").then((m) => m.LandingOffice));

const RUNS: [keyof SiteWords, keyof SiteWords, string][] = [
  ["runCounter", "runCounterBody", "M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5Z M9 8.5h6 M9 12.5h6"],
  ["runStock", "runStockBody", "M3.5 8 12 4l8.5 4v8.5L12 20.5l-8.5-4Z M3.5 8 12 12l8.5-4 M12 12v8.5"],
  ["runBuying", "runBuyingBody", "M2.5 6.5h11v10h-11Z M13.5 10h4l3 3.2v3.3h-7"],
  ["runBooks", "runBooksBody", "M6 3.5h8.5l4 4v13H6Z M14.5 3.5v4h4 M9 12h6.5 M9 15.5h6.5"],
  ["runCredit", "runCreditBody", "M6 3.5h12.5v17H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z M8.5 3.5v17 M11.5 8.5h4.5"],
  ["runStaff", "runStaffBody", "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M5 20.5c.8-4 3.6-6 7-6s6.2 2 7 6"],
];

const AGENTS: [keyof SiteWords, keyof SiteWords][] = [
  ["agentExplain", "agentExplainBody"],
  ["agentLeaks", "agentLeaksBody"],
  ["agentFix", "agentFixBody"],
];

const SHOPS: [keyof SiteWords, keyof SiteWords, keyof SiteWords][] = [
  ["shopKirana", "shopKiranaQ", "shopKiranaA"],
  ["shopSalon", "shopSalonQ", "shopSalonA"],
  ["shopBoutique", "shopBoutiqueQ", "shopBoutiqueA"],
];

function Glyph({ d }: { d: string }) {
  return (
    <svg className="s-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {d.split(" M").map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
        <path key={i} d={i ? `M${p}` : p} />
      ))}
    </svg>
  );
}

/** The two calls to action every section ends on: the demo picker, and a sample shop of your own. */
export function Ctas({ w }: { w: SiteWords }) {
  return (
    <div className="s-ctas">
      <Link className="s-btn is-lg" href={SITE_LINKS.demo}>
        {w.tryDemo}
      </Link>
      <Link className="s-ghost is-lg" href={SITE_LINKS.signUp}>
        {w.makeShop}
      </Link>
    </div>
  );
}

/** The promise, set on a page of the ledger: the one guarantee and the rules that keep it. */
export function ThePromise({ w }: { w: SiteWords }) {
  return (
    <section className="s-paper" id="promise" aria-labelledby="promise-h">
      <div className="s-col">
        <h2 className="s-h2" id="promise-h">
          {w.promiseTitle}
        </h2>
        <div className="s-rules">
          <article className="s-rule">
            <h3>{w.ruleYesTitle}</h3>
            <p>{w.ruleYesBody}</p>
            <div className="s-mini">
              <span className="s-stamp is-ink">
                <span className="s-ringed">
                  {w.stampApproved}
                  <Ring />
                </span>
                <small>{w.stampBy}</small>
              </span>
            </div>
          </article>
          <article className="s-rule">
            <h3>{w.ruleSourceTitle}</h3>
            <p>{w.ruleSourceBody}</p>
            <div className="s-mini">
              <span className="s-chip">{w.tapSource}</span>
              <span className="s-cv">
                <b>{w.cannotVerify}</b> · {w.cannotWhy}
              </span>
            </div>
          </article>
          <article className="s-rule">
            <h3>{w.ruleLabelTitle}</h3>
            <p>{w.ruleLabelBody}</p>
            <div className="s-mini">
              <span className="s-sticker">{w.fence}</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

export function SiteHome() {
  const { lang } = useLang();
  const w = SITE_WORDS[lang];
  return (
    <>
      <section className="s-hero is-split" aria-labelledby="hero-h">
        <div className="s-hero-words">
          <h1 className="s-h1" id="hero-h">
            {w.heroTitle}
          </h1>
          {/* The other language's line, in Hindi only: English shows no Devanagari. */}
          {lang === "hi" && (
            <p className="s-alt" lang="en">
              {w.heroAlt}
            </p>
          )}
          <p className="s-hero-lede">{w.heroLede}</p>
          <Ctas w={w} />
          <p className="s-fence s-hero-fence">{w.fence}</p>
        </div>
        {/* A sample, labelled: its tray count is the example's, not a figure from anyone's books. */}
        <figure className="s-hero-office" data-example="">
          <LandingOffice lang={lang} />
          <figcaption className="s-hero-cap">{w.heroOffice}</figcaption>
        </figure>
      </section>

      <AskExample />

      <ImpactExample />

      <ThePromise w={w} />

      <section className="s-band" aria-labelledby="runs-h">
        <div className="s-col">
          <h2 className="s-h2" id="runs-h">
            {w.runsTitle}
          </h2>
          <ul className="s-runs">
            {RUNS.map(([t, b, d]) => (
              <li key={t}>
                <Glyph d={d} />
                <h3>{w[t]}</h3>
                <p>{w[b]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="s-band" aria-labelledby="agents-h">
        <div className="s-col">
          <h2 className="s-h2" id="agents-h">
            {w.agentsTitle}
          </h2>
          <ol className="s-agents">
            {AGENTS.map(([t, b]) => (
              <li key={t}>
                <h3>{w[t]}</h3>
                <p>{w[b]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="s-band" id="shops" aria-labelledby="shops-h">
        <div className="s-col">
          <h2 className="s-h2" id="shops-h">
            {w.shopsTitle}
          </h2>
          {/* The other language's line, in Hindi only: English shows no Devanagari. */}
          {lang === "hi" && (
            <p className="s-alt" lang="en">
              {w.shopsAlt}
            </p>
          )}
          <div className="s-shops">
            {SHOPS.map(([name, q, a]) => (
              <article key={name} className="s-shop">
                <p className="s-shop-q" lang="hi">
                  {w[q]}
                </p>
                <p className="s-shop-a">{w[a]}</p>
                <h3 className="s-shop-k">{w[name]}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="s-band s-cta" aria-labelledby="cta-h">
        <div className="s-col">
          <h2 className="s-h2" id="cta-h">
            {w.ctaTitle}
          </h2>
          <p className="s-lede">{w.ctaBody}</p>
          <Ctas w={w} />
        </div>
      </section>
    </>
  );
}

/** How it works: five steps from a record coming in to an approved change, each a thing a person can check. */
export function HowItWorks() {
  const { lang } = useLang();
  const w = SITE_WORDS[lang];
  const steps: [keyof SiteWords, keyof SiteWords][] = [
    ["howRecordTitle", "howRecordBody"],
    ["howReadTitle", "howReadBody"],
    ["howDraftTitle", "howDraftBody"],
    ["howTraceTitle", "howTraceBody"],
    ["howFenceTitle", "howFenceBody"],
  ];
  return (
    <>
      <section className="s-hero is-left" aria-labelledby="how-h">
        <p className="s-kicker">{w.howKicker}</p>
        <h1 className="s-h1" id="how-h">
          {w.howTitle}
        </h1>
        <p className="s-hero-lede">{w.howLede}</p>
      </section>
      <section className="s-band" aria-label={w.howKicker}>
        <div className="s-col">
          <ol className="s-steps">
            {steps.map(([t, b]) => (
              <li key={t}>
                <h2>{w[t]}</h2>
                <p>{w[b]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <ThePromise w={w} />
      <section className="s-band s-cta" aria-labelledby="how-cta-h">
        <div className="s-col">
          <h2 className="s-h2" id="how-cta-h">
            {w.ctaTitle}
          </h2>
          <p className="s-lede">{w.ctaBody}</p>
          <Ctas w={w} />
        </div>
      </section>
    </>
  );
}
