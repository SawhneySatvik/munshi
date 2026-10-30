import business from "@business";
import { notFound } from "next/navigation";
import { Booking } from "../../../components/Booking.tsx";
import { Shell } from "../../../components/Shell.tsx";
import { browserApi, getServices, getSite, getStylists, has } from "../../../lib/api.ts";
import { copy, langOf } from "../../../lib/page.ts";
import { addDays, dayLabel, todayIn } from "../../../lib/time.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: copy("bookTitle", await langOf(params)) };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Book({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Search }) {
  const lang = await langOf(params);
  if (business.profile.kind !== "salon") notFound();
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const site = await getSite();
  const live = has(site, "bookings") && site.bookingMode === "slots";
  const [services, stylists] = live ? await Promise.all([getServices(), getStylists()]) : [[], []];
  const today = todayIn();
  const days = Array.from({ length: 7 }, (_, n) => ({ iso: addDays(today, n), label: dayLabel(addDays(today, n), lang) }));
  const shop = site.shops.find((s) => s.id === one("shop"))?.id ?? null;
  const service = services.find((s) => s.id === one("service"))?.id ?? null;
  return (
    <Shell lang={lang} path="/book" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{copy("bookTitle", lang)}</h1>
        <p className="muted">{copy(live ? "bookLine" : "bookingOff", lang)}</p>
      </header>
      {live ? (
        <section className="section" data-capability="bookings">
          <Booking
            lang={lang}
            shops={site.shops.map((s) => ({ id: s.id, name: s.name, area: s.area }))}
            services={services.map((s) => ({ id: s.id, name: s.name, category: s.category, duration: s.duration, price: s.price, shopIds: s.shopIds }))}
            stylists={stylists.map((s) => ({ id: s.id, shopId: s.shopId, displayName: s.displayName }))}
            days={days}
            versions={{ notice: site.noticeVersion, consent: site.consentVersion }}
            initial={{ shop, service }}
          />
        </section>
      ) : null}
    </Shell>
  );
}
