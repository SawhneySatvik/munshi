// Builds "Bansal Super Mart (sample)", the second demo shop, through packages/core's real paths (sign-up,
// member additions, direct commands), so every book row went through the guard and the audit chain. Synthetic data
// only; suppliers are simulated; UPI is recorded, never processed. 120 SKUs (the kirana's 60 and a larger pack of each),
// 30 days of counter sales (18 of every 24 bills on UPI), udhaar customers, three simulated suppliers' bills and the
// day's UPI payouts. The planted situations and their hand-worked key are db/seed/bansal.answers.json. Every sale
// follows a fixed rotation (no random picks), so each day's takings, and so the key, are worked out from this plan alone.
// Deterministic for a given as_of. Days below are offsets from as_of (day 0, "this morning": no sales yet).
import {
  addDays,
  addMember,
  businessDate,
  type Capability,
  countStock,
  createTenant,
  localTime,
  openSession,
  recordPurchase,
  recordSale,
  recordSettlement,
  runCommand,
  type Session,
  switchCapability,
  withTx,
} from '@munshi/core';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { provisioned, provisionSample } from './provision.ts';
import { CATALOGUE, type Sku } from './kirana.ts';

export const BANSAL = 'Bansal Super Mart (sample)';
export const BANSAL_SLUG = 'bansal';
const TIME_ZONE = 'Asia/Kolkata';
const SUPPLIERS = ['North Star Wholesale (simulated)', 'Daily Basket Supply (simulated)', 'Cityline Distributors (simulated)'] as const;
const OWNER = 'Aarav Bansal (sample)';
const MANAGER = 'Nisha Mehta (sample)';
const STAFF = ['Kabir Rao (sample)', 'Mira Khan (sample)'];
const OVERDUE = 'Rehan S. (sample)';
const LAPSED = 'Tara V. (sample)';
const CURRENT = ['Dev A. (sample)', 'Ira B. (sample)', 'Pia D. (sample)'];
const REPAID = 'Neel C. (sample)';
export const BANSAL_ORDER_CODE = 'ORD-BNSL1';

export const BANSAL_DAYS = 30; // counter days -30 … -1
export const BILLS_A_DAY = 24;
export const UPI_BILL = (n: number) => n % 10 < 7; // 18 of a day's 24 bills
const OPENING_DAY = -110;
const OPENING_UNITS = 45;
const GAP_INDEX = 0; // Glucose biscuits 70 g: counted down to 1 on day -1
const DEAD_INDEX = 119; // the last larger pack: bought, never sold
const OVERDUE_DAY = -75; // the overdue udhaar's day (due 30 days later)
export const SHORT_DAY = -6;
export const SHORT_MINOR = 124_000; // ₹1,240
export const MISSING_DAY = -3;

// The kirana catalogue's 60 SKUs, and a larger pack of each (loose goods: a 5 kg sack) at a bulk price.
export const BANSAL_CATALOGUE: Sku[] = [
  ...CATALOGUE,
  ...CATALOGUE.map(([name, unit, category, price, cost, supplier, demand, multiple]): Sku => [
    unit === 'kg' ? `${name.replace(' (loose)', '')} sack 5 kg` : `${name} (twin pack)`,
    unit === 'kg' ? 'pack' : unit,
    category,
    Math.round((price * (unit === 'kg' ? 5 : 2) * 0.95) / 100) * 100,
    Math.round(cost * (unit === 'kg' ? 5 : 2) * 0.9),
    supplier,
    demand,
    multiple,
  ]),
];
// The counter's rotation: every SKU but the dead one, in catalogue order; bill k of the window (k = (day + 30) × 24 +
// n) sells one unit of ROTATION[k mod 119].
export const ROTATION = BANSAL_CATALOGUE.filter((_, i) => i !== DEAD_INDEX);

export type BansalSeed = {
  tenantId: string;
  asOf: string;
  shopId: string;
  seededAt: Date; // just before the order request arrived (the database stamps its arrival now)
  owner: Session;
  manager: Session;
  staff: Session[];
  items: Map<string, string>;
  suppliers: Map<string, string>;
  customers: Map<string, string>;
  capabilities: Record<'campaigns' | 'loyalty', 'switched on' | 'refused'>;
  counts: { sales: number; upiSales: number; purchases: number; settlements: number; stockCounts: number };
};

