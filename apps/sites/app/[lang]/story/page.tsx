import business from "@business";
import { Heading } from "../../../components/Bits.tsx";
import { Shell } from "../../../components/Chrome.tsx";
import { Chevron } from "../../../components/Icons.tsx";
import { linkProps, ui } from "../../../lib/i18n.ts";
import { langOf } from "../../../lib/page.ts";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return { title: business.profile.story.pill[lang] };
}

export default async function Story({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const { profile, art } = business;
  const { story } = profile;
  const title = story.title[lang];
  return (
    <Shell lang={lang} path="/story">
      <section className="hero">
        <div className="wrap">
          <div className="hero-copy">
            <p className="pill">{profile.pill[lang]}</p>
            <h1 className="story-title display">
              {title.lead} <span className="accent-word">{title.accent}</span>
            </h1>
            {story.body.map((p) => (
              <p key={p.en} className="story-body">
                {p[lang]}
              </p>
            ))}
            <div className="hero-ctas">
              <a className="btn btn-primary" {...linkProps(profile.cta.primary, lang)}>
                {profile.cta.primary.label[lang]}
                <Chevron />
              </a>
            </div>
          </div>
          <div className="hero-art">
            <art.Story />
          </div>
        </div>
      </section>

      <section className="band scallop-bottom" aria-labelledby="expect">
        <div className="wrap">
          <div className="section-head">
            <Heading id="expect">{ui.whatToExpect[lang]}</Heading>
          </div>
          <div className="grid grid-3">
            {story.promises.map((p) => (
              <article key={p.icon} className="card promise">
                <span className="badge">
                  <art.Icon id={p.icon} />
                </span>
                <h3 className="display">{p.title[lang]}</h3>
                <p>{p.body[lang]}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="close">
        <div className="wrap">
          <div className="card closer">
            <span className="icon">
              <art.Icon id={story.close.icon} />
            </span>
            <div>
              <h2 className="display" id="close">
                {story.close.title[lang]}
              </h2>
              <p>{story.close.body[lang]}</p>
            </div>
            <a className="btn btn-outline" {...linkProps(story.close.cta, lang)}>
              {story.close.cta.label[lang]}
            </a>
          </div>
        </div>
      </section>
    </Shell>
  );
}
