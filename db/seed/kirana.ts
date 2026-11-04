// Builds "Sharma General Store (synthetic)" through packages/core's real paths (sign-up, member additions, direct
// commands), so every book row went through the guard and the audit chain; each person is named in the contact vault,
// and the catalogue and the people take effect from day -120, before any of their history. Synthetic data only;
// suppliers are simulated; payments are recorded, never processed. 60 generic SKUs, 90 days of counter sales, weekly
// bills from 3 simulated distributors, 25 credit customers, 4 staff, and five planted situations
// (db/seed/kirana.answers.json): shrinkage on 2 SKUs · price creep on 1 SKU · a lot expiring within 7 days · 3 overdue
// credit customers · a short UPI settlement on 1 day — plus near-miss controls the watchers must not flag.
// Deterministic for a given as_of. Days below are offsets from as_of (day 0, "this morning": no sales yet).
import {
  addDays,
  addMember,
  addRecipient,
  businessDate,
  countStock,
  createTenant,
  decide,
  lineAmount,
  localTime,
  mintSnapshot,
  openSession,
  proposeDraft,
  recordPayment,
  recordPurchase,
  recordSale,
  recordSettlement,
  runCommand,
  type Session,
  withTx,
} from '@munshi/core';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { provisioned, provisionSample } from './provision.ts';

export const SHOP = 'Sharma General Store (synthetic)';
export type Plant = 'shrinkage' | 'price_creep' | 'expiry' | 'overdue_credit' | 'short_settlement';
export const PLANTS: Plant[] = ['shrinkage', 'price_creep', 'expiry', 'overdue_credit', 'short_settlement'];

const SUPPLIERS = ['Gupta Traders (simulated)', 'Mehta Distributors (simulated)', 'Balaji Agencies (simulated)'] as const;
const BILL_PREFIX = ['GT', 'MD', 'BA'];

