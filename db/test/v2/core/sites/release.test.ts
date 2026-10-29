// Publishing a release through core (site-release.ts): off live the owner role publishes, and the release pins a fresh
// `release` snapshot of every registered site.* read, minted by mintIn in the publishing transaction from the books;
// the public reads its cells; a release snapshot of any other read is refused before it is minted.
// Red-proofs: test/v2/sabotage/core-wire.ts.
import { CoreError, publishRelease, SITE_READS, withTx } from '@munshi/core';
import { mintIn } from '../../../../../packages/core/src/snapshots.ts';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Release');
  await db.sabotage();
});
afterAll(() => db?.close());

// The owner role's transaction, with the tenant and no actor, as the demo's reset and seed publish.
async function asOwnerRole<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.admin.connect();
  try {
    await c.query('begin');
    await c.query('set local role munshi_owner');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [s.owner.tenantId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

it('a release pins a fresh release snapshot of each site.* read, from the books, and the public reads its cells', async () => {
  const { siteId, lookId } = await withTx(app, { kind: 'member', session: s.owner }, async (c) => {
    const site = (await c.query<{ id: string }>(`insert into ops.site (tenant_id, privacy_version, consent_version) values ($1, 'v1', 'v1') returning id::text as id`, [s.owner.tenantId]))
      .rows[0]?.id as string;
    const look = (
      await c.query<{ id: string }>(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{"--ground": "#ffffff"}', 'inter') returning id::text as id`, [
        s.owner.tenantId,
        site,
      ])
    ).rows[0]?.id as string;
    return { siteId: site, lookId: look };
  });
  const { releaseId, snapshots } = await asOwnerRole((c) => publishRelease(c, { siteId, lookId }));
  expect(Object.keys(snapshots)).toEqual(SITE_READS());
  expect(SITE_READS()).toContain('site.catalogue');
  const { rows } = await db.admin.query(
    `select s.purpose, s.query_name, exists (select 1 from snap.pin p where p.snapshot_id = s.id and p.holder = 'release' and p.holder_id = $2) as pinned
       from snap.snapshot s where s.id = $1`,
    [snapshots['site.catalogue'], releaseId],
  );
  expect(rows).toEqual([{ purpose: 'release', query_name: 'site.catalogue', pinned: true }]);
  // The public reads the published prices: the books' prices in effect, one row per priced good.
  const pub = await withTx(db.as('munshi_public'), { kind: 'system', tenantId: s.owner.tenantId }, (c) =>
    c.query<{ rows: unknown[][] }>('select rows from snap.snapshot where id = $1', [snapshots['site.catalogue']]),
  );
  const prices = (pub.rows[0]?.rows ?? []).map((r) => (r[5] as { n: string }).n).sort();
  expect(prices).toEqual(['1000', '6200']);
});

it('a release snapshot is minted only of a site.* read', async () => {
  const err = await asOwnerRole((c) => mintIn(c, 'stock.on_hand', { item_id: s.biscuits }, undefined, true)).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CoreError);
  expect(err).toMatchObject({ code: 'invalid', fields: ['name'] });
});
