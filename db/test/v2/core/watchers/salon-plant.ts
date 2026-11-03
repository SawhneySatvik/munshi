// A salon for the Bookings, Packages and Customers watchers (synthetic: "Glow Salon (synthetic)"), its situations
// planted through the database's own rules (plant.ts): the roster, a day's change, leave and attendance under their
// commands; services under item.create; bookings as the manager in the app; the public's holds on its site; sales and
// package holdings under sale.record and package.plan.create. Every day is a business day relative to `today` in the
// shop's zone (Asia/Kolkata). The key it plants, worked by hand (w-salon.test.ts holds the expected rows):
// - Asha's day 0 is changed to off and days 1–2 to 10:00–12:00 (240 minutes), 180 of them booked: 25% idle, under 40%
//   (control). The manager marks her absent on day 1, which holds her 10:00 haircut (₹500). No booking is on day 0, so
//   none can have ended by the time the tests run.
// - Bilal works 10:00–18:00 every day (1,440 minutes over days 0–2), 2 haircuts booked on day 2: 1,320 idle minutes
//   (92%). His service lines of the last 90 days: ₹500 (day −2, a booking's sale) and ₹700 (day −5, a walk-in): average
//   ₹600, so 1,320 / 60 × ₹600 = ₹13,200 idle. Day −1's haircut was never billed (₹500); day −2's was billed and day
//   −3's was a no-show (controls). Three public holds on his day 1 lapsed in the hour (₹1,500 held).
// - Chitra is on leave days 0–2 (no roster, so not idle) with a facial booked before it on day 2 (₹800).
// - Asha's day 1 has two lapsed holds (under three: control).
// - Packages: one lapses on day 10 with 5 facials (₹2,000) left, one lapsed on day −3 with the same left, one lapses on
//   day 20 (control).
// - Regulars: Rekha came 3 times, days −135, −100 and −76, ₹500 each: ₹1,500 over 60 days, ₹750 a month; Sunil came 3
//   times, the last on day −59, and Tara twice (controls).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addMember, businessDate, createTenant, localTime, openSession, recordSale, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { tx } from '../../db.ts';
import { asCommand, asMember, one, plusDays, setCapability, TENANT } from './plant.ts';

export const TZ = 'Asia/Kolkata';
export const HOLD_MINUTES = 2;

export type Salon = {
  tenantId: string;
  shopId: string;
  owner: Session;
  manager: Session;
  today: string;
  stylists: Record<'asha' | 'bilal' | 'chitra', string>;
  services: Record<'haircut' | 'facial' | 'colour', string>;
  customers: Record<'rekha' | 'sunil' | 'tara', string>;
  bookings: Record<'unbilled' | 'billed' | 'noShow', string>;
  holdings: Record<'soon' | 'lapsed' | 'later', string>;
  // when the last batch of holds was placed, for the hold-pressure instant
  lastHoldAt: number;
};

const sha = (s: string) => createHash('sha256').update(s).digest();

