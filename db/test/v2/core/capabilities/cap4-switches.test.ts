// CAP4 through core, sign-up's pack, and can(). A switch is the owner's own audited ops row: switchCapability surfaces
// capability_guard's refusals (MS019 for a requirement off or a dependant on, MS007 for anyone but an active owner), and
// no switch writes a book row. Sign-up writes the chosen pack's switches in the tenant's creation transaction. can() reads
// the latest switch and, for a capability that needs the platform's grant, the approved grant, inside the page's one
// transaction. The packs are BLUEPRINT §2.5's, written out here, never read back from ref.pack_capability.
import { randomBytes, randomUUID } from 'node:crypto';
import { addMember, can, CoreError, createTenant, openSession, runCommand, type Session, switchCapability, withPage } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { firstOperator, type Operator, proposeAndApprove } from '../platform/fixture.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let op: Operator;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  op = await firstOperator(db);
  await db.sabotage();
});
afterAll(() => db.close());

const PACKS = {
  kirana: ['ai', 'buying', 'counter', 'credit', 'gst', 'messaging', 'offers', 'orders', 'site', 'staff', 'stock'],
  salon: ['ai', 'bookings', 'campaigns', 'counter', 'credit', 'gst', 'loyalty', 'messaging', 'offers', 'packages', 'salary', 'site', 'staff'],
  apparel: ['ai', 'buying', 'campaigns', 'cart', 'counter', 'credit', 'gst', 'holds', 'messaging', 'offers', 'orders', 'site', 'staff', 'stitching', 'stock', 'variants'],
} as const;

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => {
      if (!(e instanceof CoreError)) throw e;
      return e;
    },
  );
const q = async (tenant: string, sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: tenant }, (c) => c.query(sql, params))).rows;
const switchAudit = (tenant: string) =>
  q(tenant, `select actor_id::text, payload from audit.audit_log where action = 'capability.switch' order by seq`) as Promise<
    { actor_id: string; payload: { capability: string; is_on: boolean } }[]
  >;
const books = async (tenant: string) =>
  Number((await q(tenant, `select count(*)::int as n from audit.audit_log where entity like 'books.%'`))[0].n);

it('CAP4 through core: a switch-on with a requirement off and a switch-off while a dependant is on are refused (MS019); each switch is audited and writes no book row', async () => {
  const s: Shop = await smallShop(app, 'CAP4-rules');
  const bookRows = await books(s.owner.tenantId);
  const before = (await switchAudit(s.owner.tenantId)).length;
  // credit, gst and offers require counter, and are on in the kirana pack
  expect(await failure(switchCapability(app, s.owner, 'counter', false))).toMatchObject({ code: 'invalid', sqlstate: 'MS019' });
  await switchCapability(app, s.owner, 'orders', false); // nothing on requires orders
  expect(await failure(switchCapability(app, s.owner, 'stitching', true))).toMatchObject({ code: 'invalid', sqlstate: 'MS019' });
  await switchCapability(app, s.owner, 'orders', true);
  expect(await switchCapability(app, s.owner, 'stitching', true)).toEqual(expect.any(String));
  expect(await failure(switchCapability(app, s.owner, 'orders', false))).toMatchObject({ code: 'invalid', sqlstate: 'MS019' }); // stitching requires it
  expect((await switchAudit(s.owner.tenantId)).slice(before)).toEqual([
    { actor_id: s.owner.memberId, payload: { capability: 'orders', is_on: false } },
    { actor_id: s.owner.memberId, payload: { capability: 'orders', is_on: true } },
    { actor_id: s.owner.memberId, payload: { capability: 'stitching', is_on: true } },
  ]);
  expect(await books(s.owner.tenantId)).toBe(bookRows);
});

it('CAP4 only an active owner switches; an unknown code never reaches the database', async () => {
  const s: Shop = await smallShop(app, 'CAP4-who');
  const before = (await switchAudit(s.owner.tenantId)).length;
  for (const member of [s.manager, s.staff]) {
    expect(await failure(switchCapability(app, member, 'orders', false))).toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  }
  // A second owner, then deactivated: no longer active, so refused too.
  const second = (await openSession(app, s.owner.tenantId, await addMember(app, s.owner, { name: 'Second owner', role: 'owner' }))) as Session;
  await switchCapability(app, second, 'orders', false);
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [second.memberId]),
  );
  expect(await failure(switchCapability(app, second, 'orders', true))).toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  const unknown = await failure(switchCapability(app, s.owner, 'teleport' as never, true));
  expect(unknown).toMatchObject({ code: 'invalid', fields: ['capability'] });
  expect(unknown.sqlstate).toBeUndefined();
  const after = await switchAudit(s.owner.tenantId);
  expect(after.slice(before)).toEqual([{ actor_id: second.memberId, payload: { capability: 'orders', is_on: false } }]);
});

