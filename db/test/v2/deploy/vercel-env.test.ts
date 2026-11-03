// VERCEL-ENV1 (deploy/vercel-env.ts, deploy/vercel.md): what the script would set on a Vercel project, from parsed
// stand-ins for .env.production and .env (this test reads neither file and runs no `vercel`). The console's key goes
// only with --with-console, the founder's explicit choice; without it the console stays 404 on that deployment, and a
// live deployment, which requires the key to boot, is refused. Migrator, admin and channel settings never go.
// VERCEL-ENV2: each of the three projects gets only its own names; a site never a database URL, secret or model key,
// and a checkout linked to another project is refused.
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
    'vercel-env: --set takes only non-secret MUNSHI_ settings, not MUNSHI_PLATFORM_SECRET',
  );
  expect(refusal(() => vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--console'], production, {}))).toBe('vercel-env: unknown argument --console');
});

it('each project gets only its own names: the web app the database, secrets and model keys; a site its business, the API origin and its own key', () => {
  const local = { GEMINI_API_KEY: 'g'.repeat(39) };
  const web = vercelValues(['--project=munshi', '--cwd=/tmp/linked', '--with-console', '--set', 'MUNSHI_APP_URL=https://munshi.vercel.app'], production, local).values;
  expect(web).toMatchObject({ DATABASE_URL: production.DATABASE_URL, GEMINI_API_KEY: local.GEMINI_API_KEY, MUNSHI_APP_URL: 'https://munshi.vercel.app', ENABLE_EXPERIMENTAL_COREPACK: '1' });
  expect(web).not.toHaveProperty('MUNSHI_SITE');

  const API = 'https://munshi.vercel.app';
  for (const [project, slug, other] of [['munshi-elite', 'elite', 'PRABHAVE'], ['munshi-prabhave', 'prabhave', 'ELITE']] as const) {
    const key = `MUNSHI_SITE_KEY_${slug.toUpperCase()}`;
    const site = vercelValues(['--project', project, '--cwd=/tmp/linked', '--set', `MUNSHI_API_URL=${API}`, '--set', `${key}=mpk_${slug}_abcd`], production, local).values;
    expect(site, project).toEqual({ ENABLE_EXPERIMENTAL_COREPACK: '1', MUNSHI_SITE: slug, MUNSHI_API_URL: API, [key]: `mpk_${slug}_abcd` });
    const args = ['--project', project, '--cwd=/tmp/linked'];
    expect(refusal(() => vercelValues(args, production, local)), project).toBe(`vercel-env: ${project} needs --set MUNSHI_API_URL=<the munshi project's https origin>`);
    expect(refusal(() => vercelValues([...args, '--set', `MUNSHI_API_URL=${API}`, '--set', `MUNSHI_SITE_KEY_${other}=mpk_x`], production, local)), project).toMatch(
      new RegExp(`^vercel-env: --set on ${project} takes only .*, not MUNSHI_SITE_KEY_${other}$`),
    );
    expect(refusal(() => vercelValues([...args, '--set', `MUNSHI_API_URL=${API}`, '--set', 'MUNSHI_SITE=elite'], production, local)), project).toMatch(/not MUNSHI_SITE$/);
    expect(refusal(() => vercelValues([...args, '--set', `MUNSHI_API_URL=${API}`, '--with-console'], production, local)), project).toBe(
      'vercel-env: --with-console is for the web project (munshi) only',
    );
    expect(refusal(() => vercelValues([...args, '--set', 'MUNSHI_API_URL=http://munshi.vercel.app/'], production, local)), project).toBe(
      'vercel-env: MUNSHI_API_URL must be an https origin with no path or trailing slash',
    );
  }
  expect(refusal(() => vercelValues(['--cwd=/tmp/linked'], production, local))).toBe('vercel-env: --project must be one of munshi, munshi-elite, munshi-prabhave');
  expect(refusal(() => vercelValues(['--project=munshi-sites', '--cwd=/tmp/linked'], production, local))).toBe('vercel-env: --project must be one of munshi, munshi-elite, munshi-prabhave');

  // The linked checkout must name the same project.
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-vercel-link-'));
  try {
    expect(refusal(() => checkLink(dir, 'munshi'))).toBe(`vercel-env: ${dir} is linked to no named project, not munshi: run \`vercel link --yes --project munshi\` there first`);
    mkdirSync(path.join(dir, '.vercel'));
    writeFileSync(path.join(dir, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_x', orgId: 'team_x', projectName: 'munshi-elite' }));
    expect(refusal(() => checkLink(dir, 'munshi'))).toBe(`vercel-env: ${dir} is linked to munshi-elite, not munshi: run \`vercel link --yes --project munshi\` there first`);
    expect(refusal(() => checkLink(dir, 'munshi-elite'))).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
