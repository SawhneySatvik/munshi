// The apparel shop's sections (the A+C blend: A's masthead and contents, C's chapters joined by a drawn thread, the
// piece, the note from the shop, the visit). Every price is an API cell with its source; the copy is the profile's.
import business from "@business";
import type { CatalogueItem, MoneyFigure, Offer, Site } from "@munshi/sdk";
import type { Lang } from "../lib/business.ts";
import { fill, href, ui } from "../lib/i18n.ts";
import { categoryLabel, copy, splitName } from "../lib/page.ts";
import { Count, Money } from "./Figure.tsx";
import { Hours } from "./Shell.tsx";

export type Product = {
  key: string;
  base: string;
  category: string | null;
  pieces: { id: string; name: string; options: string[]; price: MoneyFigure; held: boolean }[];
};

const colourSet = () => new Set(Object.keys(business.profile.swatches ?? {}));

/** The catalogue's pieces as products: grouped by name before the colour, within a category, in the API's order. */
export function productsOf(items: CatalogueItem[]): Product[] {
  const colours = colourSet();
  const out = new Map<string, Product>();
  for (const item of items) {
    for (const v of item.variants) {
      const { base, options } = splitName(v.name, colours);
      const key = `${item.category ?? ""}·${base}`;
      const p = out.get(key) ?? { key, base, category: item.category, pieces: [] };
      p.pieces.push({ id: v.id, name: v.name, options, price: v.price, held: v.held });
      out.set(key, p);
    }
  }
  return [...out.values()];
}

/** The order of the kinds: the profile's chapters first, then any category it does not name. */
export function kindsOf(products: Product[]): string[] {
  const known = Object.keys(business.profile.categories);
  const seen = [...new Set(products.map((p) => p.category ?? "other"))];
  return seen.sort((a, b) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99));
}

/** The lowest published price among a product's pieces: one of its own cells, shown with that cell's ref. */
export const lowest = (p: Product): MoneyFigure | undefined => [...p.pieces].sort((a, b) => a.price.minor - b.price.minor)[0]?.price;

export function Masthead({ lang }: { lang: Lang }) {
  const { profile } = business;
  return (
    <section className="mast">
      <p className="mast-wm" aria-label={`${profile.wordmark.en}, ${profile.wordmark.hi}`}>
        <span className="mast-en">{profile.wordmark.en}</span>
        <span className="mast-hi" lang="hi">
          {profile.wordmark.hi}
        </span>
      </p>
      <p className="mast-line">
        <span>{copy("mastLine", lang)}</span>
        <span>{copy("mastWhere", lang)}</span>
      </p>
    </section>
  );
}

export function Opening({ lang }: { lang: Lang }) {
  const { art } = business;
  return (
    <section className="opening">
      <h1 className="opening-title">
        <span>{copy("heroLead", lang)}</span> <em>{copy("heroTurn", lang)}</em>
      </h1>
      <p className="opening-line">{copy("heroLine", lang)}</p>
      <div className="opening-cta">
        <a className="btn btn-primary" href={href(lang, "/catalogue")}>
          {copy("seeEdit", lang)}
        </a>
      </div>
      <figure className="pano">
        <art.Hero />
        <figcaption>{copy("photoToCome", lang)}</figcaption>
      </figure>
    </section>
  );
}

