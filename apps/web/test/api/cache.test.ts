// @vitest-environment node
// The cache: the public API's read path with a real
// redis-server (its own process on a socket in a temp folder, stopped by its PID) on a real v2 database, never a double.
//   - (cached) an unknown slug and an unverified site answer the same 404 bytes when the answer comes from the
//     cache, whose negative entries hold them; verifying a site and publishing a release drop its entry, so the
//     next request answers at once;
//   - every key that reaches the cache starts with a tenant id, the requested site's (or the platform's for the
//     slug directory); cacheKey takes only a TenantId; nothing but core's cache-keys.ts and the app's wiring
//     imports the cache port;
//   - every public read built from the cached release, with the live overlays (a piece held since, the slots), is
//     byte-identical to one built fresh from Postgres for the same release, refs included;
//   - a request for tenant B never reads a key planted for tenant A;
//   - with Redis stopped, or paused (slow), every API route still answers as it does with no cache.
// MUNSHI_CACHE_PERF=1 also measures the reads' latency with no cache, the memory cache and Redis (p50 and p95).
// Red-proofs: db/test/v2/sabotage/wid-cache.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type CachePort, memoryCache, redisCache, redisTarget } from "@munshi/adapters/cache";
import { asTenantId, cacheKey, PLATFORM_TENANT, runCommand, wireCache } from "@munshi/core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type RedisServer, startRedis } from "../../../../packages/adapters/test/redis-server.ts";
import { plant } from "../../../../db/test/v2/gates/lib.ts";
import { swapApiPorts } from "../../lib/api/deps";
import * as api from "../../lib/api/routes";
import { type ApiShop, call, freshIp, type Handler, openWorld, publish, text, tomorrow, verify, type World, writeHeaders } from "./fixture";

const REPO = path.join(import.meta.dirname, "../../../..");
let w: World;
let server: RedisServer;
let redis: CachePort;
const keys: string[] = [];

// Redis, with every key the API sends it recorded.
const recorded = (port: CachePort): CachePort => ({
  get: (k) => {
    keys.push(k);
    return port.get(k);
  },
  set: (k, v, t) => {
    keys.push(k);
    return port.set(k, v, t);
  },
  del: (ks) => {
    keys.push(...ks);
    return port.del(ks);
  },
  close: () => port.close(),
});
const toRedis = () => wireCache(recorded(redis), "demo");

beforeAll(async () => {
  w = await openWorld();
  await w.db.sabotage();
  server = await startRedis();
  redis = redisCache(redisTarget(server.url) as NonNullable<ReturnType<typeof redisTarget>>);
  toRedis();
}, 300_000);
afterAll(async () => {
  wireCache(null);
  swapApiPorts({});
  await redis?.close();
  await server?.stop();
  await w?.close();
});

const get = (handler: Handler, p: string, params: Record<string, string>, query?: Record<string, string>) =>
  call(handler, p, params, { ...(query ? { query } : {}), ip: freshIp() });

// Every public read of shop `s`, as [name, run]: each answered by its route handler.
async function readsOf(s: ApiShop): Promise<[string, () => Promise<Response>][]> {
  const base = `/api/v1/sites/${s.slug}`;
  const slug = { slug: s.slug };
  const cat = (await (await get(api.catalogue, `${base}/catalogue`, slug)).json()) as { data?: { variants: { price: { ref: string } }[] }[] };
  const ref = cat.data?.[0]?.variants[0]?.price.ref ?? "⟨snap:00000000-0000-0000-0000-000000000000·0·price⟩";
  const [, snapshot, row, col] = /^⟨snap:([0-9a-f-]{36})·(\d+)·([a-z_]+)⟩$/.exec(ref) as unknown as string[];
  return [
    ["site", () => get(api.site, base, slug)],
    ["catalogue", () => get(api.catalogue, `${base}/catalogue`, slug)],
    ["catalogue?limit=1", () => get(api.catalogue, `${base}/catalogue`, slug, { limit: "1" })],
    ["services", () => get(api.services, `${base}/services`, slug)],
    ["packages", () => get(api.packages, `${base}/packages`, slug)],
    ["offers", () => get(api.offers, `${base}/offers`, slug)],
    ["stylists", () => get(api.stylists, `${base}/stylists`, slug)],
    ["slots", () => get(api.slots, `${base}/slots`, slug, { shop: s.shopId, service: s.items.haircut || s.shopId, date: tomorrow() })],
    ["ref", () => get(api.ref, `${base}/refs/${snapshot}/${row}/${col}`, { ...slug, snapshot: snapshot as string, row: row as string, col: col as string })],
    ["orderStatus", () => get(api.orderStatus, `${base}/orders/ORD-ZZZZ`, { ...slug, code: "ORD-ZZZZ" })],
    ["media", () => get(api.media, `${base}/media/${s.shopId}.svg`, { ...slug, file: `${s.shopId}.svg` })],
  ];
}

