import business from "@business";
import { Branches, Hero, Menu, OfferCard, PackageCard, Stylists } from "../../components/Salon.tsx";
import { Shell } from "../../components/Shell.tsx";
import { Chapters, Masthead, Note, Opening, ProductCard, productsOf, Visit } from "../../components/Shop.tsx";
import { browserApi, getCatalogue, getOffers, getPackages, getServices, getSite, getStylists, has } from "../../lib/api.ts";
import { href } from "../../lib/i18n.ts";
import { copy, langOf } from "../../lib/page.ts";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const site = await getSite();
  const api = browserApi();
  if (business.profile.kind === "salon") {
    const booking = has(site, "bookings") && site.bookingMode !== "none";
    const [services, stylists, plans, offers] = await Promise.all([
      getServices(),
      getStylists(),
      has(site, "packages") ? getPackages() : [],
      has(site, "offers") ? getOffers() : [],
    ]);
    return (
      <Shell lang={lang} path="/" site={site} api={api}>
        <Hero lang={lang} site={site} booking={booking} />
        <Branches lang={lang} site={site} booking={booking} />
        <section className="section" aria-labelledby="services-h">
          <h2 id="services-h">{copy("servicesTitle", lang)}</h2>
          <p className="muted">{copy("servicesLine", lang)}</p>
          <Menu lang={lang} services={services} booking={booking} limit={4} />
          <a className="link" href={href(lang, "/services")}>
            {copy("seeServices", lang)} →
          </a>
        </section>
        <Stylists lang={lang} stylists={stylists} site={site} />
        {plans.length ? (
          <section className="section" aria-labelledby="plans-h" data-capability="packages">
            <h2 id="plans-h">{copy("packagesTitle", lang)}</h2>
            <div className="plan-grid">
              {plans.slice(0, 3).map((p) => (
                <PackageCard key={p.id} lang={lang} plan={p} />
              ))}
            </div>
            <a className="link" href={href(lang, "/packages")}>
              {copy("packagesTitle", lang)} →
            </a>
          </section>
        ) : null}
        {offers.length ? (
          <section className="section" aria-labelledby="offers-h" data-capability="offers">
            <h2 id="offers-h">{copy("offersTitle", lang)}</h2>
            <div className="offer-grid">
              {offers.map((o) => (
                <OfferCard key={o.id} lang={lang} offer={o} />
              ))}
            </div>
          </section>
        ) : null}
      </Shell>
    );
  }
  const [items, offers] = await Promise.all([getCatalogue(), has(site, "offers") ? getOffers() : []]);
  const products = productsOf(items);
  const featured = products.filter((p) => p.pieces.some((x) => !x.held)).slice(0, 3);
  return (
    <Shell lang={lang} path="/" site={site} api={api}>
      <Masthead lang={lang} />
      <Opening lang={lang} />
      <Chapters lang={lang} products={products} />
      {featured.length ? (
        <section className="section asks-intro" aria-labelledby="hold-h">
          <h2 id="hold-h">{copy(has(site, "holds") ? "holdTitle" : "catalogueTitle", lang)}</h2>
          {has(site, "holds") ? (
            <p className="muted" data-capability="holds">
              {copy("holdLine", lang)}
            </p>
          ) : null}
          {has(site, "orders") ? (
            <p className="muted" data-capability="orders">
              {copy("orderLine", lang)}
            </p>
          ) : null}
          <div className="look-grid">
            {featured.map((p, i) => (
              <ProductCard key={p.key} lang={lang} product={p} tone={i} />
            ))}
          </div>
        </section>
      ) : null}
      {offers[0] ? <Note lang={lang} offer={offers[0]} /> : null}
      <Visit lang={lang} site={site} />
      <p className="sample-line">{copy("sampleCatalogue", lang)}</p>
    </Shell>
  );
}
