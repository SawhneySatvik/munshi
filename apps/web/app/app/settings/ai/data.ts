// Settings → AI staff's read (P-5): one row per agent from core's aiStaff, under the signed-in member's page transaction,
// with the running build's model catalogue (the aliases it serves and the edition's defaults). The member's role decides
// only whether the screen offers the picker: core's chooseModel and the table's guard refuse anyone but the owner.
import { modelCatalogue } from "@munshi/agent";
import { type AiStaffRow, aiStaff, type Session, viewFloor } from "@munshi/core";
import type { Frame } from "../../../../lib/app-types";
import { readEdition } from "../../../../lib/edition";
import { page } from "../../../../lib/server/ops";
import { frameOf } from "../../../../lib/server/sell";

export type AiStaffPage = Frame & { rows: AiStaffRow[]; owner: boolean };

export const catalogue = () => modelCatalogue(readEdition());

// Agents ref.ai_agent lists that no code runs yet: no model of theirs is ever called, so they leave the picker.
export const NO_AGENT_CODE: ReadonlySet<string> = new Set(["counter", "settlements"]);

export async function loadAiStaff(session: Session): Promise<AiStaffPage> {
  return page(session, async (c) => {
    const v = (await viewFloor(c, session)).viewer;
    const rows = (await aiStaff(c, catalogue())).filter((r) => !NO_AGENT_CODE.has(r.agent));
    return { ...frameOf(v, []), rows, owner: v.member.role === "owner" };
  });
}
