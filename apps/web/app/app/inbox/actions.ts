"use server";

// The inbox's moves (BLUEPRINT §8.6). A member marks a message handled or ignored, through core's handleInbound as the
// signed-in member under the form's key (an ops row: who handled it and when are the database's). A STOP is never
// handled here: it is handled only by consent.record beside the withdrawal, and the database refuses it otherwise.
// The agents' moves (W1-A) take the message's id only: "Draft reply" and "Draft order" run the agent on the message's
// stored words and leave a draft for approval; "Hear the voice note" transcribes the clip the person attached (the
// WhatsApp media download is not connected: simulated, and the screen says so) and stores its words once.
import { handleInbound, memberMayRead, type Session } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { AgentNote, AgentState } from "../../../lib/agent-types";
import type { ActState } from "../../../lib/app-types";
import { MAX_AUDIO } from "../../../lib/hero-types";
import { act, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { hearVoiceNote, type Outcome, orderFromMessage, replyToMessage } from "../../../lib/server/inbox-agents";
import { sessionFrom } from "../../../lib/server/session";

export async function handleMessageAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/inbox", async (session) => {
    const messageId = idOf(form, "message");
    const status = field(form, "status");
    if (!messageId || (status !== "handled" && status !== "ignored")) return invalid();
    await handleInbound(await appPool(), session, messageId, status);
    return undefined;
  });
}

// The inbox is the office's (core's map, D-082): a tap of another role's is refused before any run, model call or write,
// though the action stays callable while the page answers 404. `refused`: the note that refusal shows.
async function tap(form: FormData, move: (session: Session, messageId: string) => Promise<Outcome>, refused: AgentNote = "errStaff"): Promise<AgentState> {
  const messageId = idOf(form, "message");
  if (!messageId) return { note: "errOther", ok: false };
  const session = await sessionFrom(await cookies());
  if (!session) return { note: "errSignedOut", ok: false };
  try {
    if (!(await memberMayRead(await appPool(), session, "inbox.extract"))) return { note: refused, ok: false };
    return await move(session, messageId);
  } catch {
    return { note: "errOther", ok: false };
  } finally {
    revalidatePath("/app/inbox");
    revalidatePath("/app");
  }
}

export async function draftReplyAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  return tap(form, replyToMessage);
}

export async function draftOrderAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  return tap(form, orderFromMessage);
}

const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

export async function hearAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0 || audio.size > MAX_AUDIO) return { note: "notHeard", ok: false };
  const wav = new Uint8Array(await audio.arrayBuffer());
  if (wav.length < 44 || tag(wav, 0) !== "RIFF" || tag(wav, 8) !== "WAVE") return { note: "notHeard", ok: false };
  return tap(form, (session, messageId) => hearVoiceNote(session, messageId, wav), "hearOwnersOnly");
}
