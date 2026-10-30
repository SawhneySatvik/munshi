import business from "@business";
import { notFound } from "next/navigation";
import { Menu } from "../../../components/Salon.tsx";
import { Shell } from "../../../components/Shell.tsx";
import { browserApi, getServices, getSite, has } from "../../../lib/api.ts";
import { copy, langOf } from "../../../lib/page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: copy("servicesTitle", await langOf(params)) };
}

export default async function Services({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  if (business.profile.kind !== "salon") notFound();
  const [site, services] = await Promise.all([getSite(), getServices()]);
  return (
    <Shell lang={lang} path="/services" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{copy("servicesTitle", lang)}</h1>
        <p className="muted">{copy("servicesLine", lang)}</p>
      </header>
      <section className="section">
        <Menu lang={lang} services={services} booking={has(site, "bookings") && site.bookingMode !== "none"} />
      </section>
    </Shell>
  );
}
