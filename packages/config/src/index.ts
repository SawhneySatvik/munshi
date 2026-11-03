// The one config module (BLUEPRINT §4.3), and the only reader of process.env. Nothing here reads a file: pnpm dev passes
// the secrets it generates into the app as environment variables, so a deployed app needs nothing under .run/.
//
// An error names settings, never their values. It is built fresh: a caught error is never wrapped or kept as a cause
// (URL's TypeError keeps its whole input), so a secret cannot reach a message, a stack or a log line.
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Env = Readonly<Record<string, string | undefined>>;

/** Load repository environment files into process.env without exposing their values to callers. */
export function loadEnvFiles(files: readonly (string | URL)[]): void {
  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
}

/** Render only variable names and presence; never include their values. */
export function envPresence(names: readonly string[], env: Env = process.env): string {
  return names.map((name) => `${name}: ${env[name] ? 'set' : 'unset'}`).join('\n');
}

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
  /** MUNSHI_SEND_MODE: the deployment's outbound switch. Only `live` wires a real sender (channelsFor); `recorded`, the
   *  default, records every send whatever credentials the deployment holds. */
  sendMode: 'recorded' | 'live';
  /** Set by Vercel on a deployed function; absent locally. */
  region: string | undefined;
  /** Real sign-in's keys (the email HMAC, the IP hash): required on live, optional on demo (BLUEPRINT §4.3, §6.2). */
  identitySecret: string | undefined;
  rateSecret: string | undefined;
  /** The superadmin console's key (MUNSHI_PLATFORM_SECRET): it seals each operator's TOTP secret. Unset, the console
   *  signs nobody in. At least 32 characters when given. */
  platformSecret: string | undefined;
  /** The WhatsApp Cloud API: all four set, or none (BLUEPRINT §4.3), with the approved template names a send outside the
   *  24-hour window may use (each optional) and their language. Holding them sends nothing by itself: a real send also
   *  needs sendMode live, a real shop and the operator's grant (channelsFor, the outbox sweep, ops.delivery_derive). */
  whatsapp: WhatsAppSettings | undefined;
  /** Instagram content publishing and its webhook: all five set, or none. An operator's Instagram grant names the
   *  account by INSTAGRAM_ACCOUNT_REF, mapped here to the business account id; the host follows the token's login. */
  instagram: InstagramSettings | undefined;
  /** The phone routes' HMAC key, its own secret (§2.10.2): needed with WhatsApp. */
  phoneRouteSecret: string | undefined;
  /** Where the recorded sender writes its lines (ids and hashes only): MUNSHI_OUTBOX_DIR, else a temp folder. */
  outboxDir: string;
  /** The cache (BLUEPRINT §4.8): MUNSHI_CACHE_URL, `redis://host:port`, `unix:///path.sock`, `off`; unset is the memory cache. */
  cacheUrl: string | undefined;
  /** PayPal (D-079, sandbox only): recorded mode unless all three keys are set (paypalSettings). */
  paypal: PayPalSettings;
  /** Supabase Auth's email, for a real shop's sign-up (D-080): SUPABASE_URL (https) and SUPABASE_PUBLISHABLE_KEY, both
   *  or neither. Unset, real sign-up takes the password at once and says the email is not verified. */
  supabase: SupabaseSettings | undefined;
  /** MUNSHI_APP_URL: the app's public origin (https, or http on localhost), where Supabase's email link returns.
   *  Required with Supabase: the link never follows a request's own Host or Origin. */
  appUrl: string | undefined;
  /** Where documents' bytes live (an Instagram post's card among them): Supabase Storage where SUPABASE_STORAGE_BUCKET
   *  is set (with SUPABASE_URL and SUPABASE_SECRET_KEY); else, off a host (no VERCEL_REGION), the folder MUNSHI_MEDIA_DIR
   *  names (pnpm dev sets .run/media); else none, and a post's card cannot be served (the screens say so). */
  media: MediaSettings | undefined;
};

export type SupabaseSettings = { url: string; publishableKey: string };
export type MediaSettings = { kind: 'local'; dir: string } | { kind: 'supabase'; url: string; secretKey: string; bucket: string };

