// Shared by the orders tests (test/v2/core/orders/): an apparel shop built through core's paths (sign-up, members,
// direct commands) with a customer in the vault, two priced goods and one with no price (a stitching job, quoted), and
// its site published with a site.catalogue release snapshot of the priced goods (the owner role publishes off live, as
// the reset does); then the inbox message a webhook stores, and the pools' roles.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { addMember, CATALOGUE, createTenant, execute, runCommand, type Session, withTx } from '@munshi/core';
import type pg from 'pg';
import { type TestDb, tx } from '../../db.ts';
import { sessionOf } from '../shop.ts';

export type OrderShop = {
  owner: Session;
  manager: Session;
  staff: Session;
  tenantId: string;
  shopId: string;
  customer: string;
  contact: string;
  tea: string; // ₹249.99 a pack (₹200 the day before)
  saree: string; // ₹2,499 a piece
  blouse: string; // stitching, no price: quoted
};

export const TEA = 24_999;
export const SAREE = 249_900;
export const ORDER_CODE = /^ORD-[A-Z0-9]{4,6}$/;

// `accept` makes it a real shop, accepted before the rest is written (as smallShop's): an Instagram channel is a real shop's.
export async function orderShop(app: pg.Pool, label: string, opts: { accept?: (tenantId: string) => Promise<unknown> } = {}): Promise<OrderShop> {
  const { session: owner, shopId } = await createTenant(app, {
    kind: opts.accept ? 'real' : 'sample',
    name: `${label} Boutique (synthetic)`,
    slug: `shop-${randomBytes(6).toString('hex')}`,
    businessType: 'apparel',
    shopName: 'Main counter',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  await opts.accept?.(owner.tenantId);
  const manager = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }));
  const staff = await sessionOf(app, owner.tenantId, await addMember(app, owner, { name: 'Counter staff', role: 'staff' }));
  const run = async (name: string, input: unknown) => (await runCommand(app, owner, name, input)) as Record<string, string>;
  const person = await run('customer.create', { name: 'Asha (synthetic)', phone: `+9198${String(randomInt(10_000_000, 99_999_999))}` });
  const tea = (await run('item.create', { name: 'Assam tea 250 g', unit: 'pack' })).itemId as string;
  const saree = (await run('item.create', { name: 'Cotton saree', unit: 'piece' })).itemId as string;
  const blouse = (await run('item.create', { name: 'Blouse stitching', unit: 'piece' })).itemId as string;
  const day = 86_400_000;
  await run('price.set', { itemId: tea, amountMinor: 20_000, effectiveFrom: new Date(Date.now() - 2 * day).toISOString() });
  await run('price.set', { itemId: tea, amountMinor: TEA, effectiveFrom: new Date(Date.now() - day).toISOString() });
  await run('price.set', { itemId: saree, amountMinor: SAREE, effectiveFrom: new Date(Date.now() - day).toISOString() });
  return { owner, manager, staff, tenantId: owner.tenantId, shopId, customer: person.customerId as string, contact: person.contactId as string, tea, saree, blouse };
}

// The site, its look, and a release whose site.catalogue snapshot lists `items` at their published prices.
export async function publish(db: TestDb, s: OrderShop, items: [string, string, number][]): Promise<{ releaseId: string; snapshotId: string }> {
  const app = db.as('munshi_app');
  const { site, look } = await tx(app, { tenant_id: s.tenantId, actor_id: s.owner.memberId }, async (c) => {
    const existing = (await c.query<{ id: string }>('select id from ops.site')).rows[0]?.id;
    const site =
      existing ??
      (await c.query<{ id: string }>(`insert into ops.site (tenant_id, privacy_version, consent_version) values ($1, 'v1', 'v1') returning id`, [s.tenantId])).rows[0]?.id;
    const look = (await c.query<{ id: string }>(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{"--ground": "#ffffff"}', 'inter') returning id`, [s.tenantId, site]))
      .rows[0]?.id;
    return { site: site as string, look: look as string };
  });
  const owner = await db.admin.connect();
  try {
    await owner.query('begin');
    await owner.query('set local role munshi_owner');
    await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [s.tenantId]);
    const columns = [
      { n: CATALOGUE.item, k: 'text' },
      { n: 'item', k: 'text' },
      { n: CATALOGUE.price, k: 'money' },
    ];
    const rows = items.map(([id, name, minor]) => [{ k: 'text', t: id }, { k: 'text', t: name }, { k: 'money', n: String(minor), c: 'INR' }]);
    const snapshotId = (
      await owner.query<{ id: string }>(
        `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
         values ($1, $2, '{}', 'release', $3, $4, '\\x00', '\\x00', 0) returning id`,
        [s.tenantId, CATALOGUE.query, JSON.stringify(columns), JSON.stringify(rows)],
      )
    ).rows[0]?.id as string;
    const releaseId = randomUUID();
    await owner.query(`insert into ops.site_release (tenant_id, id, site_id, look_id, snapshots, created_txid) values ($1, $2, $3, $4, $5, 0)`, [
      s.tenantId,
      releaseId,
      site,
      look,
      JSON.stringify({ [CATALOGUE.query]: snapshotId }),
    ]);
    await owner.query('commit');
    return { releaseId, snapshotId };
  } finally {
    owner.release();
  }
}

// What the webhook stores (the public role, no actor): the id is the caller's, as the role cannot read the row back.
export async function inbound(db: TestDb, tenantId: string, kind: 'text' | 'audio' | 'image', text: string | null = null): Promise<string> {
  const id = randomUUID();
  await tx(db.as('munshi_public'), { tenant_id: tenantId }, (c) =>
    c.query(`insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, $3, '+919800000001', $4, $5, now())`, [
      tenantId,
      id,
      `wamid.${randomUUID()}`,
      kind,
      text,
    ]),
  );
  return id;
}

// A public route's transaction: the tenant, no actor.
export const asPublic = <T>(db: TestDb, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>) => withTx(db.as('munshi_public'), { kind: 'system', tenantId }, fn);

// A writer another command calls inside its own transaction (recordOrderPayment inside payment.record, …), run as that
// command's body: the guard admits the rows under `command`, as the member.
export const within = (app: pg.Pool, session: Session, command: string, run: never, input: unknown) =>
  withTx(app, { kind: 'member', session, command }, (c) => execute(c, { input: undefined as never, run }, input));

// A plain order a manager takes (orders are the office’s): one line of tea, confirmed now.
export async function teaOrder(app: pg.Pool, s: OrderShop, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await runCommand(app, s.manager, 'order.confirm', { shopId: s.shopId, customerId: s.customer, lines: [{ itemId: s.tea, qtyMilli: 1000 }], ...extra });
  return r.orderId as string;
}

// runCommand refuses a bad input before its promise exists (a throw, not a rejection): this catches either.
export const failure = (f: () => Promise<unknown>) => Promise.resolve().then(f).catch((e: unknown) => e);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until `n` munshi_app backends of this database are blocked on a lock.
export async function appWaiting(db: TestDb, n: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await db.admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where datname = $1 and usename = 'munshi_app' and wait_event_type = 'Lock'`,
      [db.name],
    );
    if ((rows[0]?.n ?? 0) >= n) return;
    await sleep(25);
  }
  throw new Error(`fewer than ${n} munshi_app backends ever waited on a lock`);
}
