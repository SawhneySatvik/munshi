import { CHAIN_ALIASES, KNOWN_ALIASES, MODEL_ALIASES } from "./models.ts";
import { notice } from "./notice.ts";
import { PROVIDER_IDS, ROLES, type ProviderId, type Role } from "./providers/types.ts";

export type RoleBinding = { provider: ProviderId; model: string };
export type RoleMap = Record<Role, RoleBinding>;
export const EDITIONS = ["meta", "paytm"] as const;
export type Edition = (typeof EDITIONS)[number];

/**
 * Each edition's default model per role, by alias (models.ts). The paytm edition names no segment alias: no adapter but
 * Meta's speaks that wire format, so the shelf count hides there (EDITION_ROLES below). Its voice is Sarvam's. Speak is
 * Sarvam's on both editions: Meta has no text-to-speech model, so on the meta edition it is the default, not a fallback.
 */
export const EDITION_ALIASES: Partial<Record<Edition, Partial<Record<Role, string>>>> = {
  meta: { router: "muse-spark", reason: "muse-spark", vision: "muse-spark", segment: "sam", voice: "muse-voice", narrate: "spark-open", speak: "bulbul-v3" },
  paytm: { router: "gemini-flash-lite", reason: "gemini-flash", vision: "gemini-flash", voice: "saaras-v4", narrate: "gemini-flash-lite", speak: "bulbul-v3" },
};

/**
 * Providers an edition's allow-list offers beyond those its defaults use (D-075): a shop on paytm may pick these. The
 * meta edition offers the same, and Gemini, behind Meta's own models (D-077), so a deployment without a Meta key, or
 * with Meta down, still answers. No other provider serves segment: the shelf count still needs Meta's key.
 */
const EDITION_EXTRA_PROVIDERS: Partial<Record<Edition, readonly ProviderId[]>> = {
  meta: ["gemini", "anthropic", "openai", "openrouter", "nvidia", "sarvam"],
  paytm: ["anthropic", "openai", "openrouter", "nvidia", "sarvam"],
};

// An edition's role map through its aliases: exactly { provider, model }, so fixture keys stay as they were.
function viaAliases(aliases: Record<Role, string>): RoleMap {
  return Object.fromEntries(
    ROLES.map((role) => {
      const m = MODEL_ALIASES[aliases[role]];
      if (!m?.roles.includes(role)) throw new Error(`edition alias "${aliases[role]}" does not serve role "${role}"`);
      return [role, { provider: m.provider, model: m.model }];
    }),
  ) as RoleMap;
}

export const EDITION_ROLES: Record<Edition, RoleMap> = {
  meta: viaAliases(EDITION_ALIASES.meta as Record<Role, string>),
  // Text roles and voice through the paytm aliases. segment names a provider with no adapter for that role, so segment()
  // refuses before any call and the shelf count hides (fix 2's gate).
  paytm: {
    ...viaAliases({ ...(EDITION_ALIASES.meta as Record<Role, string>), ...EDITION_ALIASES.paytm }),
    segment: { provider: "gemini", model: "gemini-3.5-flash" },
  },
};

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

export function parseEdition(v: string | undefined): Edition {
  const e = v ?? "meta";
  if (!(EDITIONS as readonly string[]).includes(e)) throw new Error(`unknown edition: ${e}`);
  return e as Edition;
}

/** Validates the whole map: every role present, every provider known. */
export function resolveRoles(edition: Edition, map: Partial<Record<string, RoleBinding>> = EDITION_ROLES[edition]): RoleMap {
  for (const role of ROLES) {
    const b = map[role];
    if (!b) throw new Error(`edition ${edition}: role "${role}" is not mapped`);
    if (!(PROVIDER_IDS as readonly string[]).includes(b.provider)) throw new Error(`edition ${edition}: role "${role}" has unknown provider "${b.provider}"`);
  }
  for (const role of Object.keys(map)) {
    if (!(ROLES as readonly string[]).includes(role)) throw new Error(`edition ${edition}: unknown role "${role}"`);
  }
  return map as RoleMap;
}

export function binding(role: Role, edition: Edition = parseEdition(process.env.MUNSHI_EDITION)): RoleBinding {
  return resolveRoles(edition)[role];
}

/** What core is handed for model choice (core's ModelCatalogue): the build's aliases and their roles, and the edition's defaults. */
export function modelCatalogue(edition: Edition): { known: Readonly<Record<string, readonly Role[]>>; defaults: Partial<Record<Role, string>> } {
  return { known: KNOWN_ALIASES, defaults: EDITION_ALIASES[edition] ?? {} };
}

/**
 * The (alias, role) pairs a demo of this edition allows: every alias of a provider its defaults use or its extra
 * providers name, in each role it serves (MODEL_ALIASES lists only the roles that passed the live probe). A document
 * reader is never on it: it serves the PDF path alone, never a chain (models.ts).
 */
export function editionAllowList(edition: Edition): { alias: string; role: Role }[] {
  const defaults: Partial<Record<Role, string>> = EDITION_ALIASES[edition] ?? {};
  const providers = new Set([...Object.values(defaults).map((a) => MODEL_ALIASES[a as string]?.provider), ...(EDITION_EXTRA_PROVIDERS[edition] ?? [])]);
  return Object.entries(CHAIN_ALIASES)
    .filter(([, m]) => providers.has(m.provider))
    .flatMap(([alias, m]) => m.roles.map((role) => ({ alias, role })));
}

// Meta's own models: its API, and its open model on Baseten.
const META_HOSTED: ReadonlySet<ProviderId> = new Set(["meta", "baseten"]);
const metaHosted = (alias: string) => META_HOSTED.has(MODEL_ALIASES[alias]?.provider as ProviderId);

/**
 * A run's chain on the meta edition (D-077): Meta's own models stay first. Core's modelFor gives the shop's choice, the
 * edition's default, then the other allowed aliases by name; after the first, every Meta-hosted alias moves ahead of the
 * other providers', each group in its own order. Another edition's chain is left as core gave it.
 */
export function metaFirst(edition: Edition, aliases: string[]): string[] {
  if (edition !== "meta" || aliases.length < 2) return aliases;
  const [first, ...rest] = aliases;
  return [first as string, ...rest.filter(metaHosted), ...rest.filter((a) => !metaHosted(a))];
}

/**
 * The binding a call with no chain uses (a photo, an inbox message, a voice note): the edition's, unless this is the
 * meta edition (D-077) in live mode and the deployment has no key for it; then the first alias of the edition's
 * allow-list for the role whose key is set (Meta's own first, by the alias list's order), else the edition's, whose
 * missing key then fails the call by name. The static allow-list, not the platform's: these flows have no port to ask.
 * Only a missing key moves it: a 429, a 5xx or a timeout falls back on a run's chain alone.
 */
export function keyedBinding(role: Role, edition: Edition, env: NodeJS.ProcessEnv, live: boolean): RoleBinding {
  const b = binding(role, edition);
  if (!live || edition !== "meta" || env[KEY_ENV[b.provider]]) return b;
  const next = editionAllowList(edition).find((p) => p.role === role && env[KEY_ENV[(MODEL_ALIASES[p.alias] as { provider: ProviderId }).provider]]);
  if (!next) return b;
  const m = MODEL_ALIASES[next.alias] as { provider: ProviderId; model: string };
  // Names only, never a value: the key that is missing and the role that moved to the next alias with one.
  notice("model.key_missing", { names: [KEY_ENV[b.provider]], code: role });
  return { provider: m.provider, model: m.model };
}
