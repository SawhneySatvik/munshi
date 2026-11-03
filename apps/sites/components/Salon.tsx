// The salon's sections (hero, branches, a services menu with dotted leaders, stylists, packages,
// offers). Every figure is an API cell rendered through Figure.tsx; the copy is the profile's.
import business from "@business";
import type { Offer, PackagePlan, Service, Site, Stylist } from "@munshi/sdk";
import type { Lang } from "../lib/business.ts";
import { fill, href, ui } from "../lib/i18n.ts";
import { categoryLabel, copy } from "../lib/page.ts";
import { Count, Minutes, Money } from "./Figure.tsx";
import { Hours } from "./Shell.tsx";

export function Hero({ lang, site, booking }: { lang: Lang; site: Site; booking: boolean }) {
  const { art } = business;
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1 className="hero-title">
          <span>{copy("heroLead", lang)}</span>
          <em>{copy("heroTurn", lang)}</em>
        </h1>
        <p className="hero-line">{copy("heroLine", lang)}</p>
        <div className="hero-cta">
          {booking ? (
            <a className="btn btn-primary" href={href(lang, "/book")}>
              {copy("book", lang)}
            </a>
          ) : null}
          <a className="btn btn-ghost" href={href(lang, "/services")}>
            {copy("seeServices", lang)}
          </a>
        </div>
        <p className="hero-where">{site.shops.map((s) => s.name).join(" · ")}</p>
      </div>
      <div className="hero-art">
        <art.Hero />
      </div>
    </section>
  );
}

export function Branches({ lang, site, booking }: { lang: Lang; site: Site; booking: boolean }) {
  return (
    <section className="section branches" aria-labelledby="branches-h">
      <h2 id="branches-h">{copy("branchesTitle", lang)}</h2>
      <div className="branch-grid">
        {site.shops.map((s) => (
          <article key={s.id} className="card branch">
            <h3>{s.name}</h3>
            {s.area ? <p className="muted">{s.area}</p> : null}
            <ul className="status-chips">
              <li data-intake={site.intake}>
                <i aria-hidden="true" />
                {copy(site.intake === "open" ? "taking" : "paused", lang)}
              </li>
            </ul>
            <Hours shop={s} lang={lang} />
            {booking ? (
              <a className="link" href={href(lang, `/book?shop=${s.id}`)}>
                {fill(copy("bookAt", lang), { branch: s.name })} →
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

/** Services grouped by the API's category, in the profile's order, then any category the profile does not name. */
export function groupServices(services: Service[]): [string, Service[]][] {
  const known = Object.keys(business.profile.categories);
  const groups = new Map<string, Service[]>();
  for (const s of services) {
    const k = s.category ?? "other";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.entries()].sort(([a], [b]) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99));
}

export function ServiceRows({ lang, services, booking }: { lang: Lang; services: Service[]; booking: boolean }) {
  return (
    <ol className="service-list">
      {services.map((s) => (
        <li key={s.id} data-service={s.id}>
          <span className="service-name">
            {booking ? <a href={href(lang, `/book?service=${s.id}`)}>{s.name}</a> : s.name}
          </span>
          <i className="leader" aria-hidden="true" />
          <span className="service-time">
            <Minutes fig={s.duration} lang={lang} what={s.name} />
          </span>
          <span className="service-price">
            <Money fig={s.price} lang={lang} what={s.name} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Menu({ lang, services, booking, limit }: { lang: Lang; services: Service[]; booking: boolean; limit?: number }) {
  const groups = groupServices(services);
  if (!groups.length) return <p className="muted">{ui.noneYet[lang]}</p>;
  return (
    <div className="menu">
      <nav className="tabs" aria-label={copy("servicesTitle", lang)}>
        {groups.map(([k]) => (
          <a key={k} href={`#${k}`}>
            {categoryLabel(k, lang)}
          </a>
        ))}
      </nav>
      {groups.map(([k, rows]) => (
        <section key={k} id={k} className="menu-group" aria-labelledby={`${k}-h`}>
          <h3 id={`${k}-h`}>{categoryLabel(k, lang)}</h3>
          {business.profile.categories[k] ? <p className="muted">{business.profile.categories[k].blurb[lang]}</p> : null}
          <ServiceRows lang={lang} services={limit ? rows.slice(0, limit) : rows} booking={booking} />
        </section>
      ))}
      <p className="fine">{ui.inclGst[lang]}</p>
    </div>
  );
}

export function Stylists({ lang, stylists, site }: { lang: Lang; stylists: Stylist[]; site: Site }) {
  const { art } = business;
  if (!stylists.length) return null;
  const branch = (id: string) => site.shops.find((s) => s.id === id)?.name ?? "";
  return (
    <section className="section stylists" aria-labelledby="stylists-h">
      <h2 id="stylists-h">{copy("stylistsTitle", lang)}</h2>
      <p className="muted">{copy("stylistsLine", lang)}</p>
      <ul className="stylist-grid">
        {stylists.map((s) => (
          <li key={s.id} className="card stylist">
            {s.artUrl ? <img src={s.artUrl} alt="" width={120} height={150} /> : <art.Plate kind={s.displayName} />}
            <h3>{s.displayName}</h3>
            <p className="muted">{branch(s.shopId)}</p>
            {s.blurb ? <p>{s.blurb}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PackageCard({ lang, plan }: { lang: Lang; plan: PackagePlan }) {
  return (
    <article className="card plan" data-plan={plan.id}>
      <p className="eyebrow">{categoryLabel(plan.kind === "value" ? "membership" : "package", lang)}</p>
      <h3>{plan.name}</h3>
      {plan.lines.length ? (
        <ul className="plan-lines">
          {plan.lines.map((l) => (
            <li key={l.serviceId}>
              <span>{l.name}</span>
              <Count fig={l.sessions} lang={lang} phrase={ui.sessions[lang]} what={`${plan.name}: ${l.name}`} />
            </li>
          ))}
        </ul>
      ) : null}
      {plan.value ? (
        <p>
          <Money fig={plan.value} lang={lang} what={plan.name} />
        </p>
      ) : null}
      <p className="plan-foot">
        <Money fig={plan.price} lang={lang} what={plan.name} />
        <Count fig={plan.validityDays} lang={lang} phrase={ui.validDays[lang]} what={plan.name} />
      </p>
    </article>
  );
}

export function OfferCard({ lang, offer }: { lang: Lang; offer: Offer }) {
  const until = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long" }).format(new Date(offer.endsAt));
  return (
    <article className="offer" data-offer={offer.id}>
      <h3>{offer.name}</h3>
      <p className="offer-cut">
        {offer.kind === "percent_off" ? (
          <Count fig={offer.percentBp} lang={lang} phrase={ui.percentOff[lang]} what={offer.name} scale={100} />
        ) : (
          <>
            <Money fig={offer.amountOff} lang={lang} what={offer.name} /> {ui.amountOff[lang].replace("{amount}", "").trim()}
          </>
        )}
        {offer.minSpend ? (
          <span className="muted">
            {" "}
            · {ui.minSpend[lang].split("{amount}")[0]}
            <Money fig={offer.minSpend} lang={lang} what={offer.name} />
            {ui.minSpend[lang].split("{amount}")[1]}
          </span>
        ) : null}
      </p>
      {offer.code ? (
        <p className="offer-code">
          {ui.code[lang]} <b>{offer.code}</b>
        </p>
      ) : null}
      <p className="fine">
        {fill(ui.until[lang], { when: until })} · {ui.offerAtShop[lang]}
      </p>
    </article>
  );
}
