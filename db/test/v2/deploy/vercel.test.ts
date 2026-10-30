// The two demo projects' committed Vercel settings (apps/web/vercel.json, apps/sites/vercel.json; deploy/vercel.md):
// each installs and builds only its own app, runs in Mumbai and carries no environment value; the web project's one
// cron is daily (the Hobby plan's limit) and calls the tick route, which answers GET. What Vercel does with the file is
// UNVERIFIED until BP-OPS-2. Red-proofs: test/v2/sabotage/deploy.ts (harness-level: the parsed file is changed).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
type VercelJson = { framework?: string; installCommand?: string; buildCommand?: string; regions?: string[]; crons?: { path: string; schedule: string }[]; env?: unknown; build?: unknown };
type ServiceVercel = {
  regions?: string[];
  services?: Record<string, { root?: string; framework?: string; installCommand?: string; buildCommand?: string; env?: unknown }>;
  rewrites?: { source: string; destination: { service?: string } }[];
  crons?: { path: string; schedule: string }[];
  env?: unknown;
  build?: unknown;
};
const read = (app: string): VercelJson => JSON.parse(readFileSync(path.join(ROOT, 'apps', app, 'vercel.json'), 'utf8')) as VercelJson;

it('VERCEL1 each demo project installs and builds only its own app, in bom1, and its file carries no environment value', () => {
  for (const [app, pkg] of [['web', '@munshi/web'], ['sites', '@munshi/sites']] as const) {
    const v = read(app);
    expect(v, app).toMatchObject({
      framework: 'nextjs',
      installCommand: `pnpm install --frozen-lockfile --filter ${pkg}...`,
      buildCommand: `pnpm --filter ${pkg} build`,
      regions: ['bom1'],
    });
    expect([v.env, v.build], app).toEqual([undefined, undefined]);
  }
  expect(read('sites').crons).toBeUndefined();
});

it('VERCEL1 the web project has one daily cron, on the tick route, which answers GET', () => {
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

it('VERCEL2 the services layout routes both sites before the web catch-all and carries no environment value', () => {
  const file = path.join(ROOT, 'vercel.json');
  const v = JSON.parse(readFileSync(file, 'utf8')) as ServiceVercel;
  const rewrites = v.rewrites ?? [];
  if (sabotageIs('v2-vercel-services-catchall-order')) {
    const catchall = rewrites.pop();
    if (catchall) rewrites.unshift(catchall);
  }
  if (sabotageIs('v2-vercel-services-env-value')) {
    if (v.services?.web) v.services.web.env = { MUNSHI_API_URL: 'https://example.invalid' };
  }
  expect(v.regions).toEqual(['bom1']);
  expect(v.env).toBeUndefined();
  expect(v.build).toBeUndefined();
  expect(v.services && Object.keys(v.services).sort()).toEqual(['elite', 'prabhave', 'web']);
  for (const [name, root, pkg] of [
    ['web', 'apps/web', '@munshi/web'],
    ['elite', 'apps/sites', '@munshi/sites'],
    ['prabhave', 'apps/sites', '@munshi/sites'],
  ] as const) {
    const service = v.services?.[name];
    expect(service?.root, name).toBe(root);
    expect(existsSync(path.join(ROOT, root, 'package.json')), name).toBe(true);
    expect(service?.framework, name).toBe('nextjs');
    expect(service?.installCommand, name).toContain(`--filter ${pkg}...`);
    expect(service?.env, name).toBeUndefined();
    if (name === 'elite' || name === 'prabhave') {
      expect(service?.buildCommand).toContain(`MUNSHI_SITE=${name}`);
      expect(service?.buildCommand).toContain(`MUNSHI_SITES_BASE_PATH=/s/${name}`);
      expect(service?.buildCommand).toContain(`NEXT_PUBLIC_MUNSHI_SITES_BASE_PATH=/s/${name}`);
      expect(service?.buildCommand).toContain(`MUNSHI_SITES_DIST=.next-${name}`);
      expect(service?.buildCommand).toContain(`mv .next-${name} .next`);
    }
  }
  for (const slug of ['elite', 'prabhave']) {
    expect(rewrites.some((r) => r.source === `/s/${slug}/(.*)` && r.destination.service === slug), slug).toBe(true);
    expect(rewrites.some((r) => r.source === `/s/${slug}` && r.destination.service === slug), slug).toBe(true);
  }
  expect(rewrites.at(-1)).toEqual({ source: '/(.*)', destination: { service: 'web' } });
  expect(rewrites.filter((r) => r.source === '/(.*)')).toHaveLength(1);
  expect(v.crons).toEqual([{ path: '/api/internal/tick', schedule: '41 0 * * *' }]);
  const route = path.join(ROOT, 'apps', 'web', 'app', 'api', 'internal', 'tick', 'route.ts');
  expect(readFileSync(route, 'utf8')).toMatch(/^export const GET = /m);
});
