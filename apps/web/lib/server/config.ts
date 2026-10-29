// The web app's one config module (server only): every setting comes through @munshi/config, the only reader of the
// environment, and nothing is read from a file. `pnpm dev` passes the secrets it generates under .run/ (the session
// secret, the database passwords) to this process as environment variables. DATABASE_URL is the app's own connection
// (role munshi_app); AGENT_DATABASE_URL is the agent's read-only one (role munshi_agent), used only by the agent's port
// (lib/server/agent-port.ts). IDP_DATABASE_URL (munshi_idp) and PUBLIC_DATABASE_URL (munshi_public) are real sign-in's
// (BP-AUTH-1). Errors name a setting, never its value.
import { webConfig } from "@munshi/config";

export { tickSettings } from "@munshi/config";

export type Config = {
  databaseUrl: string;
  agentDatabaseUrl: string | undefined;
  sessionSecret: Buffer;
  demoTenantId: string;
  idpDatabaseUrl?: string;
  publicDatabaseUrl?: string;
};

let loaded: Config | undefined;

export function config(): Config {
  if (loaded) return loaded;
  const s = webConfig();
  loaded = {
    databaseUrl: s.databaseUrls.app,
    agentDatabaseUrl: s.databaseUrls.agent,
    sessionSecret: s.sessionSecret,
    demoTenantId: s.demoTenantId,
    idpDatabaseUrl: s.databaseUrls.idp,
    publicDatabaseUrl: s.databaseUrls.public,
  };
  return loaded;
}
