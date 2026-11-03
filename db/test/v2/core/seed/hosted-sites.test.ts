// HOSTSITES: the hosted seed's shop sites (db/seed/hosted.ts's hostedSites, which hosted-copy.ts runs too). After the
// showcase tenants and the Demo operator's approvals, as reseed makes them, both sites are published and open through
// the public API, Elite's included, which its own seed leaves unpublished. Without origins nothing more is done and the
// seed says the sites stay read-only; the follow-up script (db/src/site-origins.ts) then adds the origins and keys on
// the seeded database. With origins, each site lists its own and gets a fresh publishable key that the
// public API accepts for that site; the keys file is 0600 (also when an earlier file was 0644), holds the names the
// site projects take, and no line the seed says holds a key. The arguments: https only, both or neither, nothing else.
// Never a mocked database. Red-proofs: test/v2/sabotage/hosted-sites.ts.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addDays, businessDate, openSite, originAllowed, siteKeyId } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hostedOperator, hostedSites } from '../../../../seed/hosted.ts';
import { type Showcase, seedShowcase } from '../../../../seed/showcase.ts';
import { seedDevOperator } from '../../../../src/dev.ts';
import { addSiteOrigins, siteArgs, writeSiteKeys } from '../../../../src/site-origins.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { SECRETS } from '../platform/fixture.ts';

const ORIGINS = { elite: 'https://elite-demo.example.test', prabhave: 'https://prabhave-demo.example.test' };

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let owner: pg.Client;
let s: Showcase;
let dir: string;
let sites: { tenantId: string; stylists?: Map<string, string> }[];

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  owner = await db.migrator();
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-hosted-sites-'));
  // reseed's showcase steps: the two tenants unverified, then the hosted seed's operator approving both sites.
  const asOf = addDays(businessDate(new Date(), 'Asia/Kolkata'), 1);
  s = await seedShowcase({ app, pub, platform: db.as('munshi_platform') }, owner, { asOf, verify: false, secrets: SECRETS });
  await seedDevOperator(owner, db.as('munshi_platform'), hostedOperator(SECRETS, path.join(dir, 'hosted-operator.json')), [s.elite.tenantId, s.prabhave.tenantId]);
  // reseed's own list of the sites, as the hosted seeds pass it on.
  sites = [{ tenantId: s.elite.tenantId, stylists: s.elite.staff }, { tenantId: s.prabhave.tenantId }];
  await db.sabotage();
}, 300_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await owner?.end();
  await db?.close();
});

const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const origins = async (tenantId: string) =>
  (await db.admin.query<{ origins: string[] }>('select origins from ops.site where tenant_id = $1', [tenantId])).rows[0]?.origins;

it('without origins the hosted seed publishes both sites, Elite’s included, and says they stay read-only', async () => {
  expect(await openSite(pub, 'elite')).toBeNull(); // Elite's own seed leaves it unpublished
  const said: string[] = [];
  const keys = await hostedSites(app, owner, sites, undefined, (l) => said.push(l));
  expect(keys).toEqual([]);
  for (const slug of ['elite', 'prabhave']) expect((await openSite(pub, slug))?.release.id, slug).toMatch(/^[0-9a-f-]{36}$/);
  expect(said.join('\n')).toContain('the sites stay read-only');
  expect(await origins(s.elite.tenantId)).toEqual([]);
  expect(await origins(s.prabhave.tenantId)).toEqual([]);
});

it('later, the follow-up script on the seeded database lists each site’s origin and issues keys the public API accepts', async () => {
  const out = path.join(dir, 'later-site-keys.json');
  const said: string[] = [];
  writeSiteKeys(out, await addSiteOrigins(app, ORIGINS), (l) => said.push(l));
  expect(mode(out)).toBe('600');
  const file = JSON.parse(readFileSync(out, 'utf8'));
  for (const slug of ['elite', 'prabhave'] as const) {
    const site = await openSite(pub, slug);
    expect(site?.origins, slug).toEqual([ORIGINS[slug]]);
    expect(site && (await siteKeyId(pub, site, file[`MUNSHI_SITE_KEY_${slug.toUpperCase()}`])), slug).toMatch(/^[0-9a-f-]{36}$/);
  }
  expect(said.join('\n')).not.toContain('mpk_');
});

it('with origins each site lists its own and gets a fresh key the public API accepts; the keys file is 0600 and no line says a key', async () => {
  const out = path.join(dir, 'hosted-site-keys.json');
  writeFileSync(out, '{"left": "by an earlier seed"}\n', { mode: 0o644 });
  const said: string[] = [];
  const keys = await hostedSites(app, owner, sites, ORIGINS, (l) => said.push(l));
  writeSiteKeys(out, keys, (l) => said.push(l));

  expect(mode(out)).toBe('600');
  const file = JSON.parse(readFileSync(out, 'utf8'));
  expect(Object.keys(file).sort()).toEqual(['MUNSHI_SITE_KEY_ELITE', 'MUNSHI_SITE_KEY_PRABHAVE', 'origins']);
  expect(file.origins).toEqual(ORIGINS);
  for (const slug of ['elite', 'prabhave'] as const) {
    const key = file[`MUNSHI_SITE_KEY_${slug.toUpperCase()}`] as string;
    expect(key).toMatch(new RegExp(`^mpk_${slug}_`));
    const site = await openSite(pub, slug);
    expect(site, slug).not.toBeNull();
    if (!site) continue;
    expect(site.origins).toEqual([ORIGINS[slug]]);
    expect(originAllowed(site, ORIGINS[slug], true)).toBe(true);
    expect(await siteKeyId(pub, site, key), slug).toMatch(/^[0-9a-f-]{36}$/);
  }
  // Each key opens only its own site.
  const elite = await openSite(pub, 'elite');
  expect(elite && (await siteKeyId(pub, elite, file.MUNSHI_SITE_KEY_PRABHAVE))).toBeNull();

  const text = said.join('\n');
  expect(text).not.toContain('mpk_');
  for (const k of keys) expect(text).not.toContain(k.key);
  expect(text).toContain(`${out} (0600)`);
  expect(text).toContain(`elite lists ${ORIGINS.elite}`);
});

it('the seed’s arguments: --confirm, then both https origins or neither; anything else is refused', () => {
  expect(siteArgs(['--confirm=abc'], 'seed')).toEqual({ confirm: 'abc', origins: undefined });
  expect(siteArgs(['--confirm=abc', '--elite-origin=https://Elite.Example.test/', '--prabhave-origin=https://p.example.test:8443'], 'seed')).toEqual({
    confirm: 'abc',
    origins: { elite: 'https://elite.example.test', prabhave: 'https://p.example.test:8443' },
  });
  const refused = (args: string[], required = false) => () => siteArgs(args, 'seed', required);
  expect(refused(['--confirm=abc'], true)).toThrow('give both');
  expect(refused(['--confirm=abc', '--elite-origin=https://e.example.test'])).toThrow('give both');
  expect(refused(['--confirm=abc', '--elite-origin=http://e.example.test', '--prabhave-origin=https://p.example.test'])).toThrow('must be https');
  expect(refused(['--confirm=abc', '--elite-origin=https://e.example.test/en', '--prabhave-origin=https://p.example.test'])).toThrow('no path');
  expect(refused(['--confirm=abc', '--elite-origin=e.example.test', '--prabhave-origin=https://p.example.test'])).toThrow('not a URL');
  expect(refused(['--confirm=abc', '--sites=all'])).toThrow('takes --confirm');
  expect(refused(['--elite-origin=https://e.example.test', '--prabhave-origin=https://p.example.test'])).toThrow('--confirm');
});
