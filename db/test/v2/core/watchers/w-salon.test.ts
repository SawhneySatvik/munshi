// W-BKG, W-PKG and W-CUS: the Bookings watchers (idle_stylist, stylist_absent_booked, unbilled_booking, hold_pressure,
// keyed by `bookings`), package_expiry (`packages`) and regulars_lapsing (`campaigns`) over a planted salon
// (salon-plant.ts, whose header works the key out by hand). The expected rows below are that key, not read back from
// the code under test. With the three capabilities off, a run reads none of those watchers. The fixture waits for two
// public holds to lapse (HOLD_MINUTES) before it places the third. Red-proofs: test/v2/sabotage/core-ai.ts.
import { localTime, runWatchers } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { findings, plusDays, runQueries, type Seen, setCapability } from './plant.ts';
import { plantSalon, type Salon, TZ } from './salon-plant.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Salon;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await plantSalon(app, db.as('munshi_public'));
  await db.sabotage();
}, 300_000);
afterAll(() => db.close());

const KINDS = ['idle_stylist', 'stylist_absent_booked', 'unbilled_booking', 'hold_pressure', 'package_expiry', 'regulars_lapsing'];
const QUERIES = KINDS.map((k) => `watch.${k}`);
const kinds = (list: string[]) => `kind in (${list.map((k) => `'${k}'`).join(', ')})`;
// Three minutes on: every hold placed has lapsed, none more than an hour ago.
const instant = () => new Date(Date.now() + 3 * 60_000);
const day = (n: number) => plusDays(s.today, n);
let watched = false;
const watch = async () => {
  if (!watched) await runWatchers(jobs, s.tenantId, s.today, instant());
  watched = true;
  return findings(jobs, s.tenantId);
};
const only = (found: Seen[], kind: string) => found.filter((f) => f.kind === kind);

// First in the file (and alone in a fresh database): with all three capabilities off, the run reads none of them.
it('with bookings, packages and campaigns off, a run reads none of their watchers and the salon gets none of their findings', async () => {
  for (const cap of ['bookings', 'packages', 'campaigns']) await setCapability(app, s.owner, cap, false);
  const off = await runWatchers(jobs, s.tenantId, s.today, instant());
  expect(await findings(jobs, s.tenantId, kinds(KINDS))).toEqual([]);
  const read = await runQueries(jobs, s.tenantId, off.runId);
  expect(read).toContain('watch.overdue_credit'); // the run ran the salon's other watchers
  expect(read.filter((q) => QUERIES.includes(q))).toEqual([]);
  // Back on, prerequisites first (capability_guard reads switch rows).
  for (const cap of ['counter', 'packages', 'messaging', 'campaigns', 'bookings']) await setCapability(app, s.owner, cap, true);
});

it('idle_stylist: Bilal, 1,320 of 1,440 rostered minutes unbooked over three days at ₹600 a service, nothing else', async () => {
  expect(only(await watch(), 'idle_stylist')).toEqual([
    {
      kind: 'idle_stylist',
      key: `idle_stylist:${s.stylists.bilal}:${s.shopId}`,
      status: 'open',
      shop: s.shopId,
      severity: 'critical',
      v: {
        staff_id: s.stylists.bilal,
        shop_id: s.shopId,
        from_day: s.today,
        rostered_minutes: 1440,
        booked_minutes: 120,
        idle_minutes: 1320,
        avg_price: 60_000,
        idle_value: 1_320_000,
      },
    },
  ]);
});

it('stylist_absent_booked: Asha marked absent on day 1 with a haircut, Chitra on leave on day 2 with a facial, nothing else', async () => {
  expect(only(await watch(), 'stylist_absent_booked')).toEqual(
    [
      {
        kind: 'stylist_absent_booked',
        key: `stylist_absent_booked:${s.stylists.asha}:${day(1)}`,
        status: 'open',
        shop: s.shopId,
        severity: 'medium',
        v: { staff_id: s.stylists.asha, shop_id: s.shopId, day: day(1), bookings: 1, value: 50_000 },
      },
      {
        kind: 'stylist_absent_booked',
        key: `stylist_absent_booked:${s.stylists.chitra}:${day(2)}`,
        status: 'open',
        shop: s.shopId,
        severity: 'medium',
        v: { staff_id: s.stylists.chitra, shop_id: s.shopId, day: day(2), bookings: 1, value: 80_000 },
      },
    ].sort((a, b) => a.key.localeCompare(b.key)),
  );
});

it("unbilled_booking: day −1's haircut, still confirmed with no sale; the billed and the no-show are not", async () => {
  const starts = localTime(day(-1), 600, TZ).toISOString();
  expect(only(await watch(), 'unbilled_booking')).toEqual([
    {
      kind: 'unbilled_booking',
      key: `unbilled_booking:${s.bookings.unbilled}`,
      status: 'open',
      shop: s.shopId,
      severity: 'medium',
      v: { booking_id: s.bookings.unbilled, shop_id: s.shopId, staff_id: s.stylists.bilal, service_item_id: s.services.haircut, starts_at: starts, price: 50_000 },
    },
  ]);
});

it("hold_pressure: three of the public's holds on Bilal's day 1 lapsed in the hour (₹1,500); Asha's two are under the threshold", async () => {
  expect(only(await watch(), 'hold_pressure')).toEqual([
    {
      kind: 'hold_pressure',
      key: `hold_pressure:${s.stylists.bilal}:${day(1)}`,
      status: 'open',
      shop: s.shopId,
      severity: 'medium',
      v: { staff_id: s.stylists.bilal, shop_id: s.shopId, day: day(1), holds: 3, held_value: 150_000 },
    },
  ]);
});

it('package_expiry: the pack lapsing on day 10 and the one lapsed on day −3, each with 5 facials (₹2,000) left; not the one lapsing on day 20', async () => {
  const row = (holding: string, expiresIn: number) => ({
    kind: 'package_expiry',
    key: `package_expiry:${holding}`,
    status: 'open',
    shop: null,
    severity: 'high',
    v: { holding_id: holding, customer_id: s.customers.tara, expires_on: day(expiresIn), days_left: expiresIn, value_left: 200_000, sessions_left: 5 },
  });
  expect(only(await watch(), 'package_expiry')).toEqual([row(s.holdings.soon, 10), row(s.holdings.lapsed, -3)].sort((a, b) => a.key.localeCompare(b.key)));
});

it('regulars_lapsing: Rekha, 3 visits, the last on day −76, ₹1,500 over 60 days (₹750 a month); not Sunil (day −59) nor Tara (2 visits and her packs)', async () => {
  expect(only(await watch(), 'regulars_lapsing')).toEqual([
    {
      kind: 'regulars_lapsing',
      key: `regulars_lapsing:${s.customers.rekha}`,
      status: 'open',
      shop: null,
      severity: 'medium',
      v: { customer_id: s.customers.rekha, visits: 3, first_visit_on: day(-135), last_visit_on: day(-76), spend: 150_000, monthly_spend: 75_000 },
    },
  ]);
});

it('the salon has no finding but the planted ones', async () => {
  expect((await watch()).map((f) => f.kind).sort()).toEqual(
    ['hold_pressure', 'idle_stylist', 'package_expiry', 'package_expiry', 'regulars_lapsing', 'stylist_absent_booked', 'stylist_absent_booked', 'unbilled_booking'],
  );
});
