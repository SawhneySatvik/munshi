// The capture guard: run over the pages about to be filmed or screenshotted, before any capture.
// Two modes, chosen by the caller and checked against each page:
//   --mode app   app screens. Each origin's GET /api/health must say `deployment: demo`, and every page must carry
//                <html data-class="synthetic|showcase" data-tenant="<slug>"> naming an allow-listed demo tenant of that
//                class. A missing or live value fails.
//   --mode site  the merchants' public site pages, live or demo. A URL on either app deploy's origin is refused before it
//                is fetched; every page must carry <meta name="munshi-surface" content="public-site"> (only apps/sites
//                renders it) and no data-state on <html> (a form result or request state).
// The app origins and the demo tenants are deploy/capture-guard.json's (or --config's).
//   node scripts/capture-guard.ts --mode app|site [--config <file>] <url> …
// Exit 0 when every page passes, 1 on any refusal, 2 on a usage error.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Mode = 'app' | 'site';
export type GuardConfig = { appOrigins: string[]; demoTenants: { slug: string; class: 'synthetic' | 'showcase' }[] };

const DEFAULT_CONFIG = fileURLToPath(new URL('../deploy/capture-guard.json', import.meta.url));
const MARKER = { name: 'munshi-surface', content: 'public-site' };
const DEMO_CLASSES = ['synthetic', 'showcase'];

/** The attributes of every `<tag …>` start tag in `html`, in order, with lower-cased names. */
function startTags(html: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))) {
    const attrs: Record<string, string> = {};
    for (const a of (m[1] ?? '').matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[(a[1] as string).toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    out.push(attrs);
  }
  return out;
}

async function page(url: string, fetchFn: typeof fetch): Promise<{ html: string } | { problem: string }> {
  try {
    const res = await fetchFn(url, { redirect: 'follow' });
    if (new URL(res.url || url).origin !== new URL(url).origin) return { problem: `${url}: redirected to another origin` };
    if (!res.ok) return { problem: `${url}: answered ${res.status}` };
    return { html: await res.text() };
  } catch {
    return { problem: `${url}: could not be fetched` };
  }
}

async function demoHealth(origin: string, fetchFn: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${origin}/api/health`, { redirect: 'manual' });
    const body = (await res.json()) as { ok?: unknown; deployment?: unknown };
    return res.ok && body.ok === true && body.deployment === 'demo';
  } catch {
    return false;
  }
}

/** The refusals for these pages in this mode; empty when every page may be captured. */
export async function guard(mode: Mode, urls: string[], config: GuardConfig, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const problems: string[] = [];
  const appOrigins = new Set(config.appOrigins.map((o) => new URL(o).origin));
  if (mode === 'app') {
    const healthy = new Map<string, boolean>();
    for (const url of urls) {
      const origin = new URL(url).origin;
      if (!healthy.has(origin)) {
        const ok = await demoHealth(origin, fetchFn);
        healthy.set(origin, ok);
        if (!ok) problems.push(`${origin}: /api/health does not say deployment demo`);
      }
      if (!healthy.get(origin)) continue;
      const got = await page(url, fetchFn);
      if ('problem' in got) {
        problems.push(got.problem);
        continue;
      }
      const html = startTags(got.html, 'html')[0] ?? {};
      const cls = html['data-class'];
      const tenant = config.demoTenants.find((t) => t.slug === html['data-tenant']);
      if (!cls || !DEMO_CLASSES.includes(cls)) problems.push(`${url}: <html data-class> is ${cls ? `"${cls}"` : 'missing'}, not synthetic or showcase`);
      else if (!tenant || tenant.class !== cls) problems.push(`${url}: <html data-tenant> is not an allow-listed ${cls} demo tenant`);
    }
    return problems;
  }
  for (const url of urls) {
    if (appOrigins.has(new URL(url).origin)) {
      problems.push(`${url}: on an app deploy's origin; --mode site never captures an app page`);
      continue;
    }
    const got = await page(url, fetchFn);
    if ('problem' in got) {
      problems.push(got.problem);
      continue;
    }
    if (!startTags(got.html, 'meta').some((m) => m.name === MARKER.name && m.content === MARKER.content)) {
      problems.push(`${url}: no <meta name="${MARKER.name}" content="${MARKER.content}">`);
    }
    if ('data-state' in (startTags(got.html, 'html')[0] ?? {})) problems.push(`${url}: in a form-result or request state (data-state)`);
  }
  return problems;
}

export type Io = { out: (line: string) => void; err: (line: string) => void };

/** The CLI: returns the exit code. */
export async function main(argv: string[], io: Io, fetchFn: typeof fetch = fetch): Promise<number> {
  let mode: string | undefined;
  let configPath = DEFAULT_CONFIG;
  const urls: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--mode') mode = argv[++i];
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length);
    else if (arg === '--config') configPath = argv[++i] ?? '';
    else if (arg.startsWith('--config=')) configPath = arg.slice('--config='.length);
    else if (arg.startsWith('--')) {
      io.err(`capture-guard: unknown option ${arg}`);
      return 2;
    } else urls.push(arg);
  }
  if (mode !== 'app' && mode !== 'site') {
    io.err('capture-guard: --mode app or --mode site is required (see the head of scripts/capture-guard.ts)');
    return 2;
  }
  if (!urls.length || urls.some((u) => !URL.canParse(u) || !/^https?:$/.test(new URL(u).protocol))) {
    io.err('capture-guard: give one or more http(s) page URLs');
    return 2;
  }
  let config: GuardConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as GuardConfig;
    if (!config.appOrigins?.length || !config.demoTenants?.length) throw new Error('empty');
  } catch {
    io.err('capture-guard: the config needs appOrigins and demoTenants');
    return 2;
  }
  const problems = await guard(mode, urls, config, fetchFn);
  if (problems.length) {
    io.err(`capture-guard: refused (--mode ${mode})\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    return 1;
  }
  io.out(`capture-guard: ok (--mode ${mode}, ${urls.length} page${urls.length === 1 ? '' : 's'})`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l) });
}
