// Reading aloud (role `speak`): text that already passed its checks (a checked answer, a brief line, put in words by the
// screen's own renderer, its figures the cells the screen shows) becomes audio. The text never comes from a model in
// this run and nothing here writes a word: the speech model only voices what it is given. Each request is first allowed
// by the port (core's allow: a media call under the shop's caps). Traces carry fixed labels only, never the text.
import type { RoleBinding } from "./config.ts";
import { aliasBinding } from "./models.ts";
import type { AgentPort, TraceKind } from "./port.ts";
import type { Deps } from "./providers/client.ts";
import { ModelError } from "./providers/redact.ts";
import { speak } from "./providers/speech.ts";
import type { SpeakLanguage, SpeakResult } from "./providers/types.ts";

export type Spoken =
  | { kind: "audio"; audio: Uint8Array; mime: SpeakResult["mime"]; chars: number; model: string }
  /** off: AI is off or the shop's media calls are spent; no_key: the deployment has no key for the speech model. */
  | { kind: "refused"; why: "off" | "no_key" | "model_error" };

export async function readAloud(text: string, o: { port: AgentPort; language: SpeakLanguage; deps?: Deps; now?: () => number }): Promise<Spoken> {
  const now = o.now ?? Date.now;
  const t0 = now();
  const trace = (kind: TraceKind, label: string) => o.port.trace({ kind, label, ids: [], ms: Math.max(0, Math.round(now() - t0)) });
  try {
    // The model is the speak desk's chain's first that this build serves (core's modelFor: the shop's pick, the edition's
    // default, the platform's allow-list); an empty chain is AI off for this desk, before any call.
    let binding: RoleBinding | undefined;
    if (o.port.models) {
      binding = (await o.port.models("speak", "speak")).map((a) => aliasBinding(a, "speak")).find((b) => b !== null) ?? undefined;
      if (!binding) throw new ModelError("no model is allowed for the speak desk", undefined, "off");
    }
    const allow = o.port.allow ? () => (o.port.allow as NonNullable<AgentPort["allow"]>)("speak") : undefined;
    const r = await speak({ text, language: o.language }, o.deps, allow, binding);
    await trace("model", "speak");
    return { kind: "audio", audio: r.audio, mime: r.mime, chars: r.chars, model: r.model };
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    const why = err.code === "off" ? "off" : err.code === "no_key" ? "no_key" : "model_error";
    // An abstention, so the run ends as one (endRun reads its outcome off the trace).
    await trace("abstain", why === "off" ? "ai_off" : why);
    return { kind: "refused", why };
  }
}
