// Shops for the counter's money suites, built through core's v2 paths: sign-up (a pack chosen by business type, so the
// capability switches fit what each suite sells), members, customers through the vault, prices by price.set, the GST
// registration and series by tax.registration.set, offers, loyalty and package plans by their own commands. One gap:
// item.create takes no tax class or HSN code and makes goods only (item.revise is not built), so an item with tax codes,
// or a service, is written here as the owner's own item.create under the book guard: the same rows, the same audit.
import { randomBytes, randomUUID } from 'node:crypto';
import { addMember, type Cell, createTenant, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { tx } from '../../db.ts';
import { sessionOf } from '../shop.ts';

export type Counter = { owner: Session; manager: Session; staff: Session; shopId: string; tenant: string };
export const SINCE = new Date(Date.now() - 60 * 86_400_000).toISOString(); // prices and names in effect from 60 days ago

export async function counterShop(app: pg.Pool, label: string, businessType: 'kirana' | 'salon' | 'apparel' = 'kirana'): Promise<Counter> {
  const { session: owner, shopId } = await createTenant(app, {
    kind: 'sample',
    name: `${label} (synthetic)`,
    slug: `ctr-${randomBytes(6).toString('hex')}`,
    businessType,
    shopName: 'Main counter',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  const manager = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }));
  const staff = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Counter staff', role: 'staff' }));
  return { owner, manager, staff, shopId, tenant: owner.tenantId };
}

export const run = async (app: pg.Pool, s: Session, name: string, input: unknown, key?: string) =>
  (await runCommand(app, s, name, input, key)) as Record<string, string>;

// A registration for the shop's state (Delhi, 07) since the start of the financial year, and its invoice series.
export const register = (app: pg.Pool, s: Counter, scheme: 'regular' | 'composition', series: string) =>
  run(app, s.owner, 'tax.registration.set', {
    scheme,
    gstin: '07AAAAA1111A1Z1',
    stateCode: '07',
    effectiveFrom: '2025-04-01',
    shops: [{ shopId: s.shopId, invoiceSeries: series }],
  });

export type ItemSpec = { name: string; priceMinor: number; kind?: 'good' | 'service'; category?: string; taxClass?: string; hsn?: string };

// An item with its first revision (its name, category and tax codes; a service a 30-minute duration) and its price,
// both in effect since SINCE.
export async function item(app: pg.Pool, s: Counter, spec: ItemSpec): Promise<string> {
  const id = randomUUID();
  const service = spec.kind === 'service';
  await tx(app, { tenant_id: s.tenant, actor_id: s.owner.memberId, command: 'item.create' }, async (c) => {
    await c.query('insert into books.item (tenant_id, id, kind, unit) values ($1, $2, $3, $4)', [s.tenant, id, service ? 'service' : 'good', service ? 'session' : 'piece']);
    await c.query(
      `insert into books.item_revision (tenant_id, item_id, name, category, tax_class, hsn_sac, duration_min, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [s.tenant, id, spec.name, spec.category ?? null, spec.taxClass ?? null, spec.hsn ?? null, service ? 30 : null, SINCE],
    );
  });
  await run(app, s.owner, 'price.set', { itemId: id, amountMinor: spec.priceMinor, effectiveFrom: SINCE });
  return id;
}

export const customer = async (app: pg.Pool, s: Counter, name: string) => (await run(app, s.owner, 'customer.create', { name })).customerId as string;

// Rows as the shop's own app role reads them (RLS on), numbers as numbers.
export async function rows(app: pg.Pool, s: Counter, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tx(app, { tenant_id: s.tenant }, (c) => c.query(sql, params))).rows;
}
export const num = (c: Cell | undefined) => (c && 'num' in c ? Number(c.num) : null);

// The journal entries that do not balance per currency (none, always).
export const unbalanced = (app: pg.Pool, s: Counter) =>
  rows(app, s, 'select entry_id from books.journal_line group by entry_id, currency having sum(amount_minor) <> 0');
