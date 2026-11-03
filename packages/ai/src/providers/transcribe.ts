import { aliasOf, allowCall, onList, replayed, requireKey, resolveBinding, told, type Deps } from "./client.ts";
import { assertWav, metaTranscribe } from "./meta-voice.ts";
import { ModelError } from "./redact.ts";
import { sarvamTranscribe } from "./sarvam-voice.ts";
import type { TranscribeRequest, TranscribeResult } from "./types.ts";

/**
 * The voice role: the default binding (or the next one with a key), to the adapter that speaks its provider's wire format; any other is refused
 * before a call. Audio the model cannot take, or a missing key, fails before `beforeCall` (core's allow, which counts the
 * call as media) is asked; false from it is a ModelError coded "off".
 */
export async function transcribe(req: TranscribeRequest, d: Deps = {}, beforeCall?: () => Promise<boolean>): Promise<TranscribeResult> {
  const b = await onList("voice", resolveBinding("voice", d), d, (p) => p === "meta" || p === "sarvam");
  const adapter = b.provider === "meta" ? metaTranscribe : b.provider === "sarvam" ? sarvamTranscribe : null;
  if (!adapter) throw new ModelError(`voice: provider ${b.provider} has no adapter`);
  assertWav(req.wav);
  requireKey(b.provider, d);
  await allowCall(beforeCall);
  const heard = await adapter(req, b, d);
  // No adapter reports usage for speech-to-text: the call is kept with none, so its cost cannot be verified.
  await told(d, { role: "voice", alias: aliasOf(b, "voice"), provider: b.provider, model: b.model, usage: null, replayed: replayed(d) });
  return heard;
}
