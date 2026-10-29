// The app pool and the boot check (server only). Every pool must connect as its own role: a superuser or a BYPASSRLS
// role would skip forced RLS and the grants the book guard relies on, and a member of the owner could take its rights.
// appPool() checks who it is before the pool is first handed out. boot() checks the six pools, MUNSHI_DEPLOYMENT
// against ops.deployment and ops.schema_version against the schema sha compiled into the build (BLUEPRINT §4.3); the
// request hook (proxy.ts) serves nothing until it passes.
import { buildSchemaSha256, ConfigError, POOLS, type PoolName, type WebConfig, webConfig } from "@munshi/config";
import { createAppPool } from "@munshi/core";
import pg from "pg";
import { config } from "./config.ts";
import { wireOutbox } from "./outbox.ts";

type Pool = ReturnType<typeof createAppPool>;

// Kept on globalThis so next dev's module reloads reuse one pool and one boot instead of opening new ones per edit.
const held = globalThis as typeof globalThis & { munshiPool?: Promise<Pool> | undefined; munshiBoot?: Promise<Booted> | undefined };

async function open(): Promise<Pool> {
  const pool = createAppPool(config().databaseUrl);
  try {
    const { rows } = await pool.query<{ role: string; superuser: boolean; bypass: boolean }>(
      "select rolname as role, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user",
    );
    const me = rows[0];
    if (me?.role !== "munshi_app" || me.superuser || me.bypass) {
      throw new Error("db: the app must connect as munshi_app (not a superuser, no BYPASSRLS); refusing to serve");
    }
  } catch (err) {
    await pool.end();
    throw err;
  }
  return pool;
}

/** The public role's pool (munshi_public: the public routes and the webhook), shared with real sign-in's (session.ts). */
export async function publicPool(): Promise<pg.Pool> {
  const url = config().publicDatabaseUrl;
  if (!url) throw new Error("db: PUBLIC_DATABASE_URL is not set");
  const pools = globalThis as typeof globalThis & { munshiPublicPool?: pg.Pool };
  pools.munshiPublicPool ??= new pg.Pool({ connectionString: url, max: 4, application_name: "munshi_public" });
  return pools.munshiPublicPool;
}

export function appPool(): Promise<Pool> {
  held.munshiPool ??= open().catch((err) => {
    held.munshiPool = undefined; // a later request retries (the database may still be starting)
    throw err;
  });
  return held.munshiPool;
}

const publicHeld = globalThis as typeof globalThis & { munshiPublicPool?: pg.Pool };

/**
 * The public API's pool, connected as munshi_public (boot checks the role): the only pool /api/v1 uses. The same pool
 * real sign-in's per-IP limits use (session.ts keeps it under the same name).
 */
export function publicPool(): pg.Pool {
  const url = config().publicDatabaseUrl;
  if (!url) throw new Error("config: the public API needs PUBLIC_DATABASE_URL");
  publicHeld.munshiPublicPool ??= new pg.Pool({ connectionString: url, max: 4, application_name: "munshi_public" });
  return publicHeld.munshiPublicPool;
}

const ROLES: Record<PoolName, string> = {
  app: "munshi_app",
  jobs: "munshi_jobs",
  agent: "munshi_agent",
  platform: "munshi_platform",
  public: "munshi_public",
  idp: "munshi_idp",
};

export type BootCode = "unreachable" | "wrong_role" | "wrong_deployment" | "stale_schema";

export class BootError extends Error {
  readonly code: BootCode;
  readonly pool: PoolName | undefined;
  constructor(code: BootCode, pool?: PoolName) {
    super(`boot: ${code}${pool ? ` (the ${pool} pool)` : ""}; refusing to serve`);
    this.name = "BootError";
    this.code = code;
    this.pool = pool;
  }
}

/** What health reports once boot has passed: labels and the schema sha's first 12 hex characters, never a count. */
export type Booted = {
  deployment: WebConfig["deployment"];
  source: string;
  schema: string;
  region: string | null;
  modelMode: WebConfig["modelMode"];
  sendMode: WebConfig["sendMode"];
  ai: WebConfig["ai"];
};

