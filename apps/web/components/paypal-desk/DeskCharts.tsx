"use client";

import { type AgCartesianChartOptions, BarSeriesModule, CartesianChartModule, CategoryAxisModule, NumberAxisModule } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PAYPAL_DESK } from "../../lib/i18n-paypal-desk";
import { type DeskBucket, type DeskRow, type DeskState, DESK_STATES } from "../../lib/paypal-desk";
import { resolveCell, resolveNumber } from "../../lib/snapshot";
import { useLang } from "../LangProvider";
import { useSources } from "../Sources";
import type { DeskPick } from "./DeskGrid";

const MODULES = [CartesianChartModule, BarSeriesModule, CategoryAxisModule, NumberAxisModule];
const AGES: DeskBucket[] = ["not_due", "month", "two", "three", "older"];

// The chart is drawn on a canvas, which cannot read CSS: the tokens are read once from the page (a shop's look
// overrides the same custom properties, so the charts follow it).
const TOKENS = ["--ink", "--ink-muted", "--hairline", "--surface", "--font-text", "--ok", "--warn", "--accent", "--signal", "--danger"] as const;
type Token = (typeof TOKENS)[number];
type Ink = Record<Token, string>;

function useInk(): Ink | null {
  const [ink, setInk] = useState<Ink | null>(null);
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(t).trim()])) as Ink;
    // The font token is a chain of var()s a canvas cannot resolve: the body's computed face is the same one.
    read["--font-text"] = getComputedStyle(document.body).fontFamily;
    if (!read["--ink"]) return;
    // Drawn once the web font is in: labels measured in the fallback face would be clipped when the real one paints.
    let live = true;
    (document.fonts?.ready ?? Promise.resolve()).then(() => live && setInk(read));
    return () => {
      live = false;
    };
  }, []);
  return ink;
}

// Calm to urgent. A link paid on PayPal but not yet in the books is the one that needs a person.
const AGE_TONE: Record<DeskBucket, Token> = { clear: "--hairline", not_due: "--ok", month: "--warn", two: "--accent", three: "--signal", older: "--danger" };
const STATE_TONE: Record<DeskState, Token> = {
  none: "--ink-muted",
  draft: "--warn",
  live: "--accent",
  paid: "--signal",
  recorded: "--ok",
  cancelled: "--hairline",
  failed: "--danger",
};
const BAR = 40;

type Group<K extends string> = { key: K; label: string; rows: DeskRow[] };

/**
 * One stacked bar per group (an age bucket, or a PayPal state). Each piece of a bar is one customer's balance, plotted
 * from that very credit book cell; the bar has no total of its own and the value axis has no numbers, since no stored
 * cell holds a bucket's sum. A piece's tooltip shows its figure from the cell; tapping a bar picks its rows in the grid.
 */