// name, unit, category, selling price, bill cost (paise), supplier, demand a day (units), order multiple (units)
export type Sku = [string, 'pack' | 'piece' | 'kg', string, number, number, 0 | 1 | 2, number, number];
export const CATALOGUE: Sku[] = [
  ['Glucose biscuits 70 g', 'pack', 'biscuits', 1000, 850, 0, 12, 24],
  ['Cream biscuits 100 g', 'pack', 'biscuits', 2500, 2000, 0, 5, 24],
  ['Salted crackers 120 g', 'pack', 'biscuits', 3000, 2500, 0, 3, 12],
  ['Instant noodles 70 g', 'pack', 'snacks', 1400, 1150, 0, 10, 24],
  ['Potato chips 50 g', 'pack', 'snacks', 2000, 1600, 0, 6, 24],
  ['Namkeen mix 200 g', 'pack', 'snacks', 5500, 4500, 0, 3, 12],
  ['Butter 100 g', 'pack', 'dairy', 6200, 5600, 0, 3, 12],
  ['Cheese slices 200 g', 'pack', 'dairy', 11500, 9000, 0, 0, 1],
  ['Paneer 200 g', 'pack', 'dairy', 9500, 8000, 0, 0, 1],
  ['Milk powder 400 g', 'pack', 'dairy', 21000, 18000, 0, 1, 6],
  ['Condensed milk 400 g', 'pack', 'dairy', 14000, 12000, 0, 1, 6],
  ['Cornflakes 250 g', 'pack', 'breakfast', 13000, 11000, 0, 1, 6],
  ['Oats 500 g', 'pack', 'breakfast', 9900, 8200, 0, 1, 6],
  ['Tomato ketchup 500 g', 'pack', 'spreads', 12000, 10000, 0, 1, 6],
  ['Mixed fruit jam 200 g', 'pack', 'spreads', 9000, 7500, 0, 1, 6],
  ['Peanut butter 200 g', 'pack', 'spreads', 14500, 12000, 0, 0.5, 6],
  ['Soft drink 750 ml', 'piece', 'drinks', 4000, 3300, 0, 4, 12],
  ['Mango drink 600 ml', 'piece', 'drinks', 3500, 2800, 0, 3, 12],
  ['Drinking water 1 l', 'piece', 'drinks', 2000, 1400, 0, 8, 12],
  ['Mango pickle 400 g', 'pack', 'spreads', 12500, 10000, 0, 0.5, 6],
  ['Toor dal 1 kg', 'pack', 'staples', 15000, 12800, 1, 3, 10],
  ['Moong dal 500 g', 'pack', 'staples', 7500, 6300, 1, 2, 10],
  ['Chana dal 1 kg', 'pack', 'staples', 11000, 9300, 1, 2, 10],
  ['Basmati rice 1 kg', 'pack', 'staples', 12500, 10500, 1, 2, 10],
  ['Sona masoori rice 5 kg', 'pack', 'staples', 32000, 28000, 1, 1, 5],
  ['Wheat flour 5 kg', 'pack', 'staples', 24000, 21000, 1, 2, 5],
  ['Besan 500 g', 'pack', 'staples', 6000, 5000, 1, 1, 10],
  ['Sugar 1 kg', 'pack', 'staples', 4800, 4200, 1, 5, 20],
  ['Iodised salt 1 kg', 'pack', 'staples', 2800, 2200, 1, 3, 20],
  ['Jaggery 1 kg', 'pack', 'staples', 7000, 5800, 1, 1, 10],
  ['Poha 500 g', 'pack', 'staples', 4500, 3700, 1, 2, 10],
  ['Suji 500 g', 'pack', 'staples', 4000, 3300, 1, 1, 10],
  ['Sunflower oil 1 l', 'pack', 'oils', 20500, 18000, 1, 2, 12],
  ['Mustard oil 1 l', 'pack', 'oils', 18000, 15800, 1, 1, 12],
  ['Groundnut oil 1 l', 'pack', 'oils', 22000, 19500, 1, 1, 12],
  ['Ghee 500 ml', 'pack', 'oils', 25000, 22000, 1, 1, 6],
  ['Sugar (loose)', 'kg', 'loose', 4600, 4000, 1, 4, 25],
  ['Rice (loose)', 'kg', 'loose', 5200, 4400, 1, 5, 25],
  ['Turmeric powder 100 g', 'pack', 'spices', 3500, 2800, 1, 1, 10],
  ['Red chilli powder 100 g', 'pack', 'spices', 4200, 3400, 1, 1, 10],
  ['Coriander powder 100 g', 'pack', 'spices', 3000, 2400, 1, 1, 10],
  ['Garam masala 50 g', 'pack', 'spices', 6500, 5200, 1, 0.5, 10],
  ['Cumin seeds 100 g', 'pack', 'spices', 5500, 4500, 1, 0.5, 10],
  ['Tea leaves 250 g', 'pack', 'beverages', 14000, 11800, 1, 2, 12],
  ['Instant coffee 50 g', 'pack', 'beverages', 16000, 13500, 1, 0.5, 6],
  ['Bath soap 100 g', 'pack', 'household', 4000, 3200, 2, 4, 24],
  ['Detergent powder 1 kg', 'pack', 'household', 12000, 10000, 2, 1, 10],
  ['Dishwash bar 200 g', 'pack', 'household', 2500, 2000, 2, 2, 20],
  ['Toothpaste 150 g', 'pack', 'household', 9500, 7800, 2, 1, 12],
  ['Shampoo sachet 6 ml', 'piece', 'household', 200, 150, 2, 10, 100],
  ['Hair oil 200 ml', 'pack', 'household', 11000, 9000, 2, 0.5, 12],
  ['Floor cleaner 1 l', 'pack', 'household', 17500, 14500, 2, 0.5, 6],
  ['Toilet cleaner 500 ml', 'pack', 'household', 9500, 7800, 2, 0.5, 6],
  ['Mosquito coils pack of 10', 'pack', 'household', 4500, 3600, 2, 1, 12],
  ['Matchbox pack of 10', 'pack', 'household', 1000, 800, 2, 3, 20],
  ['Candles pack of 6', 'pack', 'household', 3000, 2400, 2, 0.5, 12],
  ['Agarbatti 100 g', 'pack', 'household', 5000, 4000, 2, 1, 12],
  ['Tissue paper roll', 'piece', 'household', 3500, 2800, 2, 1, 12],
  ['Garbage bags 30 pcs', 'pack', 'household', 9000, 7200, 2, 0.5, 6],
  ['Batteries AA pair', 'pack', 'household', 4000, 3200, 2, 1, 12],
];

