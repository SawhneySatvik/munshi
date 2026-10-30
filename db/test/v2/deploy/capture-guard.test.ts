// The capture guard (scripts/capture-guard.ts, MERCHANTS-DESIGN §8.3) against three local servers standing in for the
// demo app, the live app and a shop site (real HTTP on 127.0.0.1, nothing mocked), with both app origins in its config,
// and the source scan that keeps the public-site marker out of apps/web. Red-proofs: test/v2/sabotage/deploy.ts.
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type GuardConfig, guard, main } from '../../../../scripts/capture-guard.ts';
import { sabotageIs } from '../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
const MARKER = '<meta name="munshi-surface" content="public-site">';
const doc = (htmlAttrs: string, head = '') => `<!doctype html><html lang="en" ${htmlAttrs}><head>${head}<title>t</title></head><body>page</body></html>`;

type Routes = Record<string, { status?: number; type?: string; body: string }>;
const servers: Server[] = [];
async function serve(routes: Routes): Promise<string> {
  const server = createServer((req, res) => {
    const r = routes[req.url ?? ''];
    res.writeHead(r ? (r.status ?? 200) : 404, { 'content-type': r?.type ?? 'text/html; charset=utf-8' });
    res.end(r ? r.body : 'not found');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const a = server.address();
  if (!a || typeof a !== 'object') throw new Error('no address');
  return `http://127.0.0.1:${a.port}`;
}

const health = (deployment: string) => ({ type: 'application/json', body: JSON.stringify({ ok: true, deployment, schema: 'abcdefabcdef' }) });
let demo: string;
let live: string;
let site: string;
let config: GuardConfig;
let configFile: string;
let tmp: string;

beforeAll(async () => {
  demo = await serve({
    '/api/health': health('demo'),
    '/app/home': { body: doc('data-class="synthetic" data-tenant="sharma-general-store"') },
    '/app/elite': { body: doc('data-class="showcase" data-tenant="elite"') },
    '/app/leaky': { body: doc('data-class="live" data-tenant="sharma-general-store"') },
    '/app/bare': { body: doc('') },
    '/app/stranger': { body: doc('data-class="synthetic" data-tenant="someone-else"') },
    '/app/misfiled': { body: doc('data-class="synthetic" data-tenant="elite"') },
  });
  live = await serve({
    '/api/health': health('live'),
    '/app/home': { body: doc('data-class="live" data-tenant="elite"') },
    '/planted': { body: doc('', MARKER) },
  });
  site = await serve({
    '/en': { body: doc('', MARKER) },
    '/en/sent': { body: doc('data-state="sent"', MARKER) },
    '/en/plain': { body: doc('') },
  });
  config = {
    appOrigins: [demo, `${live}/`],
    demoTenants: [
      { slug: 'sharma-general-store', class: 'synthetic' },
      { slug: 'elite', class: 'showcase' },
      { slug: 'prabhave', class: 'showcase' },
    ],
  };
  tmp = mkdtempSync(path.join(tmpdir(), 'munshi-capture-'));
  configFile = path.join(tmp, 'capture-guard.json');
  writeFileSync(configFile, JSON.stringify(config));
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

it('CAPTURE1 --mode app passes demo pages of allow-listed tenants, and --mode site a marked site page', async () => {
  expect(await guard('app', [`${demo}/app/home`, `${demo}/app/elite`], config)).toEqual([]);
  expect(await guard('site', [`${site}/en`], config)).toEqual([]);
});

it('CAPTURE1 --mode site refuses an app page: its origin is one of the app deploys', async () => {
  expect(await guard('site', [`${demo}/app/home`], config)).toEqual([`${demo}/app/home: on an app deploy's origin; --mode site never captures an app page`]);
});

it("CAPTURE1 --mode site refuses a page on the live app's origin even with the marker planted", async () => {
  expect(await guard('site', [`${live}/planted`], config)).toEqual([`${live}/planted: on an app deploy's origin; --mode site never captures an app page`]);
});

it('CAPTURE1 --mode app refuses a site page, and the live app: neither origin has /api/health saying demo', async () => {
  expect(await guard('app', [`${site}/en`], config)).toEqual([`${site}: /api/health does not say deployment demo`]);
  expect(await guard('app', [`${live}/app/home`], config)).toEqual([`${live}: /api/health does not say deployment demo`]);
});

it('CAPTURE1 --mode app refuses a demo page carrying data-class="live" or none, and a tenant off the allow-list or of another class', async () => {
  expect(await guard('app', [`${demo}/app/leaky`], config)).toEqual([`${demo}/app/leaky: <html data-class> is "live", not synthetic or showcase`]);
  expect(await guard('app', [`${demo}/app/bare`], config)).toEqual([`${demo}/app/bare: <html data-class> is missing, not synthetic or showcase`]);
  for (const p of ['stranger', 'misfiled']) {
    expect(await guard('app', [`${demo}/app/${p}`], config)).toEqual([`${demo}/app/${p}: <html data-tenant> is not an allow-listed synthetic demo tenant`]);
  }
});

it('CAPTURE1 --mode site refuses a site page with no marker or in a request state', async () => {
  expect(await guard('site', [`${site}/en/plain`, `${site}/en/sent`], config)).toEqual([
    `${site}/en/plain: no <meta name="munshi-surface" content="public-site">`,
    `${site}/en/sent: in a form-result or request state (data-state)`,
  ]);
});

it('CAPTURE1 the CLI exits 1 on any refusal, 2 without a mode, and 0 when every page passes', async () => {
  const lines: string[] = [];
  const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
  expect(await main(['--mode', 'app', '--config', configFile, `${demo}/app/home`, `${demo}/app/leaky`], io)).toBe(1);
  expect(await main(['--config', configFile, `${demo}/app/home`], io)).toBe(2);
  expect(await main(['--mode=site', `--config=${configFile}`, `${site}/en`], io)).toBe(0);
  // The script itself, as the shots runner calls it.
  // Asynchronously: the servers answer from this process, so a synchronous spawn would never get a reply.
  const cli = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [path.join(ROOT, 'scripts', 'capture-guard.ts'), ...args], { encoding: 'utf8', timeout: 30_000 }, (err, stdout, stderr) =>
        resolve({ status: err ? ((err as { code?: number }).code ?? null) : 0, stdout, stderr }),
      );
    });
  const refused = await cli(['--mode', 'site', '--config', configFile, `${live}/planted`]);
  expect([refused.status, refused.stderr]).toEqual([1, expect.stringContaining("on an app deploy's origin")]);
  const ok = await cli(['--mode', 'app', '--config', configFile, `${demo}/app/home`]);
  expect([ok.status, ok.stdout.trim()]).toEqual([0, 'capture-guard: ok (--mode app, 1 page)']);
});

it('CAPTURE1 only apps/sites may render the public-site marker: no source file under apps/web carries it', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|js|html)$/.test(name)) files.push(p);
    }
  };
  const web = path.join(ROOT, 'apps', 'web');
  for (const sub of ['app', 'components', 'lib']) walk(path.join(web, sub));
  files.push(path.join(web, 'proxy.ts'));
  const texts = files.map((f) => [path.relative(ROOT, f), readFileSync(f, 'utf8')] as const);
  if (sabotageIs('v2-capture-scan-web-marker')) texts.push(['apps/web/app/planted.tsx', `<meta name="munshi-surface" content="public-site" />`]);
  expect(texts.length).toBeGreaterThan(20);
  expect(texts.filter(([, t]) => t.includes('munshi-surface')).map(([f]) => f)).toEqual([]);
});
