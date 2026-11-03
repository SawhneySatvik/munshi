"use server";

// Campaigns (BLUEPRINT §8.6). The owner's moves on a campaign are ops rows, each the signed-in member's under the form's
// key: compose one (createCampaign), write its copy (writeCopy: words only, a typed figure is refused), send a test to
// their own phone (sendTest: recorded, no book row) and propose it (proposeCampaign: the audience minted as
// campaign.audience and cited by the campaign.send draft). The send itself is a book: it runs only when the owner
// approves the draft with decide(), under the approver's identity, and on a shop with no channel grant it is recorded.
import { createCampaign, decide, memberMayRead, proposeCampaign, sendTest, writeCopy } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { AgentState } from "../../../lib/agent-types";
import type { ActState } from "../../../lib/app-types";
import { fromMarks } from "../../../lib/copy-marks";
import { act, field, idOf, invalid, wholeOf } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { copyForCampaign } from "../../../lib/server/inbox-agents";
import { sessionFrom } from "../../../lib/server/session";

const PATH = "/app/campaigns";
const SEGMENTS = ["bought_within_days", "lapsed_regulars", "package_expiring"] as const;
type Segment = (typeof SEGMENTS)[number];

export async function createCampaignAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const name = field(form, "name");
    const channel = field(form, "channel");
    const segment = field(form, "segment") as Segment;
    const days = field(form, "days") === "" ? undefined : wholeOf(form, "days", 1, 365);
    const offer = field(form, "offer") === "" ? undefined : idOf(form, "offer");
    if (!name || (channel !== "whatsapp" && channel !== "instagram") || !SEGMENTS.includes(segment) || days === null || offer === null) return invalid();
    await createCampaign(await appPool(), session, { name, channel, segment, ...(days ? { segmentDays: days } : {}), ...(offer ? { offerId: offer } : {}) });
    return undefined;
  });
}

export async function writeCopyAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const campaignId = idOf(form, "campaign");
    // The copy's figures come back as their ref tokens (the field shows each as a mark, ⟦a⟧: lib/copy-marks.ts).
    let figures: unknown = [];
    try {
      figures = JSON.parse(field(form, "figures") || "[]");
    } catch {
      return invalid();
    }
    const body = fromMarks(field(form, "body"), figures);
    if (!campaignId || !body) return invalid();
    await writeCopy(await appPool(), { session }, campaignId, body);
    return undefined;
  });
}

/**
 * "Write the copy": the agent writes the campaign's words from the owner's brief (what it is about) and the campaign's
 * reads, each figure a cell; core stores them while the campaign is composing, and the owner edits and proposes them as
 * before. The person comes from sessionFrom(); the form names the campaign only (its offer is the one it names).
 */
export async function draftCopyAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const campaignId = idOf(form, "campaign");
  const brief = field(form, "brief").slice(0, 400);
  if (!campaignId || !brief) return { note: "copyNotWritten", ok: false };
  const session = await sessionFrom(await cookies());
  if (!session) return { note: "errSignedOut", ok: false };
  try {
    // Campaigns are the office's (core's map, D-082): another role is refused before any run or model call, though the
    // action stays callable while the page answers 404.
    if (!(await memberMayRead(await appPool(), session, "campaign.audience"))) return { note: "errStaff", ok: false };
    return await copyForCampaign(session, campaignId, brief);
  } catch {
    return { note: "errOther", ok: false };
  } finally {
    revalidatePath(PATH);
  }
}

export async function testSendAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const campaignId = idOf(form, "campaign");
    if (!campaignId) return invalid();
    await sendTest(await appPool(), session, campaignId);
    return undefined;
  });
}

export async function proposeCampaignAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const campaignId = idOf(form, "campaign");
    if (!campaignId) return invalid();
    await proposeCampaign(await appPool(), session, campaignId);
    return undefined;
  });
}

export async function decideCampaignAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const draftId = idOf(form, "draft");
    const verdict = field(form, "verdict");
    if (!draftId || (verdict !== "approved" && verdict !== "rejected")) return invalid();
    const d = await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined);
    return d.status === "stale" ? { error: "stale" } : undefined;
  });
}