/** C's chapters, one per kind, strung on one drawn thread with a knot at each; A's "in this edit" as their contents. */
export function Chapters({ lang, products }: { lang: Lang; products: Product[] }) {
  const { art, profile } = business;
  const kinds = kindsOf(products);
  return (
    <section className="chapters" aria-labelledby="contents-h">
      <h2 id="contents-h" className="contents-h">
        {copy("contents", lang)}
      </h2>
      <ol className="contents">
        {kinds.map((k, i) => (
          <li key={k}>
            <a href={href(lang, `/catalogue#${k}`)}>
              <span className="contents-n">{String(i + 1).padStart(2, "0")}</span>
              <span>{categoryLabel(k, lang)}</span>
            </a>
          </li>
        ))}
      </ol>
      <div className="thread-wrap">
        <svg className="thread" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
          <path pathLength={1} d="M50 0C10 120 90 230 50 330S10 560 50 660 90 880 50 1000" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {kinds.map((k, i) => {
          const first = products.find((p) => (p.category ?? "other") === k);
          const from = first ? lowest(first) : undefined;
          return (
            <article key={k} className="chapter" style={{ "--k": i } as React.CSSProperties}>
              <span className="knot" aria-hidden="true" />
              <div className="chapter-plate">
                <art.Plate kind={k} tone={i} />
              </div>
              <div className="chapter-copy">
                <p className="eyebrow">{fill(copy("chapter", lang), { n: i + 1 })}</p>
                <h3>{categoryLabel(k, lang)}</h3>
                <p>{profile.categories[k]?.blurb[lang] ?? ""}</p>
                {first && from ? (
                  <p className="credit">
                    {first.base} · {copy("fromPrice", lang)} <Money fig={from} lang={lang} what={first.base} />
                  </p>
                ) : null}
                <a className="link" href={href(lang, `/catalogue#${k}`)}>
                  {categoryLabel(k, lang)} →
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ProductCard({ lang, product, tone = 0 }: { lang: Lang; product: Product; tone?: number }) {
  const { art } = business;
  const from = lowest(product);
  const colours = [...new Set(product.pieces.map((p) => p.options[0]).filter(Boolean))];
  const first = product.pieces[0];
  if (!first) return null;
  return (
    <article className="look" data-product={product.key}>
      <a href={href(lang, `/catalogue/${first.id}`)} className="look-link">
        <div className="look-plate">
          <art.Plate kind={product.category ?? ""} tone={tone} />
          <span className="photo-tag">{copy("photoToCome", lang)}</span>
        </div>
        <h3>{product.base}</h3>
      </a>
      <p className="credit">
        {categoryLabel(product.category, lang)}
        {colours.length ? ` · ${colours.join(", ")}` : ""}
      </p>
      {from ? (
        <p className="look-price">
          {product.pieces.length > 1 ? `${copy("fromPrice", lang)} ` : ""}
          <Money fig={from} lang={lang} what={product.base} />
        </p>
      ) : null}
    </article>
  );
}

/** C's paper note: the shop's published offer, its code as published. */
export function Note({ lang, offer }: { lang: Lang; offer: Offer }) {
  const until = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long" }).format(new Date(offer.endsAt));
  return (
    <aside className="note-wrap" data-offer={offer.id}>
      <div className="paper">
        <p className="eyebrow">{copy("noteFrom", lang)}</p>
        <p className="paper-big">
          {offer.name}:{" "}
          {offer.kind === "percent_off" ? (
            <Count fig={offer.percentBp} lang={lang} phrase={ui.percentOff[lang]} what={offer.name} scale={100} />
          ) : (
            <Money fig={offer.amountOff} lang={lang} what={offer.name} />
          )}
          {offer.category ? ` · ${categoryLabel(offer.category, lang)}` : ""}
        </p>
        {offer.code ? (
          <p className="paper-code">
            {ui.code[lang]} <b>{offer.code}</b>
          </p>
        ) : null}
        <p className="fine">
          {fill(ui.until[lang], { when: until })} · {ui.offerAtShop[lang]}
        </p>
      </div>
    </aside>
  );
}

export function Visit({ lang, site }: { lang: Lang; site: Site }) {
  return (
    <section className="visit" aria-labelledby="visit-h">
      <h2 id="visit-h">
        {copy("visitTitle", lang)} · <em>{site.shops[0]?.area ?? site.shops[0]?.name}</em>
      </h2>
      <p className="visit-line">{copy("visitLine", lang)}</p>
      <p>{copy("visitAddress", lang)}</p>
      {site.shops.map((s) => (
        <Hours key={s.id} shop={s} lang={lang} />
      ))}
    </section>
  );
}
