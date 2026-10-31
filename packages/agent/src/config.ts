import { KNOWN_ALIASES, MODEL_ALIASES } from "./models.ts";
import { PROVIDER_IDS, ROLES, type ProviderId, type Role } from "./providers/types.ts";

export type RoleBinding = { provider: ProviderId; model: string };
export type RoleMap = Record<Role, RoleBinding>;
export const EDITIONS = ["meta", "paytm"] as const;
export type Edition = (typeof EDITIONS)[number];

/**
 * Each edition's default model per role, by alias (models.ts). The paytm edition names no segment or voice alias: no
 * Gemini or Sarvam adapter speaks those wire formats yet, so the shelf count and voice hide there (EDITION_ROLES below).
 */
export const EDITION_ALIASES: Partial<Record<Edition, Partial<Record<Role, string>>>> = {
  meta: { router: "muse-spark", reason: "muse-spark", vision: "muse-spark", segment: "sam", voice: "muse-voice", narrate: "spark-open" },
  paytm: { router: "gemini-flash-lite", reason: "gemini-flash", vision: "gemini-flash", narrate: "gemini-flash-lite" },
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
  // Text roles through the paytm aliases. segment and voice name providers with no adapter for those roles, so
  // segment() and transcribe() refuse before any call and their surfaces hide (fix 2's gates), until Sarvam's key and
  // adapter arrive.
  paytm: {
    ...viaAliases({ ...(EDITION_ALIASES.meta as Record<Role, string>), ...EDITION_ALIASES.paytm }),
    segment: { provider: "gemini", model: "gemini-3.5-flash" },
    voice: { provider: "sarvam", model: "pending" },
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

export function binding(role: Role, edition: Edition = parseEdition(process.env.MUNSHI_EDITION)): RoleBinding {
  return resolveRoles(edition)[role];
}

/** What core is handed for model choice (core's ModelCatalogue): the build's aliases and their roles, and the edition's defaults. */
export function modelCatalogue(edition: Edition): { known: Readonly<Record<string, readonly Role[]>>; defaults: Partial<Record<Role, string>> } {
  return { known: KNOWN_ALIASES, defaults: EDITION_ALIASES[edition] ?? {} };
}

/** The (alias, role) pairs a demo of this edition allows: every alias of a provider its defaults use, in each role it serves. */
export function editionAllowList(edition: Edition): { alias: string; role: Role }[] {
  const defaults: Partial<Record<Role, string>> = EDITION_ALIASES[edition] ?? {};
  const providers = new Set(Object.values(defaults).map((a) => MODEL_ALIASES[a as string]?.provider));
  return Object.entries(MODEL_ALIASES)
    .filter(([, m]) => providers.has(m.provider))
    .flatMap(([alias, m]) => m.roles.map((role) => ({ alias, role })));
}
