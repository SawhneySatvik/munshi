import OpenAI from "openai";
import { BASE_URLS, fallbackOrder, KEY_ENV, keyedBinding, ROLE_TIMEOUT_MS, type RoleBinding } from "../config.ts";
import { CHAIN_ALIASES, MODEL_ALIASES } from "../models.ts";
import { parseMode } from "./fixtures.ts";
import { ModelError } from "./redact.ts";
import type { ProviderId, Role, Usage } from "./types.ts";

/** One binding of a run's chain: the alias it came from, for the trace and "Written by". */
export type ChainBinding = RoleBinding & { alias: string };

export type Deps = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  fixturesDir?: string;
  mode?: string;
  /**
   * The models a call of this role may use, in order (core's modelFor, through the run's port): the first answers; in
   * live mode a 429, a 5xx or a timeout moves to the next. Empty: no model is allowed, and the call is refused. Absent:
   * the default binding.
   */
  chain?: (role: Role) => Promise<ChainBinding[]>;
  /** Asked before each fallback attempt (the caller asked for the first): core's allow, which counts that call. */
  allowAgain?: (role: Role) => Promise<boolean>;
  /**
   * The run's chain for a role (core's modelFor: the owner's pick, the shop's default, the build's, the rest of the shop's
   * list), for a call with no chain of its own: its first alias this call can use answers (onList), and a binding off it
   * is never called; none is a refusal before anything is counted. Null: the binding as given.
   */
  permitted?: (role: Role) => Promise<readonly string[] | null>;
  /**
   * Told of every call a model answered, before the caller sees the answer (and before a reply is checked against its
   * schema: a reply that fails it was still a call), with the adapter's usage: the spend ledger's writer. Awaited,
   * so a run's spend is written while the run is open; a writer that throws fails the call.
   */
  onUsage?: (call: ModelCall) => Promise<void>;
};

/**
 * One answered call: its role (`document` for a PDF read), the alias that answered (null for a binding no alias names),
 * the adapter's usage (null where the adapter reports none: speech-to-text, segment, a document) and whether it was
 * replayed from a recorded fixture rather than made.
 */
export type ModelCall = { role: Role | "document"; alias: string | null; provider: ProviderId; model: string; usage: Usage | null; replayed: boolean };

/** The alias that names a binding in a role, else null. */
export function aliasOf(b: { provider: ProviderId; model: string; alias?: string }, role: Role): string | null {
  if (b.alias) return b.alias;
  return Object.entries(MODEL_ALIASES).find(([, m]) => m.provider === b.provider && m.model === b.model && m.roles.includes(role))?.[0] ?? null;
}

/** Whether this call is replayed from a recorded fixture, not made. */
export const replayed = (d: Deps) => parseMode(d.mode ?? (d.env ?? process.env).MUNSHI_MODEL_MODE) === "recorded";

/** Tells the caller of an answered call (Deps.onUsage), if it asked. */
export async function told(d: Deps, call: ModelCall): Promise<void> {
  if (d.onUsage) await d.onUsage(call);
}

/**
 * A call with no chain, held to the run's chain for its role (Deps.permitted: core's modelFor, the owner's pick, the
 * shop's default, the build's, then the rest of the shop's list, put in fallback order), so the model AI staff names is
 * the model called. The chain's first alias whose provider `adapts` answers; outside recorded mode, the first of those
 * whose key the deployment has (as keyedBinding moves a call with no key), else that first. None: refused before
 * anything is counted (coded "off", like AI off). No `permitted`, or null from it: the binding as given.
 */
export async function onList(role: Role, b: RoleBinding, d: Deps, adapts: (p: ProviderId) => boolean = () => true): Promise<RoleBinding> {
  const list = d.permitted ? await d.permitted(role) : null;
  if (list === null) return b;
  const usable = fallbackOrder(list, role).flatMap((alias) => {
    const m = Object.hasOwn(CHAIN_ALIASES, alias) ? CHAIN_ALIASES[alias] : undefined;
    return m?.roles.includes(role) && adapts(m.provider) ? [{ provider: m.provider, model: m.model }] : [];
  });
  const env = d.env ?? process.env;
  const keyed = replayed(d) ? undefined : usable.find((u) => env[KEY_ENV[u.provider]]);
  const first = keyed ?? usable[0];
  if (!first) throw new ModelError(`no model on the shop's list serves role ${role}`, undefined, "off");
  return first;
}

/**
 * The binding a call with no chain starts from: the default for the role; in live mode, one whose key is unset gives
 * way to the next allowed alias that has one (config.ts keyedBinding).
 */
export function resolveBinding(role: Role, d: Deps): { provider: ProviderId; model: string } {
  const env = d.env ?? process.env;
  return keyedBinding(role, env, parseMode(d.mode ?? env.MUNSHI_MODEL_MODE) === "live");
}

export function baseUrl(provider: ProviderId): string {
  const u = BASE_URLS[provider];
  if (!u) throw new ModelError(`provider "${provider}" has no adapter yet`);
  return u.replace(/\/$/, "");
}

export function apiKey(provider: ProviderId, env: NodeJS.ProcessEnv): string {
  const k = env[KEY_ENV[provider]];
  // code "no_key": a chain moves past this binding (generate's fallsBack), naming the key, never a value.
  if (!k) throw new ModelError(`${KEY_ENV[provider]} is not set`, undefined, "no_key");
  return k;
}

/** Live or record mode: the binding's key, else a ModelError coded no_key, before any call is counted (recorded needs none). */
export function requireKey(provider: ProviderId, d: Deps): void {
  const env = d.env ?? process.env;
  if (parseMode(d.mode ?? env.MUNSHI_MODEL_MODE) !== "recorded") apiKey(provider, env);
}

/** Core's allow, asked before a call (it counts the call against the shop's caps): false is a ModelError coded "off". */
export async function allowCall(beforeCall?: () => Promise<boolean>): Promise<void> {
  if (beforeCall && !(await beforeCall())) throw new ModelError("AI is off for this shop, or its calls today are spent", undefined, "off");
}

export function openaiClient(provider: ProviderId, role: Role, d: Deps): OpenAI {
  return new OpenAI({
    apiKey: apiKey(provider, d.env ?? process.env),
    baseURL: baseUrl(provider),
    timeout: ROLE_TIMEOUT_MS[role],
    maxRetries: 0, // retries are ours (withRetry), so backoff and the 429/5xx rule are in one place
    ...(d.fetch ? { fetch: d.fetch } : {}),
  });
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

export const RETRIES = 3;

// `signal`: the caller's time is up. A backoff then ends at once, and the next attempt fails as aborted.
export async function withRetry<T>(fn: () => Promise<T>, d: Deps, signal?: AbortSignal): Promise<T> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = statusOf(e);
      if (attempt < RETRIES && !signal?.aborted && status !== undefined && (status === 429 || status >= 500)) {
        await Promise.race([sleep(500 * 2 ** attempt + Math.random() * 250), new Promise((r) => signal?.addEventListener("abort", r, { once: true }))]);
        continue;
      }
      if (e instanceof ModelError) throw e;
      // The SDK's own per-role timeout (not the caller's budget): a binding that did not answer, so the chain may move on.
      if (e instanceof OpenAI.APIConnectionTimeoutError) throw new ModelError("model call timed out", undefined, "timeout", d.env ?? process.env);
      const code = (e as { code?: unknown })?.code;
      throw new ModelError(e instanceof Error ? e.message : "model call failed", status, typeof code === "string" ? code : undefined, d.env ?? process.env);
    }
  }
}
