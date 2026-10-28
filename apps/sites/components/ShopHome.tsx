import business from "@business";
import type { CSSProperties } from "react";
import type { Lang } from "../lib/business.ts";
import { fill, href, linkProps } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { catalogue, offers, site } from "../lib/source.ts";
import { Heading, Hero, Marquee, SampleChip } from "./Bits.tsx";
import { fromPrice, OfferCard, ProductCard } from "./Cards.tsx";
import { Chevron } from "./Icons.tsx";

export async function ShopHome({ lang }: { lang: Lang }) {
  const { profile, art } = business;
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  const [s, pieces, deals] = await Promise.all([site(), catalogue(), offers()]);
  const fresh = (profile.featured ?? []).map((id) => pieces.find((p) => p.id === id)).filter((p) => p !== undefined);
  return (
    <>
      <Hero lang={lang} />

      <section className="band" aria-labelledby="kinds">
        <div className="wrap">
          <div className="section-head">
            <Heading id="kinds">{c("kindsTitle")}</Heading>
          </div>
          <div className="kinds">
            {profile.categories.map((cat) => {
              const rows = pieces.filter((p) => p.category === cat.id);
              const low = rows.map(fromPrice).reduce((a, m) => (m.minor < a.minor ? m : a));
              const swatch = rows[0]?.variants[0]?.attrs.swatch ?? "";
              return (
                <a key={cat.id} className="card kind" href={`${href(lang, "/catalogue")}#${cat.id}`}>
                  <span className="art" style={{ "--c1": swatch, "--c2": art.trimFor(swatch) } as CSSProperties}>
                    <art.Product category={cat.id} />
                  </span>
                  <h3>{cat.label[lang]}</h3>
                  <p>{cat.blurb[lang]}</p>
                  <p className="meta">{fill(c("kindMeta"), { n: rows.length, price: formatMoney(low) })}</p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <Marquee items={profile.marquee.map((t) => t[lang])} />

      <section className="section" aria-labelledby="festive">
        <div className="wrap">
          <div className="section-head">
            <Heading id="festive" icon="diya">
              {c("offersTitle")}
            </Heading>
            <SampleChip lang={lang} show={s.sample} what="sampleOffers" />
          </div>
          <div className="offers">
            {deals.map((o) => (
              <OfferCard key={o.id} offer={o} lang={lang} />
            ))}
          </div>
        </div>
      </section>

      <section className="band scallop-bottom" aria-labelledby="new">
        <div className="wrap">
          <div className="section-head">
            <Heading id="new">{c("newTitle")}</Heading>
            <p>{c("newLine")}</p>
            <SampleChip lang={lang} show={s.sample} />
          </div>
          <div className="products products-3">
            {fresh.map((p) => (
              <ProductCard key={p.id} product={p} lang={lang} />
            ))}
          </div>
          <p className="section-foot">
            <a className="btn btn-primary" {...linkProps(profile.cta.primary, lang)}>
              {profile.cta.primary.label[lang]}
              <Chevron />
            </a>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="visit">
        <div className="wrap">
          <div className="card closer">
            <span className="icon">
              <art.Icon id="shop" />
            </span>
            <div>
              <h2 className="display" id="visit">
                {c("visitTitle")}
              </h2>
              <p>{c("visitBody")}</p>
            </div>
            <a className="btn btn-outline" {...linkProps(profile.cta.secondary, lang)}>
              {profile.cta.secondary.label[lang]}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
