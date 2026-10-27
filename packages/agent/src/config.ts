import { PROVIDER_IDS, ROLES, type ProviderId, type Role } from "./providers/types.ts";

export type RoleBinding = { provider: ProviderId; model: string };
export type RoleMap = Record<Role, RoleBinding>;
export const EDITIONS = ["meta", "paytm"] as const;
export type Edition = (typeof EDITIONS)[number];

export const EDITION_ROLES: Record<Edition, RoleMap> = {
  meta: {
    router: { provider: "meta", model: "muse-spark-1.3" },
    reason: { provider: "meta", model: "muse-spark-1.3" },
    vision: { provider: "meta", model: "muse-spark-1.3" },
    segment: { provider: "meta", model: "sam-3.1" },
    voice: { provider: "meta", model: "muse-voice-transcribe-1.0" },
    narrate: { provider: "baseten", model: "meta-models/muse-spark-open-1026" },
  },
  // TODO(paytm edition): placeholder map so the switch is exercised; model ids are not chosen or verified.
  paytm: {
    router: { provider: "gemini", model: "TODO-gemini-model" },
    reason: { provider: "gemini", model: "TODO-gemini-model" },
    vision: { provider: "gemini", model: "TODO-gemini-model" },
    segment: { provider: "gemini", model: "TODO-gemini-model" },
    voice: { provider: "sarvam", model: "TODO-sarvam-model" },
    narrate: { provider: "nebius", model: "TODO-nebius-model" },
  },
};

/** Base URLs for the OpenAI-compatible providers. sarvam has no adapter yet. */
export const BASE_URLS: Partial<Record<ProviderId, string>> = {
  meta: "https://api.meta.ai/v1",
  baseten: "https://inference.baseten.co/v1",
  nebius: "https://api.tokenfactory.nebius.com/v1/",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
};

export const KEY_ENV: Record<ProviderId, string> = {
  meta: "META_MODEL_API_KEY",
  baseten: "BASETEN_API_KEY",
  nebius: "NEBIUS_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  sarvam: "SARVAM_API_KEY",
};

/** Providers that serve the Responses API. Others use Chat Completions. UNVERIFIED for all but meta. */
export const USES_RESPONSES: ReadonlySet<ProviderId> = new Set(["meta"]);

export const ROLE_TIMEOUT_MS: Record<Role, number> = {
  router: 20_000,
  reason: 60_000,
  vision: 60_000,
  segment: 60_000,
  voice: 60_000,
  narrate: 60_000,
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

export function binding(role: Role, edition: Edition = parseEdition(process.env["MUNSHI_EDITION"])): RoleBinding {
  return resolveRoles(edition)[role];
}
