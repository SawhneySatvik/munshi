// db/seed/reseed.ts wipes every tenant, so it refuses unless its target is the dev cluster `pnpm dev` made (127.0.0.1,
// data directory .run/pg17, the database comment with the .run/dev.json marker), and refuses BEFORE it writes anything
// (on v2 it builds no schema: `pnpm db:reset` does). The test databases are local and superuser-reachable but are not
// that cluster.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { inject } from "vitest";
import { seedKirana } from "../../../db/seed/kirana.ts";
import { SUPERUSER } from "../../../db/test/v2/global-setup.ts";
import { openWebDb, type WebDb } from "./helpers/home-db";

let db: WebDb;
const bare = `t_bare_${randomBytes(4).toString("hex")}`;
const port = () => inject("pg17Port");
const target = (name: string) => `postgres://${SUPERUSER.user}:${encodeURIComponent(SUPERUSER.password)}@127.0.0.1:${port()}/${name}`;

beforeAll(async () => {
  db = await openWebDb();
  await seedKirana(db.app);
  await db.admin.query(`create database ${bare}`);
});
afterAll(async () => {
  await db.admin.query(`drop database ${bare}`);
  await db.close();
});

const reseed = (name: string) => {
  const run = spawnSync(process.execPath, ["seed/reseed.ts"], {
    cwd: new URL("../../../db", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: target(name) },
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
};

test("a migrated database that is not the dev cluster is refused, exits non-zero, and keeps its tenant", async () => {
  const before = (await db.admin.query("select count(*)::int as n from ops.tenant")).rows[0].n;
  expect(before).toBe(1);
  const run = reseed(db.name);
  expect(run.out).toMatch(/refusing to wipe: .*not the cluster in \.run\/pg17.*lacks this \.run\/ marker/);
  expect(run.status).not.toBe(0);
  expect((await db.admin.query("select count(*)::int as n from ops.tenant")).rows[0].n).toBe(before);
});

test("the refusal comes before the migration: an empty database is left without a schema", async () => {
  const run = reseed(bare);
  expect(run.out).toMatch(/refusing to wipe/);
  expect(run.status).not.toBe(0);
  // A pool of the harness's own class, pointed at the bare database.
  const Pool = db.admin.constructor as new (o: { connectionString: string }) => typeof db.admin;
  const server = new Pool({ connectionString: target(bare) });
  const { rows } = await server.query("select count(*)::int as n from pg_namespace where nspname in ('ops', 'books', 'audit')");
  await server.end();
  expect(rows[0].n).toBe(0);
});
