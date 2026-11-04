"use client";

// /app/office: the morning brief, its figures the findings' own cells, each a <Figure> of a stored cell, under the
// office scene.
import type { ReactNode } from "react";
import { fill } from "../../lib/i18n";
import { APP, type AppDict, BRIEF_LINE } from "../../lib/i18n-app";
import { OPS } from "../../lib/i18n-ops";
import type { BriefLineRow, BriefPage } from "../../lib/server/office";
import type { SourceRef } from "../../lib/types";
import { FindingMoves } from "../FindingMoves";
import { useLang } from "../LangProvider";
import type { DoingKey } from "../office/doing";
import { OfficeScene } from "../office/OfficeScene";
import type { AgentId, AgentState, OfficeEvent } from "../office/types";
import { ReadAloud } from "../ReadAloud";
import { Figure } from "../shell/Figure";
import { Group, Name, Row, Screen, Tag, When } from "./Kit";
import { shopName } from "./OfficeParts";

const SEVERITY: Record<string, keyof AppDict> = { critical: "sevCritical", high: "sevHigh", medium: "sevMedium", low: "sevLow" };

/** A line's words with ⟦n⟧ (a narrated line) or {fig} (a fixed line) as the figure of its cell. */
export function Words({ text, refs, slot }: { text: string; refs: SourceRef[]; slot: RegExp }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const t of text.matchAll(slot)) {
    parts.push(text.slice(last, t.index));
    parts.push(<Figure key={t.index} cell={refs[(Number(t[1]) || 1) - 1] ?? null} read="slot" />);
    last = (t.index ?? 0) + t[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function BriefLine({ l }: { l: BriefLineRow }) {
  const { lang } = useLang();
  const a = APP[lang];
  const fixed = BRIEF_LINE[l.kind]?.[lang];
  const words = l.narrated ? (
    <Words text={l.text} refs={l.refs} slot={/⟦(\d+)⟧/g} />
  ) : fixed ? (
    <Words text={fixed} refs={l.refs} slot={/\{(fig)\}/g} />
  ) : (
    <Words text={l.text} refs={l.refs} slot={/⟦(\d+)⟧/g} />
  );
  return (
    <Row
      title={
        <>
          {fill(a.briefRank, { n: <Figure cell={l.rank} /> })} <Tag tone={l.severity === "critical" || l.severity === "high" ? "warn" : "ink"}>{a[SEVERITY[l.severity] ?? "sevLow"]}</Tag>
        </>
      }
      // Only a line in Munshi's own words says so; the group's note says the rest are in fixed words.
      sub={l.narrated ? a.briefNarrated : undefined}
    >
      <p className="app-line">{words}</p>
      <FindingMoves ids={[l.findingId]} why={l.why} fix={l.fix} quiet={l.quiet} offer={l.offer} paypal={l.paypal} />
    </Row>
  );
}

/** /app/office: each branch's latest morning brief, in the order brief.ranked's rank cells give. */
/** `desks` renders under the brief (the cast's cards and the run log); `states` is each cast member's state from its
 *  latest run (lib/cast.ts), idle when absent. */
export function BriefView({
  data,
  desks,
  surplus,
  states,
  doing,
  trayWaiting,
  events,
  kind,
}: {
  data: BriefPage;
  desks?: ReactNode;
  /** the surplus impact tally, before the desks */
  surplus?: ReactNode;
  states?: Partial<Record<AgentId, AgentState>>;
  doing?: Partial<Record<AgentId, DoingKey>>;
  trayWaiting?: boolean | undefined;
  events?: OfficeEvent[];
  /** the shop's kind, which picks the room the scene opens in */
  kind?: string | undefined;
}) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen frame={data} id="office-h" kicker={shopName(data.shop)} title={OPS[lang].navOffice} lede={a.officeLede} wide>
      <OfficeScene
        shop={data.shop}
        lang={lang}
        at={data.briefs[0]?.at ?? ""}
        briefWritten={data.briefs.length > 0}
        states={states}
        doing={doing}
        trayWaiting={trayWaiting}
        events={events}
        sample={false}
        briefId="brief-h"
        kind={kind}
      />
      <h2 id="brief-h" className="ops-h">
        {a.briefTitle}
      </h2>
      <p className="office-note">{a.briefLede}</p>
      {data.briefs.length === 0 && (
        <div className="l-card">
          <p className="l-row app-empty">{a.briefEmpty}</p>
        </div>
      )}
      {data.briefs.map((b) => (
        <Group
          key={b.id}
          id={`brief-${b.id.slice(-12)}`}
          title={
            <>
              <Name>{b.shop}</Name> · <When at={`${b.day}T00:00:00Z`} day />
            </>
          }
          note={
            <>
              {fill(a.briefWritten, { at: <When at={b.at} /> })} · {a.briefTemplateNote}
              {b.lines.length > 0 && <ReadAloud kind="brief" id={b.id} />}
            </>
          }
          empty={a.briefNothing}
        >
          {b.lines.map((l) => (
            <BriefLine key={l.findingId} l={l} />
          ))}
        </Group>
      ))}
      {surplus}
      {/* The cast's desks and the run log, after the brief they serve. */}
      {desks}
    </Screen>
  );
}
