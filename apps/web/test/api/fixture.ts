// The public API's test world, built through core's real paths in a fresh v2 database (never mocked): shop A, a salon
// with goods, a service, a package plan, offers, a rostered stylist with a public profile, a site taking live slots,
// its publishable key, look and published release, verified by an operator's approved change; and shop B, a kirana
// whose site is published but not verified. The routes are called as Next calls them, with a Request and its params.
import { randomBytes, randomUUID } from "node:crypto";
import { addDays, businessDate, issueSiteKey, publishRelease, runCommand, type Session, switchCapability, withTx, createTenant } from "@munshi/core";
import type pg from "pg";
import { firstOperator, type Operator, proposeAndApprove } from "../../../../db/test/v2/core/platform/fixture.ts";
import type { Config } from "../../lib/server/config";
import { state } from "../app-state";
import { openWebDb, urlAs, type WebDb } from "../home-db";

export const RATE = "rate-secret-for-the-api-tests-only-000001";
export const TZ = "Asia/Kolkata";
export const tomorrow = () => addDays(businessDate(new Date(), TZ), 1);

export type ApiShop = {
  tenantId: string;
  slug: string;
  owner: Session;
  shopId: string;
  siteId: string;
  key: string;
  keyId: string;
  origin: string;
  releaseId: string;
  items: { [name: string]: string } & { tea: string; saree: string; haircut: string; plan: string };
  staffId: string;
  offerId: string;
};
export type World = { db: WebDb; a: ApiShop; b: ApiShop; op: Operator; close: () => Promise<void> };

