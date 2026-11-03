// What the channel screens may know of the deployment's channels (core's channelState): the send mode, which
// credentials are set, the Instagram account ref the grant must name, and whether a post's card can be served at a
// public HTTPS address; never a token, a secret or an id. Instagram fetches a post's picture from that address, so a
// card is servable only where MUNSHI_APP_URL is https and a media store holds the cards' bytes (lib/api/deps.ts). Until
// both hold, the outbox wires no Instagram sender (outbox.ts) and every screen says the post is not sent, for that reason
// (no_card): the one predicate, instagramCards, decides both, evaluated afresh on each request and before each sweep.
import { campaignCard, channelDeployOf, type createJobsPool, publicCard, type ChannelDeploy } from "@munshi/core";
import { mediaStore } from "../api/deps.ts";
import { config } from "./config.ts";
import type { publicPool } from "./db.ts";

/** Whether a campaign's card can be served where Instagram fetches it: an https MUNSHI_APP_URL and a media store wired. */
export const instagramCards = (): boolean => !!config().appUrl?.startsWith("https://") && mediaStore() !== null;

export function channelDeploy(): ChannelDeploy {
  return channelDeployOf(config(), instagramCards());
}

/** A card's public address under the app's origin: app/api/cards/[tenant]/[file] serves it. */
export const cardUrl = (appUrl: string, tenantId: string, documentId: string): string => `${appUrl}/api/cards/${tenantId}/${documentId}.jpg`;

/**
 * The Instagram sender's mediaUrlFor: the public address of the card the campaign's approved campaign.post draft bound
 * (its payload's id, with the approved sha256 still the document's: core's campaignCard, read by the jobs role with no
 * actor), then checked readable by the public role (the database's policies: an
 * approved or sent Instagram campaign names it, unerased). That is database visibility only: whether the store holds
 * the bytes, and that they are the document's own, is the card route's check when Meta fetches the address. Null (the
 * post fails, never guessed) for a campaign with no approved card, or one the public may not read.
 */
export const mediaUrlFor =
  (appUrl: string, jobs: ReturnType<typeof createJobsPool>, pub: ReturnType<typeof publicPool>) =>
  async (tenantId: string, campaignId: string): Promise<string | null> => {
    const card = await campaignCard(jobs, tenantId, campaignId);
    if (!card || !(await publicCard(pub, tenantId, card))) return null;
    return cardUrl(appUrl, tenantId, card);
  };
