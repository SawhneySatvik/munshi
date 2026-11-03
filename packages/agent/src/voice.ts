// Ask by voice: the voice model (role `voice`) transcribes a spoken question, Hindi or English, and the
// transcript is asked like a typed question (run.ts `ask`), so the answer cites cells or abstains. The transcript is
// untrusted user text: it goes to the router and the desk as the question, and back to the caller, never into a trace.
// The voice call is counted by core's allow (a media call) once the audio and the key are checked; refused, the question
// abstains. The language the voice model heard (a BCP-47 code, when its provider says: Sarvam's detection does) is
// returned to the caller beside the transcript. The answer follows the question's own language (the narrator answers in
// it), and Read aloud picks its voice from the answer's script (apps/web lib/server/speak.ts); nothing else uses this code.
import type { Missing, Reply } from "./answer.ts";
import { ModelError, transcribe } from "@munshi/ai";
import { ask, type RunOptions } from "./run.ts";

export type VoiceReply = { transcript: string | null; language: string | null; reply: Reply };

const CODE = /^[a-z]{2,3}-[A-Z]{2}$/;

/** language: a bias for the voice model ("Hindi", "English"); none asks the model to detect it. */
export async function askByVoice(wav: Uint8Array, o: RunOptions & { language?: string }): Promise<VoiceReply> {
  const now = o.now ?? Date.now;
  const t0 = now();
  const trace = (kind: "model" | "abstain" | "budget", label: string) => o.port.trace({ kind, label, ids: [], ms: Math.max(0, Math.round(now() - t0)) });
  let transcript: string;
  let language: string | null = null;
  try {
    const allow = o.port.allow ? () => (o.port.allow as NonNullable<typeof o.port.allow>)("voice") : undefined;
    const heard = await transcribe({ wav, ...(o.language ? { language: o.language } : {}) }, o.deps, allow);
    transcript = heard.text;
    language = heard.language && CODE.test(heard.language) ? heard.language : null;
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    const before = err.code === "off" ? "ai_off" : err.code === "no_key" ? "no_key" : null;
    await trace(before ? "budget" : "model", before ?? "model_error");
    transcript = "";
  }
  if (!transcript.trim()) {
    const missing: Missing[] = ["model_error"];
    await trace("abstain", "model_error");
    return { transcript: null, language: null, reply: { kind: "abstain", specialist: null, missing } };
  }
  await trace("model", "voice");
  return { transcript, language, reply: await ask(transcript, o) };
}
