// A small shop built through packages/core's v2 paths (sign-up, members, direct commands): for the core tests that do
// not need the full kirana seed. Sign-up writes the tenant, its directory row, the owner and the first-owner login in one
// transaction; the supplier and the customer are named in the contact vault; each item is created with its first
// revision. The slug is random hex, which the directory's look-alike folding cannot make collide.
import { randomBytes, randomUUID } from 'node:crypto';
import { addMember, createTenant, openSession, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';

export type Shop = {
  owner: Session;
  manager: Session;
  staff: Session;
  shopId: string;
  supplier: string;
  customer: string;
  biscuits: string;
  butter: string;
};

// A member's session, through core's constructor (a Session cannot be hand-built).
export const sessionOf = async (app: pg.Pool, tenantId: string, memberId: string) => (await openSession(app, tenantId, memberId)) as Session;

// On a live deployment sign-up makes a real shop, pending until the operator accepts it (D-080): pass `accept` (the
// gates' acceptTenant over the test database's admin pool) to accept it before the rest of the shop is written.
export async function smallShop(app: pg.Pool, label: string, opts: { accept?: (tenantId: string) => Promise<unknown> } = {}): Promise<Shop> {
  const { session: owner, shopId } = await createTenant(app, {
    name: `${label} General Store (synthetic)`,
    slug: `shop-${randomBytes(6).toString('hex')}`,
    shopName: 'Main counter',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  await opts.accept?.(owner.tenantId);
  const manager = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }));
  const staff = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Counter staff', role: 'staff' }));
  const run = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  const supplier = (await run(owner, 'supplier.create', { name: 'Gupta Traders (simulated)' })).supplierId as string;
  const customer = (await run(owner, 'customer.create', { name: 'Credit customer' })).customerId as string;
  const biscuits = (await run(owner, 'item.create', { name: 'Glucose biscuits 70 g', unit: 'pack' })).itemId as string;
  const butter = (await run(owner, 'item.create', { name: 'Butter 100 g', unit: 'pack' })).itemId as string;
  const from = new Date(Date.now() - 86_400_000).toISOString();
  await run(owner, 'price.set', { itemId: biscuits, amountMinor: 1000, effectiveFrom: from });
  await run(owner, 'price.set', { itemId: butter, amountMinor: 6200, effectiveFrom: from });
  await run(manager, 'purchase.record', {
    supplierId: supplier,
    billNo: 'GT-1',
    billDate: from.slice(0, 10),
    receivedAt: from,
    lines: [
      { itemId: biscuits, qtyMilli: 48_000, unitCostMinor: 850, expiresOn: '2027-06-30' },
      { itemId: butter, qtyMilli: 12_000, unitCostMinor: 5600, expiresOn: '2027-03-31' },
    ],
  });
  return { owner, manager, staff, shopId, supplier, customer, biscuits, butter };
}
