import OpenAI from "openai";
import { BASE_URLS, binding, KEY_ENV, parseEdition, ROLE_TIMEOUT_MS, type RoleBinding } from "../config.ts";
import { ModelError } from "./redact.ts";
import type { ProviderId, Role } from "./types.ts";

/** One binding of a run's chain: the alias it came from, for the trace and "Written by". */
export type ChainBinding = RoleBinding & { alias: string };

export type Deps = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  fixturesDir?: string;
  mode?: string;
  edition?: string;
  /**
   * The models a call of this role may use, in order (core's modelFor, through the run's port): the first answers; in
   * live mode a 429, a 5xx or a timeout moves to the next. Empty: no model is allowed, and the call is refused. Absent:
   * the edition's binding, as before.
   */
  chain?: (role: Role) => Promise<ChainBinding[]>;
  /** Asked before each fallback attempt (the caller asked for the first): core's allow, which counts that call. */
  allowAgain?: (role: Role) => Promise<boolean>;
};

/** One edition rule for every role: the injected edition, else MUNSHI_EDITION from the injected env. */
export function resolveBinding(role: Role, d: Deps): { provider: ProviderId; model: string } {
  return binding(role, parseEdition(d.edition ?? (d.env ?? process.env).MUNSHI_EDITION));
}

/** segment and voice speak Meta's own wire formats; any other provider has no adapter. */
export function resolveMetaBinding(role: "segment" | "voice", d: Deps): { provider: ProviderId; model: string } {
  const b = resolveBinding(role, d);
  if (b.provider !== "meta") throw new ModelError(`${role}: provider ${b.provider} has no adapter`);
  return b;
}

export function baseUrl(provider: ProviderId): string {
  const u = BASE_URLS[provider];
  if (!u) throw new ModelError(`provider "${provider}" has no adapter yet`);
  return u.replace(/\/$/, "");
}

export function apiKey(provider: ProviderId, env: NodeJS.ProcessEnv): string {
  const k = env[KEY_ENV[provider]];
  if (!k) throw new ModelError(`${KEY_ENV[provider]} is not set`);
  return k;
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