const OVERDUE = ['Ramesh K.', 'Sunita P.', 'Mohan L.'];
// Mohan L. gave the shop his WhatsApp number and agreed in person to service messages, so the owner can approve the
// overdue reminder the walkthrough drafts for him. Ramesh K. and Sunita P. gave no number: a reminder to them is refused.
const REACHABLE = new Map([['Mohan L.', '+919800000103']]); // synthetic
const NEAR_MISS = 'Kamala D.'; // owes ₹40 past due: under the ₹100 threshold
const OTHERS = [
  'Asha M.', 'Vikram S.', 'Geeta R.', 'Farhan A.', 'Lakshmi N.', 'Deepak T.', 'Neha B.', 'Arjun V.', 'Priya C.', 'Suresh G.',
  'Anjali H.', 'Ravi J.', 'Meena O.', 'Karan W.', 'Fatima Z.', 'Gopal E.', 'Rekha F.', 'Sanjay I.', 'Usha U.', 'Nikhil Y.',
  'Shabnam X.',
];

const SHELF_LIFE_DAYS = 365; // background stock: nothing else comes near expiry in the window
const CREEP_FROM = -30; // Butter's bill cost rises from this day (and Cream biscuits' by 2%, a control)
const SHORT_DAY = -6;
const SHORT_MINOR = 45_000;

// Deterministic randomness (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Kirana = {
  tenantId: string;
  asOf: string;
  shopId: string;
  owner: Session;
  manager: Session;
  staff: Session[];
  items: Map<string, string>; // name → item id
  suppliers: Map<string, string>;
  customers: Map<string, string>;
  counts: { sales: number; purchases: number; payments: number; settlements: number; stockCounts: number };
};

