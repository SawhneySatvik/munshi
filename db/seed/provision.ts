// The showcase tenants' creation transaction, as the operator provisions a shop (03_tenancy.sql: munshi_owner with no
// actor, the path the schema names for "the operator's provisioning and the populate script"). Self-serve sign-up
// (core's createTenant, as munshi_app) cannot take `elite` or `prabhave`: both slugs are reserved
// (platform.reserved_slug), and only the owner role may take a reserved slug for itself. One transaction: the tenant
// (data class showcase), its directory row, its owner, its shops, and its pack's capability switches (ref.pack_capability,
// those with no requirement first). No book row: everything after this is written through core as the tenant's members.
// The tenant, owner and shop ids are derived from the slug and a fixed namespace (BLUEPRINT §3.3), so a rebuild keeps them.
import { createHash } from 'node:crypto';
import type pg from 'pg';

const NAMESPACE = 'munshi-showcase-v1';

/** A UUID (version 8, "custom") from the namespace and the parts: the same parts always give the same id. */
export function seededId(...parts: string[]): string {
  const h = createHash('sha256').update([NAMESPACE, ...parts].join('\u001f')).digest().subarray(0, 16);
  h[6] = ((h[6] as number) & 0x0f) | 0x80;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export type Provisioned = { tenantId: string; ownerId: string; shopIds: string[] };

/** `owner`: a connection that may SET ROLE munshi_owner (the migrator, or the dev cluster's superuser). */
export async function provision(
  owner: pg.ClientBase,
  t: { slug: string; name: string; businessType: 'salon' | 'apparel'; ownerName: string; shops: string[] },
): Promise<Provisioned> {
  const tenantId = seededId(t.slug, 'tenant');
  const ownerId = seededId(t.slug, 'owner');
  const shopIds = t.shops.map((s) => seededId(t.slug, 'shop', s));
  await owner.query('begin');
  try {
    await owner.query('set local role munshi_owner');
    await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    await owner.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, $2, $3, 'showcase')`, [tenantId, t.name, t.businessType]);
    await owner.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [t.slug, tenantId]);
    await owner.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, $3, 'owner')`, [tenantId, ownerId, t.ownerName]);
    for (const [i, name] of t.shops.entries()) await owner.query('insert into ops.shop (tenant_id, id, name) values ($1, $2, $3)', [tenantId, shopIds[i], name]);
    for (const dependent of [false, true]) {
      await owner.query(
        `insert into ops.capability_switch (tenant_id, capability, is_on)
         select $1, p.capability, true from ref.pack_capability p
          where p.business_type = $2 and exists (select 1 from ref.capability_requires r where r.capability = p.capability) = $3
          order by p.capability`,
        [tenantId, t.businessType, dependent],
      );
    }
    await owner.query('commit');
  } catch (err) {
    await owner.query('rollback');
    throw err;
  }
  return { tenantId, ownerId, shopIds };
}
