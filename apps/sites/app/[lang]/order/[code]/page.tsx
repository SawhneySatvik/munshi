import business from "@business";
import { notFound } from "next/navigation";
import { Shell } from "../../../../components/Shell.tsx";
import { browserApi, getOrderStatus, getSite } from "../../../../lib/api.ts";
import type { Lang, Text } from "../../../../lib/business.ts";
import { fill, href } from "../../../../lib/i18n.ts";
import { copy, langOf } from "../../../../lib/page.ts";

export const dynamic = "force-dynamic";

const REQUEST: Record<string, Text> = {
  received: { en: "Received: waiting for the shop to confirm", hi: "मिल गया: दुकान की पुष्टि का इंतज़ार" },
  confirmed: { en: "Confirmed by the shop", hi: "दुकान ने पक्का किया" },
  declined: { en: "The shop could not take this order", hi: "दुकान यह ऑर्डर नहीं ले सकी" },
  expired: { en: "Not answered in time: send it again or ask at the shop", hi: "समय पर जवाब नहीं: फिर भेजें या दुकान पर पूछें" },
};
const STEP: Record<string, Text> = {
  confirmed: { en: "Confirmed", hi: "पक्का" },
  packed: { en: "Packed", hi: "पैक" },
  cutting: { en: "Cutting", hi: "कटाई" },
  stitching: { en: "Stitching", hi: "सिलाई" },
  trial: { en: "Trial", hi: "ट्रायल" },
  ready: { en: "Ready", hi: "तैयार" },
  out_for_delivery: { en: "Out for delivery", hi: "डिलीवरी पर" },
  delivered: { en: "Delivered", hi: "पहुँचा" },
  cancelled: { en: "Cancelled", hi: "रद्द" },
  rescheduled: { en: "Rescheduled", hi: "नई तारीख़" },
};
const at = (when: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(when));

// The order code is the only credential: anyone holding it opens this page, so it shows no name, number or amount, only
// the steps and their times.
export default async function OrderStatusPage({ params }: { params: Promise<{ lang: string; code: string }> }) {
  const lang = await langOf(params);
  const { code } = await params;
  if (business.profile.kind !== "apparel" || !/^ORD-[A-Z0-9]{4,6}$/.test(code)) notFound();
  const [site, status] = await Promise.all([getSite(), getOrderStatus(code)]);
  if (!status) notFound();
  return (
    <Shell lang={lang} path={`/order/${code}`} site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{fill(copy("statusTitle", lang), { code: status.code })}</h1>
        <p className="status-request" data-request={status.request}>
          {REQUEST[status.request]?.[lang]}
        </p>
      </header>
      <section className="section">
        {status.steps.length ? (
          <ol className="steps">
            {status.steps.map((s) => (
              <li key={`${s.step}-${s.at}`} aria-current={s.step === status.current ? "step" : undefined}>
                <b>{STEP[s.step]?.[lang] ?? s.step}</b>
                <time dateTime={s.at}>{at(s.at, lang)}</time>
              </li>
            ))}
          </ol>
        ) : null}
        <a className="link" href={href(lang, "/catalogue")}>
          {copy("backToEdit", lang)} →
        </a>
      </section>
    </Shell>
  );
}