// `owner`: a connection that may SET ROLE munshi_owner. Given, the shop is provisioned as the operator's (a hosted
// database takes no sample shop from the app); else it signs up through core, as on a laptop or in a test.
export async function seedKirana(app: pg.Pool, opts: { asOf?: string; omit?: Plant[]; slug?: string; owner?: pg.ClientBase } = {}): Promise<Kirana> {
  const tz = 'Asia/Kolkata';
  const asOf = opts.asOf ?? businessDate(new Date(), tz);
  const planted = (p: Plant) => !(opts.omit ?? []).includes(p);
  const random = rng(20261027);
  const date = (d: number) => addDays(asOf, d);
  const iso = (d: number, minute: number) => localTime(date(d), minute, tz).toISOString();

  const shop = { name: SHOP, slug: opts.slug ?? 'sharma-general-store', shopName: 'Main counter', ownerName: 'Rajesh Sharma' };
  const { session: owner, shopId } = opts.owner
    ? await provisioned(app, await provisionSample(opts.owner, { ...shop, businessType: 'kirana' }))
    : await createTenant(app, { kind: 'sample', ...shop, identity: { provider: 'password', subject: randomUUID() } });
  const since = iso(-120, 0);
  const as = async (memberId: string) => (await openSession(app, owner.tenantId, memberId)) as Session;
  const manager = await as(await addMember(app, owner, { name: 'Anil Verma', role: 'manager' }));
  const staff: Session[] = [];
  for (const name of ['Pooja Yadav', 'Imran Khan', 'Kavita Rao']) staff.push(await as(await addMember(app, owner, { name, role: 'staff' })));

  const cmd = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  for (const [i, s] of [manager, ...staff].entries()) {
    await cmd(owner, 'staff.create', {
      name: ['Anil Verma', 'Pooja Yadav', 'Imran Khan', 'Kavita Rao'][i],
      memberId: s.memberId,
      shopId,
      dailyWageMinor: i === 0 ? 90_000 : 60_000,
      joinedOn: date(-400 + 30 * i),
      effectiveFrom: since,
    });
  }

  const suppliers = new Map<string, string>();
  for (const name of SUPPLIERS) suppliers.set(name, (await cmd(owner, 'supplier.create', { name, effectiveFrom: since })).supplierId as string);
  const items = new Map<string, string>();
  const sku = new Map(CATALOGUE.map((s) => [s[0], s]));
  for (const [name, unit, category, price] of CATALOGUE) {
    const itemId = (await cmd(owner, 'item.create', { name, unit, category, effectiveFrom: since })).itemId as string;
    items.set(name, itemId);
    await cmd(owner, 'price.set', { itemId, amountMinor: price, effectiveFrom: since });
  }
  const customers = new Map<string, string>();
  for (const name of [...OVERDUE, NEAR_MISS, ...OTHERS]) {
    const phone = REACHABLE.get(name);
    const customerId = (await cmd(owner, 'customer.create', { name, effectiveFrom: since, ...(phone ? { phone } : {}) })).customerId as string;
    customers.set(name, customerId);
    if (phone) await cmd(owner, 'consent.record', { customerId, channel: 'whatsapp', purpose: 'service', granted: true, source: 'in_person', noticeVersion: 'v1' });
  }

  const id = (m: Map<string, string>, k: string) => m.get(k) as string;
  const onHand = new Map<string, number>(); // milli-units, by item name: what the books hold, tracked as we write
  const upiByDay = new Map<number, number>();
  const counts = { sales: 0, purchases: 0, payments: 0, settlements: 0, stockCounts: 0 };
  const billSeq = [1000, 2000, 3000];
  const milli = (units: number) => Math.round(units * 1000);
  const add = (name: string, q: number) => onHand.set(name, (onHand.get(name) ?? 0) + q);

  const costOn = (name: string, d: number) => {
    const s = sku.get(name) as Sku;
    if (d >= CREEP_FROM && name === 'Butter 100 g' && planted('price_creep')) return 6000;
    if (d >= CREEP_FROM && name === 'Cream biscuits 100 g') return 2040;
    return s[4];
  };
  const bill = async (supplier: 0 | 1 | 2, d: number, lines: { name: string; qtyMilli: number; expiresOn: string }[]) => {
    if (!lines.length) return;
    billSeq[supplier] = (billSeq[supplier] as number) + 1;
    await recordPurchase(app, manager, {
      supplierId: id(suppliers, SUPPLIERS[supplier]),
      billNo: `${BILL_PREFIX[supplier]}-${billSeq[supplier]}`,
      billDate: date(d),
      receivedAt: iso(d, 450),
      lines: lines.map((l) => ({ itemId: id(items, l.name), qtyMilli: l.qtyMilli, unitCostMinor: costOn(l.name, d), expiresOn: l.expiresOn })),
    });
    for (const l of lines) add(l.name, l.qtyMilli);
    counts.purchases++;
  };
  const regular = CATALOGUE.filter((s) => s[6] > 0);
  const restock = async (supplier: 0 | 1 | 2, d: number, opening: boolean) => {
    const lines = [];
    for (const [name, , , , , sup, demand, multiple] of regular) {
      if (sup !== supplier) continue;
      const have = onHand.get(name) ?? 0;
      const forced = !opening && (name === 'Butter 100 g' || name === 'Cream biscuits 100 g'); // on every bill: price observations
      if (!opening && !forced && have >= milli(demand * 5)) continue;
      let want = Math.max(0, milli(demand * 9) - have);
      want = Math.ceil(want / milli(multiple)) * milli(multiple);
      if (forced) want = Math.max(want, milli(multiple));
      if (want > 0) lines.push({ name, qtyMilli: want, expiresOn: date(d + SHELF_LIFE_DAYS) });
    }
    await bill(supplier, d, lines);
  };
  const sell = async (d: number, minute: number, seller: Session, lines: [string, number][], pay: 'cash' | 'upi' | 'credit', customer?: string, strict = false) => {
    const kept = lines.filter(([name, q]) => (onHand.get(name) ?? 0) >= q);
    if (strict && kept.length !== lines.length) throw new Error(`seed: a planned sale on day ${d} lacks stock`);
    if (!kept.length) return 0;
    const total = kept.reduce((a, [name, q]) => a + lineAmount(q, (sku.get(name) as Sku)[3]), 0);
    await recordSale(app, seller, {
      shopId,
      soldAt: iso(d, minute),
      ...(customer ? { customerId: id(customers, customer) } : {}),
      lines: kept.map(([name, q]) => ({ itemId: id(items, name), qtyMilli: q })),
      payments: pay === 'credit' ? [] : [{ method: pay, amountMinor: total }],
    });
    for (const [name, q] of kept) add(name, -q);
    if (pay === 'upi') upiByDay.set(d, (upiByDay.get(d) ?? 0) + total);
    counts.sales++;
    return total;
  };
  const repay = async (d: number, minute: number, customer: string, amount: number, method: 'cash' | 'upi') => {
    await recordPayment(app, staff[0] as Session, {
      direction: 'in',
      customerId: id(customers, customer),
      method,
      amountMinor: amount,
      paidAt: iso(d, minute),
    });
    if (method === 'upi') upiByDay.set(d, (upiByDay.get(d) ?? 0) + amount);
    counts.payments++;
  };

  // Explicit schedules: the planted lot and its fast-moving control, the overdue customers and the near miss.
  const cheeseSales = new Set([-70, -58, -46, -34, -22, -15, -9, -4]); // 8 of the 24 sell: 16 left, 4 in the last 28 days
  const paneerLots = new Set([-30, -23, -16, -9, -2]); // 7 a week, 8-day shelf life, 1 sold a day: sells before it expires
  // On Mehta's bill days, after the 07:30 delivery (which leaves at least 5 days' demand of each staple on hand).
  const explicitSales = new Map<number, [string, [string, number][]]>([
    [-61, ['Ramesh K.', [['Toor dal 1 kg', milli(8)]]]], // ₹1,200, due day -31
    [-47, ['Sunita P.', [['Sugar 1 kg', milli(5)], ['Sunflower oil 1 l', milli(2)]]]], // ₹240 + ₹410, due day -17
    [-40, ['Mohan L.', [['Basmati rice 1 kg', milli(2)], ['Ghee 500 ml', milli(1)]]]], // ₹250 + ₹250, due day -10
    [-54, [NEAR_MISS, [['Mustard oil 1 l', milli(3)]]]], // ₹540, of which ₹500 repaid on day -40
  ]);
  const repayments = new Map<number, [number, string, number, 'cash' | 'upi'][]>(); // day → (minute, customer, amount, method)
  const later = (d: number, entry: [number, string, number, 'cash' | 'upi']) => repayments.set(d, [...(repayments.get(d) ?? []), entry]);
  later(-40, [1100, NEAR_MISS, 50_000, 'cash']);

  const popular = regular.flatMap((s) => Array(Math.max(1, Math.round(s[6] * 2))).fill(s[0]) as string[]);
  for (let d = -95; d <= 0; d++) {
    if (d === -95) for (const s of [0, 1, 2] as const) await restock(s, d, true);
    for (const s of [0, 1, 2] as const) if (d >= -90 && d <= -1 && (d + 90 - s) % 7 === 0) await restock(s, d, false);
    if (d === -80) await bill(0, d, [{ name: 'Cheese slices 200 g', qtyMilli: milli(24), expiresOn: date(planted('expiry') ? 5 : 30) }]);
    if (paneerLots.has(d)) await bill(0, d, [{ name: 'Paneer 200 g', qtyMilli: milli(7), expiresOn: date(d + 8) }]);
    if (d > -90 - 1 && d <= -1) {
      // The day's counter: 30–45 bills between 08:00 and 21:00, across the three counter staff.
      const n = 30 + Math.floor(random() * 16);
      const minutes = Array.from({ length: n }, () => 480 + Math.floor(random() * 780)).sort((a, b) => a - b);
      const planned = explicitSales.get(d);
      for (const [k, minute] of minutes.entries()) {
        const seller = staff[Math.floor((minute - 480) / 260)] as Session;
        if (k === 0 && planned && (planted('overdue_credit') || planned[0] === NEAR_MISS)) {
          await sell(d, minute - 1, seller, planned[1], 'credit', planned[0], true);
        }
        if (k === 0 && cheeseSales.has(d)) await sell(d, minute - 1, seller, [['Cheese slices 200 g', milli(1)]], 'cash', undefined, true);
        if (k === 0 && d >= -30) await sell(d, minute - 1, seller, [['Paneer 200 g', milli(1)]], 'upi', undefined, true);
        const lines: [string, number][] = [];
        for (let l = 1 + Math.floor(random() * 4); l > 0; l--) {
          const name = popular[Math.floor(random() * popular.length)] as string;
          const unit = (sku.get(name) as Sku)[1];
          lines.push([name, unit === 'kg' ? [500, 1000, 2000][Math.floor(random() * 3)] as number : milli(1 + Math.floor(random() * 2))]);
        }
        const r = random();
        if (r < 0.05) {
          const customer = OTHERS[Math.floor(random() * OTHERS.length)] as string;
          const total = await sell(d, minute, seller, lines, 'credit', customer);
          const back = d + 7 + Math.floor(random() * 14);
          if (total > 0 && back <= -1) later(back, [1150 + Math.floor(random() * 60), customer, total, random() < 0.5 ? 'cash' : 'upi']);
        } else {
          await sell(d, minute, seller, lines, r < 0.6 ? 'cash' : 'upi');
        }
      }
      for (const [minute, customer, amount, method] of repayments.get(d) ?? []) await repay(d, minute, customer, amount, method);
    }
    if (d === -1) {
      // Yesterday's closing count (21:15): two SKUs short (the plant), two low-value gaps and three exact (controls).
      const gaps: [string, number][] = [
        ['Glucose biscuits 70 g', planted('shrinkage') ? 6 : 0],
        ['Bath soap 100 g', planted('shrinkage') ? 4 : 0],
        ['Matchbox pack of 10', 1],
        ['Shampoo sachet 6 ml', 3],
        ['Tea leaves 250 g', 0],
        ['Toor dal 1 kg', 0],
        ['Potato chips 50 g', 0],
      ];
      for (const [name, missing] of gaps) {
        const counted = (onHand.get(name) ?? 0) - milli(missing);
        await countStock(app, manager, { itemId: id(items, name), countedQtyMilli: counted, countedAt: iso(d, 1275) });
        onHand.set(name, counted);
        counts.stockCounts++;
      }
    }
    if (d >= -89) {
      // Yesterday's UPI takings settle this morning; one day comes in short (the plant).
      const amount = upiByDay.get(d - 1) ?? 0;
      const short = d - 1 === SHORT_DAY && planted('short_settlement') ? SHORT_MINOR : 0;
      if (amount - short > 0) {
        await recordSettlement(app, owner, {
          channel: 'upi',
          businessDate: date(d - 1),
          amountMinor: amount - short,
          reference: `UPI-STL-${date(d - 1).replaceAll('-', '')}`,
          receivedOn: date(d),
        });
        counts.settlements++;
      }
    }
  }
  await (await import('./kirana-history.ts')).seedKiranaHistory(app, { owner, manager, items }); // decisions and Keeper's notes
  await seedSurplus(app, owner, items);
  return { tenantId: owner.tenantId, asOf, shopId, owner, manager, staff, items, suppliers, customers, counts };
}

