// VERCEL-ENV1 (deploy/vercel-env.ts, deploy/vercel.md): what the script would set on a Vercel project, from parsed
// stand-ins for .env.production and .env (this test reads neither file and runs no `vercel`). The console's key goes
// only with --with-console, the founder's explicit choice; without it the console stays 404 on that deployment, and a
// live deployment, which requires the key to boot, is refused. Migrator, admin and channel settings never go.
// VERCEL-ENV2: the one project (the web app and both sites, as services) gets the web app's names and each site's
// publishable key under its own name, checked to be that business's; never a site's API address, a business or the
// one-key name both sites would read. Any other project, and a checkout linked to another project, is refused.
// Red-proofs: test/v2/sabotage/operator.ts (VERCEL-ENV1), test/v2/sabotage/deploy-prep.ts (VERCEL-ENV2).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { checkLink, vercelValues } from '../../../../deploy/vercel-env.ts';

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

it('the console key goes only with --with-console, which also needs sign-in’s two secrets; a live deployment needs the flag; migrator and channel settings never go', () => {
  const off = vercelValues(['--project=munshi', '--cwd=/tmp/linked'], production, {}).values;
  expect(off).not.toHaveProperty('MUNSHI_PLATFORM_SECRET');
  expect(off).toMatchObject({ PLATFORM_DATABASE_URL: production.PLATFORM_DATABASE_URL, MUNSHI_DEPLOYMENT: 'demo' });
  const on = vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--with-console'], production, {}).values;
  expect(on.MUNSHI_PLATFORM_SECRET).toBe(KEY);
  for (const v of [off, on]) for (const name of ['MIGRATOR_DATABASE_URL', 'WHATSAPP_ACCESS_TOKEN']) expect(v).not.toHaveProperty(name);
  expect(Object.keys(on).filter((k) => !(k in off))).toEqual(['MUNSHI_PLATFORM_SECRET']);

  // The console's sign-in needs the key and the password identity's two secrets: each missing one is named.
  const without = (...names: string[]) =>
    refusal(() => vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--with-console'], { ...production, ...Object.fromEntries(names.map((n) => [n, ''])) }, {}));
  expect(without('MUNSHI_PLATFORM_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_PLATFORM_SECRET in .env.production');
  expect(without('MUNSHI_IDENTITY_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_IDENTITY_SECRET in .env.production');
  expect(without('MUNSHI_RATE_SECRET', 'MUNSHI_IDENTITY_SECRET')).toBe('vercel-env: --with-console needs MUNSHI_IDENTITY_SECRET, MUNSHI_RATE_SECRET in .env.production');
  const live = { ...production, MUNSHI_DEPLOYMENT: 'live' };
  expect(refusal(() => vercelValues(['--project=munshi', '--cwd=/tmp/linked'], live, {}))).toBe('vercel-env: a live deployment runs the console: pass --with-console');
  expect(vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--with-console'], live, {}).values.MUNSHI_PLATFORM_SECRET).toBe(KEY);
  expect(refusal(() => vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--set', `MUNSHI_PLATFORM_SECRET=${KEY}`], production, {}))).toBe(
    "vercel-env: --set takes only the non-secret settings and the sites' publishable keys, not MUNSHI_PLATFORM_SECRET",
  );
  expect(refusal(() => vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--console'], production, {}))).toBe('vercel-env: unknown argument --console');
});

it('the one project gets the web app’s names and the sites’ keys; never a site’s address, a business or a shared key', () => {
  const local = { GEMINI_API_KEY: 'g'.repeat(39), PAYPAL_CLIENT_ID: 'c'.repeat(80), PAYPAL_CLIENT_SECRET: 's'.repeat(80), PAYPAL_WEBHOOK_ID: 'W0RKS1234567890AB', PAYPAL_ENV: 'sandbox' };
  const ELITE = `mpk_elite_${'e'.repeat(43)}`;
  const PRABHAVE = `mpk_prabhave_${'p'.repeat(43)}`;
  const args = ['--project=munshi', '--cwd=/tmp/linked', '--with-console'];
  const all = vercelValues(
    [...args, '--set', 'MUNSHI_APP_URL=https://munshi.vercel.app', '--set', 'PAYPAL_SANDBOX_CURRENCY=INR:USD', '--set', `MUNSHI_SITE_KEY_ELITE=${ELITE}`, '--set', `MUNSHI_SITE_KEY_PRABHAVE=${PRABHAVE}`],
    production,
    local,
  ).values;
  expect(all).toMatchObject({
    DATABASE_URL: production.DATABASE_URL,
    GEMINI_API_KEY: local.GEMINI_API_KEY,
    PAYPAL_CLIENT_ID: local.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: local.PAYPAL_CLIENT_SECRET,
    PAYPAL_WEBHOOK_ID: local.PAYPAL_WEBHOOK_ID,
    PAYPAL_ENV: 'sandbox',
    PAYPAL_SANDBOX_CURRENCY: 'INR:USD',
    MUNSHI_APP_URL: 'https://munshi.vercel.app',
    MUNSHI_SITE_KEY_ELITE: ELITE,
    MUNSHI_SITE_KEY_PRABHAVE: PRABHAVE,
    ENABLE_EXPERIMENTAL_COREPACK: '1',
  });
  // A site's server finds the web app through its binding (WEB_URL) and the browser calls its own origin; each site app
  // fixes its business; a one-key name would hand both sites the same key.
  for (const name of ['MUNSHI_SITE', 'MUNSHI_API_URL', 'MUNSHI_PUBLIC_API_URL', 'WEB_URL', 'MUNSHI_SITE_KEY']) {
    expect(all, name).not.toHaveProperty(name);
    expect(refusal(() => vercelValues([...args, '--set', `${name}=x`], production, local)), name).toBe(
      `vercel-env: --set takes only the non-secret settings and the sites' publishable keys, not ${name}`,
    );
  }
  // Each key under its own business's name: a swapped or malformed one is refused.
  expect(refusal(() => vercelValues([...args, '--set', `MUNSHI_SITE_KEY_ELITE=${PRABHAVE}`], production, local))).toBe(
    "vercel-env: MUNSHI_SITE_KEY_ELITE must be elite's publishable key (mpk_elite_…)",
  );
  expect(refusal(() => vercelValues([...args, '--set', `MUNSHI_SITE_KEY_PRABHAVE=${ELITE}`], production, local))).toBe(
    "vercel-env: MUNSHI_SITE_KEY_PRABHAVE must be prabhave's publishable key (mpk_prabhave_…)",
  );
  expect(refusal(() => vercelValues([...args, '--set', 'MUNSHI_SITE_KEY_ELITE=mpk_elite_short'], production, local))).toMatch(/^vercel-env: MUNSHI_SITE_KEY_ELITE must be/);
  // The three-project names are gone.
  const ONE = 'vercel-env: --project must be munshi, the one project with the web app and both sites';
  expect(refusal(() => vercelValues(['--cwd=/tmp/linked'], production, local))).toBe(ONE);
  for (const project of ['munshi-elite', 'munshi-prabhave', 'munshi-sites']) expect(refusal(() => vercelValues([`--project=${project}`, '--cwd=/tmp/linked'], production, local)), project).toBe(ONE);

  // The linked checkout must name the same project.
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-vercel-link-'));
  try {
    expect(refusal(() => checkLink(dir, 'munshi'))).toBe(`vercel-env: ${dir} is linked to no named project, not munshi: run \`vercel link --yes --project munshi\` there first`);
    mkdirSync(path.join(dir, '.vercel'));
    writeFileSync(path.join(dir, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_x', orgId: 'team_x', projectName: 'munshi-elite' }));
    expect(refusal(() => checkLink(dir, 'munshi'))).toBe(`vercel-env: ${dir} is linked to munshi-elite, not munshi: run \`vercel link --yes --project munshi\` there first`);
    writeFileSync(path.join(dir, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_x', orgId: 'team_x', projectName: 'munshi' }));
    expect(refusal(() => checkLink(dir, 'munshi'))).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