// Each read's status, headers and body bytes.
const answers = async (reads: [string, () => Promise<Response>][]) => {
  const out: Record<string, Awaited<ReturnType<typeof text>>> = {};
  for (const [name, run] of reads) out[name] = await text(await run());
  return out;
};
// The same reads with no cache at all: Postgres only.
async function fresh<T>(fn: () => Promise<T>): Promise<T> {
  wireCache(null);
  try {
    return await fn();
  } finally {
    toRedis();
  }
}

test("(cached) an unknown slug and an unverified site answer the same 404 bytes from the cache; verifying and publishing drop the site's entry", async () => {
  const site = (slug: string) => get(api.site, `/api/v1/sites/${slug}`, { slug });
  const unknown = `nobody-${w.a.slug.slice(-8)}`;
  const first = [await text(await site(unknown)), await text(await site(w.b.slug))];
  const again = [await text(await site(unknown)), await text(await site(w.b.slug))];
  for (const a of [...first, ...again]) expect(a).toEqual(first[0]);
  expect(first[0]?.status).toBe(404);
  // The second answers came from negative entries.
  expect(await redis.get(cacheKey(PLATFORM_TENANT, "slug", unknown))).toBe("null");
  expect(await redis.get(cacheKey(asTenantId(w.b.tenantId), "site"))).toBe("null");

  await verify(w, w.b.tenantId);
  expect((await site(w.b.slug)).status).toBe(200);

  const before = (await (await site(w.a.slug)).json()) as { release: { id: string } };
  expect(before.release.id).toBe(w.a.releaseId);
  const next = await publish(w.db, w.a.tenantId, w.a.siteId);
  const after = (await (await site(w.a.slug)).json()) as { release: { id: string } };
  expect(after.release.id).toBe(next);
});

