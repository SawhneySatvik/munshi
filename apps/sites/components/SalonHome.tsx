import business from "@business";
import type { Lang } from "../lib/business.ts";
import { fill, href, ui } from "../lib/i18n.ts";
import { formatMoney } from "../lib/money.ts";
import { offers, packages, services, site } from "../lib/source.ts";
import { Heading, Hero, Marquee, SampleChip } from "./Bits.tsx";
import { BranchCard, OfferCard, PlanTeaser } from "./Cards.tsx";
import { Chevron } from "./Icons.tsx";

export async function SalonHome({ lang }: { lang: Lang }) {
  const { profile, art } = business;
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  const [s, menu, plans, deals] = await Promise.all([site(), services(), packages(), offers()]);
  return (
    <>
      <Hero lang={lang} />

      <section className="band" aria-labelledby="branches">
        <div className="wrap">
          <div className="section-head">
            <Heading id="branches">{c("branchesTitle")}</Heading>
          </div>
          <div className="grid grid-2">
            {s.shops.map((shop) => (
              <BranchCard key={shop.id} shop={shop} lang={lang} open={s.intake === "open"} />
            ))}
          </div>
        </div>
      </section>

      <Marquee items={profile.marquee.map((t) => t[lang])} />

      <section className="section" aria-labelledby="what">
        <div className="wrap">
          <div className="section-head">
            <Heading id="what">{c("servicesTitle")}</Heading>
            <p>{c("servicesLine")}</p>
          </div>
          <div className="grid tiles">
            {profile.categories.map((cat) => {
              const rows = menu.filter((m) => m.category === cat.id);
              const low = Math.min(...rows.map((m) => m.price.minor));
              return (
                <a key={cat.id} className="card tile tile-compact" href={`${href(lang, "/services")}#${cat.id}`}>
                  <span className="badge">
                    <art.Icon id={cat.id} />
                  </span>
                  <h3>{cat.label[lang]}</h3>
                  <p>{cat.blurb[lang]}</p>
                  <p className="meta">
                    <strong>{fill(ui.from[lang], { price: formatMoney({ minor: low, currency: "INR", ref: null, source: null }) })}</strong>
                    <span>{fill(rows.length === 1 ? ui.count1[lang] : ui.countN[lang], { n: rows.length })}</span>
                  </p>
                </a>
              );
            })}
          </div>
          <p className="section-foot">
            <SampleChip lang={lang} show={s.sample} />
            <a className="btn btn-primary" href={href(lang, "/services")}>
              {profile.cta.secondary.label[lang]}
              <Chevron />
            </a>
          </p>
        </div>
      </section>

      <section className="band scallop-bottom" aria-labelledby="packs">
        <div className="wrap">
          <div className="section-head">
            <Heading id="packs" icon="packages">
              {c("packagesTitle")}
            </Heading>
            <p>{c("packagesLine")}</p>
            <SampleChip lang={lang} show={s.sample} />
          </div>
          <div className="grid grid-3">
            {plans.slice(0, 3).map((p) => (
              <PlanTeaser key={p.id} plan={p} lang={lang} />
            ))}
          </div>
          <p className="section-foot">
            <a className="btn btn-outline" href={href(lang, "/packages")}>
              {c("packagesCta")}
              <Chevron />
            </a>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="offers">
        <div className="wrap">
          <div className="section-head">
            <Heading id="offers">{c("offersTitle")}</Heading>
            <SampleChip lang={lang} show={s.sample} what="sampleOffers" />
          </div>
          <div className="offers">
            {deals.map((o) => (
              <OfferCard key={o.id} offer={o} lang={lang} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
