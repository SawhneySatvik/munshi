// The media store's settings (webConfig's media): SUPABASE_STORAGE_BUCKET switches Supabase Storage on and needs the
// project URL and the secret key beside it; without it, a process off a host (no VERCEL_REGION) keeps bytes in a folder
// (MUNSHI_MEDIA_DIR, which pnpm dev sets to .run/media; unset, none), and a hosted one has none. No value reaches an error.
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { expect, it } from 'vitest';
import { ConfigError, webConfig } from '../src/index.ts';

const hex = () => randomBytes(32).toString('hex');
const url = (role: string) => `postgres://${role}:${hex()}@127.0.0.1:5432/munshi`;
const good = (): Record<string, string> => ({
  DATABASE_URL: url('munshi_app'),
  JOBS_DATABASE_URL: url('munshi_jobs'),
  AGENT_DATABASE_URL: url('munshi_agent'),
  PLATFORM_DATABASE_URL: url('munshi_platform'),
  PUBLIC_DATABASE_URL: url('munshi_public'),
  IDP_DATABASE_URL: url('munshi_idp'),
  MUNSHI_DEPLOYMENT: 'demo',
  MUNSHI_SESSION_SECRET: hex(),
  MUNSHI_DEMO_TENANT_ID: randomUUID(),
});
const SECRET = `sb_secret_${randomBytes(16).toString('hex')}`;
const supabase = {
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key_0123456789abcdef',
  MUNSHI_APP_URL: 'https://munshi.example',
  SUPABASE_SECRET_KEY: SECRET,
};

const refused = (env: Record<string, string>) => {
  try {
    webConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    expect(`${(err as Error).message} ${(err as Error).stack} ${inspect(err)}`).not.toContain(SECRET);
    return [(err as ConfigError).code, (err as ConfigError).names];
  }
  return null;
};

it('off a host the store is the folder MUNSHI_MEDIA_DIR names (unset, none); hosted, none unless the bucket is set; the bucket needs the project URL and the secret key, and a bad bucket or key is refused by name', () => {
  expect(webConfig(good()).media).toBeUndefined();
  expect(webConfig({ ...good(), MUNSHI_MEDIA_DIR: '/tmp/munshi-media' }).media).toEqual({ kind: 'local', dir: '/tmp/munshi-media' });
  expect(webConfig({ ...good(), VERCEL_REGION: 'bom1', MUNSHI_MEDIA_DIR: '/tmp/munshi-media' }).media).toBeUndefined();
  expect(webConfig({ ...good(), VERCEL_REGION: 'bom1', ...supabase }).media).toBeUndefined();
  const hosted = { ...good(), VERCEL_REGION: 'bom1', ...supabase, SUPABASE_STORAGE_BUCKET: 'munshi-media' };
  expect(webConfig(hosted).media).toEqual({ kind: 'supabase', url: supabase.SUPABASE_URL, secretKey: SECRET, bucket: 'munshi-media' });
  expect(webConfig({ ...good(), ...supabase, SUPABASE_STORAGE_BUCKET: 'munshi-media' }).media?.kind).toBe('supabase');
  const { SUPABASE_SECRET_KEY: _k, ...noKey } = hosted;
  expect(refused(noKey)).toEqual(['config_missing', ['SUPABASE_SECRET_KEY']]);
  expect(refused({ ...good(), SUPABASE_STORAGE_BUCKET: 'munshi-media', SUPABASE_SECRET_KEY: SECRET })).toEqual(['config_missing', ['SUPABASE_URL']]);
  expect(refused({ ...hosted, SUPABASE_STORAGE_BUCKET: 'Has Spaces' })).toEqual(['config_invalid', ['SUPABASE_STORAGE_BUCKET']]);
  expect(refused({ ...hosted, SUPABASE_SECRET_KEY: `${SECRET} ;` })).toEqual(['config_invalid', ['SUPABASE_SECRET_KEY']]);
});
