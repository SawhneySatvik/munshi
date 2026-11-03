// A small boutique for the holds tests, built through core's paths: an apparel sign-up, a manager and a counter
// hand, one silk saree (a single piece on hand) and three cotton kurtas, bought from a simulated supplier; and its site,
// set by the owner with 24 reservation hours, so a hold's held_until is seen to come from the site and not a default.
import { randomBytes, randomUUID } from 'node:crypto';
import { addMember, createTenant, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { tx } from '../../db.ts';
import { sessionOf } from '../shop.ts';
import { askToHold } from '../../../../../packages/core/src/reservations.ts';

export type Boutique = { owner: Session; manager: Session; staff: Session; tenantId: string; shopId: string; siteId: string; saree: string; kurta: string };

export const RESERVATION_HOURS = 24;

export async function boutique(app: pg.Pool, label: string): Promise<Boutique> {
  const { session: owner, shopId } = await createTenant(app, {
    kind: 'sample',
    name: `${label} Boutique (synthetic)`,
    slug: `boutique-${randomBytes(6).toString('hex')}`,
    businessType: 'apparel',
    shopName: 'Main floor',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  const tenantId = owner.tenantId;
  const manager = await sessionOf(app, tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }));
  const staff = await sessionOf(app, tenantId, await addMember(app, owner, { name: 'Floor staff', role: 'staff' }));
  const run = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  const supplier = (await run(owner, 'supplier.create', { name: 'Weavers Co-op (simulated)' })).supplierId as string;
  const saree = (await run(owner, 'item.create', { name: 'Silk saree, peacock blue', unit: 'piece' })).itemId as string;
  const kurta = (await run(owner, 'item.create', { name: 'Cotton kurta', unit: 'piece' })).itemId as string;
  const from = new Date(Date.now() - 86_400_000).toISOString();
  await run(owner, 'price.set', { itemId: saree, amountMinor: 1_850_000, effectiveFrom: from });
  await run(owner, 'price.set', { itemId: kurta, amountMinor: 120_000, effectiveFrom: from });
  await run(manager, 'purchase.record', {
    supplierId: supplier,
    billNo: 'WC-1',
    billDate: from.slice(0, 10),
    receivedAt: from,
    lines: [
      { itemId: saree, qtyMilli: 1000, unitCostMinor: 1_400_000 },
      { itemId: kurta, qtyMilli: 3000, unitCostMinor: 80_000 },
    ],
  });
  const siteId = await tx(app, { tenant_id: tenantId, actor_id: owner.memberId }, async (c) =>
    (
      await c.query<{ id: string }>(
        `insert into ops.site (tenant_id, privacy_version, consent_version, reservation_hours) values ($1, 'v1', 'v1', $2) returning id`,
        [tenantId, RESERVATION_HOURS],
      )
    ).rows[0]?.id as string,
  );
  return { owner, manager, staff, tenantId, shopId, siteId, saree, kurta };
}

// A public ask for a piece, as the site sends it on a demo (only the sample phone is stored there).
export const ask = (pub: pg.Pool, b: Boutique, itemId: string, qtyMilli = 1000, ipHash = randomBytes(32).toString('hex')) =>
  askToHold(pub, b.tenantId, {
    siteId: b.siteId,
    itemId,
    qtyMilli,
    name: 'Asha',
    phone: '+910000000000',
    note: 'Keep it for Saturday',
    noticeVersion: 'v1',
    consentVersion: 'v1',
    ipHash,
  });