function Stacked<K extends string>({
  title,
  groups,
  ink,
  tone,
  onPick,
}: {
  title: string;
  groups: Group<K>[];
  ink: Ink | null;
  tone: Record<K, string>;
  onPick: (key: K) => void;
}) {
  const { lang } = useLang();
  const { snapshots } = useSources();
  const picked = useRef(onPick);
  picked.current = onPick;
  const options = useMemo<AgCartesianChartOptions | null>(() => {
    if (!ink) return null;
    const pieces = groups.flatMap((g) =>
      g.rows.flatMap((r) => {
        const v = r.balance ? resolveCell(snapshots, r.balance) : undefined;
        const shown = r.balance ? resolveNumber(snapshots, r.balance, lang) : null;
        return v?.t === "money" && shown ? [{ group: g, row: r, minor: v.minor, shown }] : [];
      }),
    );
    const data = groups.map((g) => ({ key: g.key, label: g.label, ...Object.fromEntries(pieces.filter((p) => p.group.key === g.key).map((p) => [p.row.customer.id, p.minor])) }));
    return {
      data,
      height: Math.max(groups.length, 1) * BAR + 16,
      background: { visible: false },
      padding: { top: 4, right: 8, bottom: 4, left: 4 },
      legend: { enabled: false },
      // The chart's own keyboard layer would announce counts no cell holds ("17 series"): the pick buttons under it and
      // the grid are the accessible route to the same rows, so the drawing is hidden from assistive tech.
      keyboard: { enabled: false },
      animation: { enabled: false },
      series: pieces.map((p) => ({
        type: "bar" as const,
        direction: "horizontal" as const,
        xKey: "label",
        yKey: p.row.customer.id,
        yName: p.row.customer.name,
        stacked: true,
        fill: tone[p.group.key],
        stroke: ink["--surface"],
        strokeWidth: 1,
        cornerRadius: 3,
        tooltip: { renderer: () => ({ heading: p.group.label, title: p.row.customer.name, data: [{ label: PAYPAL_DESK[lang].colOwes, value: p.shown }] }) },
      })),
      axes: {
        x: { type: "category", position: "left", label: { color: ink["--ink"], fontFamily: ink["--font-text"], fontSize: 13, wrapping: "on-space", maxWidth: 120 }, line: { enabled: false } },
        y: { type: "number", position: "bottom", label: { enabled: false }, gridLine: { style: [{ stroke: ink["--hairline"], lineDash: [2, 4] }] } },
      },
      listeners: {
        seriesNodeClick: (e: { datum: unknown }) => picked.current((e.datum as { key: K }).key),
      },
    } as AgCartesianChartOptions;
  }, [groups, ink, lang, snapshots, tone]);
  return (
    <figure className="pd-chart">
      <figcaption className="kicker">{title}</figcaption>
      <div className="pd-canvas" aria-hidden="true" style={{ height: Math.max(groups.length, 1) * BAR + 16 }}>
        {options && <AgCharts options={options} modules={MODULES} style={{ width: "100%", height: "100%" }} />}
      </div>
      <div className="pd-picks">
        {groups.map((g) => (
          <button key={g.key} type="button" className="pd-pick" onClick={() => onPick(g.key)} disabled={!g.rows.length}>
            <span className="pd-dot" style={{ background: tone[g.key] }} aria-hidden="true" />
            {g.label}
          </button>
        ))}
      </div>
    </figure>
  );
}

/** The two charts above the grid: what is owed by how late, and by where its PayPal link stands. */
export function DeskCharts({ rows, onPick }: { rows: DeskRow[]; onPick: (pick: DeskPick) => void }) {
  const { lang } = useLang();
  const d = PAYPAL_DESK[lang];
  const ink = useInk();
  const owing = useMemo(() => rows.filter((r) => r.balance !== null), [rows]);
  const ages = useMemo(() => AGES.map((key) => ({ key, label: d[`bucket_${key}`], rows: owing.filter((r) => r.bucket === key) })), [d, owing]);
  const states = useMemo(
    () => DESK_STATES.map((key) => ({ key, label: d[`state_${key}`], rows: owing.filter((r) => r.state === key) })).filter((g) => g.rows.length > 0),
    [d, owing],
  );
  const [ageTone, stateTone] = useMemo(() => {
    const tone = (t: Token) => ink?.[t] || "currentColor";
    return [
      Object.fromEntries(AGES.map((k) => [k, tone(AGE_TONE[k])])) as Record<DeskBucket, string>,
      Object.fromEntries(DESK_STATES.map((k) => [k, tone(STATE_TONE[k])])) as Record<DeskState, string>,
    ];
  }, [ink]);
  return (
    <section className="pd-charts" aria-label={d.chartsLabel}>
      <Stacked title={d.chartAge} groups={ages} ink={ink} tone={ageTone} onPick={(value) => onPick({ by: "bucket", value })} />
      <Stacked title={d.chartState} groups={states} ink={ink} tone={stateTone} onPick={(value) => onPick({ by: "state", value })} />
      <p className="field-note pd-chart-note">{d.chartNote}</p>
    </section>
  );
}
