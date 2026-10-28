import business from "@business";
import { notFound } from "next/navigation";
import { Heading, Marquee, SampleChip } from "../../../components/Bits.tsx";
import { ServiceCard } from "../../../components/Cards.tsx";
import { ChipNav } from "../../../components/ChipNav.tsx";
import { Shell } from "../../../components/Chrome.tsx";
import { TrayBar, TrayProvider } from "../../../components/Tray.tsx";
import { href, ui } from "../../../lib/i18n.ts";
import { langOf, nameOf } from "../../../lib/page.ts";
import { services, site } from "../../../lib/source.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: business.profile.copy.servicesPageTitle?.[lang] };
}

export default async function Services({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile } = business;
  if (profile.kind !== "salon") notFound();
  const [s, menu] = await Promise.all([site(), services()]);
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";
  const tray = menu.map((m) => ({ id: m.id, name: nameOf(m, lang), minutes: m.duration.value, minor: m.price.minor, from: m.from ?? false }));
  return (
    <Shell lang={lang} path="/services">
      <TrayProvider known={menu.map((m) => m.id)}>
        <header className="page-head">
          <div className="wrap">
            <h1 className="page-title display">{c("servicesPageTitle")}</h1>
            <p>{c("servicesPageLine")}</p>
            <SampleChip lang={lang} show={s.sample} />
          </div>
        </header>
        <ChipNav label={c("servicesPageTitle")} items={profile.categories.map((cat) => ({ id: cat.id, label: cat.label[lang] }))} />
        <Marquee items={profile.marquee.map((t) => t[lang])} />
        <div className="wrap menu-body">
          {profile.categories.map((cat) => (
            <section key={cat.id} id={cat.id} className="menu-section" aria-labelledby={`${cat.id}-h`}>
              <Heading id={`${cat.id}-h`} icon={cat.id}>
                {cat.label[lang]}
              </Heading>
              <div className="grid grid-3">
                {menu
                  .filter((m) => m.category === cat.id)
                  .map((m) => (
                    <ServiceCard key={m.id} service={m} lang={lang} />
                  ))}
              </div>
            </section>
          ))}
        </div>
        <TrayBar
          services={tray}
          bookHref={href(lang, "/book")}
          labels={{
            add: ui.add[lang],
            remove: ui.remove[lang],
            count1: ui.count1[lang],
            countN: ui.countN[lang],
            request: ui.requestBooking[lang],
            full: ui.trayFull[lang],
            show: ui.trayShow[lang],
            hide: ui.trayHide[lang],
            from: ui.from[lang],
            lang,
          }}
        />
      </TrayProvider>
    </Shell>
  );
}
