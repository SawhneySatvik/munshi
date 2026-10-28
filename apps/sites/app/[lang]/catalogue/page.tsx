import business from "@business";
import { notFound } from "next/navigation";
import { Heading, Marquee, SampleChip } from "../../../components/Bits.tsx";
import { ProductCard } from "../../../components/Cards.tsx";
import { ChipNav } from "../../../components/ChipNav.tsx";
import { Shell } from "../../../components/Chrome.tsx";
import { langOf } from "../../../lib/page.ts";
import { catalogue, site } from "../../../lib/source.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: business.profile.copy.catalogueTitle?.[lang] };
}

export default async function Catalogue({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile } = business;
  if (profile.kind !== "apparel") notFound();
  const [s, pieces] = await Promise.all([site(), catalogue()]);
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  return (
    <Shell lang={lang} path="/catalogue">
      <header className="page-head">
        <div className="wrap">
          <h1 className="page-title display">{c("catalogueTitle")}</h1>
          <p>{c("catalogueLine")}</p>
          <SampleChip lang={lang} show={s.sample} />
        </div>
      </header>
      <ChipNav label={c("catalogueTitle")} items={profile.categories.map((cat) => ({ id: cat.id, label: cat.label[lang] }))} />
      <Marquee items={profile.marquee.map((t) => t[lang])} />
      <div className="wrap catalogue-body">
        {profile.categories.map((cat) => (
          <section key={cat.id} id={cat.id} className="menu-section" aria-labelledby={`${cat.id}-h`}>
            <div className="section-head">
              <Heading id={`${cat.id}-h`} icon={cat.id}>
                {cat.label[lang]}
              </Heading>
              <p>{cat.blurb[lang]}</p>
            </div>
            <div className="products">
              {pieces
                .filter((p) => p.category === cat.id)
                .map((p) => (
                  <ProductCard key={p.id} product={p} lang={lang} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