export async function plantSalon(app: pg.Pool, pub: pg.Pool): Promise<Salon> {
  const today = businessDate(new Date(), TZ);
  const at = (day: number, minute: number) => localTime(plusDays(today, day), minute, TZ).toISOString();
  const { session: owner, shopId } = await createTenant(app, {
    kind: 'sample',
    name: 'Glow Salon (synthetic)',
    slug: `salon-${randomBytes(6).toString('hex')}`,
    businessType: 'salon',
    shopName: 'Main salon',
    ownerName: 'Owner',
    identity: { provider: 'password', subject: randomUUID() },
  });
  const tenantId = owner.tenantId;
  const manager = (await openSession(app, tenantId, await addMember(app, owner, { name: 'Manager', role: 'manager' }))) as Session;
  const run = async (name: string, input: unknown) => (await runCommand(app, owner, name, input)) as Record<string, string>;
  // A booking mode needs the bookings switch, which needs staff (capability_guard reads switch rows only).
  await setCapability(app, owner, 'staff', true);
  await setCapability(app, owner, 'bookings', true);
  const site = await asMember(app, owner, (c) =>
    one<{ id: string }>(
      c,
      `insert into ops.site (tenant_id, booking_mode, privacy_version, consent_version, hold_minutes) values (${TENANT}, 'slots', 'p1', 'c1', $1) returning id`,
      [HOLD_MINUTES],
    ),
  );
  await asMember(app, owner, async (c) => {
    for (let weekday = 1; weekday <= 7; weekday++) {
      await c.query(`insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from) values (${TENANT}, $1, $2, '09:00', '21:00', false, $3)`, [
        shopId,
        weekday,
        plusDays(today, -400),
      ]);
    }
  });

  const stylists = {} as Salon['stylists'];
  for (const name of ['asha', 'bilal', 'chitra'] as const) stylists[name] = (await run('staff.create', { name, effectiveFrom: at(-400, 0) })).staffId as string;
  const patterns = new Map<string, string>(); // staff:weekday → shift_pattern id
  await asCommand(app, owner, 'shift.pattern.set', async (c) => {
    for (const staffId of Object.values(stylists)) {
      for (let weekday = 1; weekday <= 7; weekday++) {
        const p = await one<{ id: string }>(
          c,
          `insert into books.shift_pattern (tenant_id, staff_id, shop_id, weekday, starts, ends, effective_from) values (${TENANT}, $1, $2, $3, '10:00', '18:00', $4) returning id`,
          [staffId, shopId, weekday, plusDays(today, -400)],
        );
        patterns.set(`${staffId}:${weekday}`, p.id);
      }
    }
  });
  const changes = new Map<number, string>(); // Asha's day → shift_change id
  await asCommand(app, owner, 'shift.change', async (c) => {
    for (const day of [0, 1, 2]) {
      const ch = await one<{ id: string }>(
        c,
        `insert into books.shift_change (tenant_id, staff_id, day, shop_id, starts, ends, off) values (${TENANT}, $1, $2, $3, $4, $5, $6) returning id`,
        day === 0 ? [stylists.asha, plusDays(today, day), shopId, null, null, true] : [stylists.asha, plusDays(today, day), shopId, '10:00', '12:00', false],
      );
      changes.set(day, ch.id);
    }
  });
  const isoDow = (day: number) => ((new Date(`${plusDays(today, day)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const roster = (staffId: string, day: number) =>
    staffId === stylists.asha && changes.has(day)
      ? { shift_pattern_id: null, shift_change_id: changes.get(day) as string }
      : { shift_pattern_id: patterns.get(`${staffId}:${isoDow(day)}`) as string, shift_change_id: null };

  const services = {} as Salon['services'];
  const plan: [keyof Salon['services'], number, number][] = [
    ['haircut', 60, 50_000],
    ['facial', 30, 80_000],
    ['colour', 45, 70_000],
  ];
  for (const [name, minutes, price] of plan) {
    services[name] = await asCommand(app, owner, 'item.create', async (c) => {
      const item = await one<{ id: string }>(c, `insert into books.item (tenant_id, kind, unit) values (${TENANT}, 'service', 'session') returning id`);
      await c.query(`insert into books.item_revision (tenant_id, item_id, name, duration_min, effective_from) values (${TENANT}, $1, $2, $3, $4)`, [item.id, name, minutes, at(-400, 0)]);
      return item.id;
    });
    await run('price.set', { itemId: services[name], amountMinor: price, effectiveFrom: at(-400, 0) });
  }
  const minutesOf = { haircut: 60, facial: 30, colour: 45 };

  // The public's holds: placed first, so they lapse while the rest is planted. Each from its own device and network.
  const hold = (staffId: string, service: keyof Salon['services'], day: number, minute: number) =>
    tx(pub, { tenant_id: tenantId }, (c) =>
      c.query(
        `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash,
                                  shift_pattern_id, shift_change_id)
         values ($1, $2, $3, $4, $5, tstzrange($6, $7), 'held', 'site', $8, $9, $10, $11, $12)`,
        [
          tenantId,
          site.id,
          shopId,
          staffId,
          services[service],
          at(day, minute),
          at(day, minute + minutesOf[service]),
          sha(randomUUID()),
          sha(randomUUID()),
          sha(randomUUID()),
          roster(staffId, day).shift_pattern_id,
          roster(staffId, day).shift_change_id,
        ],
      ),
    );
  const firstHolds = Date.now();
  await hold(stylists.bilal, 'haircut', 1, 14 * 60);
  await hold(stylists.bilal, 'haircut', 1, 15 * 60);
  await hold(stylists.asha, 'facial', 1, 11 * 60);
  await hold(stylists.asha, 'facial', 1, 11 * 60 + 30);

  const book = (staffId: string, service: keyof Salon['services'], day: number, minute: number) =>
    asMember(app, manager, (c) =>
      one<{ id: string }>(
        c,
        `insert into ops.booking (tenant_id, shop_id, staff_id, service_item_id, during, state, source, shift_pattern_id, shift_change_id)
         values (${TENANT}, $1, $2, $3, tstzrange($4, $5), 'confirmed', 'app', $6, $7) returning id`,
        [shopId, staffId, services[service], at(day, minute), at(day, minute + minutesOf[service]), roster(staffId, day).shift_pattern_id, roster(staffId, day).shift_change_id],
      ),
    );
  for (const [day, minute] of [
    [1, 600],
    [2, 600],
    [2, 660],
  ] as const)
    await book(stylists.asha, 'haircut', day, minute);
  await book(stylists.bilal, 'haircut', 2, 600);
  await book(stylists.bilal, 'haircut', 2, 660);
  await book(stylists.chitra, 'facial', 2, 600);
  const bookings = {
    unbilled: (await book(stylists.bilal, 'haircut', -1, 600)).id,
    billed: (await book(stylists.bilal, 'haircut', -2, 600)).id,
    noShow: (await book(stylists.bilal, 'haircut', -3, 600)).id,
  };
  await asMember(app, manager, (c) => c.query(`update ops.booking set state = 'no_show' where id = $1`, [bookings.noShow]));
  await asCommand(app, owner, 'leave.record', (c) =>
    c.query(`insert into books.leave (tenant_id, staff_id, kind, first_day, last_day) values (${TENANT}, $1, 'paid', $2, $3)`, [stylists.chitra, today, plusDays(today, 2)]),
  );
  await asCommand(app, manager, 'attendance.mark', (c) =>
    c.query(`insert into books.attendance (tenant_id, staff_id, shop_id, day, status, marked_by_role) values (${TENANT}, $1, $2, $3, 'absent', 'manager')`, [
      stylists.asha,
      shopId,
      plusDays(today, 1),
    ]),
  );

  // Bilal's service lines: the billed booking's sale, and a walk-in.
  const serviceSale = (day: number, service: keyof Salon['services'], bookingId: string | null) =>
    asCommand(app, manager, 'sale.record', async (c) => {
      const price = await one<{ id: string; amount_minor: string }>(c, 'select id, amount_minor from books.price where item_id = $1', [services[service]]);
      const sale = await one<{ id: string }>(
        c,
        `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency, booking_id) values (${TENANT}, $1, $2, $3, 'INR', $4) returning id`,
        [shopId, at(day, 700), price.amount_minor, bookingId],
      );
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, staff_id, qty_milli, unit_price_minor, gross_minor, currency)
         values (${TENANT}, $1, 1, $2, 'service', $3, $4, 1000, $5, $5, 'INR')`,
        [sale.id, services[service], price.id, stylists.bilal, price.amount_minor],
      );
    });
  await serviceSale(-2, 'haircut', bookings.billed);
  await serviceSale(-5, 'colour', null);

  // Regulars buy a retail good at the counter.
  const customers = {} as Salon['customers'];
  for (const name of ['rekha', 'sunil', 'tara'] as const) customers[name] = (await run('customer.create', { name, effectiveFrom: at(-400, 0) })).customerId as string;
  const shampoo = (await run('item.create', { name: 'Shampoo bottle', unit: 'piece', effectiveFrom: at(-400, 0) })).itemId as string;
  await run('price.set', { itemId: shampoo, amountMinor: 50_000, effectiveFrom: at(-400, 0) });
  const visits: [keyof Salon['customers'], number][] = [
    ['rekha', -135],
    ['rekha', -100],
    ['rekha', -76],
    ['sunil', -150],
    ['sunil', -120],
    ['sunil', -59],
    ['tara', -140],
    ['tara', -90],
  ];
  for (const [who, day] of visits) {
    await recordSale(app, manager, { shopId, soldAt: at(day, 720), customerId: customers[who], lines: [{ itemId: shampoo, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 50_000 }] });
  }

  // Packages: a five-facial pack for ₹2,000, sold to Tara three times with different expiry dates.
  const planId = await asCommand(app, owner, 'package.plan.create', async (c) => {
    const item = await one<{ id: string }>(c, `insert into books.item (tenant_id, kind, unit) values (${TENANT}, 'package', 'piece') returning id`);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values (${TENANT}, $1, 'Glow pack', $2)`, [item.id, at(-400, 0)]);
    await c.query(`insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values (${TENANT}, $1, 200000, 'INR', $2)`, [item.id, at(-400, 0)]);
    const p = await one<{ id: string }>(c, `insert into books.package_plan (tenant_id, item_id, kind, validity_days) values (${TENANT}, $1, 'sessions', 30) returning id`, [item.id]);
    await c.query(`insert into books.package_plan_line (tenant_id, plan_id, line_no, item_id, sessions) values (${TENANT}, $1, 1, $2, 5)`, [p.id, services.facial]);
    return p.id;
  });
  const sellPack = (expiresIn: number) =>
    asCommand(app, manager, 'sale.record', async (c) => {
      const plan = await one<{ item_id: string }>(c, 'select item_id from books.package_plan where id = $1', [planId]);
      const price = await one<{ id: string }>(c, 'select id from books.price where item_id = $1', [plan.item_id]);
      const soldOn = expiresIn - 30;
      const sale = await one<{ id: string }>(
        c,
        `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values (${TENANT}, $1, $2, $3, 200000, 'INR') returning id`,
        [shopId, at(soldOn, 720), customers.tara],
      );
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
         values (${TENANT}, $1, 1, $2, 'package', $3, 1000, 200000, 200000, 'INR')`,
        [sale.id, plan.item_id, price.id],
      );
      const h = await one<{ id: string }>(
        c,
        `insert into books.package_holding (tenant_id, customer_id, plan_id, sale_id, starts_on, expires_on, liability_minor, currency)
         values (${TENANT}, $1, $2, $3, $4, $5, 200000, 'INR') returning id`,
        [customers.tara, planId, sale.id, plusDays(today, soldOn), plusDays(today, expiresIn)],
      );
      await c.query(
        `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, seq, value_after, at)
         values (${TENANT}, $1, $2, $3, 'sold', 5, 200000, 'INR', 0, 0, $4)`,
        [h.id, shopId, services.facial, at(soldOn, 720)],
      );
      return h.id;
    });
  const holdings = { soon: await sellPack(10), lapsed: await sellPack(-3), later: await sellPack(20) };

  // The last hold on Bilal's day 1 waits until the first two have lapsed (a stylist's day holds two live at most).
  const wait = firstHolds + HOLD_MINUTES * 60_000 + 3_000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  await hold(stylists.bilal, 'haircut', 1, 16 * 60);
  return { tenantId, shopId, owner, manager, today, stylists, services, customers, bookings, holdings, lastHoldAt: Date.now() };
}
