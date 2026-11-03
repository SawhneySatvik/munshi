// The inbox's and campaigns' agent moves (server only, BLUEPRINT §8.6, §8.12), each a run the signed-in member's tap
// starts, through the app's inbox port (agent-port.ts): a reply drafted (draftReply), an order drafted (draftOrder), a
// voice note heard (the voice model, its words stored once as the message's transcript) and a campaign's copy written
// (writeCampaignCopy). Reading a customer's words taints the run before they reach it (tappedPort), so a run that read
// them may propose only the recipe tapped. Who the message is from, its order request, whether a reply or an order
// already waits on it, and a campaign's offer are read by core as the member, never taken from the form. A draft waits
// for a person; nothing here writes a book.
import { draftOrder, draftReply, tappedPort, wordsOf, writeCampaignCopy } from "@munshi/agent";
import {
  campaignOffer,
  mayAttachClip,
  messageParty,
  messageRequest,
  replyWaiting,
  requestDrafted,
  requestUndrafted,
  type Session,
  saveClipTranscript,
} from "@munshi/core";
import type { AgentNote } from "../agent-types";
import { agentDeps, inRun, startInboxRun } from "./agent-port";
import { appPool } from "./db";

export type Outcome = { note: AgentNote; ok: boolean };

/** "Draft reply": the customer's words and their figures, a reply citing cells, proposed as message.reply; once only
 * while one waits for a decision (core refuses a second as well). */
export async function replyToMessage(session: Session, messageId: string): Promise<Outcome> {
  const pool = await appPool();
  if (await replyWaiting(pool, session, messageId)) return { note: "replyAlready", ok: false };
  const party = await messageParty(pool, session, messageId);
  if (!party.customerId) return { note: "noCustomer", ok: false };
  const run = await startInboxRun(session, "inbox", "replies");
  const r = await inRun(run, () => draftReply({ messageId, customerId: party.customerId as string }, { port: run.port, deps: run.deps(agentDeps("inbox"), "replies") }));
  return r.kind === "proposed" ? { note: "replyDrafted", ok: true } : { note: "notDrafted", ok: false };
}

/** "Draft order": the message's request (made now if it has none), its lines pointed at and read by core, proposed as
 * order.confirm; the request then waits on that draft. An order already waiting is not drafted again; a request this
 * tap made that the run drafted nothing from is ended again. */
export async function orderFromMessage(session: Session, messageId: string): Promise<Outcome> {
  const pool = await appPool();
  const party = await messageParty(pool, session, messageId);
  if (!party.customerId && !party.contactId) return { note: "noCustomer", ok: false };
  const request = await messageRequest(pool, session, messageId, party.contactId);
  if (request.drafted) return { note: "orderAlready", ok: false };
  const customer = party.customerId ? { customerId: party.customerId } : { contactId: party.contactId as string };
  const run = await startInboxRun(session, "inbox", "chat_to_order");
  let r: Awaited<ReturnType<typeof draftOrder>>;
  try {
    r = await inRun(run, () => draftOrder({ requestId: request.requestId, messageId, customer }, { port: run.port, deps: run.deps(agentDeps("inbox"), "chat_to_order") }));
  } catch (err) {
    if (request.created) await requestUndrafted(pool, session, request.requestId).catch(() => {});
    throw err;
  }
  if (r.kind === "drafted") {
    await requestDrafted(pool, session, request.requestId, r.draftId);
    return { note: "orderDrafted", ok: true };
  }
  if (request.created) await requestUndrafted(pool, session, request.requestId);
  return r.kind === "nothing" ? { note: "orderNothing", ok: false } : { note: "notDrafted", ok: false };
}

/** A voice note heard: the clip an owner or a manager attached is transcribed (role voice) and stored once as its
 * transcript (core refuses staff). A note not heard ends its run as an abstention. */
export async function hearVoiceNote(session: Session, messageId: string, wav: Uint8Array): Promise<Outcome> {
  const pool = await appPool();
  if (!(await mayAttachClip(pool, session))) return { note: "hearOwnersOnly", ok: false };
  const run = await startInboxRun(session, "voice", "voice");
  // The run reads a customer's words: tainted first, and it proposes nothing. Its words are stored by the clip's writer.
  const port = { ...run.port, saveTranscript: (id: string, words: string) => saveClipTranscript(pool, session, id, words) };
  const words = await inRun(run, async () => {
    const w = await wordsOf({ port: tappedPort(port, "message.reply"), deps: run.deps(agentDeps("inbox"), "voice"), media: wav }, messageId);
    if ("refused" in w) await run.port.trace({ kind: "abstain", label: w.refused, ids: [], ms: 0 });
    return w;
  });
  return "refused" in words ? { note: "notHeard", ok: false } : { note: "heard", ok: true };
}

/** "Write the copy": the campaign's words from the owner's brief and its reads (the offer the campaign names), stored
 * while it is composing. */
export async function copyForCampaign(session: Session, campaignId: string, brief: string): Promise<Outcome> {
  const offerId = await campaignOffer(await appPool(), session, campaignId);
  const run = await startInboxRun(session, "campaign", "campaigns");
  const r = await inRun(run, () => writeCampaignCopy({ campaignId, brief, ...(offerId ? { offerId } : {}) }, { port: run.port, deps: run.deps(agentDeps("campaign"), "campaigns") }));
  return r.kind === "written" ? { note: "copyWritten", ok: true } : { note: "copyNotWritten", ok: false };
}