test("every key that reaches the cache starts with a tenant id, the requested site's; cacheKey takes only a TenantId; only core's cache-keys.ts and the wiring import the port", async () => {
  keys.length = 0;
  for (const s of [w.a, w.b]) for (const [, run] of await readsOf(s)) await run();
  await send(api.order, w.a, "/orders", { shopId: w.a.shopId, channel: "widget", lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] });
  expect(keys.length).toBeGreaterThan(20);
  const KEY = /^munshi:demo:t:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(slug|site|release|snapshot)(:[a-z0-9-]+)?$/;
  const bad = keys.filter((k) => {
    const m = KEY.exec(k);
    if (!m) return true;
    const [, tenant, kind] = m;
    return kind === "slug" ? tenant !== PLATFORM_TENANT : tenant !== w.a.tenantId && tenant !== w.b.tenantId;
  });
  expect(bad).toEqual([]);
  expect(new Set(keys.map((k) => KEY.exec(k)?.[2]))).toEqual(new Set(["slug", "site", "release", "snapshot"]));
  expect(() => cacheKey(asTenantId(w.a.tenantId), "snapshot", "Not A Part")).toThrow();
  expect(() => asTenantId("a-slug")).toThrow();
  if (process.env.NEVER) {
    // @ts-expect-error a plain string is not a TenantId: a key is built only from a tenant the server resolved
    cacheKey(w.a.tenantId, "site");
  }

  // The source scan: who imports the port.
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".") || name === "test") continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(name)) sources.push(p);
    }
  };
  for (const top of ["apps", "packages", "db/src", "db/seed", "scripts"]) walk(path.join(REPO, top));
  const importers = sources.filter((p) => /from ["']@munshi\/adapters\/cache["']|adapters\/cache\/index\.ts["']/.test(readFileSync(p, "utf8"))).map((p) => path.relative(REPO, p));
  expect(importers.sort()).toEqual(["apps/web/lib/api/deps.ts", "packages/core/src/cache-keys.ts"]);
  expect(sources.filter((p) => /from ["'](redis|ioredis|@redis\/client)["']/.test(readFileSync(p, "utf8")))).toEqual([]);
  const deps = readFileSync(path.join(REPO, "apps/web/lib/api/deps.ts"), "utf8");
  expect(deps.match(/cacheFor\(/g)?.length).toBe(1);
  expect(deps).toContain("wireCache(cacheFor(c.cacheUrl)");
});

async function send(handler: Handler, s: ApiShop, route: string, body: unknown) {
  return call(handler, `/api/v1/sites/${s.slug}${route}`, { slug: s.slug }, { body, ip: freshIp(), headers: writeHeaders(s) });
}

test("every public read from the cached release plus the live overlays is byte-identical to one built fresh, refs included", async () => {
  const reads = await readsOf(w.a);
  await answers(reads); // warm: the release and its snapshots are now in Redis
  const warm = keys.length;
  // A live overlay changes after the cache was filled: a piece is now held.
  await plant(
    w.db.admin,
    `insert into ops.reservation (tenant_id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, notice_version, consent_version, state, held_until)
     values ($1, $2, $3, 1000, 'Visitor (sample)', '+910000000000', 'v1', 'v1', 'held', now() + interval '1 hour')`,
    [w.a.tenantId, w.a.siteId, w.a.items.saree],
  );
  const cachedAnswers = await answers(reads);
  expect(keys.length).toBeGreaterThan(warm);
  const freshAnswers = await fresh(() => answers(reads));
  expect(Object.keys(cachedAnswers).length).toBe(11);
  for (const name of Object.keys(freshAnswers)) expect([name, cachedAnswers[name]]).toEqual([name, freshAnswers[name]]);
  const catalogue = JSON.parse(cachedAnswers.catalogue?.body ?? "{}") as { data: { variants: { id: string; held: boolean; price: { ref: string } }[] }[] };
  const saree = catalogue.data.flatMap((i) => i.variants).find((v) => v.id === w.a.items.saree);
  expect(saree?.held).toBe(true);
  expect(saree?.price.ref).toMatch(/^⟨snap:/);
  expect((JSON.parse(cachedAnswers.slots?.body ?? "{}") as { slots: unknown[] }).slots.length).toBeGreaterThan(0);
});

test("a request for tenant B never reads a key planted for tenant A", async () => {
  // A's own entries, as A's requests leave them, and one planted beside them.
  await answers(await readsOf(w.a));
  await redis.set(cacheKey(asTenantId(w.a.tenantId), "site"), JSON.stringify(w.a.releaseId), 60);
  await redis.del([cacheKey(asTenantId(w.b.tenantId), "site")]);
  const reads = await readsOf(w.b);
  const cachedAnswers = await answers(reads);
  const freshAnswers = await fresh(() => answers(reads));
  for (const name of Object.keys(freshAnswers)) expect([name, cachedAnswers[name]]).toEqual([name, freshAnswers[name]]);
  const site = JSON.parse(cachedAnswers.site?.body ?? "{}") as { slug: string; release: { id: string } };
  expect([site.slug, site.release.id]).toEqual([w.b.slug, w.b.releaseId]);
});

test("with Redis paused (slow) or stopped, every API route answers as it does with no cache", async () => {
  const reads = await readsOf(w.a);
  const expected = await fresh(() => answers(reads));
  const order = { shopId: w.a.shopId, channel: "widget", lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] };

  server.pause();
  const started = Date.now();
  const slow = await answers(reads);
  const slowMs = Date.now() - started;
  expect(slow).toEqual(expected);
  expect(slowMs).toBeLessThan(10_000);
  expect((await send(api.order, w.a, "/orders", order)).status).toBe(201);
  server.resume();

  await server.stop();
  const stopped = await answers(reads);
  expect(stopped).toEqual(expected);
  expect((await send(api.order, w.a, "/orders", order)).status).toBe(201);
  const enquiry = { shopId: w.a.shopId, name: "Asha", phone: "+910000000000", message: "Open on Sunday?", whatsappUpdates: false, noticeVersion: "v1", consentVersion: "v1", botToken: "XXXX.DUMMY.TOKEN.XXXX", website: "" };
  expect((await send(api.enquire, w.a, "/enquiries", enquiry)).status).toBe(202);
  server = await startRedis(); // afterAll stops this one
  redis = redisCache(redisTarget(server.url) as NonNullable<ReturnType<typeof redisTarget>>);
  toRedis();
});

test.skipIf(!process.env.MUNSHI_CACHE_PERF)("the public reads' latency with no cache, the memory cache and Redis", async () => {
  const N = Number(process.env.MUNSHI_CACHE_PERF_N ?? 300);
  // A shop-sized catalogue: MUNSHI_CACHE_PERF_ITEMS more goods, priced, then a release.
  const more = Number(process.env.MUNSHI_CACHE_PERF_ITEMS ?? 0);
  for (let i = 0; i < more; i++) {
    const { itemId } = (await runCommand(w.db.app, w.a.owner, "item.create", { name: `Sample good ${i}`, unit: "piece", category: "Sample", effectiveFrom: "2026-01-01T00:00:00Z" })) as { itemId: string };
    await runCommand(w.db.app, w.a.owner, "price.set", { itemId, amountMinor: 1000 + i, effectiveFrom: "2026-01-01T00:00:00Z" });
  }
  if (more) await publish(w.db, w.a.tenantId, w.a.siteId);
  const reads = (await readsOf(w.a)).filter(([name]) => ["site", "catalogue", "offers", "ref"].includes(name));
  const modes: [string, CachePort | null][] = [
    ["none (Postgres only)", null],
    ["memory", memoryCache()],
    ["redis (unix socket)", redis],
  ];
  const rows: string[] = [];
  for (const [mode, port] of modes) {
    wireCache(port, "demo");
    for (const [name, run] of reads) {
      for (let i = 0; i < 20; i++) await run(); // warm the pool and the cache
      const ms: number[] = [];
      for (let i = 0; i < N; i++) {
        const t = performance.now();
        const r = await run();
        await r.arrayBuffer();
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      const at = (q: number) => (ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] as number).toFixed(2);
      rows.push(`${mode.padEnd(22)} ${name.padEnd(10)} n=${N} p50=${at(0.5)} ms p95=${at(0.95)} ms`);
    }
  }
  toRedis();
  console.log(`cache perf\n${rows.join("\n")}`);
}, 600_000);
