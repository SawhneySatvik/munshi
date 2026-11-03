// The showcase tenants' creation transaction, as the operator provisions a shop (03_tenancy.sql: munshi_owner with no
// actor, the path the schema names for "the operator's provisioning and the populate script"). Self-serve sign-up
// (core's createTenant, as munshi_app) cannot take `elite` or `prabhave`: both slugs are reserved
// (platform.reserved_slug), and only the owner role may take a reserved slug for itself. One transaction: the tenant
// (data class showcase), its directory row, its owner, its shops, and its pack's capability switches (ref.pack_capability,
// those with no requirement first). No book row: everything after this is written through core as the tenant's members.
// The tenant, owner and shop ids are derived from the slug and a fixed namespace (BLUEPRINT §3.3), so a rebuild keeps them.
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_TIME_ZONE, openSession, type Session } from '@munshi/core';
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

/**
 * The demo's sample shops (the kirana, Bansal) on a hosted database (D-080): there the app may make only a real shop or
 * a sandbox (tenant_class, MS010), so a listed sample shop is the operator's, provisioned as showcase is, as the owner
 * role with no actor, in one transaction: the synthetic tenant, its directory row, its owner, its shop and its pack's
 * switches. It has no login: its people sign in through the demo picker. Everything after is written through core as
 * its members, as on a laptop.
 */
export async function provisionSample(
  owner: pg.ClientBase,
  t: { slug: string; name: string; businessType: 'kirana' | 'salon' | 'apparel'; shopName: string; ownerName: string; timeZone?: string },
): Promise<{ tenantId: string; ownerId: string; shopId: string }> {
  const [tenantId, ownerId, shopId] = [randomUUID(), randomUUID(), randomUUID()];
  await owner.query('begin');
  try {
    await owner.query('set local role munshi_owner');
    await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    await owner.query(`insert into ops.tenant (tenant_id, name, business_type, data_class, time_zone) values ($1, $2, $3, 'synthetic', $4)`, [
      tenantId,
      t.name,
      t.businessType,
      t.timeZone ?? DEFAULT_TIME_ZONE,
    ]);
    await owner.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [t.slug, tenantId]);
    await owner.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, $3, 'owner')`, [tenantId, ownerId, t.ownerName]);
    await owner.query('insert into ops.shop (tenant_id, id, name) values ($1, $2, $3)', [tenantId, shopId, t.shopName]);
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
  return { tenantId, ownerId, shopId };
}

/** The provisioned owner's session, as core's createTenant returns it. */
export async function provisioned(app: pg.Pool, p: { tenantId: string; ownerId: string; shopId: string }): Promise<{ session: Session; shopId: string }> {
  const session = await openSession(app, p.tenantId, p.ownerId);
  if (!session) throw new Error('seed: the provisioned owner has no session');
  return { session, shopId: p.shopId };
}
