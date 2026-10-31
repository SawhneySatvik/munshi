// Model aliases (P-5S, D-068). The database stores a short alias, never a provider's model id: a platform change's
// payload refuses slashes and seven-digit runs, which real ids carry, and no provider name may reach the schema (hard
// rule 5). The alias resolves to its provider and model here, in code, and only for the roles it is listed for. Core
// gets this list's names and roles injected (it never imports the agent): model.choose refuses an alias the running
// build does not know, and modelFor drops one.
import type { RoleBinding } from "./config.ts";
import type { ProviderId, Role } from "./providers/types.ts";

export type ModelAlias = { provider: ProviderId; model: string; roles: readonly Role[] };

export const ALIAS = /^[a-z0-9][a-z0-9.-]{1,31}$/;

export const MODEL_ALIASES: Readonly<Record<string, ModelAlias>> = {
  // Also a narrate fallback on main: when Baseten is busy or down, Meta's own model writes the words.
  "muse-spark": { provider: "meta", model: "muse-spark-1.3", roles: ["router", "reason", "vision", "narrate"] },
  sam: { provider: "meta", model: "sam-3.1", roles: ["segment"] },
  "muse-voice": { provider: "meta", model: "muse-voice-transcribe-1.0", roles: ["voice"] },
  "spark-open": { provider: "baseten", model: "meta-models/muse-spark-open-1026", roles: ["narrate"] },
};

/** What core is handed: each alias the build knows, with the roles it may serve. */
export const KNOWN_ALIASES: Readonly<Record<string, readonly Role[]>> = Object.fromEntries(Object.entries(MODEL_ALIASES).map(([a, m]) => [a, m.roles]));

/** The binding an alias names for a role; null for an alias this build does not know, or one not listed for the role. */
export function aliasBinding(alias: string, role: Role): (RoleBinding & { alias: string }) | null {
  const m = Object.hasOwn(MODEL_ALIASES, alias) ? MODEL_ALIASES[alias] : undefined;
  if (!m?.roles.includes(role)) return null;
  return { provider: m.provider, model: m.model, alias };
}
