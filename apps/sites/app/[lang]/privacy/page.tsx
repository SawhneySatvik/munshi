import business from "@business";
import { Shell } from "../../../components/Chrome.tsx";
import { fill } from "../../../lib/i18n.ts";
import { langOf } from "../../../lib/page.ts";
import { privacy } from "../../../lib/privacy.ts";
import { site } from "../../../lib/source.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: privacy.title[lang] };
}

export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile } = business;
  const s = await site();
  return (
    <Shell lang={lang} path="/privacy">
      <header className="page-head">
        <div className="wrap">
          <h1 className="page-title display">{privacy.title[lang]}</h1>
          <p>{fill(privacy.lead[lang], { v: s.privacyVersion })}</p>
        </div>
      </header>
      <div className="wrap notice-wrap">
        <article className="card notice">
          {privacy.sections
            .filter((sec) => !sec.kinds || sec.kinds.includes(profile.kind))
            .map((sec) => (
              <section key={sec.title.en + (sec.kinds?.[0] ?? "")}>
                <h2 className="display">{sec.title[lang]}</h2>
                <p>{fill(sec.body[lang], { shop: profile.fullName })}</p>
              </section>
            ))}
          <p className="muted fine">{privacy.foot[lang]}</p>
        </article>
      </div>
    </Shell>
  );
}
