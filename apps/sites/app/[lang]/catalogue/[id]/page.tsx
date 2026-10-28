import business from "@business";
import { notFound } from "next/navigation";
import { Heading } from "../../../../components/Bits.tsx";
import { ProductCard } from "../../../../components/Cards.tsx";
import { Shell } from "../../../../components/Chrome.tsx";
import { ArrowLeft } from "../../../../components/Icons.tsx";
import { ProductView } from "../../../../components/ProductView.tsx";
import { href, ui } from "../../../../lib/i18n.ts";
import { descOf, langOf, nameOf } from "../../../../lib/page.ts";
import { catalogue, offers, site } from "../../../../lib/source.ts";

type Params = Promise<{ lang: string; id: string }>;

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await catalogue()).map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Params }) {
  const lang = await langOf(params);
  const { id } = await params;
  const p = (await catalogue()).find((x) => x.id === id);
  return { title: p ? nameOf(p, lang) : undefined };
}

export default async function Piece({ params }: { params: Params }) {
  const lang = await langOf(params);
  const { id } = await params;
  const { profile, art } = business;
  if (profile.kind !== "apparel") notFound();
  const [s, pieces, deals] = await Promise.all([site(), catalogue(), offers()]);
  const p = pieces.find((x) => x.id === id);
  if (!p) notFound();
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  const kind = profile.categories.find((k) => k.id === p.category);
  const colours = [...new Map(p.variants.map((v) => [v.attrs.colour, v.attrs.swatch])).entries()].map(([name, swatch]) => ({ name, swatch, trim: art.trimFor(swatch) }));
  const sizes = [...new Set(p.variants.map((v) => v.attrs.size).filter((x) => x !== undefined))];
  const offer = deals.find((o) => o.appliesTo?.includes(p.category));
  const o = offer ? (lang === "hi" && offer.hi ? offer.hi : offer) : null;
  const more = [...pieces.filter((x) => x.category === p.category && x.id !== p.id), ...pieces.filter((x) => x.category !== p.category)].slice(0, 3);

  return (
    <Shell lang={lang} path={`/catalogue/${p.id}`}>
      <div className="wrap pdp-wrap">
        <a className="back" href={href(lang, "/catalogue")}>
          <ArrowLeft />
          {c("backToCatalogue")}
        </a>
        <ProductView
          art={<art.Product category={p.category} />}
          kind={kind?.label[lang] ?? ""}
          name={nameOf(p, lang)}
          description={descOf(p, lang)}
          fabric={lang === "hi" && p.hi?.fabric ? p.hi.fabric : p.fabric}
          colours={colours}
          sizes={sizes.length ? sizes : null}
          sizeNote={c(`sizeNote_${p.category}`)}
          variants={p.variants.map((v) => ({ colour: v.attrs.colour, size: v.attrs.size ?? null, minor: v.price.minor }))}
          offer={o ? { title: o.title, detail: o.detail, until: o.until } : null}
          whatsapp={profile.whatsapp}
          sample={s.sample}
          t={{
            colour: ui.colour[lang],
            size: ui.size[lang],
            fabric: ui.fabric[lang],
            inclGst: ui.inclGst[lang],
            samplePrices: ui.samplePrices[lang],
            sampleOffer: ui.sampleOffer[lang],
            standIn: ui.standIn[lang],
            ask: profile.headerCta.label[lang],
            askNote: c("askNote"),
            prefill: c("prefill"),
            prefillSize: c("prefillSize"),
            from: ui.from[lang],
          }}
        />
      </div>
      {more.length ? (
        <section className="band scallop-bottom" aria-labelledby="more">
          <div className="wrap">
            <div className="section-head">
              <Heading id="more" icon={p.category}>
                {c("moreTitle")}
              </Heading>
            </div>
            <div className="products">
              {more.map((m) => (
                <ProductCard key={m.id} product={m} lang={lang} />
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="section-tight" />
      )}
    </Shell>
  );
}