/** By purpose, an approved template's name and its exact approved body, {{1}} where the message's words go. */
export type WhatsAppTemplate = { name: string; text: string };
export type WhatsAppTemplates = { campaign?: WhatsAppTemplate; credit_due?: WhatsAppTemplate; package_expiring?: WhatsAppTemplate; paypal_link?: WhatsAppTemplate };
export type WhatsAppSettings = {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  templates: WhatsAppTemplates;
  templateLanguage: string;
};
export type InstagramSettings = {
  /** The name a grant's account_ref uses for this account: platform.change refuses a run of seven digits, so the
   *  business account id (about seventeen digits) can never be one. */
  accountRef: string;
  businessAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  graphHost: 'graph.instagram.com' | 'graph.facebook.com';
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

/**
 * The channel settings a deployment names: any WHATSAPP_ or INSTAGRAM_ name with a value. Any deployment may hold them
 * (D-080: real and sample shops share one database, so the class is the tenant's): holding them sends nothing by itself.
 * Shared with db/src/deploy-check.ts, which notes them by name.
 */
export const channelCredentials = (env: Env): string[] => Object.keys(env).filter((name) => /^(WHATSAPP|INSTAGRAM)_/.test(name) && env[name]);

const WHATSAPP_NAMES = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'];
const INSTAGRAM_NAMES = ['INSTAGRAM_ACCOUNT_REF', 'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN'];
const TEMPLATE_NAMES: Record<keyof WhatsAppTemplates, string> = {
  campaign: 'WHATSAPP_TEMPLATE_CAMPAIGN',
  credit_due: 'WHATSAPP_TEMPLATE_CREDIT_DUE',
  package_expiring: 'WHATSAPP_TEMPLATE_PACKAGE_EXPIRING',
  paypal_link: 'WHATSAPP_TEMPLATE_PAYPAL_LINK', // a PayPal sandbox payer link (D-079)
};

/** The database's TLS root (MUNSHI_DB_CA, the PEM or its base64), read here as every setting is; core parses it. */
export const dbCaSetting = (env: Env = process.env): string | undefined => env.MUNSHI_DB_CA || undefined;

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
  if (env.MUNSHI_PLATFORM_SECRET && env.MUNSHI_PLATFORM_SECRET.length < 32) invalid.push('MUNSHI_PLATFORM_SECRET');
  if (env.MUNSHI_PHONE_ROUTE_SECRET && env.MUNSHI_PHONE_ROUTE_SECRET.length < 32) invalid.push('MUNSHI_PHONE_ROUTE_SECRET');
  const channels = readChannels(env, invalid);
  if (channels.whatsapp && !env.MUNSHI_PHONE_ROUTE_SECRET) throw new ConfigError('config_missing', ['MUNSHI_PHONE_ROUTE_SECRET']);
  const cache = env.MUNSHI_CACHE_URL;
  if (cache && cache !== 'off' && !/^(redis:\/\/[^\s/]+(\/[0-9]{1,2})?|unix:\/\/\/[^\s]+)$/.test(cache)) invalid.push('MUNSHI_CACHE_URL');
  const supabase = supabaseSettings(env, invalid);
  const appUrl = env.MUNSHI_APP_URL || undefined;
  if (appUrl && !/^(https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)$/.test(appUrl)) invalid.push('MUNSHI_APP_URL');
  if (supabase && !appUrl) throw new ConfigError('config_missing', ['MUNSHI_APP_URL']);
  const media = mediaSettings(env, invalid);
  if (invalid.length) throw new ConfigError('config_invalid', invalid);
  const get = (name: string) => env[name] as string;
  return {
    supabase,
    appUrl,
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
    platformSecret: env.MUNSHI_PLATFORM_SECRET || undefined,
    whatsapp: channels.whatsapp,
    instagram: channels.instagram,
    phoneRouteSecret: env.MUNSHI_PHONE_ROUTE_SECRET || undefined,
    outboxDir: env.MUNSHI_OUTBOX_DIR || path.join(tmpdir(), 'munshi-outbox'),
    cacheUrl: cache || undefined,
    paypal: paypalSettings(env),
    media,
  };
}

