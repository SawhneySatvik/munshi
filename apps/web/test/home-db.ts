// A fresh database per test file with the demo shop as `pnpm dev` builds it: the kirana seed, its watchers, and the
// reorder drafted from the largest shelf gap (db/src/dev.ts). The app's pool then connects to it as munshi_app.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runWatchers, type Session } from "@munshi/core";
import { inject } from "vitest";
import { openTestDb, type TestDb, tx } from "../../../db/test/db.ts";
import { type Kirana, seedKirana } from "../../../db/seed/kirana.ts";
import { proposeDemoDraft } from "../../../db/src/dev.ts";
import { appPool } from "../lib/server/db";
import { loadHome } from "../lib/server/home";
import { type Claim, SESSION_COOKIE, signSession } from "../lib/server/session";
import { state } from "./app-state";

export const AS_OF = "2026-10-27";

type Answer = { kind: string; match: Record<string, string | number>; expect: Record<string, number> };
export const ANSWERS = (
  JSON.parse(readFileSync(new URL("../../../db/seed/kirana.answers.json", import.meta.url), "utf8")) as { plants: Answer[] }
).plants;

export type Home = { db: TestDb; k: Kirana; draftId: string; close: () => Promise<void> };

export async function openHome(): Promise<Home> {
  const db = await openTestDb();
  const k = await seedKirana(db.app, { asOf: AS_OF });
  await runWatchers(db.app, k.tenantId, AS_OF);
  const draftId = await proposeDemoDraft(db.app, k.tenantId);
  state.config = {
    databaseUrl: `postgres://munshi_app:munshi_app@127.0.0.1:${inject("pgPort")}/${db.name}`,
    sessionSecret: randomBytes(32),
    demoTenantId: k.tenantId,
  };
  state.cookies.clear();
  return {
    db,
    k,
    draftId,
    close: async () => {
      await (await appPool()).end();
      (globalThis as { munshiPool?: unknown }).munshiPool = undefined;
      await db.close();
    },
  };
}

export function signInAs(session: Claim): void {
  if (!state.config) throw new Error("test: openHome first");
  state.cookies.set(SESSION_COOKIE, signSession(session, state.config.sessionSecret));
}

export const homeFor = (session: Session) => loadHome(session);

/** Rows read as the app role under the tenant, for assertions. */
export async function rows<R>(h: Home, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await tx(h.db.app, { tenant: h.k.tenantId }, (c) => c.query(sql, params))).rows as R[];
}
