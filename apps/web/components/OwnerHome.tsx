"use client";

import { fill } from "../lib/i18n";
import { ROUTER } from "../lib/i18n-router";
import { keyRef } from "../lib/snapshot";
import { type DayPart, dayAndTime, dayPart } from "../lib/time";
import type { OwnerHome as OwnerHomeData } from "../lib/types";
import { CannotVerify } from "./CannotVerify";
import { DemoDay } from "./DemoDay";
import { DraftCard } from "./DraftCard";
import { useLang } from "./LangProvider";
import { LedgerCard } from "./LedgerCard";
import { MoreFindings } from "./MoreFindings";
import { PageHead } from "./PageHead";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { TrayCard } from "./TrayCard";
import { VoiceButton } from "./VoiceButton";
import "./OwnerHome.css";

// The brief opens on the three findings with the most rupees at stake (home.ts has ranked them); the rest wait behind "+N more".
export const TOP_FINDINGS = 3;

const ROLE = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" } as const;
// "Good evening" stands for the night too: English has no greeting for it.
const GREET = { morning: "greetMorning", afternoon: "greetAfternoon", evening: "greetEvening", night: "greetEvening" } as const satisfies Record<DayPart, string>;

/**
 * The owner's morning: the brief, the drafts waiting for a decision, and where every number comes from. Names read from
 * the books are marked data-name and times are <time>: outside a source chip, the only places a digit may appear.
 * `now` is the server's clock when it rendered the page, so the greeting is the same on the server and in the browser;
 * without it (the offline copy) the greeting names no part of the day.
 */
export function OwnerHome({ data, now }: { data: OwnerHomeData; now?: string }) {
  const { lang, t } = useLang();
  const first = data.findings[0];
  const firstName = data.member.name.split(" ")[0] ?? data.member.name;
  const shop = <span data-name="">{data.shop.name}</span>;
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={first ? keyRef(first) : null}>
      <main className="wrap home">
        <PageHead
          id="shop-h"
          kicker={
            <>
              {data.briefAt ? fill(t.briefKicker, { when: <time dateTime={data.briefAt}>{dayAndTime(data.briefAt, lang)}</time> }) : t.noBrief}{" "}
              <DemoDay day={data.demoDay} />
            </>
          }
          title={
            <>
              {shop} {data.shop.synthetic && <small>{t.synthetic}</small>}
            </>
          }
          lede={
            <>
              {fill(t.lede, { greeting: now ? t[GREET[dayPart(now)]] : t.greetAny, name: <span data-name="">{firstName}</span> })} <mark>{t.ledeMark}</mark>
            </>
          }
        />
        <div className="col-a">
          {/* The AI budget, from its stored state cell: most of it spent, or all of it. No figure here. */}
          {data.spendState ? (
            <p className="ops-error" role="status" data-spend-state={data.spendState}>
              {ROUTER[lang][data.spendState]}
            </p>
          ) : null}
          <section className="brief" aria-labelledby="brief-h">
            <h2 id="brief-h" className="brief-h">
              {t.briefHeading}
            </h2>
            <LedgerCard findings={data.findings.slice(0, TOP_FINDINGS)} />
          </section>
        </div>
        <div className="col-b">
          {data.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
          {data.tray?.map((d) => (
            <TrayCard key={d.id} draft={d} />
          ))}
          <VoiceButton />
          <SourceDrawer />
        </div>
        {/* After the approval card in the page, so on a phone the decision stays above the fold; the rows open under it. */}
        <MoreFindings findings={data.findings.slice(TOP_FINDINGS)} first={TOP_FINDINGS + 1} />
        {data.unverified.map((u) => (
          <CannotVerify key={u.what.en}>{fill(t.unverifiedLine, { what: u.what[lang], reason: u.reason[lang] })}</CannotVerify>
        ))}
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
