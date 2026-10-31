import { resolveBinding, type Deps } from "./client.ts";
import { assertWav, metaTranscribe } from "./meta-voice.ts";
import { ModelError } from "./redact.ts";
import { sarvamTranscribe } from "./sarvam-voice.ts";
import type { TranscribeRequest, TranscribeResult } from "./types.ts";

/** The voice role: the edition's binding, to the adapter that speaks its provider's wire format; any other is refused before a call. */
export async function transcribe(req: TranscribeRequest, d: Deps = {}): Promise<TranscribeResult> {
  const b = resolveBinding("voice", d);
  const adapter = b.provider === "meta" ? metaTranscribe : b.provider === "sarvam" ? sarvamTranscribe : null;
  if (!adapter) throw new ModelError(`voice: provider ${b.provider} has no adapter`);
  assertWav(req.wav);
  return adapter(req, b, d);
}
