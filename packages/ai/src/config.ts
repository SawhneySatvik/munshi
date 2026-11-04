import { CHAIN_ALIASES, KNOWN_ALIASES, MODEL_ALIASES } from "./models.ts";
import { notice } from "./notice.ts";
import { ROLES, type ProviderId, type Role } from "./providers/types.ts";

export type RoleBinding = { provider: ProviderId; model: string };
export type RoleMap = Record<Role, RoleBinding>;

/**
 * The default model per role, by alias (models.ts): Meta's own models. Speak is the one exception: Meta has no
 * text-to-speech model, so Sarvam's Bulbul is the default there. A shop's own pick and its default come before these
 * (core's modelFor); when a default cannot answer, the fallback order below decides what does.
 */
export const DEFAULT_ALIASES: Readonly<Record<Role, string>> = {
  router: "muse-spark",
  reason: "muse-spark",
  vision: "muse-spark",
  segment: "sam",
  voice: "muse-voice",
  narrate: "spark-open",
  speak: "bulbul-v3",
};

// The defaults as exactly { provider, model }, so recorded fixtures keep their keys. An alias that does not serve its
// role fails here, at load, rather than on the first call.
export const DEFAULT_ROLES: RoleMap = Object.fromEntries(
  ROLES.map((role) => {
    const m = MODEL_ALIASES[DEFAULT_ALIASES[role]];
    if (!m?.roles.includes(role)) throw new Error(`default alias "${DEFAULT_ALIASES[role]}" does not serve role "${role}"`);
    return [role, { provider: m.provider, model: m.model }];
  }),
) as RoleMap;

/** Base URLs. All but anthropic (its Messages API, providers/anthropic.ts) speak OpenAI's wire format; sarvam's speech-to-text is its own (providers/sarvam-voice.ts). */
export const BASE_URLS: Partial<Record<ProviderId, string>> = {
  meta: "https://api.meta.ai/v1",
  baseten: "https://inference.baseten.co/v1",
  nebius: "https://api.tokenfactory.nebius.com/v1/",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  sarvam: "https://api.sarvam.ai/v1",
};

export const KEY_ENV: Record<ProviderId, string> = {
  meta: "META_MODEL_API_KEY",
  baseten: "BASETEN_API_KEY",
  nebius: "NEBIUS_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  sarvam: "SARVAM_API_KEY",
  anthropic: "CLAUDE_API_KEY",
  openai: "OPENAI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
};

/** Providers that serve the Responses API (meta's from its docs, openai's from the live probe). Others use Chat Completions, but anthropic. */
export const USES_RESPONSES: ReadonlySet<ProviderId> = new Set(["meta", "openai"]);

export const ROLE_TIMEOUT_MS: Record<Role, number> = {
  router: 20_000,
  reason: 60_000,
  vision: 60_000,
  segment: 60_000,
  voice: 60_000,
  narrate: 60_000,
  speak: 60_000,
};

/** What core is handed for model choice (core's ModelCatalogue): the aliases this build serves, their roles, and the defaults. */
export function modelCatalogue(): { known: Readonly<Record<string, readonly Role[]>>; defaults: Partial<Record<Role, string>> } {
  return { known: KNOWN_ALIASES, defaults: DEFAULT_ALIASES };
}

/**
 * The (alias, role) pairs the demo allows: every alias this build serves, in each role it serves (MODEL_ALIASES lists
 * only the roles that passed a live probe). A document reader is never on it: it serves the PDF path alone, never a
 * chain (models.ts).
 */
export function allowList(): { alias: string; role: Role }[] {
  return Object.entries(CHAIN_ALIASES)
    .flatMap(([alias, m]) => m.roles.map((role) => ({ alias, role })));
}

// Fallback tiers: Meta's own models (its API, and its open model on Baseten), then Gemini, then every other provider.
const tier = (alias: string): number => {
  const p = MODEL_ALIASES[alias]?.provider;
  if (p === "meta" || p === "baseten") return 0;
  if (p === "gemini") return 1;
  return 2;
};

// Within Gemini's tier, its best model first ("fallback to Gemini, its best work"); a Gemini alias not named here comes
// after these. Every other alias ranks 0, so the rest of the order is the order given.
const GEMINI_BEST = ["gemini-flash", "gemini-flash-lite", "gemini-3.1-lite"];
const withinTier = (alias: string): number => {
  if (MODEL_ALIASES[alias]?.provider !== "gemini") return 0;
  const i = GEMINI_BEST.indexOf(alias);
  return i < 0 ? GEMINI_BEST.length : i;
};

/**
 * The order a chain for `role` falls back in. Core's modelFor gives the owner's pick, the shop's default, the build's
 * default, then the other allowed aliases by name. Everything up to the build's default stays as core gave it (the
 * shop's choices are the shop's); after it, Meta's own models come first, then Gemini's (best first: GEMINI_BEST), then
 * every other provider's, each group otherwise in the order given. A list without the build's default (an operator
 * narrowed the shop's list) is left as core gave it: where the shop's choices end cannot be told, and they must never
 * fall behind a tier.
 */
export function fallbackOrder(aliases: readonly string[], role: Role): string[] {
  const end = aliases.indexOf(DEFAULT_ALIASES[role]);
  if (end < 0) return [...aliases];
  const keep = end + 1;
  return [...aliases.slice(0, keep), ...aliases.slice(keep).sort((a, b) => tier(a) - tier(b) || withinTier(a) - withinTier(b))];
}

/**
 * The binding a call with no chain uses (a photo, an inbox message, a voice note): the default, unless this is live
 * mode and the deployment has no key for it; then the first alias for the role, in fallback order, whose key is set,
 * else the default, whose missing key then fails the call by name. Only a missing key moves it: a 429, a 5xx or a
 * timeout falls back on a run's chain alone. Recorded mode never moves, as fixtures are keyed by the binding.
 */
export function keyedBinding(role: Role, env: NodeJS.ProcessEnv, live: boolean): RoleBinding {
  const b = DEFAULT_ROLES[role];
  if (!live || env[KEY_ENV[b.provider]]) return b;
  const allowed = allowList().filter((p) => p.role === role).map((p) => p.alias);
  const next = fallbackOrder([DEFAULT_ALIASES[role], ...allowed], role).find((a) => env[KEY_ENV[(MODEL_ALIASES[a] as { provider: ProviderId }).provider]]);
  if (!next) return b;
  const m = MODEL_ALIASES[next] as { provider: ProviderId; model: string };
  // Names only, never a value: the key that is missing and the role that moved to the next alias with one.
  notice("model.key_missing", { names: [KEY_ENV[b.provider]], code: role });
  return { provider: m.provider, model: m.model };
}