it("CAP4 sign-up writes the chosen pack: kirana 11, salon 13, boutique (apparel) 16 switches, in the creation transaction, each the owner's own and audited", async () => {
  for (const [type, pack] of Object.entries(PACKS) as [keyof typeof PACKS, readonly string[]][]) {
    const { session } = await createTenant(app, {
      name: `CAP4 ${type} (synthetic)`,
      slug: `cap-${randomBytes(6).toString('hex')}`,
      businessType: type,
      shopName: 'Main',
      ownerName: 'Owner',
      identity: { provider: 'password', subject: randomUUID() },
    });
    const switches = await q(
      session.tenantId,
      `select s.capability, s.is_on, s."by"::text as by, s.created_txid = t.created_txid as at_creation
         from ops.capability_switch s join ops.tenant t on t.tenant_id = s.tenant_id order by s.capability`,
    );
    expect(switches.map((r) => r.capability), type).toEqual([...pack]);
    expect(switches.length, type).toBe({ kirana: 11, salon: 13, apparel: 16 }[type]);
    expect(switches.every((r) => r.is_on && r.at_creation && r.by === session.memberId), type).toBe(true);
    const audit = await switchAudit(session.tenantId);
    expect(audit.map((a) => a.payload.capability).sort(), type).toEqual([...pack]);
    expect(audit.every((a) => a.actor_id === session.memberId && a.payload.is_on), type).toBe(true);
    // The pack decides what the shop's commands can start: the salon buys nothing, the others can.
    const supplier = runCommand(app, session, 'supplier.create', { name: 'Gupta Traders (simulated)' });
    if (type === 'salon') expect(await failure(supplier)).toMatchObject({ code: 'capability_off', fields: ['buying'] });
    else expect(await supplier).toMatchObject({ supplierId: expect.any(String) });
  }
});

it("can() reads the latest switch inside the page's one transaction, and a capability that needs the platform's grant only once it is granted", async () => {
  const s: Shop = await smallShop(app, 'CAP-can');
  const caps = (session: Session = s.owner) =>
    withPage(app, session, async (c) => {
      const out: Record<string, boolean> = {};
      for (const cap of ['stock', 'bookings', 'ai', 'site', 'messaging'] as const) out[cap] = await can(c, session, cap);
      return out;
    });
  // ai, site and messaging are on in the kirana pack, but the platform has granted none of them
  expect(await caps()).toEqual({ stock: true, bookings: false, ai: false, site: false, messaging: false });
  expect(await caps(s.staff)).toEqual({ stock: true, bookings: false, ai: false, site: false, messaging: false });
  await switchCapability(app, s.owner, 'stock', false);
  expect((await caps()).stock).toBe(false);
  await switchCapability(app, s.owner, 'stock', true);
  expect((await caps()).stock).toBe(true);

  await proposeAndApprove(db, op, { kind: 'shop_config', tenantId: s.owner.tenantId, set: { ai_enabled: true } });
  await proposeAndApprove(db, op, { kind: 'site_verify', tenantId: s.owner.tenantId, set: { site_verified: true } });
  // A sample shop is never granted a channel through the console (D-080, GRANT1): the grant is planted, a past.
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 2, $2)`, [
    s.owner.tenantId,
    randomUUID(),
  ]);
  expect(await caps()).toEqual({ stock: true, bookings: false, ai: true, site: true, messaging: true });
  // Granted but switched off by the owner: off.
  await switchCapability(app, s.owner, 'ai', false);
  expect((await caps()).ai).toBe(false);

  // Under another shop's page, the switches would read as off for the wrong reason: refused.
  const other = await smallShop(app, 'CAP-can-other');
  const crossed = await failure(withPage(app, other.owner, (c) => can(c, s.owner, 'stock')));
  expect(crossed).toMatchObject({ code: 'refused' });
});
