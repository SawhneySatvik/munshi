import business from "@business";
import { notFound } from "next/navigation";
import { BookingForm, type BookingStrings } from "../../../components/BookingForm.tsx";
import { Shell } from "../../../components/Chrome.tsx";
import { ArrowLeft } from "../../../components/Icons.tsx";
import { fill, href, ui } from "../../../lib/i18n.ts";
import { langOf, nameOf } from "../../../lib/page.ts";
import { packages, services, site } from "../../../lib/source.ts";
import { addDays, dayLabel, todayIn } from "../../../lib/time.ts";
import { demo } from "../../../lib/variant.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: business.profile.copy.bookTitle?.[lang] };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Book({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Search }) {
  const lang = await langOf(params);
  const { profile } = business;
  if (profile.kind !== "salon") notFound();
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const [s, menu, plans] = await Promise.all([site(), services(), packages()]);
  const c = (k: string) => profile.copy[k]?.[lang] ?? "";

  const today = todayIn();
  const days = Array.from({ length: 7 }, (_, n) => {
    const iso = addDays(today, n);
    return { iso, label: n === 0 ? ui.today[lang] : n === 1 ? ui.tomorrow[lang] : dayLabel(iso, lang) };
  });
  const wanted = one("services");
  const ids = wanted === null ? null : wanted.split(",").filter((id) => menu.some((m) => m.id === id)).slice(0, 3);
  const plan = plans.find((p) => p.id === one("plan"));
  const branch = s.shops.find((b) => b.id === one("branch"))?.id ?? null;

  const keys = [
    "stepBranch", "stepWhen", "stepYou", "yourServices", "noServices", "chooseServices", "changeServices", "askingAbout", "day",
    "timeOfDay", "anotherDay", "pickDate", "morning", "afternoon", "evening", "yourName", "phone", "phoneHint", "note",
    "consentHint", "privacyLine", "privacy", "demoForm", "send", "sending", "errBranch", "errServices", "errDay", "errDate",
    "errTime", "errName", "errPhone", "errSummary", "sentTitle", "sentDemo", "sentRef", "backHome", "another", "remove", "from",
    "samplePrices",
  ] as const;
  const t = Object.fromEntries(keys.map((k) => [k, ui[k][lang]])) as BookingStrings;
  t.consent = fill(ui.consent[lang], { shop: c("shop") });
  t.confirmsOn = fill(ui.confirmsOn[lang], { shop: c("shop") });

  return (
    <Shell lang={lang} path="/book">
      <header className="page-head">
        <div className="wrap">
          <a className="back" href={href(lang, "/services")}>
            <ArrowLeft />
            {profile.nav[0]?.label[lang]}
          </a>
          <h1 className="page-title display">{c("bookTitle")}</h1>
          <p>{c("bookLine")}</p>
        </div>
      </header>
      <div className="wrap book-wrap">
        <BookingForm
          lang={lang}
          t={t}
          shops={s.shops.map((b) => ({ id: b.id, name: lang === "hi" && b.hi ? b.hi.name : b.name, area: lang === "hi" && b.hi ? b.hi.area : b.area }))}
          services={menu.map((m) => ({ id: m.id, name: nameOf(m, lang), minutes: m.duration.value, minor: m.price.minor, from: m.from ?? false }))}
          days={days}
          minDate={today}
          maxDate={addDays(today, 60)}
          initial={{ branch, ids, plan: plan ? { id: plan.id, name: nameOf(plan, lang) } : null }}
          versions={{ consent: s.consentVersion, notice: s.privacyVersion }}
          links={{ home: href(lang, "/"), services: href(lang, "/services"), privacy: href(lang, "/privacy") }}
          demo={demo}
          sample={s.sample}
        />
      </div>
    </Shell>
  );
}
