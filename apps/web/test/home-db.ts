// A fresh database per test file with the demo shop as `pnpm dev` builds it: the kirana seed, its watchers (the jobs
// role's run, with no actor), and the reorder drafted from the largest shelf gap (db/src/dev.ts). The app's pool then
// connects to it as munshi_app. The database is a clone of the v2 schema template (db/test/v2's harness).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Opened, openDemoSession, runWatchers, type Session } from "@munshi/core";
import type pg from "pg";
import { inject } from "vitest";
import { proposeDemoDraft } from "../../../db/src/dev.ts";
import { type Kirana, seedKirana } from "../../../db/seed/kirana.ts";
import { DEMO_DEFAULTS, demoAllowList } from "../../../db/seed/showcase.ts";
import { firstOperator, type Operator, proposeAndApprove } from "../../../db/test/v2/core/platform/fixture.ts";
import { openTestDb, type TestDb, tx } from "../../../db/test/v2/db.ts";
import { appPool } from "../lib/server/db";
import { loadHome } from "../lib/server/home";
import { SESSION_COOKIE, signSession } from "../lib/server/session";
import { state } from "./app-state";

export const AS_OF = "2026-10-27";

type Answer = { kind: string; match: Record<string, string | number>; expect: Record<string, number> };
export const ANSWERS = (
  JSON.parse(readFileSync(new URL("../../../db/seed/kirana.answers.json", import.meta.url), "utf8")) as { plants: Answer[] }
).plants;

/** The test file's database, with the pools the web tests use: the app's (munshi_app) and the jobs role's. */
export type WebDb = TestDb & { app: pg.Pool; jobs: pg.Pool };

export type Home = { db: WebDb; k: Kirana; draftId: string; operator: Operator; close: () => Promise<void> };

/** A fresh v2 database for one test file, its app and jobs pools at hand. */
export async function openWebDb(): Promise<WebDb> {
  const db = await openTestDb();
  return { ...db, app: db.as("munshi_app"), jobs: db.as("munshi_jobs") };
}

/** The connection string of a login role (its test password is its name) to the test file's database. */
export const urlAs = (db: TestDb, role: string, password = role) => `postgres://${role}:${password}@127.0.0.1:${inject("pg17Port")}/${db.name}`;

// The demo session of each of the shop's people, by member id (openHome fills it, signInAs signs its cookie).
const opened = new Map<string, Opened>();

export async function openHome(): Promise<Home> {
  const db = await openWebDb();
  const k = await seedKirana(db.app, { asOf: AS_OF });
  // The demo default config, as pnpm dev's seed sets it (D-060): the sample shops keep AI, capped, so the app's agent
  // port's allow() lets the recorded flows run.
  const operator = await firstOperator(db);
  await proposeAndApprove(db, operator, { kind: "default_config", set: { ...DEMO_DEFAULTS } });
  // And the model allow-list it approves (P-5): the agent port's chains come from it.
  for (const set of demoAllowList()) await proposeAndApprove(db, operator, { kind: "model_allow", set });
  await runWatchers(db.jobs, k.tenantId, AS_OF);
  const draftId = await proposeDemoDraft(db.app, k.tenantId);
  // A demo session row for each of the shop's people, as the demo picker opens one (BP-AUTH-1): a cookie names its row.
  opened.clear();
  for (const m of [k.owner, k.manager, ...k.staff]) {
    const o = await openDemoSession(db.app, k.tenantId, m.memberId);
    if (!o) throw new Error("test: the demo shop refused a demo session");
    opened.set(m.memberId, o);
  }
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: urlAs(db, "munshi_agent"),
    sessionSecret: randomBytes(32),
    demoTenantId: k.tenantId,
  };
  state.cookies.clear();
  return {
    db,
    k,
    draftId,
    operator,
    close: async () => {
      await (await appPool()).end();
      (globalThis as { munshiPool?: unknown }).munshiPool = undefined;
      const agent = (globalThis as { munshiAgentPool?: Promise<{ end: () => Promise<void> }> }).munshiAgentPool;
      (globalThis as { munshiAgentPool?: unknown }).munshiAgentPool = undefined;
      await agent?.then((p) => p.end(), () => {});
      await db.close();
    },
  };
}

/** Signs the browser in as one of the demo shop's people, with the demo session openHome opened for them. */
export function signInAs(who: { tenantId: string; memberId: string }): void {
  const o = opened.get(who.memberId);
  if (!state.config || !o) throw new Error("test: openHome first, and sign in as one of the shop's people");
  const claim = { tenantId: who.tenantId, memberId: who.memberId, sessionId: o.session.sessionId as string, via: "demo" as const };
  state.cookies.set(SESSION_COOKIE, signSession(claim, o.expiresAt, state.config.sessionSecret));
}

export const homeFor = (session: Session) => loadHome(session);

/** Rows read as the app role under the tenant, for assertions. */
export async function rows<R>(h: Home, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => c.query(sql, params))).rows as R[];
}