// The media store's settings. SUPABASE_STORAGE_BUCKET switches Supabase Storage on and then needs the project URL (the
// same https origin Auth uses) and the secret key, which stays on the server (the store's adapter is its only reader).
// Without it, a process off a host keeps the bytes in the folder MUNSHI_MEDIA_DIR names (the app reads nothing under
// .run/ by itself: pnpm dev passes .run/media); a hosted one has no folder that Meta's fetch would reach on the next
// instance, so it has none.
function mediaSettings(env: Env, invalid: string[]): MediaSettings | undefined {
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  if (bucket) {
    const unset = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'].filter((name) => !env[name]);
    if (unset.length) throw new ConfigError('config_missing', unset);
    if (!/^[a-z0-9][a-z0-9_.-]{2,62}$/.test(bucket)) invalid.push('SUPABASE_STORAGE_BUCKET');
    if (!/^[A-Za-z0-9._-]{20,1000}$/.test(env.SUPABASE_SECRET_KEY as string)) invalid.push('SUPABASE_SECRET_KEY');
    return { kind: 'supabase', url: env.SUPABASE_URL as string, secretKey: env.SUPABASE_SECRET_KEY as string, bucket };
  }
  if (env.VERCEL_REGION) return undefined;
  return env.MUNSHI_MEDIA_DIR ? { kind: 'local', dir: path.resolve(env.MUNSHI_MEDIA_DIR) } : undefined;
}

// Supabase Auth's two public settings come together or not at all; the URL is the project's https origin.
function supabaseSettings(env: Env, invalid: string[]): SupabaseSettings | undefined {
  const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
  const unset = names.filter((name) => !env[name]);
  if (unset.length === names.length) return undefined;
  if (unset.length) throw new ConfigError('config_missing', unset);
  const url = env.SUPABASE_URL as string;
  if (!/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/.test(url)) invalid.push('SUPABASE_URL');
  if (!/^[A-Za-z0-9._-]{20,400}$/.test(env.SUPABASE_PUBLISHABLE_KEY as string)) invalid.push('SUPABASE_PUBLISHABLE_KEY');
  return { url, publishableKey: env.SUPABASE_PUBLISHABLE_KEY as string };
}

