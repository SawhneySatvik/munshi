// pnpm dev's environment for next dev (db/src/dev.ts webEnv): every setting boot requires, each pool connecting as its
// own role on the dev cluster, and none of it written to the output. The required names come from the config module's
// own refusal of an empty environment, not from dev.ts. Nothing here starts a cluster or touches .run/. Red-proofs:
// test/v2/sabotage/core-boot.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ConfigError, POOL_URL, type PoolName, tickSettings, webConfig } from '../../../../../packages/config/src/index.ts';
import { type Logins, webEnv } from '../../../../src/dev.ts';

const DEV = path.join(import.meta.dirname, '..', '..', '..', '..', 'src', 'dev.ts');
const hex = (n = 24) => randomBytes(n).toString('hex');
const ROLE: Record<PoolName, keyof Logins> = {
  app: 'munshi_app',
  jobs: 'munshi_jobs',
  agent: 'munshi_agent',
  platform: 'munshi_platform',
  public: 'munshi_public',
  idp: 'munshi_idp',
};

function requiredNames(): string[] {
  try {
    webConfig({});
  } catch (err) {
    if (err instanceof ConfigError) return err.names;
  }
  throw new Error('webConfig accepted an empty environment');
}

it('pnpm dev gives next dev every setting boot requires, each pool as its own role, and writes none of them out', () => {
  const logins: Logins = { munshi_app: hex(), munshi_agent: hex(), munshi_jobs: hex(), munshi_platform: hex(), munshi_public: hex(), munshi_idp: hex() };
  const secrets = { session: hex(32), cron: hex(32), identity: hex(32), rate: hex(32) };
  const tenant = randomUUID();
  const written: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    }),
  );
  let env: Record<string, string>;
  try {
    env = webEnv(54321, logins, secrets, tenant);
  } finally {
    for (const s of spies) s.mockRestore();
  }
  expect(written).toEqual([]);

  const required = requiredNames();
  expect(required).toHaveLength(9);
  for (const name of required) expect(env[name], name).toBeTruthy();
  const c = webConfig(env); // throws naming any setting that is missing or not valid
  expect([c.deployment, c.sessionSecret.toString('hex'), c.demoTenantId, c.identitySecret, c.rateSecret]).toEqual(['demo', secrets.session, tenant, secrets.identity, secrets.rate]);
  expect(tickSettings(env)).toEqual({ cronSecret: secrets.cron, jobsDatabaseUrl: env.JOBS_DATABASE_URL, idpDatabaseUrl: env.IDP_DATABASE_URL });
  for (const [pool, name] of Object.entries(POOL_URL) as [PoolName, string][]) {
    const u = new URL(env[name] as string);
    expect([u.username, decodeURIComponent(u.password), u.hostname, u.port, u.pathname], pool).toEqual([ROLE[pool], logins[ROLE[pool]], '127.0.0.1', '54321', '/munshi_dev']);
  }

  // dev.ts's own output: no console call names a login, a secret, a URL or the environment it builds.
  const calls = readFileSync(DEV, 'utf8')
    .split('\n')
    .filter((line) => /\bconsole\s*\.\s*\w+\s*\(/.test(line));
  expect(calls.length).toBeGreaterThan(0);
  for (const line of calls) expect(line).not.toMatch(/secret|password|logins|webEnv|env\b|url\(/i);
});
