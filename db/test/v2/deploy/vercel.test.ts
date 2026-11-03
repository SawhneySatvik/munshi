// One Vercel project with three services (deploy/vercel.md), defined by the root vercel.json: the web app (apps/web) and
// the two shop sites (apps/elite, apps/prabhave), each built from its own folder, so no two builds write the same .next
// (what failed the earlier previews, when both sites built from apps/sites). Each service installs and builds only its own
// app and carries no environment value; the top level holds only routing, the region and the cron. Public traffic: each
// site at /s/<slug>, the base path its app builds under, and everything else to the web app. Each site reaches the web
// app's API server-side through a binding (WEB_URL). The project's daily cron calls the GET tick route, which the web app
// serves. .vercelignore keeps settings files and the local database out of every upload, and lets vercel.json go up.
// Red-proofs: test/v2/sabotage/deploy.ts (the cron) and test/v2/sabotage/deploy-prep.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { sabotageIs } from '../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
// Each site app's next.config.ts, loaded as Next loads it (by path, so the database package does not take Next's types).
const configOf = async (slug: string) =>
  ((await import(pathToFileURL(path.join(ROOT, 'apps', slug, 'next.config.ts')).href)) as { default: { basePath?: string } }).default;
type Binding = { type: string; service: string; format: string; env: string };
type Service = { root: string; framework?: string; installCommand?: string; buildCommand?: string; bindings?: Binding[] } & Record<string, unknown>;
type Rewrite = { source: string; destination: { service: string } };
type VercelJson = { services: Record<string, Service>; rewrites: Rewrite[]; regions?: string[]; crons?: { path: string; schedule: string }[] } & Record<string, unknown>;
const read = (): VercelJson => JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as VercelJson;

const SERVICES = { web: ['apps/web', '@munshi/web'], elite: ['apps/elite', '@munshi/elite'], prabhave: ['apps/prabhave', '@munshi/prabhave'] } as const;
const WEB_BINDING = { type: 'service', service: 'web', format: 'url', env: 'WEB_URL' };

/** The service a path reaches: the first rewrite whose source matches it (Vercel's order), as a whole-path match. */
function serviceFor(rewrites: Rewrite[], pathname: string): string | undefined {
  return rewrites.find((r) => new RegExp(`^${r.source}$`).test(pathname))?.destination.service;
}

it('one project, three services, each from its own folder, installing and building only its own app; the top level holds no build or runtime key', () => {
  const v = read();
  if (sabotageIs('v2-vercel-services-shared-root')) (v.services.prabhave as Service).root = 'apps/elite';
  if (sabotageIs('v2-vercel-sites-dist')) (v.services.elite as Service).buildCommand = 'MUNSHI_SITES_DIST=.next-elite pnpm build';
  expect(Object.keys(v.services)).toEqual(Object.keys(SERVICES));
  for (const [name, [root, pkg]] of Object.entries(SERVICES)) {
    const s = v.services[name] as Service;
    expect(s, name).toMatchObject({ root, framework: 'nextjs', installCommand: `cd ../.. && pnpm install --frozen-lockfile --filter ${pkg}...` });
    // The business and the base path are fixed in each site app's next.config.ts, and every app builds into .next.
    expect(s.buildCommand, name).toBe('pnpm build');
    expect((JSON.parse(readFileSync(path.join(ROOT, s.root, 'package.json'), 'utf8')) as { name: string }).name, name).toBe(pkg);
    expect(Object.keys(s).filter((k) => !['root', 'framework', 'installCommand', 'buildCommand', 'bindings'].includes(k)), name).toEqual([]);
  }
  // Two services building in one folder would write one .next.
  const roots = Object.values(v.services).map((s) => s.root);
  expect(new Set(roots).size).toBe(roots.length);
  // In services mode, build and runtime keys belong to a service; the top level is routing, the region and the cron.
  expect(Object.keys(v).sort()).toEqual(['$schema', 'crons', 'regions', 'rewrites', 'services']);
  expect(v.regions).toEqual(['bom1']);
  // The per-app files of the three-project layout are gone, so nothing else configures a build.
  for (const app of ['web', 'sites', 'elite', 'prabhave']) expect(existsSync(path.join(ROOT, 'apps', app, 'vercel.json')), app).toBe(false);
});

