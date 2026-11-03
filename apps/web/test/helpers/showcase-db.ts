// The two showcase shops as `pnpm dev` builds them (db/seed/showcase.ts): Elite (the salon pack: two branches, stylists,
// a roster, packages, bookings on days 0–2, a salary run) and Prabhave (the apparel pack: pieces, the Diwali offer,
// orders at cutting and ready, a site cart waiting), in a fresh v2 database per test file, through core's real paths.
// Their sites are left unverified (no operator is seeded): no capability screen needs a verified site. Each person a test
// signs in as gets a demo session as the demo picker opens one, and the app's config points at this database.
import { randomBytes } from "node:crypto";
import { addDays, businessDate, type Opened, openDemoSession, type Session } from "@munshi/core";
import { type Showcase, seedShowcase } from "../../../../db/seed/showcase.ts";
import { tx } from "../../../../db/test/v2/db.ts";
import { appPool } from "../../lib/server/db";
import { SESSION_COOKIE, signSession } from "../../lib/server/session";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";

export type Shows = { db: WebDb; s: Showcase; close: () => Promise<void> };

// As the dev seed does: the showcase's day 0 is tomorrow, so Elite's desk bookings lie ahead of the clock.
export const SHOW_AS_OF = addDays(businessDate(new Date(), "Asia/Kolkata"), 1);

const opened = new Map<string, Opened>();

export async function openShowcase(): Promise<Shows> {
  const db = await openWebDb();
  const owner = await db.migrator();
  let s: Showcase;
  try {
    s = await seedShowcase({ app: db.app, pub: db.as("munshi_public"), platform: db.as("munshi_platform") }, owner, { asOf: SHOW_AS_OF, verify: false });
  } finally {
    await owner.end();
  }
  opened.clear();
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: urlAs(db, "munshi_agent"),
    sessionSecret: randomBytes(32),
    demoTenantId: s.elite.tenantId,
  };
  state.cookies.clear();
  return {
    db,
    s,
    close: async () => {
      await (await appPool()).end();
      (globalThis as { munshiPool?: unknown }).munshiPool = undefined;
      await db.close();
    },
  };
}

/** Signs the browser in as `who` with a demo session (opened once per person), and returns that session. */
export async function signInShow(h: Shows, who: Session): Promise<Session> {
  let o = opened.get(who.memberId);
  if (!o) {
    o = (await openDemoSession(h.db.app, who.tenantId, who.memberId)) ?? undefined;
    if (!o) throw new Error("test: the showcase shop refused a demo session");
    opened.set(who.memberId, o);
  }
  if (!state.config) throw new Error("test: openShowcase first");
  const claim = { tenantId: who.tenantId, memberId: who.memberId, sessionId: o.session.sessionId as string, via: "demo" as const };
  state.cookies.set(SESSION_COOKIE, signSession(claim, o.expiresAt, state.config.sessionSecret));
  return o.session;
}

/** Rows read as the app role under a tenant, for assertions. */
export async function showRows<R>(h: Shows, tenantId: string, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await tx(h.db.app, { tenant_id: tenantId }, (c) => c.query(sql, params))).rows as R[];
}
