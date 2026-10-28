import business from "@business";
import { notFound } from "next/navigation";
import { Heading, SampleChip } from "../../../components/Bits.tsx";
import { PlanCard } from "../../../components/Cards.tsx";
import { Shell } from "../../../components/Chrome.tsx";
import { Chevron } from "../../../components/Icons.tsx";
import { fill, href, ui } from "../../../lib/i18n.ts";
import { langOf } from "../../../lib/page.ts";
import { packages, site } from "../../../lib/source.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: business.profile.copy.packagesTitle?.[lang] };
}

export default async function Packages({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile, art } = business;
  if (profile.kind !== "salon") notFound();
  const [s, plans] = await Promise.all([site(), packages()]);
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  const groups = [
    { id: "packs", title: c("packagesHeading"), icon: "packages", rows: plans.filter((p) => p.kind === "package") },
    { id: "memberships", title: c("membershipsHeading"), icon: "academy", rows: plans.filter((p) => p.kind === "membership") },
  ];
  return (
    <Shell lang={lang} path="/packages">
      <header className="page-head">
        <div className="wrap">
          <h1 className="page-title display">{c("packagesTitle")}</h1>
          <p>{c("packagesPageLine")}</p>
          <SampleChip lang={lang} show={s.sample} />
        </div>
      </header>
      {groups.map((g, i) => (
        <section key={g.id} className={i % 2 ? "section" : "band scallop-bottom"} aria-labelledby={g.id}>
          <div className="wrap">
            <div className="section-head">
              <Heading id={g.id} icon={g.icon}>
                {g.title}
              </Heading>
            </div>
            <div className="grid grid-3">
              {g.rows.map((p) => (
                <PlanCard key={p.id} plan={p} lang={lang} />
              ))}
            </div>
          </div>
        </section>
      ))}
      <section className="section section-tight">
        <div className="wrap">
          <div className="card closer">
            <span className="icon">
              <art.Icon id="chat" />
            </span>
            <div>
              <h2 className="display">{c("bookTitle")}</h2>
              <p>{fill(ui.confirmsOn[lang], { shop: c("shop") })}</p>
            </div>
            <a className="btn btn-primary" href={href(lang, "/book")}>
              {c("bookTitle")}
              <Chevron />
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
