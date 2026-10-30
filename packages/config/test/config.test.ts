// The web process's settings (BLUEPRINT §4.3): every required name is named when missing, every invalid one when
// wrong, and no value ever reaches the error. The database-backed boot checks and their red-proofs are in
// db/test/v2/core/boot/.
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { expect, it } from 'vitest';
import { buildSchemaSha256, ConfigError, type Env, tickSettings, webConfig } from '../src/index.ts';

const hex = () => randomBytes(32).toString('hex');
const url = (role: string, password: string) => `postgres://${role}:${password}@127.0.0.1:5432/munshi`;

const good = (): Record<string, string> => ({
  DATABASE_URL: url('munshi_app', hex()),
  JOBS_DATABASE_URL: url('munshi_jobs', hex()),
  AGENT_DATABASE_URL: url('munshi_agent', hex()),
  PLATFORM_DATABASE_URL: url('munshi_platform', hex()),
  PUBLIC_DATABASE_URL: url('munshi_public', hex()),
  IDP_DATABASE_URL: url('munshi_idp', hex()),
  MUNSHI_DEPLOYMENT: 'demo',
  MUNSHI_SESSION_SECRET: hex(),
  MUNSHI_DEMO_TENANT_ID: randomUUID(),
});

const REQUIRED = Object.keys(good());

