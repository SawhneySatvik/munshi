// The office page's data (server only, W1-B): the morning brief, the desks and the run log in the page's ONE transaction.
// Core's viewDesks mints desks.week (a row per cast member, the cast and its mapping from lib/cast.ts as the read's
// params) and, for the run the member opened, desks.trace; every count and timing shown is a ref into those cells, and
// nothing is added up here. The scene's states come from each member's latest run, as its cells say: still open,
// thinking; its draft undecided, waiting; approved, done; failed, blocked; anything else, idle. A member with no run in
// the window gets no state (the scene's own default); a finished watcher or brief run of the last hour, watching. The run
// log is read in SQL for everyone or the chosen member (?cast=), at most core's LOG_ROWS, newest first. The model on each
// card is what AI staff answers with now.
import { modelCatalogue } from "@munshi/ai";
import { aiStaff, type Cell, mayReadIn, type Session, viewDesks, viewImpact } from "@munshi/core";
import type { AgentState } from "../../components/office/types";
import { BY_DESK, BY_TRIGGER, CAST, type CastId, castOf } from "../cast";
import { readEdition } from "../edition";
import { DESKS } from "../i18n-desks";
import type { Localized, Snapshot, SourceRef } from "../types";
import { type KeeperData, keeperIn } from "./memory";
import { type BriefPage, briefIn } from "./office";
import { type Minted, mintedAs, page, refTo, textOf } from "./ops";
import { type ImpactTally, impactOf } from "./surplus";

const COUNTS = ["runs", "proposed", "approved", "rejected", "abstained", "failed"] as const;
export type CountKey = (typeof COUNTS)[number];

export type LatestRun = { id: string; at: string; outcome: string | null; trigger: string; desk: string };
export type DeskCard = { cast: CastId; models: string[]; counts: Record<CountKey, SourceRef>; latest: LatestRun | null };
export type RunStep = { kind: string; label: string; alias: string | null; ms: SourceRef };
export type RunLogRow = { id: string; cast: CastId; at: string; trigger: string; desk: string; outcome: string | null };
export type DesksData = {
  cards: DeskCard[];
  log: RunLogRow[];
  /** the log holds its most rows: older runs of the window are not shown */
  capped: boolean;
  filter: CastId | null;
  open: { id: string; steps: RunStep[] } | null;
  snapshots: Snapshot[];
};
/** The surplus impact tally (W2-B), its figures cells of a surplus.impact snapshot minted in the same transaction. */
export type OfficeImpact = { tally: ImpactTally | null; snapshot: Snapshot };
// keeper: Keeper's desk (W2-A), read in the same page transaction; impact: the surplus tally (W2-B), likewise.
export type OfficeData = {
  brief: BriefPage;
  desks: DesksData | null;
  states: Partial<Record<CastId, AgentState>>;
  keeper?: KeeperData | null;
  impact?: OfficeImpact | null;
};

const label = (k: "weekLabel" | "stepsLabel"): Localized => ({ en: DESKS.en[k], hi: DESKS.hi[k] });
const isCast = (x: string | undefined): x is CastId => !!x && (CAST as readonly string[]).includes(x);
const at = (cell: Cell | undefined) => (cell?.kind === "timestamp" ? cell.at : null);
const textOr = (cell: Cell | undefined) => (cell?.kind === "text" ? cell.txt : null);

/** A cast member's state from its desks.week row: its latest run's outcome and where that run's drafts stand. */
export function stateOf(row: Record<string, Cell>): AgentState | null {
  if (!textOr(row.latest_run_id)) return null;
  const outcome = textOr(row.latest_outcome);
  const draft = textOr(row.latest_draft);
  if (outcome === null) return "thinking";
  if (outcome === "proposed" && draft === "undecided") return "waiting";
  // Before failed, by ruling: a run that failed after a draft of it was approved shows the approval, done.
  if (draft === "approved") return "done";
  if (outcome === "failed") return "blocked";
  // A finished watcher or brief run that started in the last hour (the read's cell, by the database clock).
  if (row.latest_watching?.kind === "integer" && row.latest_watching.num === "1") return "watching";
  return "idle";
}

// A model step's label is the role, then the alias that answered (and any it fell back from), stored joined by ":"
// (the app's agent port): "reason:muse-spark", "reason:a:fallback:b". A bare role recorded no alias.
const aliasOf = (kind: string, text: string) => {
  const parts = kind === "model" ? text.split(/[,:]/) : [];
  return parts.length > 1 ? (parts[parts.length - 1] as string) : null;
};

export async function loadOffice(session: Session, q: { cast?: string | undefined; run?: string | undefined } = {}): Promise<OfficeData> {
  return page(session, async (c) => {
    const brief = await briefIn(c, session);
    // The office is the owner's and a manager's (core's map, D-082): no desks for any other role, and the page answers 404.
    if (!(await mayReadIn(c, "desks.week"))) return { brief, desks: null, states: {} };
    const filter = isCast(q.cast) ? q.cast : null;
    const v = await viewDesks(c, { cast: [...CAST], desks: BY_DESK, triggers: BY_TRIGGER }, { cast: filter ?? undefined, run: q.run });
    const staff = await aiStaff(c, modelCatalogue(readEdition()));
    const week = mintedAs(v.week, label("weekLabel"), ["cast_id", ...COUNTS, "latest_at", "latest_outcome", "latest_trigger", "latest_desk"]);
    const minted: Minted[] = [week];
    const states: Partial<Record<CastId, AgentState>> = {};
    const cards = week.cells.flatMap((row, i): DeskCard[] => {
      const cast = textOf(row.cast_id);
      if (!isCast(cast)) return [];
      const state = stateOf(row);
      if (state) states[cast] = state;
      const id = textOr(row.latest_run_id);
      const when = at(row.latest_at);
      return [
        {
          cast,
          models: [...new Set(staff.filter((s) => castOf({ desk: s.agent }) === cast && s.current).map((s) => s.current as string))],
          counts: Object.fromEntries(COUNTS.map((k) => [k, refTo(week, i, k, week.snapshot.title)])) as Record<CountKey, SourceRef>,
          latest: id && when ? { id, at: when, outcome: textOr(row.latest_outcome), trigger: textOf(row.latest_trigger), desk: textOf(row.latest_desk) } : null,
        },
      ];
    });
    let open: DesksData["open"] = null;
    if (v.trace && q.run) {
      const t = mintedAs(v.trace, label("stepsLabel"), ["step", "kind", "label", "ms"]);
      minted.push(t);
      open = {
        id: q.run,
        steps: t.cells.map((row, i) => ({ kind: textOf(row.kind), label: textOf(row.label), alias: aliasOf(textOf(row.kind), textOf(row.label)), ms: refTo(t, i, "ms", t.snapshot.title) })),
      };
    }
    const log = v.log.map((r) => ({ id: r.id, cast: castOf(r), at: r.startedAt, trigger: r.trigger, desk: r.desk, outcome: r.outcome }));
    const keeper = await keeperIn(c, session);
    const tally = await viewImpact(c);
    return {
      brief,
      desks: { cards, log, capped: v.capped, filter, open, snapshots: minted.map((m) => m.snapshot) },
      states,
      keeper,
      impact: tally ? impactOf(tally) : null,
    };
  });
}
