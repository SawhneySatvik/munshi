// The web app's one config module (server only). DATABASE_URL is the app's own connection (role munshi_app);
// AGENT_DATABASE_URL is the agent's read-only one (role munshi_agent), used only by the agent's port
// (lib/server/agent-port.ts), which refuses to start without it. `pnpm dev` (db/src/dev.ts) passes both to this process.
// The session-signing secret and the demo shop's tenant are files dev.ts generates under .run/ (git-ignored). Values
// are never logged; errors name the missing setting, never its value.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./root";

export type Config = { databaseUrl: string; agentDatabaseUrl: string | undefined; sessionSecret: Buffer; demoTenantId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function runFile(name: string): string {
  const file = path.join(/*turbopackIgnore: true*/ repoRoot(), ".run", name);
  if (!existsSync(/*turbopackIgnore: true*/ file)) throw new Error(`config: .run/${name} is missing; start the app with pnpm dev`);
  return readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
}

let loaded: Config | undefined;

export function config(): Config {
  if (loaded) return loaded;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("config: DATABASE_URL is not set; start the app with pnpm dev");
  const secret = runFile("session-secret");
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error("config: .run/session-secret is not 32 bytes of hex");
  const demoTenantId = runFile("demo-tenant");
  if (!UUID.test(demoTenantId)) throw new Error("config: .run/demo-tenant is not a uuid");
  loaded = { databaseUrl, agentDatabaseUrl: process.env.AGENT_DATABASE_URL || undefined, sessionSecret: Buffer.from(secret, "hex"), demoTenantId };
  return loaded;
}