const run = async (app: pg.Pool, s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
const past = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

async function tenant(app: pg.Pool, label: string, businessType: "salon" | "kirana") {
  const slug = `${label}-${randomBytes(4).toString("hex")}`;
  const { session: owner, shopId } = await createTenant(app, {
    name: `${label.toUpperCase()} Sample Shop (synthetic)`,
    slug,
    shopName: "Main branch",
    ownerName: "Owner (sample)",
    businessType,
    identity: { provider: "password", subject: randomUUID() },
  });
  return { slug, owner, shopId, tenantId: owner.tenantId };
}

// The site, its hours, its look and its key, as the owner's own ops rows.
async function siteOf(app: pg.Pool, t: { owner: Session; shopId: string; slug: string }, bookingMode: "none" | "slots", origin: string) {
  return withTx(app, { kind: "member", session: t.owner }, async (c) => {
    await c.query(
      `insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from)
       select $1, $2, w, '09:00', '20:00', false, current_date - 30 from generate_series(1, 7) w`,
      [t.owner.tenantId, t.shopId],
    );
    const siteId = (
      await c.query<{ id: string }>(`insert into ops.site (tenant_id, booking_mode, origins, privacy_version, consent_version) values ($1, $2, $3, 'v1', 'v1') returning id::text as id`, [
        t.owner.tenantId,
        bookingMode,
        [origin],
      ])
    ).rows[0]?.id as string;
    const lookId = (
      await c.query<{ id: string }>(
        `insert into ops.site_look (tenant_id, site_id, tokens, font_pair, profile) values ($1, $2, '{"--ground": "#ffffff", "--accent": "#aa3300"}', 'inter', '{"tagline": {"en": "A sample shop"}}') returning id::text as id`,
        [t.owner.tenantId, siteId],
      )
    ).rows[0]?.id as string;
    const { keyId, key } = await issueSiteKey(c, siteId, t.slug);
    return { siteId, lookId, keyId, key };
  });
}

/** A release, as the owner role publishes off live (release_check): the release snapshots minted from the books now. */
export async function publish(db: WebDb, tenantId: string, siteId: string): Promise<string> {
  const c = await db.migrator();
  try {
    await c.query("begin");
    await c.query("set local role munshi_owner");
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await c.query<{ id: string }>("select id::text as id from ops.site_look where site_id = $1 order by created_at desc, id desc limit 1", [siteId]);
    const { releaseId } = await publishRelease(c as unknown as pg.PoolClient, { siteId, lookId: rows[0]?.id as string });
    await c.query("commit");
    return releaseId;
  } catch (err) {
    await c.query("rollback");
    throw err;
  } finally {
    await c.end();
  }
}

export const verify = (w: { db: WebDb; op: Operator }, tenantId: string, verified = true) =>
  proposeAndApprove(w.db, w.op, { kind: "site_verify", tenantId, set: { site_verified: verified } });

export async function openWorld(): Promise<World> {
  const db = await openWebDb();
  const app = db.app;
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: randomUUID(),
    rateSecret: RATE,
    publicDatabaseUrl: urlAs(db, "munshi_public"),
  } as Config;

  // Shop A: a salon that also sells goods, takes orders and holds pieces.
  const ta = await tenant(app, "api-a", "salon");
  const o = ta.owner;
  await switchCapability(app, o, "orders", true);
  await switchCapability(app, o, "holds", true);
  const tea = (await run(app, o, "item.create", { name: "Assam tea 250 g", unit: "pack", category: "Tea", effectiveFrom: past() })).itemId as string;
  const saree = (await run(app, o, "item.create", { name: "Cotton saree", unit: "piece", category: "Clothes", effectiveFrom: past() })).itemId as string;
  const haircut = (await run(app, o, "item.create", { kind: "service", name: "Haircut", durationMin: 30, category: "Hair", effectiveFrom: past() })).itemId as string;
  for (const [itemId, amountMinor] of [
    [tea, 24_000],
    [saree, 180_000],
    [haircut, 35_000],
  ] as const) {
    await run(app, o, "price.set", { itemId, amountMinor, effectiveFrom: past() });
  }
  const plan = (await run(app, o, "package.plan.create", { name: "Five haircuts", priceMinor: 150_000, validityDays: 90, lines: [{ itemId: haircut, sessions: 5 }], effectiveFrom: past() }))
    .itemId as string;
  const offerId = (
    await run(app, o, "offer.create", {
      name: "Festive ten",
      kind: "percent_off",
      percentBp: 1000,
      scope: "all",
      minSpendMinor: 50_000,
      code: "FESTIVE10",
      startsAt: past(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      published: true,
    })
  ).offerId as string;
  // An offer the owner did not publish: never on the site.
  await run(app, o, "offer.create", { name: "Staff only", kind: "amount_off", amountOffMinor: 5_000, scope: "all", endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  const staffId = (await run(app, o, "staff.create", { name: "Neha", shopId: ta.shopId, dailyWageMinor: 80_000, joinedOn: addDays(businessDate(new Date(), TZ), -60), effectiveFrom: past() }))
    .staffId as string;
  for (let weekday = 1; weekday <= 7; weekday++) {
    await run(app, o, "shift.pattern.set", { staffId, shopId: ta.shopId, weekday, effectiveFrom: addDays(businessDate(new Date(), TZ), -30), starts: "10:00", ends: "19:00" });
  }
  const originA = "https://shop-a.example";
  const sa = await siteOf(app, ta, "slots", originA);
  await withTx(app, { kind: "member", session: o }, (c) =>
    c.query(`insert into ops.staff_public (tenant_id, staff_id, shop_id, display_name, blurb, consent_at) values ($1, $2, $3, 'Neha', 'Cuts and colour', now() - interval '1 day')`, [
      o.tenantId,
      staffId,
      ta.shopId,
    ]),
  );
  const releaseA = await publish(db, ta.tenantId, sa.siteId);

  // Shop B: a kirana with a published site, not verified.
  const tb = await tenant(app, "api-b", "kirana");
  const rice = (await run(app, tb.owner, "item.create", { name: "Sona masoori rice 5 kg", unit: "pack", effectiveFrom: past() })).itemId as string;
  await run(app, tb.owner, "price.set", { itemId: rice, amountMinor: 42_000, effectiveFrom: past() });
  const originB = "https://shop-b.example";
  const sb = await siteOf(app, tb, "none", originB);
  const releaseB = await publish(db, tb.tenantId, sb.siteId);

  const op = await firstOperator(db);
  await verify({ db, op }, ta.tenantId);

  return {
    db,
    op,
    a: { ...ta, siteId: sa.siteId, key: sa.key, keyId: sa.keyId, origin: originA, releaseId: releaseA, items: { tea, saree, haircut, plan }, staffId, offerId },
    b: { ...tb, siteId: sb.siteId, key: sb.key, keyId: sb.keyId, origin: originB, releaseId: releaseB, items: { rice, tea: "", saree: "", haircut: "", plan: "" }, staffId: "", offerId: "" },
    close: async () => {
      const held = globalThis as { munshiPublicPool?: pg.Pool | undefined };
      await held.munshiPublicPool?.end();
      held.munshiPublicPool = undefined;
      await db.close();
    },
  };
}

// ---- Calling a route as Next does ----

export type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
export const REQUEST_ID = "req-api-test-0001";

export type Call = { query?: Record<string, string>; headers?: Record<string, string>; body?: unknown; raw?: string; method?: string; ip?: string };

export async function call(handler: Handler, path: string, params: Record<string, string | string[]>, opts: Call = {}): Promise<Response> {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const method = opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET");
  const headers = new Headers({ "x-request-id": REQUEST_ID, "x-forwarded-for": opts.ip ?? "198.51.100.1", ...(opts.headers ?? {}) });
  const body = opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return handler(new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(params) });
}

/** A write's headers for shop `s`: its key, its origin, a fresh Idempotency-Key unless one is given. */
export const writeHeaders = (s: ApiShop, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${s.key}`,
  origin: s.origin,
  "idempotency-key": `key-${randomBytes(8).toString("hex")}`,
  ...extra,
});

let ipSeq = 0;
/** A fresh client IP per call site, under the per-IP write limit. */
export const freshIp = () => {
  ipSeq = (ipSeq % 250) + 1;
  return `203.0.113.${ipSeq}`;
};

export const text = async (r: Response) => ({ status: r.status, body: await r.text(), headers: Object.fromEntries(r.headers.entries()) });

export const ids = { random: () => randomUUID() };

// Every books.* table's row count, as the superuser, for "a public write writes no books row" (clause 1).
export async function booksCounts(db: WebDb): Promise<Record<string, number>> {
  const { rows } = await db.admin.query<{ t: string }>(`select schemaname || '.' || tablename as t from pg_tables where schemaname in ('books', 'snap', 'audit', 'approval') order by 1`);
  const out: Record<string, number> = {};
  for (const { t } of rows) out[t] = (await db.admin.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0]?.n as number;
  return out;
}
