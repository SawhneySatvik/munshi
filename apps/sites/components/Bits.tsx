import business from "@business";
import type { ReactNode } from "react";
import type { Lang } from "../lib/business.ts";
import { linkProps, ui } from "../lib/i18n.ts";
import { Chevron, Star, Underline } from "./Icons.tsx";

export function Heading({ children, icon, id, level = 2 }: { children: ReactNode; icon?: string; id?: string; level?: 1 | 2 }) {
  const Tag = level === 1 ? "h1" : "h2";
  const { art } = business;
  return (
    <Tag className="heading display" id={id}>
      {icon ? (
        <span className="icon">
          <art.Icon id={icon} />
        </span>
      ) : null}
      <span>{children}</span>
      <Underline />
    </Tag>
  );
}

/** The coloured band of words. The list is doubled so the loop has no seam; the copy is hidden from screen readers. */
export function Marquee({ items }: { items: string[] }) {
  let words = items;
  while (words.length < 12) words = [...words, ...items];
  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {words.map((w, i) => (
        <li key={`${i}-${w}`}>
          <Star />
          {w}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="marquee">
      <div className="marquee-track">
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

export function Hero({ lang }: { lang: Lang }) {
  const { profile, art } = business;
  const name = profile.name[lang];
  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero-copy">
          <p className="pill">{profile.pill[lang]}</p>
          <h1 className="hero-name display">
            <span>{name.lead}</span>
            <span className="accent-word">{name.accent}</span>
            {profile.pending ? <span className="pending-tag">{profile.pending[lang]}</span> : null}
          </h1>
          <p className="hero-sub">{profile.sub[lang]}</p>
          <div className="hero-ctas">
            <a className="btn btn-primary" {...linkProps(profile.cta.primary, lang)}>
              {profile.cta.primary.label[lang]}
              <Chevron />
            </a>
            <a className="btn btn-outline" {...linkProps(profile.cta.secondary, lang)}>
              {profile.cta.secondary.label[lang]}
            </a>
          </div>
        </div>
        <div className="hero-art">
          <art.Hero />
        </div>
      </div>
    </section>
  );
}

export function SampleChip({ lang, show, what = "samplePrices" }: { lang: Lang; show: boolean; what?: "samplePrices" | "sampleOffers" }) {
  return show ? <span className="chip chip-sample">{ui[what][lang]}</span> : null;
}
