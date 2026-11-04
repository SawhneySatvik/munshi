"use client";

// Under the office scene: a card per member of the AI staff (name, role, the model it answers with, its last seven
// days counted from rows, its latest run), then the run log, newest first, filtered by member, whose row opens the run's
// steps. Every count and timing is a <Figure> of a desks.* cell; labels and aliases are codes (<Name>), never figures.
import type { ReactNode } from "react";
import { fill } from "../../lib/i18n";
import { DESKS, OUTCOME, STEP, TRIGGER } from "../../lib/i18n-desks";
import type { CountKey, DesksData, RunLogRow } from "../../lib/server/desks";
import { dayAndTime } from "../../lib/time";
import { Group, Name, Row, Tabs, Tag, When } from "../app/Kit";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { castAgents } from "./OfficeScene";
import { modelName } from "./presets";
import type { AgentId } from "./types";

const COUNTS: CountKey[] = ["runs", "proposed", "approved", "rejected", "abstained", "failed"];

const href = (cast: AgentId | null, run?: string) => {
  const q = new URLSearchParams();
  if (cast) q.set("cast", cast);
  if (run) q.set("run", run);
  const s = q.toString();
  return `/app/office${s ? `?${s}` : ""}#${run ? `run-${run.slice(-12)}` : "runs-h"}`;
};

const tone = (outcome: string | null) => (outcome === null ? "warn" : outcome === "failed" || outcome === "budget" ? "warn" : outcome === "answered" || outcome === "proposed" ? "ok" : "ink");

// `after`: what the office shows under the run log (Keeper's desk).
export function Desks({ data, after }: { data: DesksData; after?: ReactNode }) {
  const { lang } = useLang();
  const t = DESKS[lang];
  const agents = castAgents(lang);
  const who = (id: AgentId) => agents.find((a) => a.id === id);
  const outcome = (o: string | null) => (o === null ? t.stillRunning : (OUTCOME[o]?.[lang] ?? o));
  return (
    <>
      <Group grid id="desks-h" title={t.desksTitle} note={t.desksNote}>
        {data.cards.map((card) => {
          const a = who(card.cast);
          return (
            <Row
              key={card.cast}
              title={
                <>
                  {a?.name ?? card.cast} <Tag>{a?.role ?? ""}</Tag>
                </>
              }
              sub={
                <>
                  {t.model}: {card.models.length ? <Name>{card.models.map(modelName).join(", ")}</Name> : t.noModel}
                </>
              }
            >
              <dl className="desk-counts">
                {COUNTS.map((k) => (
                  <div key={k}>
                    <dt>{t[k]}</dt>
                    <dd>
                      <Figure cell={card.counts[k]} />
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="l-sub">
                {card.latest ? (
                  <>
                    {t.latest}: <When at={card.latest.at} /> · {outcome(card.latest.outcome)} · {TRIGGER[card.latest.trigger]?.[lang] ?? card.latest.trigger} ·{" "}
                    <Name>{card.latest.desk}</Name>
                  </>
                ) : (
                  t.noRuns
                )}
              </p>
            </Row>
          );
        })}
      </Group>
      <Tabs
        label={t.filterLabel}
        items={[{ href: href(null), text: t.everyone, on: data.filter === null }, ...agents.map((a) => ({ href: href(a.id), text: a.name, on: data.filter === a.id }))]}
      />
      <Group
        id="runs-h"
        title={t.logTitle}
        note={data.capped ? t.logNoteCapped : t.logNote}
        empty={data.filter ? fill(t.logEmptyFor, { name: who(data.filter)?.name ?? data.filter }) : t.logEmpty}
      >
        {data.log.map((r) => (
          <LogRow key={r.id} r={r} data={data} />
        ))}
      </Group>
      {after}
    </>
  );
}

function LogRow({ r, data }: { r: RunLogRow; data: DesksData }) {
  const { lang } = useLang();
  const t = DESKS[lang];
  const name = castAgents(lang).find((a) => a.id === r.cast)?.name ?? r.cast;
  const open = data.open?.id === r.id ? data.open : null;
  return (
    <Row
        title={
          <>
            <span id={`run-${r.id.slice(-12)}`} className="desk-anchor">
              {name}
            </span>{" "}
            <Tag tone={tone(r.outcome)}>{r.outcome === null ? t.stillRunning : (OUTCOME[r.outcome]?.[lang] ?? r.outcome)}</Tag>
          </>
        }
        sub={
          <>
            <When at={r.at} /> · {TRIGGER[r.trigger]?.[lang] ?? r.trigger} · <Name>{r.desk}</Name>
          </>
        }
        amt={
          // Named by its member, its time and its run's short code, so each row's link is told apart (two runs can share a
          // minute); the open run's link is marked current.
          <a
            className="desk-open"
            href={open ? href(data.filter) : href(data.filter, r.id)}
            aria-label={(open ? t.closeStepsOf : t.stepsOf)
              .replace("{name}", name)
              .replace("{at}", dayAndTime(r.at, lang))
              .replace("{code}", r.id.slice(-6))}
            aria-current={open ? "true" : undefined}
          >
            {open ? t.closeSteps : t.openSteps}
          </a>
        }
      >
        {open && (
          <section aria-label={t.steps}>
            {open.steps.length === 0 ? (
              <p className="l-sub">{t.noSteps}</p>
            ) : (
              <ol className="desk-steps">
                {open.steps.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a trace's steps are in seq order and never reorder
                  <li key={i}>
                    <span className="desk-step-kind">{STEP[s.kind]?.[lang] ?? s.kind}</span>
                    {s.kind === "model" ? " · " : " "}
                    <Name>{s.kind === "model" ? s.label.split(":")[0] : s.label}</Name>
                    {s.alias && (
                      <>
                        {" · "}
                        <Name>{modelName(s.alias)}</Name>
                      </>
                    )}
                    {" · "}
                    {fill(t.ms, { n: <Figure cell={s.ms} /> })}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </Row>
  );
}
