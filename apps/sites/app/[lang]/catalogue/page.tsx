import business from "@business";
import { notFound } from "next/navigation";
import { Shell } from "../../../components/Shell.tsx";
import { kindsOf, ProductCard, productsOf } from "../../../components/Shop.tsx";
import { browserApi, getCatalogue, getSite } from "../../../lib/api.ts";
import { href, ui } from "../../../lib/i18n.ts";
import { categoryLabel, copy, langOf } from "../../../lib/page.ts";
import { live } from "../../../lib/variant.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: copy("catalogueTitle", await langOf(params)) };
}

export default async function Catalogue({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile } = business;
  if (profile.kind !== "apparel") notFound();
  const [site, items] = await Promise.all([getSite(), getCatalogue()]);
  const products = productsOf(items);
  const kinds = kindsOf(products);
  return (
    <Shell lang={lang} path="/catalogue" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{copy("catalogueTitle", lang)}</h1>
        {live ? null : <p className="muted">{copy("sampleCatalogue", lang)}</p>}
        <nav className="contents contents-inline" aria-label={copy("contents", lang)}>
          {kinds.map((k, i) => (
            <a key={k} href={href(lang, `/catalogue#${k}`)}>
              <span className="contents-n">{String(i + 1).padStart(2, "0")}</span> {categoryLabel(k, lang)}
            </a>
          ))}
        </nav>
      </header>
      {kinds.length ? null : <p className="section muted">{ui.noneYet[lang]}</p>}
      {kinds.map((k) => (
        <section key={k} id={k} className="section kind" aria-labelledby={`${k}-h`}>
          <div className="kind-head">
            <h2 id={`${k}-h`}>{categoryLabel(k, lang)}</h2>
            <p className="muted">{profile.categories[k]?.blurb[lang] ?? ""}</p>
          </div>
          <div className="look-grid">
            {products
              .filter((p) => (p.category ?? "other") === k)
              .map((p, i) => (
                <ProductCard key={p.key} lang={lang} product={p} tone={i} />
              ))}
          </div>
        </section>
      ))}
    </Shell>
  );
}