type Me = { role: string; superuser: boolean; bypass: boolean; owner: boolean };

const ME_SQL =
  "select rolname as role, rolsuper as superuser, rolbypassrls as bypass, pg_has_role(rolname, 'munshi_owner', 'MEMBER') as owner from pg_roles where rolname = current_user";

/** True unless the connection is the expected role itself: no superuser, no BYPASSRLS, no member of the owner. */
export const roleRefused = (expected: string, me: Me | undefined): boolean => me?.role !== expected || me.superuser || me.bypass || me.owner;

// Only the app, public and jobs roles may read these two tables, so boot reads them on the app's connection.
type Build = { kind: string | null; source: string | null; sha: string | null };
const BUILD_SQL =
  "select (select kind from ops.deployment) as kind, (select source from ops.schema_version) as source, (select encode(sha256, 'hex') from ops.schema_version) as sha";

async function readBuild(client: pg.Client): Promise<Build> {
  try {
    return (await client.query<Build>(BUILD_SQL)).rows[0] as Build;
  } catch {
    throw new BootError("stale_schema"); // no such table: the database was not built from this schema
  }
}

// One short-lived connection per pool, ended whatever happens. A failure becomes a code: pg's own message can carry the
// host, the user and the server's words, so it is dropped, never wrapped.
async function checkPool(pool: PoolName, url: string, read?: (client: pg.Client) => Promise<Build>): Promise<Build | undefined> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, application_name: `munshi_boot_${pool}` });
  client.on("error", () => {}); // a backend that drops after the check must not crash the process
  try {
    let me: Me | undefined;
    try {
      await client.connect();
      me = (await client.query<Me>(ME_SQL)).rows[0];
    } catch {
      throw new BootError("unreachable", pool);
    }
    if (roleRefused(ROLES[pool], me)) throw new BootError("wrong_role", pool);
    return read ? await read(client) : undefined;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Checks every pool's role, the deployment, and the schema against `built` (the build's sha unless a test passes one);
 * a refusal is a BootError naming its code and the pool.
 */
export async function checkBoot(s: WebConfig, built = buildSchemaSha256()): Promise<Booted> {
  const checks = await Promise.allSettled(POOLS.map((pool) => checkPool(pool, s.databaseUrls[pool], pool === "app" ? readBuild : undefined)));
  const failed = checks.find((c) => c.status === "rejected");
  if (failed) throw failed.reason; // the first in POOLS order, so one fault always names the same pool
  const found = (checks[POOLS.indexOf("app")] as PromiseFulfilledResult<Build>).value;
  if ((found.kind ?? "demo") !== s.deployment) throw new BootError("wrong_deployment");
  if (found.sha !== built) throw new BootError("stale_schema"); // no build value refuses too
  return {
    deployment: s.deployment,
    source: found.source as string,
    schema: found.sha.slice(0, 12),
    region: s.region ?? null,
    modelMode: s.modelMode,
    sendMode: s.sendMode,
    ai: s.ai,
  };
}

/** Boots once per process. A refusal is not kept: the next request checks again (the database may still be starting). */
export function boot(): Promise<Booted> {
  held.munshiBoot ??= Promise.resolve()
    .then(() => checkBoot(webConfig()))
    .then((booted) => {
      wireOutbox(); // the senders, once boot has passed (outbox.ts)
      return booted;
    })
    .catch((err: unknown) => {
      held.munshiBoot = undefined;
      throw err;
    });
  return held.munshiBoot;
}

/** What a refusal may say: its code, and the pool or the setting names it concerns. Anything else is `internal`. */
export function refusal(err: unknown): { code: string; pool?: PoolName; names?: string[] } {
  if (err instanceof BootError) return err.pool ? { code: err.code, pool: err.pool } : { code: err.code };
  if (err instanceof ConfigError) return { code: err.code, names: err.names };
  return { code: "internal" };
}
