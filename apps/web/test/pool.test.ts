// The app pool refuses to serve unless it is connected as munshi_app: a superuser (the dev flow's migrate and reseed
// role) would bypass forced RLS and every grant the book guard relies on.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { inject } from "vitest";
import { openTestDb, type TestDb } from "../../../db/test/db.ts";
import { SUPERUSER } from "../../../db/test/global-setup.ts";
import { appPool } from "../lib/server/db";
import { state } from "./app-state";

let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(() => db.close());

const connectAs = (user: string, password: string) => {
  state.config = {
    databaseUrl: `postgres://${user}:${password}@127.0.0.1:${inject("pgPort")}/${db.name}`,
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: "00000000-0000-4000-8000-000000000000",
  };
  (globalThis as { munshiPool?: unknown }).munshiPool = undefined;
};

test("a superuser connection is refused; munshi_app is served", async () => {
  connectAs(SUPERUSER.user, SUPERUSER.password);
  await expect(appPool()).rejects.toThrow(/must connect as munshi_app/);
  connectAs("munshi_app", "munshi_app");
  const pool = await appPool();
  const { rows } = await pool.query("select current_user as role");
  expect(rows).toEqual([{ role: "munshi_app" }]);
  await pool.end();
});
