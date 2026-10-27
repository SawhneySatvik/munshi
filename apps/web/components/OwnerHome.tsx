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

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;

/**
 * The owner's morning: the brief, the drafts waiting for a decision, and where every number comes from. Names read from
 * the books are marked data-name and times are <time>: outside a source chip, the only places a digit may appear.
 */
export function OwnerHome({ data }: { data: OwnerHomeData }) {
  const { lang, t } = useLang();
  const first = data.findings[0];
  const firstName = data.member.name.split(" ")[0] ?? data.member.name;
  const shop = <span data-name="">{data.shop.name}</span>;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={first ? keyRef(first) : null}>
      <main className="wrap home">
        <div className="col-a">
          <section className="shop" aria-labelledby="shop-h">
            <p className="kicker shop-kicker">
              {data.briefAt
                ? fill(t.briefKicker, { when: <time dateTime={data.briefAt}>{dayAndTime(data.briefAt, lang)}</time> })
                : t.noBrief}
            </p>
            <h1 id="shop-h">
              {shop} {data.shop.synthetic && <small>{t.synthetic}</small>}
            </h1>
            <p className="shop-lede">
              {fill(t.lede, { name: <span data-name="">{firstName}</span> })} <mark>{t.ledeMark}</mark>
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
          {data.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
          <VoiceButton />
          <SourceDrawer />
        </div>
      </main>
      <footer className="foot">
        <div className="wrap foot-in">
          <p>{fill(t.footer, { shop })}</p>
          <p className="who">
            {fill(t.signedInAs, { name: <span data-name="">{data.member.name}</span>, role: t[ROLE[data.member.role]] })}{" "}
            <a className="switch" href="/sign-in">
              {t.switchPerson}
            </a>
          </p>
        </div>
      </footer>
    </SourcesProvider>
  );
}