// `owner`: as seedKirana's, the operator's provisioning on a hosted database.
export async function seedBansal(app: pg.Pool, opts: { asOf?: string; slug?: string; owner?: pg.ClientBase } = {}): Promise<BansalSeed> {
  const asOf = opts.asOf ?? businessDate(new Date(), TIME_ZONE);
  const day = (offset: number) => addDays(asOf, offset);
  const iso = (offset: number, minute: number) => localTime(day(offset), minute, TIME_ZONE).toISOString();
  const since = iso(-120, 0);

  const shop = { name: BANSAL, slug: opts.slug ?? BANSAL_SLUG, businessType: 'kirana' as const, shopName: 'Bansal Super Mart', ownerName: OWNER, timeZone: TIME_ZONE };
  const { session: owner, shopId } = opts.owner
    ? await provisioned(app, await provisionSample(opts.owner, shop))
    : await createTenant(app, { kind: 'sample', ...shop, identity: { provider: 'password', subject: randomUUID() } });
  await withTx(app, { kind: 'member', session: owner }, (c) =>
    c.query("update ops.shop set area = 'Sector 62, Noida (sample)', address = 'Plot 12, Sample Market, Sector 62, Noida, Uttar Pradesh (sample)' where id = $1", [
      shopId,
    ]),
  );
  // Campaigns and loyalty, if the kirana's switches admit them (capability_guard: campaigns needs messaging, loyalty the
  // counter, both in the pack). The result is kept; the key's lapsed-regular row holds only while campaigns is on.
  const capabilities = {} as BansalSeed['capabilities'];
  for (const capability of ['campaigns', 'loyalty'] as const satisfies readonly Capability[]) {
    capabilities[capability] = await switchCapability(app, owner, capability, true).then(
      () => 'switched on' as const,
      (err: { code?: string }) => {
        if (err.code === 'MS019') return 'refused' as const;
        throw err;
      },
    );
  }

  const as = async (memberId: string) => (await openSession(app, owner.tenantId, memberId)) as Session;
  const manager = await as(await addMember(app, owner, { name: MANAGER, role: 'manager' }));
  const staff: Session[] = [];
  for (const name of STAFF) staff.push(await as(await addMember(app, owner, { name, role: 'staff' })));
  const cmd = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  for (const [i, s] of [manager, ...staff].entries()) {
    await cmd(owner, 'staff.create', {
      name: [MANAGER, ...STAFF][i],
      memberId: s.memberId,
      shopId,
      dailyWageMinor: i === 0 ? 90_000 : 60_000,
      joinedOn: day(-400 + 30 * i),
      effectiveFrom: since,
    });
  }

  const suppliers = new Map<string, string>();
  for (const name of SUPPLIERS) suppliers.set(name, (await cmd(owner, 'supplier.create', { name, effectiveFrom: since })).supplierId as string);
  const items = new Map<string, string>();
  for (const [name, unit, category, price] of BANSAL_CATALOGUE) {
    const itemId = (await cmd(owner, 'item.create', { name, unit, category, effectiveFrom: since })).itemId as string;
    items.set(name, itemId);
    await cmd(owner, 'price.set', { itemId, amountMinor: price, effectiveFrom: since });
  }
  const customers = new Map<string, string>();
  for (const name of [OVERDUE, LAPSED, ...CURRENT, REPAID]) {
    // The lapsed regular said yes to offers on WhatsApp, so a campaign to regulars who stopped coming reaches someone.
    const phone = name === LAPSED ? { phone: '+919800000203' } : {}; // synthetic
    const customerId = (await cmd(owner, 'customer.create', { name, effectiveFrom: since, ...phone })).customerId as string;
    customers.set(name, customerId);
    if (name === LAPSED) await cmd(owner, 'consent.record', { customerId, channel: 'whatsapp', purpose: 'marketing', granted: true, source: 'in_person', noticeVersion: 'v1' });
  }

  const id = (m: Map<string, string>, k: string) => m.get(k) as string;
  const counts = { sales: 0, upiSales: 0, purchases: 0, settlements: 0, stockCounts: 0 };
  const upiByDay = new Map<number, number>();

  const bill = async (supplier: 0 | 1 | 2, d: number, rows: Sku[], units: number) => {
    counts.purchases++;
    await recordPurchase(app, manager, {
      supplierId: id(suppliers, SUPPLIERS[supplier]),
      billNo: `BS${supplier + 1}-${1000 + counts.purchases}`,
      billDate: day(d),
      receivedAt: iso(d, 450),
      lines: rows.map((s) => ({ itemId: id(items, s[0]), qtyMilli: units * 1000, unitCostMinor: s[4], expiresOn: day(d + 365) })),
    });
  };
  const sell = async (d: number, minute: number, seller: Session, s: Sku, pay: 'cash' | 'upi' | 'credit', customer?: string) => {
    await recordSale(app, seller, {
      shopId,
      soldAt: iso(d, minute),
      ...(customer ? { customerId: id(customers, customer) } : {}),
      lines: [{ itemId: id(items, s[0]), qtyMilli: 1000 }],
      payments: pay === 'credit' ? [] : [{ method: pay, amountMinor: s[3] }],
    });
    if (pay === 'upi') {
      upiByDay.set(d, (upiByDay.get(d) ?? 0) + s[3]);
      counts.upiSales++;
    }
    counts.sales++;
  };
  const at = (index: number) => BANSAL_CATALOGUE[index] as Sku;

  // Opening stock from each simulated supplier, and one more lot of the SKU that will never sell.
  for (const s of [0, 1, 2] as const) await bill(s, OPENING_DAY, BANSAL_CATALOGUE.filter((k) => k[5] === s), OPENING_UNITS);
  await bill(at(DEAD_INDEX)[5], -50, [at(DEAD_INDEX)], 20);

  // A regular who stopped coming (three UPI visits, the last on day -70); udhaar: one given on day -75 and never repaid
  // (due day -45), one given on day -40 and repaid in cash on day -15, and three current ones still within their term.
  for (const d of [-100, -85, -70]) await sell(d, 600, staff[1] as Session, at(21), 'upi', LAPSED);
  await sell(OVERDUE_DAY, 610, staff[0] as Session, at(20), 'credit', OVERDUE);
  await sell(-40, 615, staff[0] as Session, at(23), 'credit', REPAID);
  await runCommand(app, staff[0] as Session, 'payment.record', {
    direction: 'in',
    customerId: id(customers, REPAID),
    method: 'cash',
    amountMinor: at(23)[3],
    paidAt: iso(-15, 1150),
  });
  for (const [i, name] of CURRENT.entries()) await sell(-20 + 7 * i, 620, staff[1] as Session, at(24 + i), 'credit', name);

  // The counter: 24 bills a day between 08:00 and 18:44, one unit each, the rotation's next SKU.
  for (let d = -BANSAL_DAYS; d <= -1; d++) {
    for (let n = 0; n < BILLS_A_DAY; n++) {
      const k = (d + BANSAL_DAYS) * BILLS_A_DAY + n;
      await sell(d, 480 + n * 28, staff[n % 2] as Session, ROTATION[k % ROTATION.length] as Sku, UPI_BILL(n) ? 'upi' : 'cash');
    }
  }

  // Yesterday's closing count (21:15): the shelf gap. The books hold 38 Glucose biscuits (45 bought, 7 sold); 1 is there.
  await countStock(app, manager, { itemId: id(items, at(GAP_INDEX)[0]), countedQtyMilli: 1000, countedAt: iso(-1, 1275) });
  counts.stockCounts++;

  // The day's UPI takings settle the next morning, recorded by the owner: one day comes in ₹1,240 short and one day's
  // payout never arrives (both planted). Yesterday's arrives this morning, not yet recorded.
  for (let d = -BANSAL_DAYS; d <= -2; d++) {
    const amount = upiByDay.get(d) ?? 0;
    if (!amount || d === MISSING_DAY) continue;
    await recordSettlement(app, owner, {
      channel: 'upi',
      businessDate: day(d),
      amountMinor: amount - (d === SHORT_DAY ? SHORT_MINOR : 0),
      reference: `BANSAL-UPI-${day(d).replaceAll('-', '')}`,
      receivedOn: day(d + 1),
    });
    counts.settlements++;
  }

  // A WhatsApp order request left waiting: an ops intake row, not a book. The database stamps its arrival now, so the
  // watcher sees it once it has waited 30 minutes.
  const seededAt = new Date();
  await withTx(app, { kind: 'member', session: manager }, (c) =>
    c.query(
      `insert into ops.order_request (tenant_id, shop_id, code, channel, kind)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, 'whatsapp', 'goods')`,
      [shopId, BANSAL_ORDER_CODE],
    ),
  );
  return { tenantId: owner.tenantId, asOf, shopId, seededAt, owner, manager, staff, items, suppliers, customers, capabilities, counts };
}

