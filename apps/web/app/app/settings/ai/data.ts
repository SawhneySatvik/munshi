// Settings → AI staff's read: one row per agent from core's aiStaff, under the signed-in member's page transaction,
// with the running build's model catalogue (the aliases it serves and its defaults). The member's role decides
// only whether the screen offers the picker: core's chooseModel and the table's guard refuse anyone but the owner.
// The router per shop: each desk's list is the shop's own once the operator set one (`source`), and the AI
// features show as the operator set them. Spend, for the office's roles: this month against the budget and by
// desk, every figure a cell of ai.spend_month or ai.spend_by_desk minted in the same transaction.
import { modelCatalogue, PRICES } from "@munshi/ai";
import { AI_FEATURES, type AiFeature, type AiStaffRow, aiStaff, type FeatureState, mayReadIn, type Session, viewAiSpend, viewFloor } from "@munshi/core";
import type { Frame } from "../../../../lib/app-types";
import { ROUTER } from "../../../../lib/i18n-router";
import type { SourceRef } from "../../../../lib/types";
import { featuresIn, recordedMode } from "../../../../lib/server/agent-port";
import { type Minted, mintedAs, page, refTo, textOf } from "../../../../lib/server/ops";
import { frameOf } from "../../../../lib/server/sell";

export type SpendDesk = { desk: string; alias: string; calls: SourceRef; cost: SourceRef | null; estimate: boolean };
/**
 * This month's spend. `state` is the month row's own cell (under, soft, hard); `budget` and `spent` are null with no
 * budget (no money cap). A cost cell that is null (a call with no price) is passed as null: the screen says "Cannot verify".
 */
export type SpendPart = {
  state: "under" | "soft" | "hard";
  budget: SourceRef | null;
  spent: SourceRef | null;
  calls: SourceRef;
  unpriced: SourceRef;
  /** the month's total leaves out calls with no price, or priced in another currency (their count cells are not zero) */
  partial: boolean;
  desks: SpendDesk[];
  recorded: boolean;
};
export type AiStaffPage = Frame & { rows: AiStaffRow[]; owner: boolean; features: { feature: AiFeature; state: FeatureState }[]; spend: SpendPart | null };

export const catalogue = () => modelCatalogue();

// Agents ref.ai_agent lists that no code runs yet: no model of theirs is ever called, so they leave the picker.
export const NO_AGENT_CODE: ReadonlySet<string> = new Set(["counter", "settlements", "documents", "shelf_video"]);

const label = (k: "monthLabel" | "deskLabel") => ({ en: ROUTER.en[k], hi: ROUTER.hi[k] });
const isNull = (m: Minted, row: number, col: string) => !m.cells[row]?.[col] || m.cells[row]?.[col]?.kind === "null";
const estimated = (alias: string) => Object.hasOwn(PRICES, alias) && PRICES[alias]?.estimate === true;

export async function loadAiStaff(session: Session): Promise<AiStaffPage> {
  return page(session, async (c) => {
    const v = (await viewFloor(c, session)).viewer;
    const rows = (await aiStaff(c, catalogue())).filter((r) => !NO_AGENT_CODE.has(r.agent));
    const states = await featuresIn(c, session);
    const features = AI_FEATURES.map((feature) => ({ feature, state: states[feature] }));
    const minted: Minted[] = [];
    let spend: SpendPart | null = null;
    if (await mayReadIn(c, "ai.spend_month")) {
      const s = await viewAiSpend(c);
      const month = mintedAs(s.month, label("monthLabel"), ["budget_minor", "spent_minor", "calls", "unpriced_calls", "state"]);
      const desks = mintedAs(s.desks, label("deskLabel"), ["desk", "alias", "calls", "cost_minor", "unpriced_calls"]);
      minted.push(month, desks);
      const m = label("monthLabel");
      const state = textOf(month.cells[0]?.state);
      spend = {
        state: state === "soft" || state === "hard" ? state : "under",
        budget: isNull(month, 0, "budget_minor") ? null : refTo(month, 0, "budget_minor", m),
        spent: isNull(month, 0, "spent_minor") ? null : refTo(month, 0, "spent_minor", m),
        calls: refTo(month, 0, "calls", m),
        unpriced: refTo(month, 0, "unpriced_calls", m),
        partial: [month.cells[0]?.unpriced_calls, month.cells[0]?.other_currency_calls].some((c) => c?.kind === "integer" && c.num !== "0"),
        desks: desks.cells.map((row, i) => ({
          desk: textOf(row.desk),
          alias: textOf(row.alias),
          calls: refTo(desks, i, "calls", label("deskLabel")),
          cost: isNull(desks, i, "cost_minor") ? null : refTo(desks, i, "cost_minor", label("deskLabel")),
          estimate: estimated(textOf(row.alias)),
        })),
        recorded: recordedMode(),
      };
    }
    return { ...frameOf(v, minted), rows, owner: v.member.role === "owner", features, spend };
  });
}
