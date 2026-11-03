import type { RoleBinding } from "../config.ts";
import { requireKey, resolveBinding, type Deps } from "./client.ts";
import { ModelError } from "./redact.ts";
import { sarvamSpeak } from "./sarvam-speak.ts";
import { SPEAK_LANGUAGES, type SpeakRequest, type SpeakResult } from "./types.ts";

/**
 * The speak role: the binding given (the run's chain's first), else the default, to the adapter that speaks its
 * provider's wire format; any other is refused before a call, as is a language outside the role's. A missing key fails
 * by name (no_key) before any call is counted (recorded mode needs none). `beforeEach` is asked before every request
 * the adapter makes (core's allow, a media call); false stops with a ModelError coded "off".
 */
export async function speak(req: SpeakRequest, d: Deps = {}, beforeEach?: () => Promise<boolean>, binding?: RoleBinding): Promise<SpeakResult> {
  const b = binding ?? resolveBinding("speak", d);
  const adapter = b.provider === "sarvam" ? sarvamSpeak : null;
  if (!adapter) throw new ModelError(`speak: provider ${b.provider} has no adapter`);
  if (!(SPEAK_LANGUAGES as readonly string[]).includes(req.language)) throw new ModelError(`speak: language ${req.language} is not spoken`);
  requireKey(b.provider, d);
  return adapter(req, b, d, beforeEach);
}
