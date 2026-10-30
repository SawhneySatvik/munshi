// @vitest-environment node
// BP-DEV-1, the developer portal's recorded examples and its SDK download, on a real v2 database with the two showcase
// shops built as `pnpm dev` builds them (sites verified by the seed's operator):
//   DEV1-EX  every published JSON read in the route table has a recorded example in docs/kit/examples.json, the example
//            parses with that route's response schema, and the same request answers 200 against a fresh showcase now;
//   DEV1-SDK the tarball the portal offers is the file in public/, its sha256 is the one the portal shows, it has no
//            dependencies, and it was packed from the SDK as it stands (its declarations name every client method).
// MUNSHI_KIT_EXAMPLES=write records the examples afresh (then `pnpm kit` bundles them for the portal).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { withTx } from "@munshi/core";
import { routes } from "@munshi/contracts";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Showcase, seedShowcase } from "../../../db/seed/showcase.ts";
import { swapApiPorts } from "../lib/api/deps";
import * as api from "../lib/api/routes";
import { KIT } from "../lib/kit";
import { call, freshIp, type Handler, publish, RATE } from "./api/fixture";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";

const EXAMPLES = new URL("../../../docs/kit/examples.json", import.meta.url);
const PUBLIC = new URL("../public", import.meta.url);

type Example = { request: string; status: number; body: unknown };

let db: WebDb;
let s: Showcase;
let requests: Record<string, { handler: Handler; path: string; params: Record<string, string>; query?: Record<string, string> }>;

beforeAll(async () => {
  db = await openWebDb();
  const owner = await db.migrator();
  try {
    s = await seedShowcase({ app: db.app, pub: db.as("munshi_public"), platform: db.as("munshi_platform") }, owner);
  } finally {
    await owner.end();
  }
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: Buffer.alloc(32, 1),
    demoTenantId: s.elite.tenantId,
    rateSecret: RATE,
    publicDatabaseUrl: urlAs(db, "munshi_public"),
  };
  // Elite's seed stops short of a public site; as `pnpm dev` does (sitesDemo), its look, its stylists' public profiles
  // under their seed names, and a release.
  const site = await withTx(db.app, { kind: "member", session: s.elite.owner }, async (c) => {
    const id = (await c.query<{ id: string }>("select id::text as id from ops.site order by created_at limit 1")).rows[0]?.id as string;
    await c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{}', 'inter')`, [s.elite.tenantId, id]);
    for (const [name, staffId] of s.elite.staff)
      await c.query(
        `insert into ops.staff_public (tenant_id, staff_id, shop_id, display_name, consent_at)
         select tenant_id, staff_id, shop_id, $2, now() - interval '1 minute' from books.staff_terms where staff_id = $1 order by effective_from desc limit 1`,
        [staffId, name],
      );
    return id;
  });
  await publish(db, s.elite.tenantId, site);
  const shop = [...s.elite.shops.values()][0] as string;
  const service = [...s.elite.services.values()][0] as string;
  const code = (await db.admin.query<{ code: string }>("select code from books.order where id = $1", [s.prabhave.orders.get("ready")])).rows[0]?.code as string;
  const at = (slug: string, rest = "") => `/api/v1/sites/${slug}${rest}`;
  requests = {
    site: { handler: api.site, path: at("elite"), params: { slug: "elite" } },
    catalogue: { handler: api.catalogue, path: at("prabhave", "/catalogue"), params: { slug: "prabhave" }, query: { limit: "3" } },
    services: { handler: api.services, path: at("elite", "/services"), params: { slug: "elite" }, query: { limit: "3" } },
    packages: { handler: api.packages, path: at("elite", "/packages"), params: { slug: "elite" }, query: { limit: "2" } },
    offers: { handler: api.offers, path: at("prabhave", "/offers"), params: { slug: "prabhave" } },
    stylists: { handler: api.stylists, path: at("elite", "/stylists"), params: { slug: "elite" }, query: { limit: "3" } },
    slots: { handler: api.slots, path: at("elite", "/slots"), params: { slug: "elite" }, query: { shop, service, date: s.asOf } },
    orderStatus: { handler: api.orderStatus, path: at("prabhave", `/orders/${code}`), params: { slug: "prabhave", code } },
  };
}, 300_000);
afterAll(async () => {
  swapApiPorts({});
  await db?.close();
});

