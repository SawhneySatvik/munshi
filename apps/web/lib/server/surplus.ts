// Surplus for good on screen (server only): the impact tally (items given, rupees not wasted) and the shop's
// recipients, every one simulated. The tally's figures are refs into the surplus.impact snapshot core minted in the page's
// transaction; nothing is added up here. A tally with any gift in another currency than the shop's has no cell that counts
// every gift: then all three figures are "Cannot verify", and the screen says why (`mixed`). The surplus page is an owner's or a manager's (core's map): null, a 404, for
// anyone else.
import { type Cell, type Session, type StoredSnapshot, viewSurplus } from "@munshi/core";
import type { Localized, Snapshot, SourceRef } from "../types";
import { frame, type Minted, mintedAs, page, refTo, textOf } from "./ops";

const IMPACT_TITLE: Localized = { en: "Surplus given · all time", hi: "दान किया बचा माल · अब तक" };
const RECIPIENTS_TITLE: Localized = { en: "Recipients · simulated", hi: "लेने वाले · सिम्युलेटेड" };

/** The tally's three figures: gifts, distinct items, and their value at cost; each null, and `mixed`, when some gift is
 * in another currency (the cells count only the shop's own). */
export type ImpactTally = { gifts: SourceRef | null; items: SourceRef | null; value: SourceRef | null; mixed: boolean };

const isZero = (cell: Cell | undefined) => cell?.kind === "integer" && cell.num === "0";

/** The tally as the screen shows it, from its snapshot; null when the read returned no row. */
export function impactOf(s: StoredSnapshot): { tally: ImpactTally | null; snapshot: Snapshot } {
  const m: Minted = mintedAs(s, IMPACT_TITLE, ["gifts", "items", "value", "other_currency_gifts"]);
  const row = m.cells[0];
  if (!row) return { tally: null, snapshot: m.snapshot };
  const ref = (col: string) => refTo(m, 0, col, IMPACT_TITLE);
  if (!isZero(row.other_currency_gifts)) return { tally: { gifts: null, items: null, value: null, mixed: true }, snapshot: m.snapshot };
  return { tally: { gifts: ref("gifts"), items: ref("items"), value: ref("value"), mixed: false }, snapshot: m.snapshot };
}

export type RecipientRow = { id: string; name: string; kind: string; area: string };
export type SurplusPage = {
  shop: string;
  /** the recipients, by name; each is simulated (the schema admits no other) */
  recipients: RecipientRow[];
  impact: ImpactTally | null;
  snapshots: Snapshot[];
};

export async function loadSurplus(session: Session): Promise<SurplusPage | null> {
  const v = await page(session, (c) => viewSurplus(c, session));
  if (!v) return null;
  const listed = mintedAs(v.recipients, RECIPIENTS_TITLE, ["name", "kind", "area"]);
  const impact = impactOf(v.impact);
  return {
    shop: frame(v.viewer).shop,
    recipients: listed.cells.map((r) => ({ id: textOf(r.id), name: textOf(r.name), kind: textOf(r.kind), area: textOf(r.area) })),
    impact: impact.tally,
    snapshots: [impact.snapshot, listed.snapshot],
  };
}