// Each channel's settings come together or not at all (WhatsApp's four, Instagram's five; any other name of the
// channel, a template or the host, brings them). App secrets are at least 32 characters; ids are digits; Instagram's
// account ref is a grant's account_ref with no run of seven digits; a template is a name Meta takes beside its exact
// approved text (both or neither, the text holding {{1}} once, at most 1024 characters), its language a locale code.
// A missing set throws; an invalid name joins `invalid`, for the caller to throw.
function readChannels(env: Env, invalid: string[]): { whatsapp: WhatsAppSettings | undefined; instagram: InstagramSettings | undefined } {
  const named = channelCredentials(env);
  const whatsappSet = named.some((name) => name.startsWith('WHATSAPP_'));
  const instagramSet = named.some((name) => name.startsWith('INSTAGRAM_'));
  const unset = (names: string[]) => names.filter((name) => !env[name]);
  if (whatsappSet && unset(WHATSAPP_NAMES).length) throw new ConfigError('config_missing', unset(WHATSAPP_NAMES));
  if (instagramSet && unset(INSTAGRAM_NAMES).length) throw new ConfigError('config_missing', unset(INSTAGRAM_NAMES));
  if (env.WHATSAPP_PHONE_NUMBER_ID && !/^[0-9]{5,20}$/.test(env.WHATSAPP_PHONE_NUMBER_ID)) invalid.push('WHATSAPP_PHONE_NUMBER_ID');
  if (env.INSTAGRAM_BUSINESS_ACCOUNT_ID && !/^[0-9]{5,30}$/.test(env.INSTAGRAM_BUSINESS_ACCOUNT_ID)) invalid.push('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  for (const name of ['WHATSAPP_APP_SECRET', 'INSTAGRAM_APP_SECRET']) if (env[name] && (env[name] as string).length < 32) invalid.push(name);
  for (const name of Object.values(TEMPLATE_NAMES)) {
    const text = `${name}_TEXT`;
    if (!env[name] !== !env[text]) throw new ConfigError('config_missing', [env[name] ? text : name]);
    if (env[name] && !/^[a-z0-9_]{1,512}$/.test(env[name] as string)) invalid.push(name);
    const body = env[text];
    if (body && (body.split('{{1}}').length !== 2 || /\{\{(?!1\}\})/.test(body) || body.length > 1024)) invalid.push(text);
  }
  const ref = env.INSTAGRAM_ACCOUNT_REF;
  if (ref && (!/^[a-z0-9_.-]{1,64}$/.test(ref) || /[0-9]{7}/.test(ref))) invalid.push('INSTAGRAM_ACCOUNT_REF');
  if (env.WHATSAPP_TEMPLATE_LANGUAGE && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(env.WHATSAPP_TEMPLATE_LANGUAGE)) invalid.push('WHATSAPP_TEMPLATE_LANGUAGE');
  if (env.INSTAGRAM_GRAPH_HOST && !oneOf('graph.instagram.com', 'graph.facebook.com')(env.INSTAGRAM_GRAPH_HOST)) invalid.push('INSTAGRAM_GRAPH_HOST');
  const get = (name: string) => env[name] as string;
  return {
    whatsapp: whatsappSet
      ? {
          accessToken: get('WHATSAPP_ACCESS_TOKEN'),
          phoneNumberId: get('WHATSAPP_PHONE_NUMBER_ID'),
          appSecret: get('WHATSAPP_APP_SECRET'),
          verifyToken: get('WHATSAPP_VERIFY_TOKEN'),
          templates: Object.fromEntries(
            Object.entries(TEMPLATE_NAMES)
              .filter(([, name]) => env[name])
              .map(([purpose, name]) => [purpose, { name: get(name), text: get(`${name}_TEXT`) }]),
          ),
          templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
        }
      : undefined,
    instagram: instagramSet
      ? {
          accountRef: get('INSTAGRAM_ACCOUNT_REF'),
          businessAccountId: get('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
          accessToken: get('INSTAGRAM_ACCESS_TOKEN'),
          appSecret: get('INSTAGRAM_APP_SECRET'),
          verifyToken: get('INSTAGRAM_VERIFY_TOKEN'),
          graphHost: (env.INSTAGRAM_GRAPH_HOST || 'graph.instagram.com') as InstagramSettings['graphHost'],
        }
      : undefined,
  };
}

/** The channels' settings alone (scripts/channels-probe.ts): the same rule as webConfig's, errors naming settings only. */
export function channelSettings(env: Env = process.env): { whatsapp: WhatsAppSettings | undefined; instagram: InstagramSettings | undefined } {
  const invalid: string[] = [];
  const channels = readChannels(env, invalid);
  if (invalid.length) throw new ConfigError('config_invalid', invalid);
  return channels;
}

/**
 * The tick route's settings, read on every call and never cached. An unset or empty CRON_SECRET is '' (the route then
 * admits no one); an unset or empty JOBS_DATABASE_URL is undefined (the route answers jobs_unconfigured); with
 * IDP_DATABASE_URL the purge of lapsed sign-ups erases their password identities (unset, a purge that finds one fails).
 */
export function tickSettings(env: Env = process.env): { cronSecret: string; jobsDatabaseUrl: string | undefined; idpDatabaseUrl?: string | undefined } {
  return { cronSecret: env.CRON_SECRET ?? '', jobsDatabaseUrl: env.JOBS_DATABASE_URL || undefined, idpDatabaseUrl: env.IDP_DATABASE_URL || undefined };
}

/**
 * PayPal (D-079, sandbox only): PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID together, or none (then
 * recorded mode: no call leaves the machine). PAYPAL_ENV, when set, must be `sandbox`; a live PayPal is not wired. Not a
 * channel credential: a demo deployment may hold sandbox keys. Errors name the settings, never their values.
 */
export type PayPalSettings = { mode: 'recorded' } | { mode: 'sandbox'; clientId: string; clientSecret: string; webhookId: string };
export function paypalSettings(env: Env = process.env): PayPalSettings {
  if (env.PAYPAL_ENV && env.PAYPAL_ENV !== 'sandbox') throw new ConfigError('config_invalid', ['PAYPAL_ENV']);
  const names = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'];
  const set = names.filter((name) => env[name]);
  if (!set.length) return { mode: 'recorded' };
  if (set.length < names.length) throw new ConfigError('config_missing', names.filter((name) => !env[name]));
  if (!/^[A-Za-z0-9]{1,50}$/.test(env.PAYPAL_WEBHOOK_ID as string)) throw new ConfigError('config_invalid', ['PAYPAL_WEBHOOK_ID']);
  return { mode: 'sandbox', clientId: env.PAYPAL_CLIENT_ID as string, clientSecret: env.PAYPAL_CLIENT_SECRET as string, webhookId: env.PAYPAL_WEBHOOK_ID as string };
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
