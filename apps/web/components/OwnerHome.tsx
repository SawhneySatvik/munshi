"use client";

import { fill } from "../lib/i18n";
import { keyRef } from "../lib/snapshot";
import { dayAndTime } from "../lib/time";
import type { OwnerHome as OwnerHomeData } from "../lib/types";
import { CannotVerify } from "./CannotVerify";
import { DraftCard } from "./DraftCard";
import { useLang } from "./LangProvider";
import { LedgerCard } from "./LedgerCard";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { VoiceButton } from "./VoiceButton";
import "./OwnerHome.css";

/** The owner's morning: the brief, the draft waiting for a decision, and where every number comes from. */
export function OwnerHome({ data }: { data: OwnerHomeData }) {
  const { lang, t } = useLang();
  const first = data.findings[0];
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={first ? keyRef(first) : null}>
      <main className="wrap home">
        <div className="col-a">
          <section className="shop" aria-labelledby="shop-h">
            <p className="kicker shop-kicker">{fill(t.briefKicker, { when: dayAndTime(data.briefAt, lang) })}</p>
            <h1 id="shop-h">
              {data.shop.name[lang]} <small>{t.synthetic}</small>
            </h1>
            <p className="shop-lede">
              {fill(t.lede, { name: data.owner.greeting[lang] })} <mark>{t.ledeMark}</mark>
            </p>
          </section>
          <section className="brief" aria-labelledby="brief-h">
            <h2 id="brief-h" className="brief-h">
              {t.briefHeading}
            </h2>
            <LedgerCard findings={data.findings} />
          </section>
          {data.unverified.map((u) => (
            <CannotVerify key={u.what.en}>{fill(t.unverifiedLine, { what: u.what[lang], reason: u.reason[lang] })}</CannotVerify>
          ))}
        </div>
        <div className="col-b">
          <DraftCard draft={data.draft} />
          <VoiceButton />
          <SourceDrawer />
        </div>
      </main>
      <footer className="foot">
        <p className="wrap foot-in">
          {fill(t.footer, { shop: data.shop.name[lang], supplier: data.draft.supplier.name[lang] })}
        </p>
      </footer>
    </SourcesProvider>
  );
}