function refusal(env: Env): ConfigError {
  try {
    webConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('webConfig accepted the settings');
}

// Every rendering of an error a log, a page or a test runner could print.
const renderings = (err: Error) => [err.message, err.stack ?? '', String(err), inspect(err), JSON.stringify(err)];

it('CONFIG1 a complete environment parses, with the defaults for the optional settings', () => {
  const env = good();
  const c = webConfig(env);
  expect(c.deployment).toBe('demo');
  expect(c.databaseUrls).toEqual({
    app: env.DATABASE_URL,
    jobs: env.JOBS_DATABASE_URL,
    agent: env.AGENT_DATABASE_URL,
    platform: env.PLATFORM_DATABASE_URL,
    public: env.PUBLIC_DATABASE_URL,
    idp: env.IDP_DATABASE_URL,
  });
  expect(c.sessionSecret.toString('hex')).toBe(env.MUNSHI_SESSION_SECRET);
  expect(c.demoTenantId).toBe(env.MUNSHI_DEMO_TENANT_ID);
  expect([c.modelMode, c.ai, c.sendMode, c.region]).toEqual(['recorded', 'on', 'recorded', undefined]);
  expect(webConfig({ ...env, MUNSHI_MODEL_MODE: 'live', MUNSHI_AI: 'off', MUNSHI_SEND_MODE: 'live', VERCEL_REGION: 'bom1' })).toMatchObject({
    modelMode: 'live',
    ai: 'off',
    sendMode: 'live',
    region: 'bom1',
  });
});

it('CONFIG1 each required setting, unset or empty, is refused by name, and every missing one is named at once', () => {
  expect(REQUIRED).toHaveLength(9);
  for (const name of REQUIRED) {
    for (const value of [undefined, '']) {
      const env: Env = { ...good(), [name]: value };
      const err = refusal(env);
      expect(err.code, name).toBe('config_missing');
      expect(err.names, name).toEqual([name]);
      expect(err.message, name).toContain(name);
    }
  }
  expect(refusal({}).names.sort()).toEqual([...REQUIRED].sort());
});

it('CONFIG1 an invalid value is refused by name and never printed', () => {
  const planted = `planted-${randomBytes(12).toString('hex')}`;
  const bad: [string, string][] = [
    ['DATABASE_URL', planted],
    ['JOBS_DATABASE_URL', `mysql://munshi_jobs:${planted}@127.0.0.1/munshi`],
    ['AGENT_DATABASE_URL', `postgres://munshi_agent:${planted}@`],
    ['MUNSHI_DEPLOYMENT', planted],
    ['IDP_DATABASE_URL', `postgres://munshi_idp:${planted}`],
    ['MUNSHI_SESSION_SECRET', planted],
    ['MUNSHI_SESSION_SECRET', hex().toUpperCase()],
    ['MUNSHI_DEMO_TENANT_ID', planted],
    ['MUNSHI_MODEL_MODE', planted],
    ['MUNSHI_AI', planted],
    ['MUNSHI_SEND_MODE', planted],
  ];
  for (const [name, value] of bad) {
    const env = { ...good(), [name]: value };
    const err = refusal(env);
    expect(err.code, name).toBe('config_invalid');
    expect(err.names, name).toEqual([name]);
    for (const text of renderings(err)) {
      expect(text, name).not.toContain(planted);
      for (const v of Object.values(env)) expect(text, name).not.toContain(v);
    }
  }
});

it('CONFIG1 the tick settings are read on every call: an unset CRON_SECRET is empty, an unset jobs URL is undefined', () => {
  expect(tickSettings({})).toEqual({ cronSecret: '', jobsDatabaseUrl: undefined });
  expect(tickSettings({ CRON_SECRET: '', JOBS_DATABASE_URL: '' })).toEqual({ cronSecret: '', jobsDatabaseUrl: undefined });
  const env = { CRON_SECRET: hex(), JOBS_DATABASE_URL: url('munshi_jobs', hex()) };
  expect(tickSettings(env)).toEqual({ cronSecret: env.CRON_SECRET, jobsDatabaseUrl: env.JOBS_DATABASE_URL });
});

// The schema sha boot expects is the build's: next.config.ts's compiler.defineServer writes it into the server bundle in
// place of the identifier. Outside a Next build the identifier is a global the process alone can set; no environment
// variable is ever read for it.
it('CONFIG1 the expected schema sha is the build value, never an environment variable', () => {
  const g = globalThis as { MUNSHI_BUILD_SCHEMA_SHA256?: unknown };
  const env = process.env as Record<string, string | undefined>;
  const before = { built: g.MUNSHI_BUILD_SCHEMA_SHA256, env: env.MUNSHI_SCHEMA_SHA256 };
  try {
    delete g.MUNSHI_BUILD_SCHEMA_SHA256;
    env.MUNSHI_SCHEMA_SHA256 = hex();
    expect(buildSchemaSha256()).toBeUndefined();
    expect(Object.keys(webConfig(good())).some((k) => /sha/i.test(k))).toBe(false);
    const built = hex();
    g.MUNSHI_BUILD_SCHEMA_SHA256 = built;
    expect(buildSchemaSha256()).toBe(built);
    g.MUNSHI_BUILD_SCHEMA_SHA256 = 42;
    expect(buildSchemaSha256()).toBeUndefined();
  } finally {
    g.MUNSHI_BUILD_SCHEMA_SHA256 = before.built;
    if (before.built === undefined) delete g.MUNSHI_BUILD_SCHEMA_SHA256;
    if (before.env === undefined) delete env.MUNSHI_SCHEMA_SHA256;
    else env.MUNSHI_SCHEMA_SHA256 = before.env;
  }
});

it('CONFIG1 real sign-in’s two keys are required on live, optional on demo, and at least 32 characters wherever given', () => {
  const live = { ...good(), MUNSHI_DEPLOYMENT: 'live' };
  const refused = (env: Record<string, string>) => {
    try {
      webConfig(env);
      return null;
    } catch (err) {
      return err instanceof ConfigError ? [err.code, err.names] : err;
    }
  };
  expect(refused(live)).toEqual(['config_missing', ['MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET']]);
  expect(refused({ ...live, MUNSHI_IDENTITY_SECRET: hex() })).toEqual(['config_missing', ['MUNSHI_RATE_SECRET']]);
  const keys = { MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex() };
  expect(webConfig({ ...live, ...keys })).toMatchObject({ identitySecret: keys.MUNSHI_IDENTITY_SECRET, rateSecret: keys.MUNSHI_RATE_SECRET });
  expect(webConfig(good())).toMatchObject({ identitySecret: undefined, rateSecret: undefined });
  expect(refused({ ...good(), MUNSHI_RATE_SECRET: 'short' })).toEqual(['config_invalid', ['MUNSHI_RATE_SECRET']]);
});

it('CONFIG1 the console’s platform key is optional and at least 32 characters when given', () => {
  expect(webConfig(good())).toMatchObject({ platformSecret: undefined });
  const key = hex();
  expect(webConfig({ ...good(), MUNSHI_PLATFORM_SECRET: key })).toMatchObject({ platformSecret: key });
  expect(() => webConfig({ ...good(), MUNSHI_PLATFORM_SECRET: 'short' })).toThrow(/MUNSHI_PLATFORM_SECRET/);
});

it('CONFIG1 WhatsApp’s four settings come together or not at all, with the phone-route key beside them', () => {
  const refused = (env: Record<string, string>) => {
    try {
      webConfig(env);
      return null;
    } catch (err) {
      return err instanceof ConfigError ? [err.code, err.names] : err;
    }
  };
  const wa = { WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token', WHATSAPP_PHONE_NUMBER_ID: '1000000001', WHATSAPP_APP_SECRET: hex(), WHATSAPP_VERIFY_TOKEN: 'verify-me' };
  // WhatsApp runs only on live (a demo names no channel credential, the next test), whose sign-in keys are required.
  const live = () => ({ ...good(), MUNSHI_DEPLOYMENT: 'live', MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex() });
  expect(webConfig(good())).toMatchObject({ whatsapp: undefined, phoneRouteSecret: undefined });
  expect(refused({ ...live(), WHATSAPP_ACCESS_TOKEN: 'x' })).toEqual(['config_missing', ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']]);
  expect(refused({ ...live(), ...wa })).toEqual(['config_missing', ['MUNSHI_PHONE_ROUTE_SECRET']]);
  const route = hex();
  expect(webConfig({ ...live(), ...wa, MUNSHI_PHONE_ROUTE_SECRET: route })).toMatchObject({ whatsapp: { phoneNumberId: '1000000001' }, phoneRouteSecret: route });
  expect(refused({ ...live(), ...wa, WHATSAPP_APP_SECRET: 'short', MUNSHI_PHONE_ROUTE_SECRET: route })).toEqual(['config_invalid', ['WHATSAPP_APP_SECRET']]);
});

it('CONFIG1 a demo deployment names no channel credential: any WhatsApp or Instagram setting refuses boot by name, never by value', () => {
  const planted = `EAAG-${hex()}`;
  for (const name of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'INSTAGRAM_ACCESS_TOKEN']) {
    const err = refusal({ ...good(), [name]: planted });
    expect([err.code, err.names], name).toEqual(['config_invalid', [name]]);
    for (const text of renderings(err)) expect(text, name).not.toContain(planted);
  }
  // All four together, with the route key, are still refused on demo, every one named.
  const wa = { WHATSAPP_ACCESS_TOKEN: planted, WHATSAPP_PHONE_NUMBER_ID: '1000000001', WHATSAPP_APP_SECRET: hex(), WHATSAPP_VERIFY_TOKEN: 'verify-me' };
  const all = refusal({ ...good(), ...wa, MUNSHI_PHONE_ROUTE_SECRET: hex() });
  expect([all.code, all.names]).toEqual(['config_invalid', Object.keys(wa)]);
  // An empty value is unset, as everywhere in this module.
  expect(webConfig({ ...good(), WHATSAPP_ACCESS_TOKEN: '' }).whatsapp).toBeUndefined();
});

it('CONFIG1 the cache address: unset is the memory cache; off, a redis:// or a unix:/// address is taken; anything else is invalid', () => {
  expect(webConfig(good()).cacheUrl).toBeUndefined();
  for (const value of ['off', 'redis://127.0.0.1:6379', 'redis://:secret@cache.example:6380/2', 'unix:///home/me/munshi/.run/redis.sock']) {
    expect(webConfig({ ...good(), MUNSHI_CACHE_URL: value }).cacheUrl).toBe(value);
  }
  for (const value of ['on', 'http://cache.example', 'redis://', 'unix://relative.sock', 'redis://host:6379/db zero']) {
    const err = refusal({ ...good(), MUNSHI_CACHE_URL: value });
    expect([value, err.code, err.names]).toEqual([value, 'config_invalid', ['MUNSHI_CACHE_URL']]);
  }
});
