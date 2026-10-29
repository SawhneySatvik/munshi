// Shared by the hosting layer's tests (test/v2/core/boot/): a complete web environment for a test file's clone, each
// pool as its own role, the sha of the checked-out db/schema (computed here by the build's own reader), and the process
// environment set and restored around a test file. Outside a Next build the sha boot expects is the global that
// next.config.ts's defineServer would replace, so setEnv sets that too. Boot is memoized on globalThis, so every change
// of environment forgets the last boot.
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { inject } from 'vitest';
import { readSchema } from '../../../../src/schema-files.ts';
import type { TestDb } from '../../db.ts';

export const SCHEMA_SHA256 = readSchema().sha256;

// Test passwords are the role names (global-setup.ts).
export const roleUrl = (db: TestDb, role: string, password = role): string =>
  `postgres://${role}:${password}@127.0.0.1:${inject('pg17Port')}/${db.name}`;

export const POOL_ROLES = {
  DATABASE_URL: 'munshi_app',
  JOBS_DATABASE_URL: 'munshi_jobs',
  AGENT_DATABASE_URL: 'munshi_agent',
  PLATFORM_DATABASE_URL: 'munshi_platform',
  PUBLIC_DATABASE_URL: 'munshi_public',
  IDP_DATABASE_URL: 'munshi_idp',
} as const;

export function goodEnv(db: TestDb): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(POOL_ROLES).map(([name, role]) => [name, roleUrl(db, role)])),
    MUNSHI_DEPLOYMENT: 'demo',
    MUNSHI_SESSION_SECRET: randomBytes(32).toString('hex'),
    MUNSHI_DEMO_TENANT_ID: randomUUID(),
  };
}

// Real sign-in's two keys, which a live deployment's config requires (optional on demo).
export const signInKeys = (): Record<string, string> => ({ MUNSHI_IDENTITY_SECRET: randomBytes(32).toString('hex'), MUNSHI_RATE_SECRET: randomBytes(32).toString('hex') });

// Every name the hosting layer reads; setEnv clears the ones an environment leaves out.
// MUNSHI_SCHEMA_SHA256 is read by nothing; it is here so a test can set it and show that boot ignores it.
const NAMES = [...Object.keys(POOL_ROLES), 'MUNSHI_DEPLOYMENT', 'MUNSHI_SCHEMA_SHA256', 'MUNSHI_SESSION_SECRET', 'MUNSHI_DEMO_TENANT_ID', 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'MUNSHI_MODEL_MODE', 'MUNSHI_AI', 'MUNSHI_SEND_MODE', 'VERCEL_REGION', 'CRON_SECRET'];
const before = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
const held = globalThis as typeof globalThis & { munshiBoot?: unknown; MUNSHI_BUILD_SCHEMA_SHA256?: string };
const builtBefore = held.MUNSHI_BUILD_SCHEMA_SHA256;

/** Sets the environment and the build's schema sha (the checked-out one unless given; null for none). */
export function setEnv(env: Record<string, string | undefined>, built: string | null = SCHEMA_SHA256): void {
  for (const name of NAMES) {
    const value = env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (built === null) delete held.MUNSHI_BUILD_SCHEMA_SHA256;
  else held.MUNSHI_BUILD_SCHEMA_SHA256 = built;
  held.munshiBoot = undefined;
}

export const restoreEnv = (): void => setEnv(before, builtBefore ?? null);

// Next's own modules (the request hook, next.config, Next's request class and testing helpers), loaded by path and
// untyped here: Next's types declare a required NODE_ENV on every ProcessEnv, which would break the types of db's other
// files that build an environment. test/hosting/next.ts loads first: it sets up the globals Next's server modules need.
const WEB = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'apps', 'web');

export type Next = {
  proxy: (request: unknown) => Promise<Response>;
  hookConfig: unknown;
  nextConfig: unknown;
  request: (url: string, init?: RequestInit) => unknown;
  doesMatch: (o: { config: unknown; url: string; nextConfig: unknown }) => boolean;
  fromConfig: (o: { url: string; nextConfig: unknown }) => Promise<Response>;
};

export async function loadNext(): Promise<Next> {
  const next = await import(path.join(WEB, 'test', 'hosting', 'next.ts'));
  const hook = await import(path.join(WEB, 'proxy.ts'));
  const config = await import(path.join(WEB, 'next.config.ts'));
  return {
    proxy: hook.proxy,
    hookConfig: hook.config,
    nextConfig: config.default,
    request: (url, init) => new next.NextRequest(url, init),
    doesMatch: next.unstable_doesMiddlewareMatch,
    fromConfig: next.unstable_getResponseFromNextConfig,
  };
}