const ask = async (op: string) => {
  const r = requests[op];
  if (!r) throw new Error(`kit: no request for ${op}`);
  const res = await call(r.handler, r.path, r.params, { ...(r.query ? { query: r.query } : {}), ip: freshIp() });
  const qs = r.query ? `?${new URLSearchParams(r.query)}` : "";
  return { request: `GET ${r.path}${qs}`, status: res.status, body: await res.json() } as Example;
};

// The published JSON reads: GETs that are not deferred and answer JSON. `ref` is recorded from a catalogue figure.
const READS = Object.entries(routes)
  .filter(([, r]) => r.method === "GET" && !r.deferred && typeof r.response !== "string")
  .map(([op]) => op);

test("DEV1-EX every published read has a recorded example that parses with its schema and still answers now", async () => {
  const fresh: Record<string, Example> = {};
  for (const op of READS.filter((o) => o !== "ref")) fresh[op] = await ask(op);
  const price = JSON.stringify(fresh.catalogue?.body).match(/⟨snap:([0-9a-f-]{36})·([0-9]+)·([a-z_]+)⟩/);
  expect(price, "a catalogue figure's ref").not.toBeNull();
  const [, snapshot, row, col] = price as RegExpMatchArray;
  requests.ref = { handler: api.ref, path: `/api/v1/sites/prabhave/refs/${snapshot}/${row}/${col}`, params: { slug: "prabhave", snapshot: snapshot as string, row: row as string, col: col as string } };
  fresh.ref = await ask("ref");
  for (const op of READS) expect([op, fresh[op]?.status]).toEqual([op, 200]);

  if (process.env.MUNSHI_KIT_EXAMPLES === "write") writeFileSync(EXAMPLES, `${JSON.stringify(fresh, null, 2)}\n`);
  const stored = JSON.parse(readFileSync(EXAMPLES, "utf8")) as Record<string, Example>;
  expect(Object.keys(stored).sort()).toEqual([...READS].sort());
  for (const op of READS) {
    const ex = stored[op] as Example;
    expect([op, ex.status]).toEqual([op, 200]);
    const parsed = (routes[op as keyof typeof routes].response as { safeParse: (v: unknown) => { success: boolean; error?: unknown } }).safeParse(ex.body);
    expect([op, parsed.success, parsed.error]).toEqual([op, true, undefined]);
    // The same route and shop; an order code and a ref differ from build to build.
    const route = (e: Example | undefined) => e?.request.split("?")[0]?.replace(/\/(orders|refs)\/.*/, "/$1/…");
    expect([op, route(ex)]).toEqual([op, route(fresh[op])]);
  }
  // The portal shows exactly the stored examples.
  expect(KIT.examples).toEqual(stored);
}, 120_000);

test("DEV1-SDK the offered tarball is the file in public/, at the sha256 shown, with no dependencies, packed from the SDK as it stands", () => {
  const file = readFileSync(new URL(`.${KIT.sdk.href}`, `${PUBLIC.href}/`));
  expect(createHash("sha256").update(file).digest("hex")).toBe(KIT.sdk.sha256);
  const tar = gunzipSync(file);
  // A tar member: a 512-byte header (its name at 0, its size in octal at 124) and the body padded to 512.
  const members = new Map<string, string>();
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = tar.subarray(at, at + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = Number.parseInt(tar.subarray(at + 124, at + 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    members.set(name, tar.subarray(at + 512, at + 512 + size).toString("utf8"));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  const pkg = JSON.parse(members.get("package/package.json") ?? "{}") as { name?: string; version?: string; dependencies?: object };
  expect([pkg.name, pkg.version, pkg.dependencies]).toEqual(["@munshi/sdk", KIT.sdk.version, {}]);
  const types = members.get("package/dist/index.d.ts") ?? "";
  const source = readFileSync(new URL("../../../packages/sdk/src/index.ts", import.meta.url), "utf8");
  const methods = [...source.matchAll(/^ {4}([a-zA-Z]+): (?:async )?\(/gm)].map((m) => m[1] as string);
  expect(methods.length).toBeGreaterThan(10);
  for (const m of methods) expect(types, m).toContain(`${m}: `);
});