// The sample statement for this seed (db/seed/merchants/bansal/settlement-<as_of>.csv; the app labels it "Sample
// statement"): our own synthetic, gateway-style CSV, never a real provider's format, worked out from the rotation. Each
// counter day's UPI takings settle the next day with no fee; day -6's payout is ₹1,240 short, as the books recorded it;
// day -3's payout, which the books lack, is on it (importing it records that day); yesterday's is ON_HOLD.
export function bansalStatement(asOf: string): string {
  const rupees = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
  const lines = ['settlement_date,txn_date,channel,gross_amount,fees,net_amount,utr,status'];
  for (let d = -BANSAL_DAYS; d <= -1; d++) {
    let upi = 0;
    for (let n = 0; n < BILLS_A_DAY; n++) {
      if (UPI_BILL(n)) upi += (ROTATION[((d + BANSAL_DAYS) * BILLS_A_DAY + n) % ROTATION.length] as Sku)[3];
    }
    const net = upi - (d === SHORT_DAY ? SHORT_MINOR : 0);
    const txn = addDays(asOf, d);
    lines.push(`${addDays(asOf, d + 1)},${txn},UPI,${rupees(net)},0.00,${rupees(net)},SAMPLE-UTR-${txn.replaceAll('-', '')},${d === -1 ? 'ON_HOLD' : 'SETTLED'}`);
  }
  return `${lines.join('\n')}\n`;
}
