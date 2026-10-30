import business from "@business";
import { notFound } from "next/navigation";
import { Piece } from "../../../../components/Piece.tsx";
import { Shell } from "../../../../components/Shell.tsx";
import { ProductCard, productsOf } from "../../../../components/Shop.tsx";
import { browserApi, getCatalogue, getSite, has } from "../../../../lib/api.ts";
import { href } from "../../../../lib/i18n.ts";
import { categoryLabel, copy, langOf } from "../../../../lib/page.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ lang: string; id: string }>;

async function productFor(id: string) {
  const products = productsOf(await getCatalogue());
  return { products, product: products.find((p) => p.pieces.some((x) => x.id === id)) };
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  return { title: (await productFor(id)).product?.base };
}

export default async function ProductPage({ params }: { params: Params }) {
  const lang = await langOf(params);
  const { id } = await params;
  const { profile, art } = business;
  if (profile.kind !== "apparel") notFound();
  const site = await getSite();
  const { products, product } = await productFor(id);
  if (!product) notFound();
  const ordered = [...product.pieces].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0));
  const more = products.filter((p) => p.category === product.category && p.key !== product.key).slice(0, 3);
  return (
    <Shell lang={lang} path={`/catalogue/${id}`} site={site} api={browserApi()}>
      <div className="section product">
        <a className="back" href={href(lang, "/catalogue")}>
          ← {copy("backToEdit", lang)}
        </a>
        <div className="product-grid">
          <figure className="product-plate">
            <art.Plate kind={product.category ?? ""} />
            <figcaption>{copy("photoToCome", lang)}</figcaption>
          </figure>
          <div className="product-copy">
            <p className="eyebrow">{categoryLabel(product.category, lang)}</p>
            <h1>{product.base}</h1>
            <p className="credit">{profile.categories[product.category ?? ""]?.blurb[lang] ?? ""}</p>
            <Piece
              lang={lang}
              title={product.base}
              pieces={ordered}
              caps={{ holds: has(site, "holds"), orders: has(site, "orders") }}
              versions={{ notice: site.noticeVersion, consent: site.consentVersion }}
              swatches={profile.swatches ?? {}}
            />
            <p className="fine">{copy("sampleCatalogue", lang)}</p>
          </div>
        </div>
      </div>
      {more.length ? (
        <section className="section" aria-labelledby="more-h">
          <h2 id="more-h">{categoryLabel(product.category, lang)}</h2>
          <div className="look-grid">
            {more.map((p, i) => (
              <ProductCard key={p.key} lang={lang} product={p} tone={i + 1} />
            ))}
          </div>
        </section>
      ) : null}
    </Shell>
  );
}
