// Builds "Elite Unisex Salon & Academy (sample menu)" (slug elite, the salon pack): two branches, Kirti Nagar and
// Kalkaji, with the SAMPLE service menu and packages of db/seed/merchants/elite/catalogue.json (none of its prices,
// durations or packages is Elite's own), invented stylists (no real person; names to be replaced only with each
// person's permission) and invented customers (no phone numbers). The tenant is provisioned as the operator would
// (provision.ts); everything after is written through packages/core as its members: the hours, the site and the
// switches as the owner's ops rows; the menu, staff, roster, a one-day change, a holiday, leave, attendance, sales and
// package sales as direct commands; a salary month as a salary.run draft the owner approves; bookings at the desk.
// Payments are recorded, never processed.
//
// Days are offsets from as_of (day 0), which must lie after today: the desk books only the future, so the watchers'
// three-day window (days 0–2) is booked whatever the time of the seed. Nothing is written on day −1 but the package
// redemptions (which core stamps now). Deterministic for a given as_of; the hand-worked key is
// db/seed/elite.answers.json. Planted: an idle stylist (Kabir), a package about to lapse with sessions left (Anita's
// Glow pack) and a regular who stopped coming (Ritu), with near-miss controls beside each.
import { readFileSync } from 'node:fs';
import {
  addDays,
  addMember,
  bookAtDesk,
  businessDate,
  COUNT_COL,
  decide,
  localTime,
  mintSnapshot,
  openSession,
  proposeDraft,
  recordSale,
  runCommand,
  type Session,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { provision } from './provision.ts';

export const ELITE = 'Elite Unisex Salon & Academy (sample menu)';
export type ElitePlant = 'idle_stylist' | 'package_expiry' | 'regulars_lapsing';
export const ELITE_PLANTS: ElitePlant[] = ['idle_stylist', 'package_expiry', 'regulars_lapsing'];

type Menu = {
  services: { ref: string; category: string; name: string; durationMin: number; priceMinor: number }[];
  packages: { ref: string; kind: string; name: string; validityDays: number; priceMinor: number; lines: { service: string; sessions: number }[] }[];
};
const MENU = JSON.parse(readFileSync(new URL('./merchants/elite/catalogue.json', import.meta.url), 'utf8')) as Menu;

const TZ = 'Asia/Kolkata';
const SHOPS = ['Kirti Nagar', 'Kalkaji'] as const;
type Branch = (typeof SHOPS)[number];
const SHIFT = { starts: '11:00', ends: '19:00', from: 660 }; // every stylist's working day; both branches open 10:00–20:00

// A day's bookings, back to back from 11:00, each starting on the quarter hour (the desk's grid).
const BLOCKS = {
  hair: ['s-colour', 's-cut-w', 's-hairspa', 's-cut-w', 's-blow', 's-hairspa'], // 120+45+60+45+30+60 = 360 min
  skin: ['s-facial', 's-cleanup', 's-gel', 's-detan', 's-nailart', 's-mani', 's-pedi', 's-wax'], // 60+45+45+30+60+40+50+20 = 350 min
  grooming: ['s-cut-m', 's-facial-m', 's-colour-m', 's-headmassage', 's-foot', 's-cut-m', 's-cut-m', 's-headmassage', 's-cut-m'], // 300 min
  quiet: ['s-cut-m', 's-beard'], // 30+20 = 50 min
} as const;
// Walk-in history: the services a stylist's last-90-day sale lines cycle through.
const HISTORY = { hair: ['s-cut-w', 's-blow', 's-hairspa'], skin: ['s-cleanup', 's-mani', 's-thread'], grooming: ['s-cut-m', 's-beard'], quiet: ['s-cut-m', 's-beard'] };
type Kind = keyof typeof BLOCKS;

// Invented stylists: name, home branch, the day they book, their walk-in services.
const STYLISTS: [string, Branch, Kind][] = [
  ['Neha', 'Kirti Nagar', 'hair'],
  ['Arjun', 'Kirti Nagar', 'hair'],
  ['Simran', 'Kirti Nagar', 'skin'],
  ['Kabir', 'Kirti Nagar', 'quiet'], // the planted idle stylist
  ['Priya', 'Kalkaji', 'hair'],
  ['Rohit', 'Kalkaji', 'grooming'], // the near miss: 37.5% idle
  ['Tanvi', 'Kalkaji', 'skin'],
];
const CUSTOMERS = ['Ritu M.', 'Sana K.', 'Vikram S.', 'Anita R.', 'Deepa J.', 'Karan B.', 'Neelam G.'];

export type Elite = {
  tenantId: string;
  asOf: string;
  owner: Session;
  desks: Record<Branch, Session>;
  shops: Map<string, string>; // branch → shop id
  staff: Map<string, string>; // stylist → staff id
  services: Map<string, string>; // menu ref → item id
  plans: Map<string, string>; // package ref → plan item id
  customers: Map<string, string>;
  holdings: Map<string, string>; // customer → package holding id
  counts: { services: number; bookings: number; sales: number; attendance: number; salaryRuns: number };
};

const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const quarter = (m: number) => Math.ceil(m / 15) * 15;

export async function seedElite(app: pg.Pool, ownerDb: pg.ClientBase, opts: { asOf: string; now?: Date; omit?: ElitePlant[]; slug?: string }): Promise<Elite> {
  const asOf = opts.asOf;
  const today = businessDate(opts.now ?? new Date(), TZ);
  if (asOf <= today) throw new Error(`seed: Elite's as_of (${asOf}) must lie after today: its desk bookings are on days 0–2`);
  const planted = (p: ElitePlant) => !(opts.omit ?? []).includes(p);
  const date = (d: number) => addDays(asOf, d);
  const at = (d: number, minute: number) => localTime(date(d), minute, TZ).toISOString();
  const since = at(-400, 0);

  const made = await provision(ownerDb, { slug: opts.slug ?? 'elite', name: ELITE, businessType: 'salon', ownerName: 'Owner (sample)', shops: [...SHOPS] });
  const tenantId = made.tenantId;
  const as = async (memberId: string) => (await openSession(app, tenantId, memberId)) as Session;
  const owner = await as(made.ownerId);
  const shops = new Map(SHOPS.map((s, i) => [s, made.shopIds[i] as string]));
  const shop = (b: Branch) => shops.get(b) as string;
  const desks = {
    'Kirti Nagar': await as(await addMember(app, owner, { name: 'Kirti Nagar desk (sample)', role: 'manager' })),
    Kalkaji: await as(await addMember(app, owner, { name: 'Kalkaji desk (sample)', role: 'manager' })),
  };
  const cmd = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  const ops = (sql: string, params: unknown[]) => withTx(app, { kind: 'member', session: owner }, (c) => c.query(sql, params));

  // The owner's ops rows (no core writer yet): both branches' hours, every day, and the site with live slots.
  for (const b of SHOPS) {
    await ops(
      `insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from)
       select $1, $2, w, '10:00', '20:00', false, $3 from generate_series(1, 7) w`,
      [tenantId, shop(b), date(-400)],
    );
  }
  await ops(`insert into ops.site (tenant_id, booking_mode, privacy_version, consent_version) values ($1, 'slots', 'v1', 'v1')`, [tenantId]);

  // The menu and the packages.
  const services = new Map<string, string>();
  const price = new Map<string, number>();
  const minutes = new Map<string, number>();
  for (const s of MENU.services) {
    const { itemId } = await cmd(owner, 'item.create', { kind: 'service', name: s.name, durationMin: s.durationMin, category: s.category, effectiveFrom: since });
    await cmd(owner, 'price.set', { itemId, amountMinor: s.priceMinor, effectiveFrom: since });
    services.set(s.ref, itemId as string);
    price.set(s.ref, s.priceMinor);
    minutes.set(s.ref, s.durationMin);
  }
  const plans = new Map<string, string>();
  const planLines = new Map<string, string[]>(); // plan ref → its services, one per session
  for (const p of MENU.packages) {
    const lines = p.lines.map((l) => ({ itemId: services.get(l.service) as string, sessions: l.sessions }));
    const { itemId } = await cmd(owner, 'package.plan.create', { name: p.name, priceMinor: p.priceMinor, validityDays: p.validityDays, lines, category: p.kind, effectiveFrom: since });
    plans.set(p.ref, itemId as string);
    planLines.set(p.ref, p.lines.flatMap((l) => Array(l.sessions).fill(l.service) as string[]));
  }

  // Stylists, their weekly roster (each off one weekday that falls on day 3–6, never inside the watchers' window), a
  // one-day change (Arjun covers Kalkaji on day 1), a holiday for both branches on day 12, and Priya's leave on days 8–9.
  const staff = new Map<string, string>();
  const patterns = new Map<string, string>(); // stylist:weekday → pattern id
  const offDay = new Map<string, number>();
  for (const [k, [name, home]] of STYLISTS.entries()) {
    const { staffId } = await cmd(owner, 'staff.create', { name, shopId: shop(home), dailyWageMinor: 80_000, joinedOn: date(-400), effectiveFrom: since });
    staff.set(name, staffId as string);
    const off = isoDow(date(3 + (k % 4)));
    offDay.set(name, off);
    for (let weekday = 1; weekday <= 7; weekday++) {
      const hours = weekday === off ? { off: true } : { starts: SHIFT.starts, ends: SHIFT.ends };
      const { patternId } = await cmd(owner, 'shift.pattern.set', { staffId, shopId: shop(home), weekday, effectiveFrom: date(-400), ...hours });
      patterns.set(`${name}:${weekday}`, patternId as string);
    }
  }
  const sid = (name: string) => staff.get(name) as string;
  const { changeId: arjunCover } = await cmd(desks['Kirti Nagar'], 'shift.change', { staffId: sid('Arjun'), shopId: shop('Kalkaji'), day: date(1), starts: SHIFT.starts, ends: SHIFT.ends });
  await cmd(desks['Kirti Nagar'], 'holiday.set', { day: date(12), nameKey: 'diwali' });
  await cmd(desks.Kalkaji, 'leave.record', { staffId: sid('Priya'), kind: 'paid', firstDay: date(8), lastDay: date(9) });

  const customers = new Map<string, string>();
  for (const name of CUSTOMERS) customers.set(name, (await cmd(owner, 'customer.create', { name, effectiveFrom: since })).customerId as string);
  const cid = (name: string) => customers.get(name) as string;

  // History: each stylist's walk-ins (12 sales a week apart, day −5 − 7j, staggered by stylist), the named regulars,
  // and the package sales. Kabir's: Men's haircut ₹350 and Beard trim ₹250 alternately, 6 of each: ₹300 on average.
  const counts = { services: services.size, bookings: 0, sales: 0, attendance: 0, salaryRuns: 0 };
  const sell = async (branch: Branch, d: number, minute: number, ref: string, stylist: string | null, customer?: string) => {
    await recordSale(app, desks[branch], {
      shopId: shop(branch),
      soldAt: at(d, minute),
      ...(customer ? { customerId: cid(customer) } : {}),
      lines: [{ itemId: services.get(ref) as string, qtyMilli: 1000, ...(stylist ? { staffId: sid(stylist) } : {}) }],
      payments: [{ method: d % 2 === 0 ? 'cash' : 'upi', amountMinor: price.get(ref) as number }],
    });
    counts.sales++;
  };
  for (const [k, [name, home, kind]] of STYLISTS.entries()) {
    const list = HISTORY[kind];
    for (let j = 0; j < 12; j++) await sell(home, -5 - 7 * j - (k % 3), 720 + 20 * k, list[j % list.length] as string, name); // Kabir (k = 3): days −5 … −82
  }
  // Ritu came three times for a facial, the last on day −80 (the plant); Sana three times, the last on day −59 (one day
  // short of lapsing); Vikram only twice.
  for (const d of [-150, -115, planted('regulars_lapsing') ? -80 : -50]) await sell('Kirti Nagar', d, 1020, 's-facial', 'Simran', 'Ritu M.');
  for (const d of [-120, -90, -59]) await sell('Kirti Nagar', d, 1020, 's-cut-w', 'Neha', 'Sana K.');
  for (const d of [-140, -100]) await sell('Kalkaji', d, 1020, 's-cut-m', 'Rohit', 'Vikram S.');

  const holdings = new Map<string, string>();
  const sellPack = async (branch: Branch, d: number, ref: string, customer: string) => {
    const pkg = MENU.packages.find((p) => p.ref === ref) as Menu['packages'][number];
    const { saleId } = await recordSale(app, desks[branch], {
      shopId: shop(branch),
      soldAt: at(d, 1080),
      customerId: cid(customer),
      lines: [{ itemId: plans.get(ref) as string, qtyMilli: 1000 }],
      payments: [{ method: 'upi', amountMinor: pkg.priceMinor }],
    });
    counts.sales++;
    const { rows } = await withTx(app, { kind: 'system', tenantId }, (c) => c.query<{ id: string }>('select id::text from books.package_holding where sale_id = $1', [saleId]));
    holdings.set(customer, (rows[0] as { id: string }).id);
  };
  const redeem = async (branch: Branch, customer: string, ref: string, sessions: number) => {
    for (const service of (planLines.get(ref) as string[]).slice(0, sessions)) {
      await cmd(desks[branch], 'package.redeem', { holdingId: holdings.get(customer), shopId: shop(branch), itemId: services.get(service) });
    }
  };
  // Anita's Glow pack (90 days, 3 facials) lapses on day 10 with 2 left (the plant); Deepa's Hair spa four lapses on day
  // 10 too, all four used; Karan's Grooming month lapses on day 20; Neelam's Pre-bridal on day 35.
  await sellPack('Kirti Nagar', planted('package_expiry') ? -80 : -50, 'p-glow', 'Anita R.');
  await sellPack('Kalkaji', -110, 'p-hairspa', 'Deepa J.');
  await sellPack('Kirti Nagar', -40, 'p-groom', 'Karan B.');
  await sellPack('Kalkaji', -10, 'p-prebridal', 'Neelam G.');
  await redeem('Kirti Nagar', 'Anita R.', 'p-glow', 1);
  await redeem('Kalkaji', 'Deepa J.', 'p-hairspa', 4);
  await redeem('Kirti Nagar', 'Karan B.', 'p-groom', 1);

  // Last month's attendance (present on every rostered day, off on the weekly off) and its salary, as the owner's
  // approved salary.run draft over the preview it cites.
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const periodEnd = addDays(monthStart, -1);
  const periodStart = `${periodEnd.slice(0, 7)}-01`;
  const attendanceEnd = periodEnd < today ? periodEnd : addDays(today, -1);
  for (const [name, home] of STYLISTS) {
    for (let day = periodStart; day <= attendanceEnd; day = addDays(day, 1)) {
      const status = isoDow(day) === offDay.get(name) ? 'off' : 'present';
      await cmd(desks[home], 'attendance.mark', { staffId: sid(name), shopId: shop(home), day, status });
      counts.attendance++;
    }
  }
  const preview = await mintSnapshot(app, { kind: 'member', session: owner }, 'salary.preview', { period_start: periodStart, period_end: periodEnd });
  const draftId = await proposeDraft(app, { session: owner }, { command: 'salary.run', payload: { periodStart, periodEnd }, basedOn: [{ snapshotId: preview.id, row: 0, col: COUNT_COL }] });
  const decided = await decide(app, owner, draftId, 'approved');
  if (decided.status !== 'executed') throw new Error(`seed: Elite's salary run was ${decided.status}`);
  counts.salaryRuns++;

  // The desk's bookings on days 0–2, each against the roster row in effect (Arjun's day 1 is his change, at Kalkaji).
  // Every stylist's day is that of their kind; Kabir's is two short services (the plant) unless omitted.
  const firstCustomer: Record<string, string> = { 'Neha:1': 'Sana K.', 'Tanvi:2': 'Neelam G.' };
  for (const [name, home, kind] of STYLISTS) {
    const block = BLOCKS[name === 'Kabir' && !planted('idle_stylist') ? 'grooming' : kind];
    for (const d of [0, 1, 2]) {
      const cover = name === 'Arjun' && d === 1;
      const branch: Branch = cover ? 'Kalkaji' : home;
      const shift = cover
        ? { shiftRel: 'books.shift_change' as const, shiftId: arjunCover as string }
        : { shiftRel: 'books.shift_pattern' as const, shiftId: patterns.get(`${name}:${isoDow(date(d))}`) as string };
      let minute = SHIFT.from;
      for (const [n, ref] of block.entries()) {
        minute = quarter(minute);
        const customer = n === 0 ? firstCustomer[`${name}:${d}`] : undefined;
        await bookAtDesk(app, desks[branch], {
          shopId: shop(branch),
          staffId: sid(name),
          serviceItemId: services.get(ref) as string,
          start: at(d, minute),
          ...shift,
          ...(customer ? { customerId: cid(customer) } : {}),
        });
        minute += minutes.get(ref) as number;
        counts.bookings++;
      }
    }
  }
  return { tenantId, asOf, owner, desks, shops, staff, services, plans, customers, holdings, counts };
}