it('each site is bound to the web app as WEB_URL and routed at its own /s/<slug>, its app’s base path; everything else goes to the web app', async () => {
  const v = read();
  if (sabotageIs('v2-vercel-site-unbound')) delete (v.services.prabhave as Service).bindings;
  if (sabotageIs('v2-vercel-catch-all-first')) v.rewrites.unshift(v.rewrites.pop() as Rewrite);
  expect(v.services.web?.bindings).toBeUndefined();
  for (const slug of ['elite', 'prabhave']) {
    expect(v.services[slug]?.bindings, slug).toEqual([WEB_BINDING]);
    const base = `/s/${slug}`;
    expect((await configOf(slug)).basePath, slug).toBe(base);
    for (const p of [base, `${base}/`, `${base}/hi/catalogue`, `${base}/_next/static/chunks/a.js`]) expect(serviceFor(v.rewrites, p), p).toBe(slug);
  }
  for (const p of ['/', '/app', '/api/v1/sites/elite', '/s', '/s/elitex', '/s/other/en', '/sitemap.xml']) expect(serviceFor(v.rewrites, p), p).toBe('web');
  // Most specific first: the catch-all is the last rule, and each rule names a service.
  expect(v.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: { service: 'web' } });
  expect(v.rewrites.map((r) => Object.keys(r.destination))).toEqual(v.rewrites.map(() => ['service']));
});

it('the project has one daily cron, on the web app’s tick route, which answers GET', () => {
  const v = read();
  if (sabotageIs('v2-vercel-cron-path')) v.crons = [{ path: '/api/tick', schedule: '41 0 * * *' }];
  if (sabotageIs('v2-vercel-cron-hourly')) v.crons = [{ path: '/api/internal/tick', schedule: '41 * * * *' }];
  expect(v.crons).toHaveLength(1);
  const cron = v.crons?.[0] as { path: string; schedule: string };
  // Hobby runs a cron at most once a day: a fixed minute and hour, every day.
  expect(cron.schedule).toMatch(/^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*$/);
  expect(serviceFor(v.rewrites, cron.path)).toBe('web');
  const route = path.join(ROOT, 'apps', 'web', 'app', ...cron.path.split('/').filter(Boolean), 'route.ts');
  let source = '';
  try {
    source = readFileSync(route, 'utf8');
  } catch {
    // no such route: the expectation below fails
  }
  expect(source, cron.path).toMatch(/^export const GET = /m);
});

it('.vercelignore keeps settings files and the local database out of the upload, and lets the root vercel.json go up', () => {
  let lines = readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (sabotageIs('v2-vercelignore-env')) lines = lines.filter((l) => l !== '.env*');
  if (sabotageIs('v2-vercelignore-run')) lines = lines.filter((l) => l !== '.run');
  // The CLI reads only .vercelignore, never .gitignore: these must be listed here, unanchored so they hold in every folder.
  for (const rule of ['.env*', '!.env.example', '.run', '.vercel', '.next', 'node_modules']) expect(lines, rule).toContain(rule);
  // Everything else at the root stays out unless named: the workspace, its root files and the services' definition.
  expect(lines[0]).toBe('/*');
  const kept = lines.filter((l) => l.startsWith('!/')).map((l) => l.slice(2)).sort();
  expect(kept).toEqual(['.nvmrc', 'apps', 'db', 'deploy', 'package.json', 'packages', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'vercel.json']);
  // `.env*` must come after the folders it applies inside; a later `!` must not undo it.
  const env = lines.indexOf('.env*');
  expect(lines.slice(env + 1).filter((l) => l.startsWith('!') && l !== '!.env.example')).toEqual([]);
});
