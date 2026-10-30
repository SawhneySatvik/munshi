import business from "@business";
import { notFound } from "next/navigation";
import { PackageCard } from "../../../components/Salon.tsx";
import { Shell } from "../../../components/Shell.tsx";
import { browserApi, getPackages, getSite, has } from "../../../lib/api.ts";
import { ui } from "../../../lib/i18n.ts";
import { categoryLabel, copy, langOf } from "../../../lib/page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: copy("packagesTitle", await langOf(params)) };
}

// The page exists only while the release has `packages` on.
export default async function Packages({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  if (business.profile.kind !== "salon") notFound();
  const site = await getSite();
  if (!has(site, "packages")) notFound();
  const plans = await getPackages();
  const groups = [
    { id: "package", rows: plans.filter((p) => p.kind === "sessions") },
    { id: "membership", rows: plans.filter((p) => p.kind === "value") },
  ].filter((g) => g.rows.length);
  return (
    <Shell lang={lang} path="/packages" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{copy("packagesTitle", lang)}</h1>
        <p className="muted">{copy("packagesLine", lang)}</p>
      </header>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.id} className="section" aria-labelledby={`${g.id}-h`}>
            <h2 id={`${g.id}-h`}>{categoryLabel(g.id, lang)}</h2>
            <div className="plan-grid">
              {g.rows.map((p) => (
                <PackageCard key={p.id} lang={lang} plan={p} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="section muted">{ui.noneYet[lang]}</p>
      )}
    </Shell>
  );
}
