// A salon for the calendar, booking and salary tests (BP-F2), built through core where core has the path: sign-up,
// members, staff.create and price.set are core's. What core has no command for yet is written here under the right
// person through the database's own guards: the capability switches (BP-CAP-1's; switched on here whatever sign-up writes), a second branch, shop hours and the
// site (no core writer), and the service item (item.create makes goods only; the guard admits the rows under it). Every
// branch is open 09:00–20:00 every day from 1 Jan 2026; the service is a 45-minute haircut at ₹400. No roster: each
// test writes its own by hand. The deployment has no ops.deployment row, so it is a demo: a public request's phone is the
// sample (+910000000000) and its name is pinned to the sample.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addDays, addMember, businessDate, createTenant, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { tx } from '../../db.ts';
import { sessionOf } from '../shop.ts';

export const STYLISTS = ['asha', 'ravi', 'meena', 'dev', 'kiran'] as const;
export type Stylist = (typeof STYLISTS)[number];

export type Salon = {
  owner: Session;
  manager: Session;
  desk: Session; // a staff member who signs in: marks their own attendance
  tenantId: string;
  shopId: string;
  otherShopId: string;
  serviceId: string;
  deskStaffId: string;
  stylists: Record<Stylist, string>;
};

export const SAMPLE_PHONE = '+910000000000';
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// One transaction as a member, optionally under a command (the guard checks the member's authority for it).
export const asMember = (app: pg.Pool, s: Session, sql: string, params: unknown[], command?: string) =>
  tx(app, { tenant_id: s.tenantId, actor_id: s.memberId, ...(command ? { command } : {}) }, (c) => c.query(sql, params));

export async function salon(app: pg.Pool, label: string): Promise<Salon> {
  const { session: owner, shopId } = await createTenant(app, {
    name: `${label} Salon (synthetic)`,
    slug: `salon-${randomBytes(6).toString('hex')}`,
    businessType: 'salon',
    shopName: 'Kalkaji',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  const t = owner.tenantId;
  const manager = await sessionOf(app, t, await addMember(app, owner, { name: 'Manager', role: 'manager' }));
  const desk = await sessionOf(app, t, await addMember(app, owner, { name: 'Front desk', role: 'staff' }));
  // staff first: bookings and salary require it; counter for price.set.
  for (const cap of ['counter', 'staff', 'salary', 'bookings']) {
    await asMember(app, owner, 'insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, $2, true)', [t, cap]);
  }
  const otherShopId = randomUUID();
  await asMember(app, owner, `insert into ops.shop (tenant_id, id, name) values ($1, $2, 'Nehru Place')`, [t, otherShopId]);
  await asMember(
    app,
    owner,
    `insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from)
     select $1, s, w, '09:00', '20:00', false, '2026-01-01' from unnest($2::uuid[]) s, generate_series(1, 7) w`,
    [t, [shopId, otherShopId]],
  );
  await asMember(app, owner, `insert into ops.site (tenant_id, booking_mode, privacy_version, consent_version) values ($1, 'slots', 'v1', 'v1')`, [t]);
  const serviceId = randomUUID();
  await tx(app, { tenant_id: t, actor_id: owner.memberId, command: 'item.create' }, async (c) => {
    await c.query(`insert into books.item (tenant_id, id, kind, unit) values ($1, $2, 'service', 'session')`, [t, serviceId]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, duration_min, effective_from) values ($1, $2, 'Haircut', 45, now() - interval '1 day')`, [
      t,
      serviceId,
    ]);
  });
  const run = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  await run(owner, 'price.set', { itemId: serviceId, amountMinor: 40_000, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() });
  const hire = async (name: string, at: string, memberId?: string) =>
    (await run(owner, 'staff.create', { name, shopId: at, dailyWageMinor: 60_000, joinedOn: '2026-08-01', ...(memberId ? { memberId } : {}) })).staffId as string;
  const stylists = {
    asha: await hire('Asha', shopId),
    ravi: await hire('Ravi', shopId),
    meena: await hire('Meena', shopId),
    dev: await hire('Dev', otherShopId),
    kiran: await hire('Kiran', shopId),
  };
  const deskStaffId = await hire('Front desk', shopId, desk.memberId);
  return { owner, manager, desk, tenantId: t, shopId, otherShopId, serviceId, deskStaffId, stylists };
}

// A Monday `weeks` weeks after the next one, as the shop's business date (Asia/Kolkata): always in the future.
export function monday(weeks: number): string {
  const today = businessDate(new Date());
  const isoDow = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return addDays(today, 8 - isoDow + 7 * weeks);
}
