// Publishing a site (ops.site_release): one release is one look and a fresh `release` snapshot of every registered
// site.* read, minted in the publishing transaction from the books as they stand, and pinned by the release
// (release_pin). The caller's transaction decides who publishes, and release_check holds it: on live an active owner
// from a real session (munshi_app), off live only the owner role with no actor (the demo's reset and seed).
import type pg from 'pg';
import { dropSite } from './cache-keys.ts';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import { mintIn } from './snapshots.ts';

export const SITE_READS = () => [...QUERIES.keys()].filter((name) => name.startsWith('site.')).sort();

export async function publishRelease(c: pg.PoolClient, input: { siteId: string; lookId: string }): Promise<{ releaseId: string; snapshots: Record<string, string> }> {
  const snapshots: Record<string, string> = {};
  for (const name of SITE_READS()) snapshots[name] = (await mintIn(c, name, {}, undefined, true)).id;
  const { rows } = await c.query<{ id: string }>(
    `insert into ops.site_release (tenant_id, site_id, look_id, snapshots, created_txid)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, 0) returning id::text as id`,
    [input.siteId, input.lookId, JSON.stringify(snapshots)],
  );
  const releaseId = rows[0]?.id;
  if (!releaseId) throw new CoreError('internal');
  // The site's cached latest release goes now, so the API serves this one (cache-keys.ts). A reader between this drop
  // and the commit may store the old release id again, for at most the entry's 10 seconds.
  const { rows: tenant } = await c.query<{ id: string }>(`select current_setting('munshi.tenant_id', true) as id`);
  if (tenant[0]?.id) await dropSite(tenant[0].id);
  return { releaseId, snapshots };
}
