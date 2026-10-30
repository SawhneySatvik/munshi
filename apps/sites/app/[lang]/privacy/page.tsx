import business from "@business";
import { Shell } from "../../../components/Shell.tsx";
import { browserApi, getSite } from "../../../lib/api.ts";
import { fill } from "../../../lib/i18n.ts";
import { langOf } from "../../../lib/page.ts";
import { privacy } from "../../../lib/privacy.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: privacy.title[await langOf(params)] };
}

export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile } = business;
  const site = await getSite();
  return (
    <Shell lang={lang} path="/privacy" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{privacy.title[lang]}</h1>
        <p className="muted">{fill(privacy.lead[lang], { v: site.noticeVersion })}</p>
      </header>
      <article className="section notice">
        {privacy.sections
          .filter((sec) => !sec.kinds || sec.kinds.includes(profile.kind))
          .map((sec) => (
            <section key={sec.title.en + (sec.kinds?.[0] ?? "")}>
              <h2>{sec.title[lang]}</h2>
              <p>{fill(sec.body[lang], { shop: site.name })}</p>
            </section>
          ))}
        <p className="fine">{privacy.foot[lang]}</p>
      </article>
    </Shell>
  );
}
