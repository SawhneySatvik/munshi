// The two shop sites' public origins and publishable keys on the hosted demo. The hosted seeds (db/seed/hosted.ts and
// hosted-copy.ts) take the same two arguments and run the same step; this script runs it later, on a seeded hosted
// demo, once the sites' Vercel projects have their production domains. Each site lists its origin (https only) and
// gets a fresh publishable key, both through its owner's own settings path as `pnpm dev` does (widgetDemoSite). The
// keys go to .run/hosted-site-keys.json (mode 0600) and are never printed: only the file's path is.
//
//   node --env-file=.env.production db/src/site-origins.ts --confirm=<project ref> \
//     --elite-origin=https://<elite host> --prabhave-origin=https://<prabhave host>
//
// Refuses unless --confirm names the project in DATABASE_URL, the database says it is a hosted demo, and both sites'
// tenants are the showcase tenants. A second run adds nothing to an origin already listed and issues new keys; the
// earlier keys keep working.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDatabaseTls, databaseTls, withTx } from '@munshi/core';
import pg from 'pg';
import { widgetDemoSite } from './dev.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SITE_KEYS_FILE = path.join(ROOT, '.run', 'hosted-site-keys.json');
export const SITE_SLUGS = ['elite', 'prabhave'] as const;
export type SiteSlug = (typeof SITE_SLUGS)[number];
export type Origins = Record<SiteSlug, string>;
export type SiteKey = { slug: string; origin: string; key: string };

/** An https origin as the site guard admits it (scheme and host, an optional port, nothing else), or a refusal. */
export function httpsOrigin(value: string, name: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`--${name}-origin is not a URL`);
  }
  const bare = u.username === '' && u.password === '' && (u.pathname === '/' || u.pathname === '') && u.search === '' && u.hash === '';
  if (u.protocol !== 'https:' || !bare || !/^https:\/\/[a-z0-9.-]{1,200}(:[0-9]{1,5})?$/.test(u.origin)) {
    throw new Error(`--${name}-origin must be https://<host>[:port], with no path`);
  }
  return u.origin;
}

/**
 * The hosted seeds' and this script's arguments: --confirm=<ref>, and the two sites' origins, both or neither
 * (`required`: both). Anything else is refused, before any database is touched.
 */
export function siteArgs(args: string[], who: string, required = false): { confirm: string; origins: Origins | undefined } {
  const named = new Map<string, string>();
  for (const arg of args) {
    const m = /^--(confirm|elite-origin|prabhave-origin)=(.*)$/.exec(arg);
    if (!m || named.has(m[1] as string)) throw new Error(`${who} takes --confirm=<project ref> --elite-origin=https://… --prabhave-origin=https://…`);
    named.set(m[1] as string, m[2] as string);
  }
  const confirm = named.get('confirm') ?? '';
  if (!confirm) throw new Error(`${who}: --confirm=<project ref> is required`);
  const given = SITE_SLUGS.filter((s) => named.has(`${s}-origin`));
  if (given.length === 0 && !required) return { confirm, origins: undefined };
  if (given.length !== SITE_SLUGS.length) throw new Error(`${who}: give both --elite-origin and --prabhave-origin`);
  const origins = Object.fromEntries(SITE_SLUGS.map((s) => [s, httpsOrigin(named.get(`${s}-origin`) as string, s)])) as Origins;
  return { confirm, origins };
}

/** Each site lists its origin and gets a fresh publishable key, as its owner. Prints nothing; the keys are returned. */
export async function issueSiteKeys(app: pg.Pool, sites: { slug: string; tenantId: string }[], origins: Origins): Promise<SiteKey[]> {
  const keys: SiteKey[] = [];
  for (const slug of SITE_SLUGS) {
    const site = sites.find((s) => s.slug === slug);
    if (!site) throw new Error(`site-origins: no ${slug} site`);
    const made = await widgetDemoSite(app, site.tenantId, origins[slug]);
    if (made.slug !== slug) throw new Error(`site-origins: the ${slug} tenant's site is ${made.slug}`);
    keys.push({ slug, origin: origins[slug], key: made.key });
  }
  return keys;
}

/** The keys to `out` (0600, also when the file was there before), under the names the site projects take. */
export function writeSiteKeys(out: string, keys: SiteKey[], say: (line: string) => void): void {
  mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  const file = Object.fromEntries(keys.map((k) => [`MUNSHI_SITE_KEY_${k.slug.toUpperCase()}`, k.key]));
  const listed = Object.fromEntries(keys.map((k) => [k.slug, k.origin]));
  writeFileSync(out, `${JSON.stringify({ ...file, origins: listed }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  for (const k of keys) say(`${k.slug} lists ${k.origin}`);
  say(`the sites' publishable keys are in ${path.relative(ROOT, out) || out} (0600)`);
}

/** On a seeded database: the two sites found by slug, each refused unless its tenant is a showcase tenant, then keyed. */
export async function addSiteOrigins(app: pg.Pool, origins: Origins): Promise<SiteKey[]> {
  const { rows: dir } = await app.query<{ slug: string; tenant_id: string }>(
    'select slug, tenant_id::text from ops.tenant_directory where slug = any($1::text[])',
    [[...SITE_SLUGS]],
  );
  const sites = dir.map((d) => ({ slug: d.slug, tenantId: d.tenant_id }));
  for (const s of sites) {
    const { rows } = await withTx(app, { kind: 'system', tenantId: s.tenantId }, (c) => c.query<{ data_class: string }>('select data_class from ops.tenant'));
    if (rows[0]?.data_class !== 'showcase') throw new Error(`site-origins: ${s.slug} is not a showcase tenant`);
  }
  return issueSiteKeys(app, sites, origins);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`site-origins: ${name} is not set`);
  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { confirm, origins } = siteArgs(process.argv.slice(2), 'site-origins', true);
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA));
  const ref = decodeURIComponent(new URL(need('DATABASE_URL')).username).split('.')[1];
  if (ref !== confirm) throw new Error('site-origins: --confirm does not name the project in DATABASE_URL');
  const app = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 2 });
  try {
    const { rows: dep } = await app.query<{ kind: string; hosted: boolean }>('select kind, hosted from ops.deployment');
    if (dep[0]?.kind !== 'demo' || dep[0]?.hosted !== true) throw new Error('site-origins: the database is not a hosted demo');
    const keys = await addSiteOrigins(app, origins as Origins);
    writeSiteKeys(SITE_KEYS_FILE, keys, (line) => console.log(`site-origins: ${line}`));
  } finally {
    await app.end();
  }
}
