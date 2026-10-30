"use server";

// Campaigns (BLUEPRINT §8.6). The owner's moves on a campaign are ops rows, each the signed-in member's under the form's
// key: compose one (createCampaign), write its copy (writeCopy: words only, a typed figure is refused), send a test to
// their own phone (sendTest: recorded, no book row) and propose it (proposeCampaign: the audience minted as
// campaign.audience and cited by the campaign.send draft). The send itself is a book: it runs only when the owner
// approves the draft with decide(), under the approver's identity, and on a shop with no channel grant it is recorded.
import { createCampaign, decide, proposeCampaign, sendTest, writeCopy } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, idOf, invalid, wholeOf } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";

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
    const body = field(form, "body");
    if (!campaignId || !body) return invalid();
    await writeCopy(await appPool(), { session }, campaignId, body);
    return undefined;
  });
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
