"use client";

import type { CSSProperties } from "react";
import { BOOKS } from "../../lib/i18n-books";
import type { DayRow } from "../../lib/books";
import { resolveCell, resolveNumber } from "../../lib/snapshot";
import { calendarDate } from "../../lib/time";
import type { SourceRef } from "../../lib/types";
import { useLang } from "../LangProvider";
import { DRAWER_ID, useRing, useSources } from "../Sources";

/**
 * The week's takings as one column per day. Every bar is a total cell and a button to its row; its height is the cell's
 * share of the tallest day's cell (a drawing scale, never shown as a number). There is no value axis: its ticks would be
 * numbers with no cell. The tallest day and the day whose source is open carry their figure.
 */
export function DayChart({ days }: { days: DayRow[] }) {
  const { lang } = useLang();
  const b = BOOKS[lang];
  const { snapshots } = useSources();
  const minor = (ref: SourceRef) => {
    const c = resolveCell(snapshots, ref);
    return c?.t === "money" ? c.minor : null;
  };
  const tallest = Math.max(0, ...days.map((d) => minor(d.total) ?? 0));
  const peak = days.find((d) => tallest > 0 && minor(d.total) === tallest)?.day;
  return (
    <figure className="bk-chart">
      <figcaption className="bk-chart-cap">
        <span className="kicker">{b.chartTitle}</span> <span className="bk-chart-hint">{b.chartHint}</span>
      </figcaption>
      <ol className="bk-bars">
        {days.map((d) => (
          <li key={d.day}>
            <Bar sourceRef={d.total} share={tallest > 0 ? (minor(d.total) ?? 0) / tallest : 0} labelled={d.day === peak} day={d.day} />
            <time className="bk-bar-day" dateTime={d.day}>
              {calendarDate(d.day, lang)}
            </time>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Bar({ sourceRef, share, labelled, day }: { sourceRef: SourceRef; share: number; labelled: boolean; day: string }) {
  const { snapshots, open } = useSources();
  const { lang, t } = useLang();
  const ring = useRing(sourceRef);
  const value = resolveNumber(snapshots, sourceRef, lang);
  if (value === null) return null;
  const state = ring.on ? " is-on" : ring.desk ? " is-desk" : "";
  return (
    <button
      type="button"
      className={`pair bk-colbar${labelled ? " is-peak" : ""}${state}`}
      aria-controls={DRAWER_ID}
      onClick={(e) => open(sourceRef, e.currentTarget)}
    >
      <span className="pair-in bk-bar-in-col">
        <span className="vh">{calendarDate(day, lang)}: </span>
        <span className="amt bk-bar-val">{value}</span>
        <span className="vh">
          , {t.source}: {sourceRef.label[lang]}
        </span>
        <span className="bk-bar-fill" style={{ "--h": share } as CSSProperties} aria-hidden="true" />
      </span>
    </button>
  );
}
