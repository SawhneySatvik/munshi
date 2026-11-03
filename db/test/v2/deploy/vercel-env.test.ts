// VERCEL-ENV1 (deploy/vercel-env.ts, deploy/vercel.md): what the script would set on a Vercel project, from parsed
// stand-ins for .env.production and .env (this test reads neither file and runs no `vercel`). The console's key goes
// only with --with-console, the founder's explicit choice; without it the console stays 404 on that deployment, and a
// live deployment, which requires the key to boot, is refused. Migrator, admin and channel settings never go.
// Red-proofs: test/v2/sabotage/operator.ts.
import { expect, it } from 'vitest';
import { vercelValues } from '../../../../deploy/vercel-env.ts';

const KEY = 'k'.repeat(64);
const production = {
  DATABASE_URL: 'postgres://munshi_app.ref:pw@pooler.invalid:6543/postgres',
  PLATFORM_DATABASE_URL: 'postgres://munshi_platform.ref:pw@pooler.invalid:6543/postgres',
  MUNSHI_DEPLOYMENT: 'demo',
  MUNSHI_PLATFORM_SECRET: KEY,
  MUNSHI_IDENTITY_SECRET: 'i'.repeat(64),
  MUNSHI_RATE_SECRET: 'r'.repeat(64),
  MIGRATOR_DATABASE_URL: 'postgres://munshi_migrator.ref:pw@pooler.invalid:5432/postgres',
  WHATSAPP_ACCESS_TOKEN: 'EAAG-unused',
};
const refusal = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};

it('VERCEL-ENV1 the console key goes only with --with-console, which also needs sign-in’s two secrets; a live deployment needs the flag; migrator and channel settings never go', () => {
  const off = vercelValues(['--cwd=/tmp/linked'], production, {}).values;
  expect(off).not.toHaveProperty('MUNSHI_PLATFORM_SECRET');
  expect(off).toMatchObject({ PLATFORM_DATABASE_URL: production.PLATFORM_DATABASE_URL, MUNSHI_DEPLOYMENT: 'demo' });
  const on = vercelValues(['--cwd=/tmp/linked', '--with-console'], production, {}).values;
  expect(on.MUNSHI_PLATFORM_SECRET).toBe(KEY);
  for (const v of [off, on]) for (const name of ['MIGRATOR_DATABASE_URL', 'WHATSAPP_ACCESS_TOKEN']) expect(v).not.toHaveProperty(name);
  expect(Object.keys(on).filter((k) => !(k in off))).toEqual(['MUNSHI_PLATFORM_SECRET']);

  // The console's sign-in needs the key and the password identity's two secrets: each missing one is named.
  const without = (...names: string[]) =>
    refusal(() => vercelValues(['--cwd=/tmp/linked', '--with-console'], { ...production, ...Object.fromEntries(names.map((n) => [n, ''])) }, {}));
  expect(without('MUNSHI_PLATFORM_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_PLATFORM_SECRET in .env.production');
  expect(without('MUNSHI_IDENTITY_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_IDENTITY_SECRET in .env.production');
  expect(without('MUNSHI_RATE_SECRET', 'MUNSHI_IDENTITY_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_IDENTITY_SECRET, MUNSHI_RATE_SECRET in .env.production');
  const live = { ...production, MUNSHI_DEPLOYMENT: 'live' };
  expect(refusal(() => vercelValues(['--cwd=/tmp/linked'], live, {}))).toBe('vercel-env: a live deployment runs the console: pass --with-console');
  expect(vercelValues(['--cwd=/tmp/linked', '--with-console'], live, {}).values.MUNSHI_PLATFORM_SECRET).toBe(KEY);
  expect(refusal(() => vercelValues(['--cwd=/tmp/linked', '--set', `MUNSHI_PLATFORM_SECRET=${KEY}`], production, {}))).toBe(
    'vercel-env: --set takes only non-secret MUNSHI_ settings, not MUNSHI_PLATFORM_SECRET',
  );
  expect(refusal(() => vercelValues(['--cwd=/tmp/linked', '--console'], production, {}))).toBe('vercel-env: unknown argument --console');
});
