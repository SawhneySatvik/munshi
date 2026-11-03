// Keeper's desk and "why this number" (server only), each in one page transaction. Keeper's desk: core's
// viewKeeper mints memory.in_force (ids, codes and times) and reads each note's words beside it; a note's source chip is
// its decision's command, verdict, who decided and when, all cells of that read. The walk: core's viewWhy mints
// why.chain from one figure's cell, cut to the nodes the member's role may read; each node's member is named here.
import { businessDate, type Cell, type CellRef, CoreError, type Session, viewKeeper, viewWhy } from "@munshi/core";
import { notesGiven } from "./agent-port";
import type { Snapshot } from "../types";
import { type Client, mintedAs, page, textOf } from "./ops";

const at = (cell: Cell | undefined) => (cell?.kind === "timestamp" ? cell.at : null);

export type KeeperNote = {
  id: string;
  kind: string;
  words: string;
  command: string;
  verdict: string;
  decidedBy: string | null;
  decidedAt: string;
  /** when the note was written (it holds from then) */
  writtenAt: string;
  validTo: string;
};
export type KeeperData = {
  notes: KeeperNote[];
  canForget: boolean;
  /** the models do not answer live (record or recorded mode): the notes are kept but no prompt is given them */
  recorded: boolean;
  /** the notes written today, in the shop's zone: Keeper is at work in the office scene */
  writtenToday: string[];
  snapshots: Snapshot[];
};

/** The notes in force with their source chips, in the page's transaction (the office's: loadOffice); null for a member
 * whose role may not read memory. */
export async function keeperIn(c: Client, session: Session): Promise<KeeperData | null> {
  const v = await viewKeeper(c, session);
  if (!v) return null;
  const m = mintedAs(v.snapshot, { en: "Keeper's notes", hi: "कीपर के नोट" }, ["kind", "command", "verdict", "decided_at", "valid_from", "valid_to"]);
  const notes = m.cells.flatMap((row): KeeperNote[] => {
    const id = textOf(row.memory_id);
    const words = v.words[id];
    const decidedAt = at(row.decided_at);
    const validTo = at(row.valid_to);
    const writtenAt = at(row.valid_from);
    if (!words || !decidedAt || !validTo || !writtenAt) return [];
    return [
      {
        id,
        kind: textOf(row.kind),
        words,
        command: textOf(row.command),
        verdict: textOf(row.verdict),
        decidedBy: v.members[textOf(row.decided_by)] ?? null,
        decidedAt,
        writtenAt,
        validTo,
      },
    ];
  });
  const today = businessDate(new Date(), v.timeZone);
  const writtenToday = notes.filter((n) => businessDate(new Date(n.writtenAt), v.timeZone) === today).map((n) => n.id);
  return { notes, canForget: v.canForget, recorded: !notesGiven(), writtenToday, snapshots: [m.snapshot] };
}

export type WhyNode = {
  kind: "figure" | "read" | "row" | "decision" | "total" | "end" | "break";
  node: string | null;
  parent: string | null;
  label: string;
  who: string | null;
  at: string | null;
};
export type WhyResult = { nodes: WhyNode[] } | { error: "not_for_role" | "other" };

/** The walk from one figure (`ref.row` 0-based, as stored) to who approved what it was read from. */
export async function loadWhy(session: Session, ref: CellRef): Promise<WhyResult> {
  try {
    return await page(session, async (c) => {
      const v = await viewWhy(c, ref);
      const nodes = v.snapshot.rows.map(
        (row): WhyNode => ({
          kind: textOf(row.kind) as WhyNode["kind"],
          node: textOf(row.node) || null,
          parent: textOf(row.parent) || null,
          label: textOf(row.label),
          who: v.members[textOf(row.member_id)] ?? null,
          at: at(row.at),
        }),
      );
      return { nodes };
    });
  } catch (err) {
    return { error: err instanceof CoreError && err.code === "not_for_role" ? "not_for_role" : "other" };
  }
}