// Surplus for good: two recipients, simulated like every recipient, listed by the owner through the app's path;
// and one gift already made, so the impact tally is not empty: what is left of an older lot of a food item (a cell of
// surplus.lot), to the food bank, proposed and approved by the owner as any surplus.give is. The item keeps the stock of
// its later lots, so its on-hand stays above zero. The lot is the first, by item name, whose remainder is above zero and
// below the item's stock on hand, among the food items no planted finding or control names (Suji, as the seed stands;
// it is in no answer). The planted Cheese lot stays
// whole: its expiry finding is what "Offer it" shows on Home. The gift is stamped now() (the listing's trigger), after
// every seeded day.
const SURPLUS_SKIP = [
  'Cheese slices 200 g',
  'Paneer 200 g',
  'Glucose biscuits 70 g',
  'Bath soap 100 g',
  'Butter 100 g',
  'Cream biscuits 100 g',
  'Matchbox pack of 10',
  'Shampoo sachet 6 ml',
  'Tea leaves 250 g',
  'Toor dal 1 kg',
  'Potato chips 50 g',
];

const SURPLUS_FOOD = ['staples', 'biscuits', 'snacks', 'breakfast', 'dairy', 'oils', 'loose', 'spreads'];

async function seedSurplus(app: pg.Pool, owner: Session, items: Map<string, string>): Promise<void> {
  const bank = await addRecipient(app, owner, { name: 'Annapurna Food Bank', kind: 'food_bank', area: 'Sector Four market' });
  await addRecipient(app, owner, { name: 'Gaushala Seva Trust', kind: 'animal_shelter', area: 'Old Town' });
  const as = { kind: 'member', session: owner } as const;
  const skip = SURPLUS_SKIP.map((n) => items.get(n) as string);
  const lots = await withTx(app, as, async (c) =>
    (
      await c.query<{ id: string; item_id: string }>(
        `with live as (
           select pl.* from books.purchase_line pl join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
            where pl.expires_on is not null and p.reverses_id is null
              and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id)
         ),
         held as (select item_id, sum(qty_milli) as qty from books.stock_move group by item_id),
         lots as (
           select l.id, l.item_id, l.expires_on, h.qty as on_hand,
                  greatest(0, least(l.qty_milli, h.qty - coalesce((select sum(o.qty_milli) from live o
                                                                     where o.item_id = l.item_id and (o.expires_on, o.id) > (l.expires_on, l.id)), 0))) as lot_left
             from live l join held h on h.item_id = l.item_id
            where l.item_id <> all($1::uuid[])
         )
         select id::text, item_id::text from lots where lot_left > 0 and lot_left < on_hand order by expires_on, id`,
        [skip],
      )
    ).rows,
  );
  // Food only: a food bank's gift.
  const food = new Set(CATALOGUE.filter((s) => SURPLUS_FOOD.includes(s[2])).map((s) => s[0]));
  const names = new Map([...items].map(([name, itemId]) => [itemId, name]));
  const lot = lots.filter((l) => food.has(names.get(l.item_id) ?? '')).sort((a, b) => ((names.get(a.item_id) ?? '') < (names.get(b.item_id) ?? '') ? -1 : (names.get(a.item_id) ?? '') > (names.get(b.item_id) ?? '') ? 1 : 0))[0];
  if (!lot) throw new Error('seed: no lot to give part of');
  const left = await mintSnapshot(app, as, 'surplus.lot', { lot_id: lot.id });
  const held = await mintSnapshot(app, as, 'stock.on_hand', { item_id: lot.item_id });
  const listed = await mintSnapshot(app, as, 'surplus.recipients', {});
  const qty = left.rows[0]?.left;
  const row = listed.rows.findIndex((r) => r.id?.kind === 'text' && r.id.txt === bank);
  if (qty?.kind !== 'quantity' || row < 0) throw new Error('seed: the surplus gift has no stock or recipient');
  const leftRef = { snapshotId: left.id, row: 0, col: 'left' };
  const draftId = await proposeDraft(
    app,
    { session: owner },
    {
      command: 'surplus.give',
      payload: { lotId: lot.id, itemId: lot.item_id, qtyMilli: Number(qty.num), recipientId: bank },
      // The lot's item and remainder, the item's stock now, and the recipient's id and name: the card shows each.
      basedOn: [
        { snapshotId: left.id, row: 0, col: 'item' },
        leftRef,
        { snapshotId: held.id, row: 0, col: 'on_hand' },
        { snapshotId: listed.id, row, col: 'id' },
        { snapshotId: listed.id, row, col: 'name' },
      ],
      payloadRefs: { qtyMilli: leftRef },
    },
  );
  const done = await decide(app, owner, draftId, 'approved');
  if (done.status !== 'executed') throw new Error(`seed: the surplus gift did not run (${done.status})`);
}
