// W-HLD: hold_expiring (the `holds` capability) over a planted boutique: a saree held for a customer whose hold ends in
// 12 hours (the site's reservation hours then) is flagged at its price, ₹4,500; a kurta held for 48 hours and a piece
// only requested are not. The public asks on the site and the manager holds, as ops.reservation's rules admit. With
// holds off, a run reads no hold. Red-proofs: test/v2/sabotage/core-ai.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { addMember, businessDate, createTenant, openSession, runCommand, runWatchers, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { asMember, findings, one, runQueries, setCapability, TENANT } from './plant.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let owner: Session;
let today: string;
const pieces = new Map<string, string>(); // name → reservation id

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  owner = (
    await createTenant(app, {
      kind: 'sample',
      name: 'Silk Lane Boutique (synthetic)',
      slug: `boutique-${randomBytes(6).toString('hex')}`,
      businessType: 'apparel',
      shopName: 'Main shop',
      ownerName: 'Owner',
      identity: { provider: 'password', subject: randomUUID() },
    })
  ).session;
  const manager = (await openSession(app, owner.tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }))) as Session;
  today = businessDate(new Date(), 'Asia/Kolkata');
  const site = await asMember(app, owner, (c) =>
    one<{ id: string }>(c, `insert into ops.site (tenant_id, privacy_version, consent_version, reservation_hours) values (${TENANT}, 'p1', 'c1', 12) returning id`),
  );
  for (const [name, price] of [
    ['Silk saree', 450_000],
    ['Cotton kurta', 120_000],
    ['Linen dupatta', 80_000],
  ] as const) {
    const itemId = ((await runCommand(app, owner, 'item.create', { name, unit: 'piece' })) as { itemId: string }).itemId;
    await runCommand(app, owner, 'price.set', { itemId, amountMinor: price, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() });
    const r = await tx(db.as('munshi_public'), { tenant_id: owner.tenantId }, (c) =>
      c.query<{ id: string }>(
        `insert into ops.reservation (tenant_id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, notice_version, consent_version, ip_hash)
         values ($1, $2, $3::uuid, 1000, 'Sample customer', '+910000000000', 'p1', 'c1', sha256(convert_to($3::uuid::text, 'UTF8')))`,
        [owner.tenantId, site.id, itemId],
      ),
    );
    expect(r.rowCount).toBe(1);
    const { id } = await asMember(app, manager, (c) => one<{ id: string }>(c, 'select r.id::text from ops.reservation r where r.item_id = $1', [itemId]));
    pieces.set(name, id);
  }
  const holdPiece = (name: string) => asMember(app, manager, (c) => c.query(`update ops.reservation set state = 'held' where id = $1`, [pieces.get(name)]));
  await holdPiece('Silk saree'); // held for 12 hours
  await asMember(app, owner, (c) => c.query('update ops.site set reservation_hours = 48 where id = $1', [site.id]));
  await holdPiece('Cotton kurta'); // held for 48 hours
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

it('with holds off, a run reads no hold and the shop gets no hold finding', async () => {
  await setCapability(app, owner, 'holds', false);
  const off = await runWatchers(jobs, owner.tenantId, today);
  expect(await findings(jobs, owner.tenantId, "kind = 'hold_expiring'")).toEqual([]);
  const read = await runQueries(jobs, owner.tenantId, off.runId);
  expect(read).toContain('watch.dead_stock');
  expect(read).not.toContain('watch.hold_expiring');
  // Back on, its prerequisite first (capability_guard reads switch rows).
  await setCapability(app, owner, 'site', true);
  await setCapability(app, owner, 'holds', true);
});

it('hold_expiring: the saree whose hold ends within 24 hours, at ₹4,500; not the kurta held 48 hours, nor the dupatta only asked for', async () => {
  await runWatchers(jobs, owner.tenantId, today);
  const saree = pieces.get('Silk saree') as string;
  const [held] = (await tx(app, { tenant_id: owner.tenantId }, (c) => c.query('select item_id::text, held_until from ops.reservation where id = $1', [saree]))).rows;
  expect(await findings(jobs, owner.tenantId, "kind = 'hold_expiring'")).toEqual([
    {
      kind: 'hold_expiring',
      key: `hold_expiring:${saree}`,
      status: 'open',
      shop: null,
      severity: 'high',
      v: { reservation_id: saree, item_id: held.item_id, item: 'Silk saree', qty: 1000, held_until: (held.held_until as Date).toISOString(), price: 450_000 },
    },
  ]);
});
