// Ask by voice: the voice model (role `voice`) transcribes a spoken question, Hindi or English, and the
// transcript is asked like a typed question (run.ts `ask`), so the answer cites cells or abstains. The transcript is
// untrusted user text: it goes to the router and the desk as the question, and back to the caller, never into a trace.
import type { Missing, Reply } from "./answer.ts";
import { ModelError } from "./providers/redact.ts";
import { transcribe } from "./providers/meta-voice.ts";
import { ask, type RunOptions } from "./run.ts";

export type VoiceReply = { transcript: string | null; reply: Reply };

/** language: a bias for the voice model ("Hindi", "English"); the question is answered in its own language. */
export async function askByVoice(wav: Uint8Array, o: RunOptions & { language?: string }): Promise<VoiceReply> {
  const now = o.now ?? Date.now;
  const t0 = now();
  const trace = (kind: "model" | "abstain", label: string) => o.port.trace({ kind, label, ids: [], ms: Math.max(0, Math.round(now() - t0)) });
  let transcript: string;
  try {
    transcript = (await transcribe({ wav, ...(o.language ? { language: o.language } : {}) }, o.deps)).text;
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    await trace("model", "model_error");
    transcript = "";
  }
  if (!transcript.trim()) {
    const missing: Missing[] = ["model_error"];
    await trace("abstain", "model_error");
    return { transcript: null, reply: { kind: "abstain", specialist: null, missing } };
  }
  await trace("model", "voice");
  return { transcript, reply: await ask(transcript, o) };
}
