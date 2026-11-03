// The web process's settings: every required name is named when missing, every invalid one when wrong, and no value
// ever reaches the error. The database-backed boot checks and their red-proofs are in db/test/v2/core/boot/.
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { expect, it } from 'vitest';
import { buildSchemaSha256, ConfigError, channelSettings, type Env, tickSettings, webConfig } from '../src/index.ts';

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

it('a complete environment parses, with the defaults for the optional settings', () => {
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

it('each required setting, unset or empty, is refused by name, and every missing one is named at once', () => {
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

it('an invalid value is refused by name and never printed', () => {
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

it('the tick settings are read on every call: an unset CRON_SECRET is empty, an unset jobs URL is undefined', () => {
  expect(tickSettings({})).toEqual({ cronSecret: '', jobsDatabaseUrl: undefined });
  expect(tickSettings({ CRON_SECRET: '', JOBS_DATABASE_URL: '' })).toEqual({ cronSecret: '', jobsDatabaseUrl: undefined });
  const env = { CRON_SECRET: hex(), JOBS_DATABASE_URL: url('munshi_jobs', hex()) };
  expect(tickSettings(env)).toEqual({ cronSecret: env.CRON_SECRET, jobsDatabaseUrl: env.JOBS_DATABASE_URL });
});

// The schema sha boot expects is the build's: next.config.ts's compiler.defineServer writes it into the server bundle in
// place of the identifier. Outside a Next build the identifier is a global the process alone can set; no environment
// variable is ever read for it.
it('the expected schema sha is the build value, never an environment variable', () => {
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

it('real sign-in’s two keys and the console’s are required on live, sign-in’s optional on demo, and at least 32 characters wherever given', () => {
  const live = { ...good(), MUNSHI_DEPLOYMENT: 'live' };
  const refused = (env: Record<string, string>) => {
    try {
      webConfig(env);
      return null;
    } catch (err) {
      return err instanceof ConfigError ? [err.code, err.names] : err;
    }
  };
  expect(refused(live)).toEqual(['config_missing', ['MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'MUNSHI_PLATFORM_SECRET']]);
  expect(refused({ ...live, MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_PLATFORM_SECRET: hex() })).toEqual(['config_missing', ['MUNSHI_RATE_SECRET']]);
  const keys = { MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex(), MUNSHI_PLATFORM_SECRET: hex() };
  expect(webConfig({ ...live, ...keys })).toMatchObject({ identitySecret: keys.MUNSHI_IDENTITY_SECRET, rateSecret: keys.MUNSHI_RATE_SECRET });
  expect(webConfig(good())).toMatchObject({ identitySecret: undefined, rateSecret: undefined });
  expect(refused({ ...good(), MUNSHI_RATE_SECRET: 'short' })).toEqual(['config_invalid', ['MUNSHI_RATE_SECRET']]);
});

it('the console’s platform key is optional on demo, required on live, and at least 32 characters when given', () => {
  expect(webConfig(good())).toMatchObject({ platformSecret: undefined });
  const key = hex();
  expect(webConfig({ ...good(), MUNSHI_PLATFORM_SECRET: key })).toMatchObject({ platformSecret: key });
  expect(() => webConfig({ ...good(), MUNSHI_PLATFORM_SECRET: 'short' })).toThrow(/MUNSHI_PLATFORM_SECRET/);
  // Live: the console is part of the deployment, so boot refuses without its key, naming only that.
  const live = { ...good(), MUNSHI_DEPLOYMENT: 'live', MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex() };
  let names: string[] | undefined;
  try {
    webConfig(live);
  } catch (err) {
    names = err instanceof ConfigError && err.code === 'config_missing' ? err.names : undefined;
  }
  expect(names).toEqual(['MUNSHI_PLATFORM_SECRET']);
  expect(webConfig({ ...live, MUNSHI_PLATFORM_SECRET: key })).toMatchObject({ deployment: 'live', platformSecret: key });
});

it('WhatsApp’s four settings come together or not at all, with the phone-route key beside them', () => {
  const refused = (env: Record<string, string>) => {
    try {
      webConfig(env);
      return null;
    } catch (err) {
      return err instanceof ConfigError ? [err.code, err.names] : err;
    }
  };
  const wa = { WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token', WHATSAPP_PHONE_NUMBER_ID: '1000000001', WHATSAPP_APP_SECRET: hex(), WHATSAPP_VERIFY_TOKEN: 'verify-me' };
  const live = () => ({ ...good(), MUNSHI_DEPLOYMENT: 'live', MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex(), MUNSHI_PLATFORM_SECRET: hex() });
  expect(webConfig(good())).toMatchObject({ whatsapp: undefined, instagram: undefined, phoneRouteSecret: undefined });
  expect(refused({ ...live(), WHATSAPP_ACCESS_TOKEN: 'x' })).toEqual(['config_missing', ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']]);
  // A template alone brings the four.
  expect(refused({ ...live(), WHATSAPP_TEMPLATE_CAMPAIGN: 'munshi_offer', WHATSAPP_TEMPLATE_CAMPAIGN_TEXT: 'Namaste! {{1}}' })).toEqual([
    'config_missing',
    Object.keys(wa),
  ]);
  expect(refused({ ...live(), ...wa })).toEqual(['config_missing', ['MUNSHI_PHONE_ROUTE_SECRET']]);
  const route = hex();
  expect(webConfig({ ...live(), ...wa, MUNSHI_PHONE_ROUTE_SECRET: route })).toMatchObject({
    whatsapp: { phoneNumberId: '1000000001', templates: {}, templateLanguage: 'en' },
    phoneRouteSecret: route,
  });
  expect(refused({ ...live(), ...wa, WHATSAPP_APP_SECRET: 'short', MUNSHI_PHONE_ROUTE_SECRET: route })).toEqual(['config_invalid', ['WHATSAPP_APP_SECRET']]);
  const templates = {
    WHATSAPP_TEMPLATE_CAMPAIGN: 'munshi_offer',
    WHATSAPP_TEMPLATE_CAMPAIGN_TEXT: 'Namaste! {{1}} Reply STOP to stop these.',
    WHATSAPP_TEMPLATE_CREDIT_DUE: 'munshi_credit_due',
    WHATSAPP_TEMPLATE_CREDIT_DUE_TEXT: '{{1}}',
    WHATSAPP_TEMPLATE_LANGUAGE: 'hi',
  };
  expect(webConfig({ ...live(), ...wa, ...templates, MUNSHI_PHONE_ROUTE_SECRET: route }).whatsapp).toMatchObject({
    templates: { campaign: { name: 'munshi_offer', text: 'Namaste! {{1}} Reply STOP to stop these.' }, credit_due: { name: 'munshi_credit_due', text: '{{1}}' } },
    templateLanguage: 'hi',
  });
  const base = { ...live(), ...wa, MUNSHI_PHONE_ROUTE_SECRET: route };
  // A name and its approved text come together: no template is sent whose words are not known.
  expect(refused({ ...base, WHATSAPP_TEMPLATE_CAMPAIGN: 'munshi_offer' })).toEqual(['config_missing', ['WHATSAPP_TEMPLATE_CAMPAIGN_TEXT']]);
  expect(refused({ ...base, WHATSAPP_TEMPLATE_CAMPAIGN_TEXT: 'Namaste! {{1}}' })).toEqual(['config_missing', ['WHATSAPP_TEMPLATE_CAMPAIGN']]);
  // The text holds {{1}} exactly once and no other variable, in at most 1024 characters.
  for (const text of ['Namaste!', '{{1}} and {{1}}', 'Namaste {{1}}, {{2}}', `${'a'.repeat(1020)} {{1}}`]) {
    expect(refused({ ...base, WHATSAPP_TEMPLATE_CAMPAIGN: 'munshi_offer', WHATSAPP_TEMPLATE_CAMPAIGN_TEXT: text }), text.slice(0, 20)).toEqual([
      'config_invalid',
      ['WHATSAPP_TEMPLATE_CAMPAIGN_TEXT'],
    ]);
  }
  expect(refused({ ...base, ...templates, WHATSAPP_TEMPLATE_CAMPAIGN: 'Has Spaces' })).toEqual(['config_invalid', ['WHATSAPP_TEMPLATE_CAMPAIGN']]);
  expect(refused({ ...live(), ...wa, MUNSHI_PHONE_ROUTE_SECRET: route, WHATSAPP_TEMPLATE_LANGUAGE: 'hindi' })).toEqual(['config_invalid', ['WHATSAPP_TEMPLATE_LANGUAGE']]);
});

it('Instagram’s five settings come together or not at all; the account ref has no run of seven digits, the account id is digits, the app secret 32 characters, the host one of two', () => {
  const refused = (env: Record<string, string>) => {
    try {
      webConfig(env);
      return null;
    } catch (err) {
      return err instanceof ConfigError ? [err.code, err.names] : err;
    }
  };
  const ig = {
    INSTAGRAM_ACCOUNT_REF: 'shop_pro',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841400000000001',
    INSTAGRAM_ACCESS_TOKEN: 'IGAA-test-token',
    INSTAGRAM_APP_SECRET: hex(),
    INSTAGRAM_VERIFY_TOKEN: 'verify-ig',
  };
  expect(refused({ ...good(), INSTAGRAM_ACCESS_TOKEN: 'x' })).toEqual([
    'config_missing',
    ['INSTAGRAM_ACCOUNT_REF', 'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN'],
  ]);
  expect(refused({ ...good(), INSTAGRAM_GRAPH_HOST: 'graph.facebook.com' })).toEqual(['config_missing', Object.keys(ig)]);
  expect(webConfig({ ...good(), ...ig }).instagram).toEqual({
    accountRef: 'shop_pro',
    businessAccountId: ig.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    accessToken: ig.INSTAGRAM_ACCESS_TOKEN,
    appSecret: ig.INSTAGRAM_APP_SECRET,
    verifyToken: ig.INSTAGRAM_VERIFY_TOKEN,
    graphHost: 'graph.instagram.com',
  });
  expect(webConfig({ ...good(), ...ig, INSTAGRAM_GRAPH_HOST: 'graph.facebook.com' }).instagram?.graphHost).toBe('graph.facebook.com');
  expect(refused({ ...good(), ...ig, INSTAGRAM_BUSINESS_ACCOUNT_ID: 'shop_account' })).toEqual(['config_invalid', ['INSTAGRAM_BUSINESS_ACCOUNT_ID']]);
  expect(refused({ ...good(), ...ig, INSTAGRAM_APP_SECRET: 'short' })).toEqual(['config_invalid', ['INSTAGRAM_APP_SECRET']]);
  // The account ref is what a grant names, and a platform change refuses a run of seven digits: the id cannot be it.
  for (const ref of [ig.INSTAGRAM_BUSINESS_ACCOUNT_ID, 'shop1234567', 'ShopRef', 'has space']) {
    expect(refused({ ...good(), ...ig, INSTAGRAM_ACCOUNT_REF: ref }), ref).toEqual(['config_invalid', ['INSTAGRAM_ACCOUNT_REF']]);
  }
  expect(webConfig({ ...good(), ...ig, INSTAGRAM_ACCOUNT_REF: 'shop_123456' }).instagram?.accountRef).toBe('shop_123456');
  expect(refused({ ...good(), ...ig, INSTAGRAM_GRAPH_HOST: 'evil.example' })).toEqual(['config_invalid', ['INSTAGRAM_GRAPH_HOST']]);
  // The probe's own read is the same rule.
  expect(channelSettings(ig).instagram?.businessAccountId).toBe(ig.INSTAGRAM_BUSINESS_ACCOUNT_ID);
  expect(() => channelSettings({ ...ig, INSTAGRAM_APP_SECRET: 'short' })).toThrow(ConfigError);
});

it('any deployment may hold channel settings: boot passes with WhatsApp and Instagram set, demo or live, and an error names a setting, never its value', () => {
  const planted = `EAAG-${hex()}`;
  const wa = { WHATSAPP_ACCESS_TOKEN: planted, WHATSAPP_PHONE_NUMBER_ID: '1000000001', WHATSAPP_APP_SECRET: hex(), WHATSAPP_VERIFY_TOKEN: 'verify-me' };
  const ig = {
    INSTAGRAM_ACCOUNT_REF: 'shop_pro',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841400000000001',
    INSTAGRAM_ACCESS_TOKEN: planted,
    INSTAGRAM_APP_SECRET: hex(),
    INSTAGRAM_VERIFY_TOKEN: 'verify-ig',
  };
  const live = { MUNSHI_DEPLOYMENT: 'live', MUNSHI_IDENTITY_SECRET: hex(), MUNSHI_RATE_SECRET: hex(), MUNSHI_PLATFORM_SECRET: hex() };
  for (const deployment of [{}, live]) {
    const c = webConfig({ ...good(), ...deployment, ...wa, ...ig, MUNSHI_PHONE_ROUTE_SECRET: hex() });
    expect([c.whatsapp?.accessToken, c.instagram?.accessToken]).toEqual([planted, planted]);
    // Holding them sends nothing by itself: the send mode stays recorded unless set.
    expect(c.sendMode).toBe('recorded');
  }
  for (const [name, value] of [
    ['WHATSAPP_PHONE_NUMBER_ID', planted],
    ['INSTAGRAM_BUSINESS_ACCOUNT_ID', planted],
    ['INSTAGRAM_APP_SECRET', planted.slice(0, 20)],
    ['WHATSAPP_APP_SECRET', planted.slice(0, 20)],
  ] as const) {
    const err = refusal({ ...good(), ...wa, ...ig, MUNSHI_PHONE_ROUTE_SECRET: hex(), [name]: value });
    expect([err.code, err.names], name).toEqual(['config_invalid', [name]]);
    for (const text of renderings(err)) expect(text, name).not.toContain(value);
  }
  // A missing partner names the missing settings, never the given ones' values.
  const missing = refusal({ ...good(), INSTAGRAM_ACCESS_TOKEN: planted });
  for (const text of renderings(missing)) expect(text).not.toContain(planted);
  // An empty value is unset, as everywhere in this module.
  expect(webConfig({ ...good(), WHATSAPP_ACCESS_TOKEN: '', INSTAGRAM_ACCESS_TOKEN: '' })).toMatchObject({ whatsapp: undefined, instagram: undefined });
});

it('the cache address: unset is the memory cache; off, a redis:// or a unix:/// address is taken; anything else is invalid', () => {
  expect(webConfig(good()).cacheUrl).toBeUndefined();
  for (const value of ['off', 'redis://127.0.0.1:6379', 'redis://:secret@cache.example:6380/2', 'unix:///home/me/munshi/.run/redis.sock']) {
    expect(webConfig({ ...good(), MUNSHI_CACHE_URL: value }).cacheUrl).toBe(value);
  }
  for (const value of ['on', 'http://cache.example', 'redis://', 'unix://relative.sock', 'redis://host:6379/db zero']) {
    const err = refusal({ ...good(), MUNSHI_CACHE_URL: value });
    expect([value, err.code, err.names]).toEqual([value, 'config_invalid', ['MUNSHI_CACHE_URL']]);
  }
});
