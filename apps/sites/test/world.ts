// The page tests' world: a fresh v2 database (db/test/v2's harness, never mocked) with the two showcase tenants seeded
// as `pnpm dev` seeds them (db/seed/showcase.ts, then dev.ts's sitesDemo: each site's origin and publishable key, and
// Elite's look, public stylists and release), and apps/web's /api/v1 route handlers answering every request the site
// makes. A server-side read goes to SERVER and carries no Origin; a browser call goes to BROWSER and carries the
// site's Origin, and gets its answer only with the CORS header naming that origin, as a browser would.
import { randomBytes, randomUUID } from "node:crypto";
import { addDays, businessDate, publishRelease, switchCapability, type Capability, type Session, openSession, withTx } from "@munshi/core";
import type pg from "pg";
import { vi } from "vitest";
import { sitesDemo } from "../../../db/src/dev.ts";
import { type Showcase, seedShowcase } from "../../../db/seed/showcase.ts";
import { openTestDb, type TestDb } from "../../../db/test/v2/db.ts";
import * as api from "../../web/lib/api/routes.ts";
import type { Config } from "../../web/lib/server/config.ts";
import { state } from "../../web/test/app-state.ts";
import { urlAs } from "../../web/test/home-db.ts";

export { NotFound } from "./not-found.ts";

export const SERVER = "http://api.server.test";
export const BROWSER = "http://api.browser.test";
export const ORIGIN = "http://localhost:3150";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
const ROUTES: [method: string, pattern: RegExp, handler: Handler, names: string[]][] = [
  ["GET", /^\/api\/v1\/sites\/([^/]+)$/, api.site, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/catalogue$/, api.catalogue, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/services$/, api.services, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/packages$/, api.packages, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/offers$/, api.offers, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/stylists$/, api.stylists, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/slots$/, api.slots, ["slug"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/refs\/([^/]+)\/([^/]+)\/([^/]+)$/, api.ref, ["slug", "snapshot", "row", "col"]],
  ["GET", /^\/api\/v1\/sites\/([^/]+)\/orders\/([^/]+)$/, api.orderStatus, ["slug", "code"]],
  ["POST", /^\/api\/v1\/sites\/([^/]+)\/holds$/, api.hold, ["slug"]],
  ["DELETE", /^\/api\/v1\/sites\/([^/]+)\/holds\/([^/]+)$/, api.releaseHold, ["slug", "id"]],
  ["POST", /^\/api\/v1\/sites\/([^/]+)\/bookings$/, api.book, ["slug"]],
  ["POST", /^\/api\/v1\/sites\/([^/]+)\/reservations$/, api.reserve, ["slug"]],
  ["POST", /^\/api\/v1\/sites\/([^/]+)\/orders$/, api.order, ["slug"]],
];

export type Sent = { method: string; path: string; status: number; browser: boolean; headers: Record<string, string> };

export type World = {
  db: TestDb;
  app: pg.Pool;
  showcase: Showcase;
  keys: Record<string, string>;
  sent: Sent[];
  /** The next answer to a write on this path suffix is lost on the way back, after the API has handled it. */
  lose: { next: string | null };
  owner: (slug: "elite" | "prabhave") => Promise<Session>;
  /** Switch a capability and publish a fresh release, as the owner would. */
  capability: (slug: "elite" | "prabhave", capability: Capability, on: boolean) => Promise<void>;
  q: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
  close: () => Promise<void>;
};

let ip = 0;

export async function openSites(slug: "elite" | "prabhave"): Promise<World> {
  const db = await openTestDb();
  const app = db.as("munshi_app");
  const owner = await db.migrator();
  const asOf = addDays(businessDate(new Date(), "Asia/Kolkata"), 1);
  const showcase = await seedShowcase({ app, pub: db.as("munshi_public"), platform: db.as("munshi_platform") }, owner, {
    asOf,
    secrets: { identitySecret: "identity-secret-for-the-sites-test-00001", platformSecret: "platform-secret-for-the-sites-test-00001" },
  });
  const made = await sitesDemo(app, owner, [{ tenantId: showcase.elite.tenantId, stylists: showcase.elite.staff }, { tenantId: showcase.prabhave.tenantId }], ORIGIN);
  const keys = Object.fromEntries(made.map((k) => [k.slug, k.key]));
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: randomUUID(),
    rateSecret: "rate-secret-for-the-sites-tests-only-0001",
    publicDatabaseUrl: urlAs(db, "munshi_public"),
  } as Config;
  process.env.MUNSHI_API_URL = SERVER;
  process.env.MUNSHI_PUBLIC_API_URL = BROWSER;
  process.env.MUNSHI_SITE_KEY = keys[slug] ?? "";

  const sent: Sent[] = [];
  const lose = { next: null as string | null };
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const browser = url.origin === BROWSER;
    if (!browser && url.origin !== SERVER) throw new TypeError("test: the site called a host other than the API");
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    if (browser) headers.set("origin", ORIGIN);
    ip = (ip % 250) + 1;
    headers.set("x-forwarded-for", `203.0.113.${ip}`);
    const route = ROUTES.find(([m, p]) => m === method && p.test(url.pathname));
    if (!route) return new Response(null, { status: 404 });
    const [, pattern, handler, names] = route;
    const m = pattern.exec(url.pathname) as RegExpExecArray;
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] as string)]));
    const res = await handler(new Request(url, { method, headers, ...(init.body ? { body: init.body as string } : {}) }), { params: Promise.resolve(params) });
    sent.push({ method, path: url.pathname, status: res.status, browser, headers: Object.fromEntries(headers.entries()) });
    if (browser && res.headers.get("access-control-allow-origin") !== ORIGIN) throw new TypeError("Failed to fetch (CORS)");
    if (method !== "GET" && lose.next && url.pathname.endsWith(lose.next)) {
      lose.next = null;
      throw new TypeError("Failed to fetch (the answer was lost)");
    }
    return res;
  });

  const tenant = (s: "elite" | "prabhave") => (s === "elite" ? showcase.elite.tenantId : showcase.prabhave.tenantId);
  const ownerOf = async (s: "elite" | "prabhave") => {
    const t = s === "elite" ? showcase.elite : showcase.prabhave;
    return (await openSession(app, t.tenantId, t.owner.memberId as string)) as Session;
  };
  return {
    db,
    app,
    showcase,
    keys,
    sent,
    lose,
    owner: ownerOf,
    capability: async (s, capability, on) => {
      await switchCapability(app, await ownerOf(s), capability, on);
      const tenantId = tenant(s);
      const { rows } = await withTx(app, { kind: "system", tenantId }, (c) =>
        c.query<{ site: string; look: string }>(
          "select s.id::text as site, (select l.id::text from ops.site_look l where l.site_id = s.id order by l.created_at desc limit 1) as look from ops.site s limit 1",
        ),
      );
      await owner.query("begin");
      try {
        await owner.query("set local role munshi_owner");
        await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
        await publishRelease(owner as unknown as pg.PoolClient, { siteId: rows[0]?.site as string, lookId: rows[0]?.look as string });
        await owner.query("commit");
      } catch (err) {
        await owner.query("rollback");
        throw err;
      }
    },
    q: async <R>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows as R[],
    close: async () => {
      vi.unstubAllGlobals();
      const held = globalThis as { munshiPublicPool?: pg.Pool | undefined };
      await held.munshiPublicPool?.end();
      held.munshiPublicPool = undefined;
      await owner.end();
      await db.close();
    },
  };
}
