// The one config module (BLUEPRINT §4.3), and the only reader of process.env. Nothing here reads a file: pnpm dev passes
// the secrets it generates into the app as environment variables, so a deployed app needs nothing under .run/.
//
// An error names settings, never their values. It is built fresh: a caught error is never wrapped or kept as a cause
// (URL's TypeError keeps its whole input), so a secret cannot reach a message, a stack or a log line.
export type Env = Readonly<Record<string, string | undefined>>;

/** The database pools of the web process, each connecting as its own role (the boot check, apps/web/lib/server/db.ts). */
export const POOLS = ['app', 'jobs', 'agent', 'platform', 'public', 'idp'] as const;
export type PoolName = (typeof POOLS)[number];

export const POOL_URL: Record<PoolName, string> = {
  app: 'DATABASE_URL',
  jobs: 'JOBS_DATABASE_URL',
  agent: 'AGENT_DATABASE_URL',
  platform: 'PLATFORM_DATABASE_URL',
  public: 'PUBLIC_DATABASE_URL',
  idp: 'IDP_DATABASE_URL',
};

export type WebConfig = {
  deployment: 'demo' | 'live';
  databaseUrls: Record<PoolName, string>;
  sessionSecret: Buffer;
  demoTenantId: string;
  modelMode: 'live' | 'recorded' | 'record';
  ai: 'on' | 'off';
  sendMode: 'recorded' | 'live';
  /** Set by Vercel on a deployed function; absent locally. */
  region: string | undefined;
  /** Real sign-in's keys (the email HMAC, the IP hash): required on live, optional on demo (BLUEPRINT §4.3, §6.2). */
  identitySecret: string | undefined;
  rateSecret: string | undefined;
};

export type ConfigCode = 'config_missing' | 'config_invalid';

export class ConfigError extends Error {
  readonly code: ConfigCode;
  readonly names: string[];
  constructor(code: ConfigCode, names: string[]) {
    super(`config: ${code === 'config_missing' ? 'not set' : 'not valid'}: ${names.join(', ')}`);
    this.name = 'ConfigError';
    this.code = code;
    this.names = names;
  }
}

const HEX32 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function postgresUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'postgres:' || u.protocol === 'postgresql:') && u.hostname !== '';
  } catch {
    return false;
  }
}

const oneOf =
  (...values: string[]) =>
  (value: string) =>
    values.includes(value);

const REQUIRED: Record<string, (value: string) => boolean> = {
  ...Object.fromEntries(Object.values(POOL_URL).map((name) => [name, postgresUrl])),
  MUNSHI_DEPLOYMENT: oneOf('demo', 'live'),
  MUNSHI_SESSION_SECRET: (v) => HEX32.test(v),
  MUNSHI_DEMO_TENANT_ID: (v) => UUID.test(v),
};

// Unset or empty takes the default; anything else must be one of the listed values.
const OPTIONAL: Record<string, [fallback: string, valid: (value: string) => boolean]> = {
  MUNSHI_MODEL_MODE: ['recorded', oneOf('live', 'recorded', 'record')],
  MUNSHI_AI: ['on', oneOf('on', 'off')],
  MUNSHI_SEND_MODE: ['recorded', oneOf('recorded', 'live')],
};

/** The web process's settings. Throws a ConfigError naming every missing setting, else every invalid one. */
export function webConfig(env: Env = process.env): WebConfig {
  const missing = Object.keys(REQUIRED).filter((name) => !env[name]);
  if (missing.length) throw new ConfigError('config_missing', missing);
  const invalid: string[] = [];
  for (const [name, valid] of Object.entries(REQUIRED)) if (!valid(env[name] as string)) invalid.push(name);
  const optional = (name: string): string => {
    const [fallback, valid] = OPTIONAL[name] as [string, (value: string) => boolean];
    const given = env[name] || fallback;
    if (!valid(given)) invalid.push(name);
    return given;
  };
  const modes = { modelMode: optional('MUNSHI_MODEL_MODE'), ai: optional('MUNSHI_AI'), sendMode: optional('MUNSHI_SEND_MODE') };
  // Real sign-in runs only on live, where its two keys must be set; given anywhere, each is at least 32 characters.
  const signInKeys = ['MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET'];
  const unsetKeys = signInKeys.filter((name) => !env[name]);
  if (env.MUNSHI_DEPLOYMENT === 'live' && unsetKeys.length) throw new ConfigError('config_missing', unsetKeys);
  for (const name of signInKeys) if (env[name] && (env[name] as string).length < 32) invalid.push(name);
  if (invalid.length) throw new ConfigError('config_invalid', invalid);
  const get = (name: string) => env[name] as string;
  return {
    deployment: get('MUNSHI_DEPLOYMENT') as WebConfig['deployment'],
    databaseUrls: Object.fromEntries(Object.entries(POOL_URL).map(([pool, name]) => [pool, get(name)])) as Record<PoolName, string>,
    sessionSecret: Buffer.from(get('MUNSHI_SESSION_SECRET'), 'hex'),
    demoTenantId: get('MUNSHI_DEMO_TENANT_ID'),
    modelMode: modes.modelMode as WebConfig['modelMode'],
    ai: modes.ai as WebConfig['ai'],
    sendMode: modes.sendMode as WebConfig['sendMode'],
    region: env.VERCEL_REGION || undefined,
    identitySecret: env.MUNSHI_IDENTITY_SECRET || undefined,
    rateSecret: env.MUNSHI_RATE_SECRET || undefined,
  };
}

/**
 * The tick route's two settings, read on every call and never cached. An unset or empty CRON_SECRET is '' (the route
 * then admits no one); an unset or empty JOBS_DATABASE_URL is undefined (the route answers jobs_unconfigured).
 */
export function tickSettings(env: Env = process.env): { cronSecret: string; jobsDatabaseUrl: string | undefined } {
  return { cronSecret: env.CRON_SECRET ?? '', jobsDatabaseUrl: env.JOBS_DATABASE_URL || undefined };
}

// next.config.ts's compiler.defineServer replaces this identifier in every server bundle with the sha256 that
// readSchema() computed from the checked-out db/schema at build time, so no environment variable can stand in for it.
// Outside a Next build (the tests) it is a global only the process itself can set; unset, boot refuses.
declare const MUNSHI_BUILD_SCHEMA_SHA256: unknown;

/** The sha256 (hex) of the db/schema the app was built from; boot refuses a database built from other files. */
export const buildSchemaSha256 = (): string | undefined =>
  typeof MUNSHI_BUILD_SCHEMA_SHA256 === 'string' ? MUNSHI_BUILD_SCHEMA_SHA256 : undefined;

/** True under `next dev`, whose React tooling needs eval; a build inlines NODE_ENV. */
export const development = (): boolean => process.env.NODE_ENV === 'development';
