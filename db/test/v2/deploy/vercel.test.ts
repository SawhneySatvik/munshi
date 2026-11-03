// Three Vercel projects, each with its Root Directory set to its app (deploy/vercel.md): `munshi` (apps/web) and
// `munshi-elite`, `munshi-prabhave` (apps/sites, the business from the project's MUNSHI_SITE). Each app's vercel.json
// uses a filtered install, runs in Mumbai and carries no environment value; the sites build into `.next`, the only
// folder Vercel packages, with no base path. The web project's daily cron calls the GET tick route. The repository
// root has no vercel.json, and its .vercelignore keeps settings files and the local database out of every upload.
// Red-proofs: test/v2/sabotage/deploy.ts (the cron) and test/v2/sabotage/deploy-prep.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
type VercelJson = { framework?: string; installCommand?: string; buildCommand?: string; regions?: string[]; crons?: { path: string; schedule: string }[]; env?: unknown; build?: unknown };
const read = (app: string): VercelJson => JSON.parse(readFileSync(path.join(ROOT, 'apps', app, 'vercel.json'), 'utf8')) as VercelJson;

it('each demo project installs and builds only its own app, in bom1, and its file carries no environment value', () => {
  for (const [app, pkg] of [['web', '@munshi/web'], ['sites', '@munshi/sites']] as const) {
    const v = read(app);
    expect(v, app).toMatchObject({ framework: 'nextjs', installCommand: `pnpm install --frozen-lockfile --filter ${pkg}...`, regions: ['bom1'] });
    expect(v.buildCommand, app).toMatch(new RegExp(`pnpm --filter ${pkg} build$`));
    expect([v.env, v.build], app).toEqual([undefined, undefined]);
  }
  expect(read('web').buildCommand).toBe('pnpm --filter @munshi/web build');
  expect(read('sites').crons).toBeUndefined();
});

it('a site project builds into .next with no base path, and takes its business only from the project’s MUNSHI_SITE', () => {
  const v = read('sites');
  if (sabotageIs('v2-vercel-sites-dist')) v.buildCommand = 'pnpm --filter @munshi/sites build';
  if (sabotageIs('v2-vercel-sites-slug-in-file')) v.buildCommand = `MUNSHI_SITE=elite ${v.buildCommand}`;
  // next.config.ts's default folder is .next/<slug>, which Vercel does not package (the fourth preview's failure).
  expect(v.buildCommand).toBe('MUNSHI_SITES_DIST=.next pnpm --filter @munshi/sites build');
  expect(v.buildCommand).not.toMatch(/MUNSHI_SITE=|BASE_PATH/);
});

it('the web project has one daily cron, on the tick route, which answers GET', () => {
  const v = read('web');
  if (sabotageIs('v2-vercel-cron-path')) v.crons = [{ path: '/api/tick', schedule: '41 0 * * *' }];
  if (sabotageIs('v2-vercel-cron-hourly')) v.crons = [{ path: '/api/internal/tick', schedule: '41 * * * *' }];
  expect(v.crons).toHaveLength(1);
  const cron = v.crons?.[0] as { path: string; schedule: string };
  // Hobby runs a cron at most once a day: a fixed minute and hour, every day.
  expect(cron.schedule).toMatch(/^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*$/);
  const route = path.join(ROOT, 'apps', 'web', 'app', ...cron.path.split('/').filter(Boolean), 'route.ts');
  let source = '';
  try {
    source = readFileSync(route, 'utf8');
  } catch {
    // no such route: the expectation below fails
  }
  expect(source, cron.path).toMatch(/^export const GET = /m);
});

it('the root has no multi-service vercel.json, and .vercelignore keeps settings files and the local database out of the upload', () => {
  expect(existsSync(path.join(ROOT, 'vercel.json'))).toBe(false);
  let lines = readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (sabotageIs('v2-vercelignore-env')) lines = lines.filter((l) => l !== '.env*');
  if (sabotageIs('v2-vercelignore-run')) lines = lines.filter((l) => l !== '.run');
  // The CLI reads only .vercelignore, never .gitignore: these must be listed here, unanchored so they hold in every folder.
  for (const rule of ['.env*', '!.env.example', '.run', '.vercel', '.next', 'node_modules']) expect(lines, rule).toContain(rule);
  // Everything else at the root stays out unless named: the workspace and its root files go up, nothing more.
  expect(lines[0]).toBe('/*');
  const kept = lines.filter((l) => l.startsWith('!/')).map((l) => l.slice(2)).sort();
  expect(kept).toEqual(['.nvmrc', 'apps', 'db', 'deploy', 'package.json', 'packages', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']);
  // `.env*` must come after the folders it applies inside; a later `!` must not undo it.
  const env = lines.indexOf('.env*');
  expect(lines.slice(env + 1).filter((l) => l.startsWith('!') && l !== '!.env.example')).toEqual([]);
});
