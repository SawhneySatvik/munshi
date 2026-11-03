// Model aliases. The database stores a short alias, never a provider's model id: a platform change's
// payload refuses slashes and seven-digit runs, which real ids carry, and no provider name may reach the schema (hard
// rule 5). The alias resolves to its provider and model here, in code, and only for the roles it is listed for. Core
// gets this list's names and roles injected (it never imports the agent): model.choose refuses an alias the running
// build does not know, and modelFor drops one.
import type { RoleBinding } from "./config.ts";
import type { ProviderId, Role } from "./providers/types.ts";

/**
 * `documents`: the alias reads whole documents through its own job API (a PDF in, its pages out), not images in a chat
 * call. It serves only the document path (bill.ts, a PDF), so it is never in a chat chain, a picker or the allow-list.
 */
export type ModelAlias = { provider: ProviderId; model: string; roles: readonly Role[]; documents?: true };

export const ALIAS = /^[a-z0-9][a-z0-9.-]{1,31}$/;

export const MODEL_ALIASES: Readonly<Record<string, ModelAlias>> = {
  // Also a narrate fallback: when Baseten is busy or down, Meta's own model writes the words.
  "muse-spark": { provider: "meta", model: "muse-spark-1.3", roles: ["router", "reason", "vision", "narrate"] },
  sam: { provider: "meta", model: "sam-3.1", roles: ["segment"] },
  "muse-voice": { provider: "meta", model: "muse-voice-transcribe-1.0", roles: ["voice"] },
  "spark-open": { provider: "baseten", model: "meta-models/muse-spark-open-1026", roles: ["narrate"] },
  // Gemini, the first fallback after Meta. Each id and role passed text, a tool call, a JSON
  // schema and an image, live, on 31 Oct. Never a gemini-2.5 id (retired).
  "gemini-flash": { provider: "gemini", model: "gemini-3.5-flash", roles: ["router", "reason", "vision", "narrate"] },
  "gemini-flash-lite": { provider: "gemini", model: "gemini-3.5-flash-lite", roles: ["router", "reason", "vision", "narrate"] },
  "gemini-3.1-lite": { provider: "gemini", model: "gemini-3.1-flash-lite", roles: ["router", "reason", "vision", "narrate"] },
  // The other providers, offered after Meta and Gemini. Each role listed passed a live probe through the adapters on
  // 31 Oct (router and narrate a JSON schema, reason a tool call and a JSON schema, vision an image into a JSON schema,
  // voice a Hindi clip). sarvam-105b took no image, and its first JSON answer
  // overran the router's timeout, so it serves reason and narrate only.
  "haiku-4-5": { provider: "anthropic", model: "claude-haiku-4-5-20251001", roles: ["router", "reason", "vision", "narrate"] },
  "haiku-5-5": { provider: "anthropic", model: "claude-haiku-5-5", roles: ["router", "reason", "vision", "narrate"] },
  "gpt-luna-5-6": { provider: "openai", model: "gpt-5.6-luna", roles: ["router", "reason", "vision", "narrate"] },
  "gpt-luna-6": { provider: "openai", model: "gpt-6-luna", roles: ["router", "reason", "vision", "narrate"] },
  "or-glm-5.3-flash": { provider: "openrouter", model: "z-ai/glm-5.3-flash", roles: ["router", "reason", "vision", "narrate"] },
  "nemotron-super-vl": { provider: "nvidia", model: "nvidia/nemotron-3.5-super-vl-120b-a12b", roles: ["router", "reason", "vision", "narrate"] },
  "sarvam-105b": { provider: "sarvam", model: "sarvam-105b", roles: ["reason", "narrate"] },
  "saaras-v4": { provider: "sarvam", model: "saaras:v4", roles: ["voice"] },
  // Sarvam's text-to-speech: the speak role's default, as Meta has no text-to-speech model.
  "bulbul-v3": { provider: "sarvam", model: "bulbul:v3", roles: ["speak"] },
  // Sarvam Vision through its Document AI parse job: a PDF bill's pages (bill.ts). Muse Spark stays the image reader.
  "sarvam-vision": { provider: "sarvam", model: "sarvam-vision", roles: ["vision"], documents: true },
};

/** The aliases a chain, a picker and the allow-list may hold: every alias but a document reader. */
export const CHAIN_ALIASES: Readonly<Record<string, ModelAlias>> = Object.fromEntries(Object.entries(MODEL_ALIASES).filter(([, m]) => !m.documents));

/** The alias that reads a PDF (bill.ts). */
export const DOCUMENT_ALIAS = "sarvam-vision";

/** What core is handed: each alias the build knows, with the roles it may serve. */
export const KNOWN_ALIASES: Readonly<Record<string, readonly Role[]>> = Object.fromEntries(Object.entries(CHAIN_ALIASES).map(([a, m]) => [a, m.roles]));

/**
 * The binding an alias names for a role; null for an alias this build does not know, one not listed for the role, or a
 * document reader (never in a chain).
 */
export function aliasBinding(alias: string, role: Role): (RoleBinding & { alias: string }) | null {
  const m = Object.hasOwn(CHAIN_ALIASES, alias) ? CHAIN_ALIASES[alias] : undefined;
  if (!m?.roles.includes(role)) return null;
  return { provider: m.provider, model: m.model, alias };
}
