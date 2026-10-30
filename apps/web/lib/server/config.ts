// The web app's one config module (server only): every setting comes through @munshi/config, the only reader of the
// environment, and nothing is read from a file. `pnpm dev` passes the secrets it generates under .run/ (the session
// secret, the database passwords) to this process as environment variables. DATABASE_URL is the app's own connection
// (role munshi_app); AGENT_DATABASE_URL is the agent's read-only one (role munshi_agent), used only by the agent's port
// (lib/server/agent-port.ts). IDP_DATABASE_URL (munshi_idp) and PUBLIC_DATABASE_URL (munshi_public) are real sign-in's
// (BP-AUTH-1). PLATFORM_DATABASE_URL (munshi_platform) and MUNSHI_PLATFORM_SECRET are the superadmin console's
// (BP-PLAT-1). Errors name a setting, never its value.
import { type WebConfig, webConfig } from "@munshi/config";

export { tickSettings } from "@munshi/config";

export type Config = {
  databaseUrl: string;
  agentDatabaseUrl: string | undefined;
  sessionSecret: Buffer;
  demoTenantId: string;
  idpDatabaseUrl?: string;
  publicDatabaseUrl?: string;
  identitySecret?: string | undefined;
  rateSecret?: string | undefined;
  /** The console's pool (munshi_platform) and the key that opens the operators' TOTP secrets; either unset, /platform is 404. */
  platformDatabaseUrl?: string | undefined;
  platformSecret?: string | undefined;
  // Optional so a test's config double may leave them out: unset reads as demo, no WhatsApp, a temp outbox folder.
  deployment?: WebConfig["deployment"];
  whatsapp?: WebConfig["whatsapp"];
  phoneRouteSecret?: string | undefined;
  outboxDir?: string;
  cacheUrl?: string | undefined;
  /** The deployment's AI switch (MUNSHI_AI); unset in a test double reads as on, and the shop's config still decides. */
  ai?: WebConfig["ai"];
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
    identitySecret: s.identitySecret,
    rateSecret: s.rateSecret,
    platformDatabaseUrl: s.databaseUrls.platform,
    platformSecret: s.platformSecret,
    deployment: s.deployment,
    whatsapp: s.whatsapp,
    phoneRouteSecret: s.phoneRouteSecret,
    outboxDir: s.outboxDir,
    cacheUrl: s.cacheUrl,
    ai: s.ai,
  };
  return loaded;
}
