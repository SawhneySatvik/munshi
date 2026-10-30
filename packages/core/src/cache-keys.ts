// The cache's keys and its one read path (BLUEPRINT §4.8, decision 19; the port is packages/adapters/cache). RLS does
// not protect Redis, so every key starts with a tenant id, `munshi:<deployment>:t:<tenant_id>:<kind>:<id>`, built here
// only, from a tenant the server resolved (a slug's tenant), never from request input; the platform's own slug
// directory sits under the nil tenant id, PLATFORM_TENANT.
//
// What is cached (only immutable or pinned rows, so a cached figure still traces to a stored cell):
//   slug      → the tenant id the slug names, or null                     10 s, under PLATFORM_TENANT
//   site      → the latest release id of a verified site, or null          10 s, dropped on publish and on verify
//   release   → a release's look, time and pinned snapshot ids, by its id  a day (a release never changes)
//   snapshot  → a pinned snapshot's columns and rows, by its id            a day (a pinned snapshot never changes)
// A null is cached like any value, so an unknown slug and an unverified site answer the same 404 from the cache as from
// Postgres (VERIFY1). Live overlays (held flags, offers in effect, slots), idempotency, rate counters, sessions and
// every balance are never cached. Each call has a 50 ms budget: a slow, failing or absent cache reads Postgres, and a
// cache that ran out of time is skipped for a second.
import type { CachePort } from '@munshi/adapters/cache';

declare const TENANT: unique symbol;
/** A tenant id the server resolved (a session's or a slug's), the only first argument cacheKey takes. */
export type TenantId = string & { readonly [TENANT]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PART = /^[a-z0-9-]{1,80}$/;

export function asTenantId(id: string): TenantId {
  if (!UUID.test(id)) throw new Error('cache: a tenant id is a uuid');
  return id as TenantId;
}

/** The platform's own entries (the slug directory), which belong to no shop. */
export const PLATFORM_TENANT = asTenantId('00000000-0000-0000-0000-000000000000');

export type CacheKind = 'slug' | 'site' | 'release' | 'snapshot';
export const SHORT_TTL = 10;
export const PINNED_TTL = 86_400;
export const CACHE_BUDGET_MS = 50;
const REST_MS = 1000;

// undefined: not yet wired (the app wires its adapter on first use); null: wired off.
let wired: { port: CachePort; deployment: string } | null | undefined;
let restUntil = 0;

/** Wire the cache (null for none). The app does this once; tests swap it. */
export function wireCache(port: CachePort | null, deployment = 'demo'): void {
  wired = port ? { port, deployment } : null;
  restUntil = 0;
}
export const cacheWired = (): boolean => wired !== undefined;

export function cacheKey(tenantId: TenantId, kind: CacheKind, ...parts: string[]): string {
  if (!UUID.test(tenantId) || !parts.every((p) => PART.test(p))) throw new Error('cache: a key part is outside its grammar');
  return [`munshi:${wired?.deployment ?? 'demo'}:t:${tenantId}:${kind}`, ...parts].join(':');
}

function budget<T>(op: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      restUntil = Date.now() + REST_MS;
      reject(new Error('cache: over budget'));
    }, CACHE_BUDGET_MS);
  });
  return Promise.race([op, late]).finally(() => clearTimeout(timer));
}

const usable = () => (wired && Date.now() >= restUntil ? wired.port : null);

/**
 * `load()`'s value through the cache under `key`. A hit is the JSON stored; a miss, an error or a call over budget
 * loads from Postgres and stores the value without waiting. `keepNull: false` stores no null (a pinned row that must
 * exist is never remembered as missing).
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>, opts: { keepNull?: boolean } = {}): Promise<T> {
  const port = usable();
  if (port) {
    try {
      const hit = await budget(port.get(key));
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      // the cache is down, slow or holds something unreadable: Postgres answers
    }
  }
  const value = await load();
  const store = usable();
  if (store && value !== undefined && (value !== null || opts.keepNull !== false)) void budget(store.set(key, JSON.stringify(value), ttlSeconds)).catch(() => {});
  return value;
}

/** Drop entries now (a publish, a verification). A cache that cannot be reached is left to its short time to live. */
export async function dropCached(keys: string[]): Promise<void> {
  const port = usable();
  if (port) await budget(port.del(keys)).catch(() => {});
}

/** The site entry of a tenant, dropped when it publishes or the platform verifies or hides its site. */
export const dropSite = (tenantId: string): Promise<void> => dropCached([cacheKey(asTenantId(tenantId), 'site')]);
