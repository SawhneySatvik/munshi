// The web app's one config module (server only). DATABASE_URL is the app's own connection (role munshi_app); `pnpm dev`
// (db/src/dev.ts) passes it to this process. The session-signing secret and the demo shop's tenant are files dev.ts
// generates under .run/ (git-ignored). Values are never logged; errors name the missing setting, never its value.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Config = { databaseUrl: string; sessionSecret: Buffer; demoTenantId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The repo root holds pnpm-workspace.yaml; next runs with apps/web as its working directory. (turbopackIgnore: these
// paths are found at run time, so the build must not trace the whole repo for them.)
function runDir(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(/*turbopackIgnore: true*/ path.join(dir, "pnpm-workspace.yaml"))) return path.join(dir, ".run");
    if (path.dirname(dir) === dir) throw new Error("config: cannot find the repo root (pnpm-workspace.yaml)");
  }
}

function runFile(name: string): string {
  const file = path.join(/*turbopackIgnore: true*/ runDir(), name);
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
  loaded = { databaseUrl, sessionSecret: Buffer.from(secret, "hex"), demoTenantId };
  return loaded;
}
