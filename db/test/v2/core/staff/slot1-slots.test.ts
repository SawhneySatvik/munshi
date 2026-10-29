// SLOT1 (BLUEPRINT §8.8, §2.13) end to end: the free slots of a roster worked by hand here are the key's, each naming
// the roster row it comes from; the database accepts every one and refuses the grid step past each edge; every stored
// booking recomputes from the roster row it names plus the other bookings; a hold naming a row not in effect that day
// is refused. Leave and holidays remove slots, and their reversals give them back. Every read runs as munshi_public,
// the tightest grant: the site's GET runs this same read. Red-proofs: test/v2/sabotage/core-staff.ts.
import { randomUUID } from 'node:crypto';
import {
  addDays,
  bookAtDesk,
  calendarIn,
  freeSlots,
  localTime,
  offered,
  placeHold,
  runCommand,
  type Session,
  type ShiftRel,
  type Slot,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { asMember, monday, type Salon, salon, sha, type Stylist } from './salon.ts';

const TZ = 'Asia/Kolkata';
const D = monday(2); // the hand-worked day
const L = monday(4); // the leave and holiday day
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const at = (day: string, hhmm: string) => localTime(day, minutes(hhmm), TZ);

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let s: Salon;
const rows: Record<string, string> = {}; // roster rows by a name the key uses

const run = async (who: Session, name: string, input: unknown) => (await runCommand(app, who, name, input)) as Record<string, string>;
const pattern = async (name: string, who: Stylist, weekday: number, starts: string | null, ends: string | null, effectiveFrom: string, shopId = s.shopId) => {
  const off = starts === null;
  rows[name] = (
    await run(s.manager, 'shift.pattern.set', { staffId: s.stylists[who], shopId, weekday, effectiveFrom, ...(off ? { off } : { starts, ends }) })
  ).patternId as string;
};
const change = async (name: string, who: Stylist, day: string, starts: string, ends: string, shopId = s.shopId) => {
  rows[name] = (await run(s.manager, 'shift.change', { staffId: s.stylists[who], shopId, day, starts, ends })).changeId as string;
};
const slotsOf = (day: string, staffId?: string) =>
  freeSlots(pub, { kind: 'system', tenantId: s.tenantId }, { shopId: s.shopId, serviceItemId: s.serviceId, day, ...(staffId ? { staffId } : {}) });
const order = (a: Slot, b: Slot) => a.start.getTime() - b.start.getTime() || a.staffId.localeCompare(b.staffId);
const hold = (who: Stylist, day: string, hhmm: string, rel: ShiftRel, row: string) =>
  placeHold(pub, s.tenantId, {
    shopId: s.shopId,
    staffId: s.stylists[who],
    serviceItemId: s.serviceId,
    start: at(day, hhmm).toISOString(),
    shiftRel: rel,
    shiftId: rows[row] as string,
    ipHash: sha(randomUUID()),
    deviceHash: sha(randomUUID()),
  });

// A hold placed as the public role in a transaction that is then rolled back, after expiring lapsed holds as placeHold
// does: the database's own verdict on a slot (booking_flow's calendar check), leaving nothing behind.
async function tryHold(staffId: string, start: Date, rel: ShiftRel, shiftId: string): Promise<void> {
  const c = await pub.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [s.tenantId]);
    await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()`);
    await c.query(
      `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash,
                                shift_pattern_id, shift_change_id)
       select st.tenant_id, st.id, $1, $2, $3, tstzrange($4, $4::timestamptz + interval '45 minutes', '[)'), 'held', 'site', $5, $6, $7, $8, $9 from ops.site st`,
      [
        s.shopId,
        staffId,
        s.serviceId,
        start,
        Buffer.from(sha(randomUUID()), 'hex'),
        Buffer.from(sha(randomUUID()), 'hex'),
        Buffer.from(sha(randomUUID()), 'hex'),
        rel === 'books.shift_pattern' ? shiftId : null,
        rel === 'books.shift_change' ? shiftId : null,
      ],
    );
  } finally {
    await c.query('rollback');
    c.release();
  }
}

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  s = await salon(app, 'SLOT1');
  // Mondays at Kalkaji: 09:30–13:30 from 1 Jun, over the fixture's 09:00–20:00 from 1 Jan; a row from the day after D is
  // not yet in effect on D.
  await asMember(
    app,
    s.manager,
    `insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from)
     values ($1, $2, 1, '09:30', '13:30', false, '2026-06-01'), ($1, $2, 1, '08:00', '20:00', false, $3)`,
    [s.tenantId, s.shopId, addDays(D, 1)],
  );
  await pattern('asha.feb', 'asha', 1, '09:00', '12:00', '2026-02-01');
  await pattern('asha', 'asha', 1, '10:00', '14:00', '2026-03-01');
  await pattern('asha.later', 'asha', 1, '08:00', '18:00', addDays(D, 1));
  await pattern('ravi.pattern', 'ravi', 1, '09:00', '12:00', '2026-03-01');
  await change('ravi.early', 'ravi', D, '09:00', '10:00');
  await change('ravi', 'ravi', D, '11:10', '13:00');
  await pattern('meena', 'meena', 1, '09:30', '13:30', '2026-03-01');
  await run(s.manager, 'leave.record', { staffId: s.stylists.meena, kind: 'sick', firstDay: D, lastDay: D, halfDay: true });
  await pattern('dev.pattern', 'dev', 1, '10:00', '12:00', '2026-03-01', s.otherShopId);
  await change('dev', 'dev', D, '12:00', '13:30');
  await pattern('kiran', 'kiran', 1, null, null, '2026-03-01');
  // Asha's day: a live hold at 12:30, a desk booking at 11:00, and a hold at 10:00 that lapses (still stored as held).
  await hold('asha', D, '12:30', 'books.shift_pattern', 'asha');
  await bookAtDesk(app, s.manager, {
    shopId: s.shopId,
    staffId: s.stylists.asha,
    serviceItemId: s.serviceId,
    start: at(D, '11:00').toISOString(),
    shiftRel: 'books.shift_pattern',
    shiftId: rows.asha as string,
  });
  const lapsing = await hold('asha', D, '10:00', 'books.shift_pattern', 'asha');
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [lapsing.holdId]);
  await db.sabotage();
});
afterAll(() => db?.close());

// The key, worked by hand from the roster above: a 45-minute haircut on the clock's quarter hours; Monday's hours at
// Kalkaji on D are the 1 Jun row, 09:30–13:30.
// - Asha: her 1 Mar pattern, 10:00–14:00 (the 1 Feb one is older, the one from the day after D not yet in effect), cut to
//   10:00–13:30, starts 10:00 to 12:45. The desk booking 11:00–11:45 takes 10:30 to 11:30; the live hold 12:30–13:15
//   takes 12:00 to 12:45; the lapsed hold at 10:00 counts as free. Left: 10:00, 10:15, 11:45.
// - Ravi: the day's latest change, 11:10–13:00, wins over his pattern and his earlier change: 11:15 to 12:15.
// - Meena: half a day of sick leave clears the whole day, as booking_flow reads it. None.
// - Dev: his pattern is the other branch's, but the day's change brings him here 12:00–13:30: 12:00 to 12:45.
// - Kiran: off on Mondays. None.
const KEY: [Stylist, string, string, ShiftRel][] = [
  ['asha', '10:00', 'asha', 'books.shift_pattern'],
  ['asha', '10:15', 'asha', 'books.shift_pattern'],
  ['asha', '11:45', 'asha', 'books.shift_pattern'],
  ['ravi', '11:15', 'ravi', 'books.shift_change'],
  ['ravi', '11:30', 'ravi', 'books.shift_change'],
  ['ravi', '11:45', 'ravi', 'books.shift_change'],
  ['ravi', '12:00', 'ravi', 'books.shift_change'],
  ['ravi', '12:15', 'ravi', 'books.shift_change'],
  ['dev', '12:00', 'dev', 'books.shift_change'],
  ['dev', '12:15', 'dev', 'books.shift_change'],
  ['dev', '12:30', 'dev', 'books.shift_change'],
  ['dev', '12:45', 'dev', 'books.shift_change'],
];
// The grid step just past each window's edges, by hand: before the first start, and the first start that no longer fits.
const EDGES: [Stylist, string, string, ShiftRel][] = [
  ['asha', '09:45', 'asha', 'books.shift_pattern'],
  ['asha', '13:00', 'asha', 'books.shift_pattern'],
  ['ravi', '11:00', 'ravi', 'books.shift_change'],
  ['ravi', '12:30', 'ravi', 'books.shift_change'],
  ['dev', '11:45', 'dev', 'books.shift_change'],
  ['dev', '13:00', 'dev', 'books.shift_change'],
];

it('SLOT1 a hand-worked roster’s free slots are the key’s, each naming its roster row; the database accepts each and refuses the step past each edge; every booking recomputes from its own row; a row not in effect is refused', async () => {
  const want = KEY.map(([who, hhmm, row, rel]) => {
    const start = at(D, hhmm);
    return { staffId: s.stylists[who], start, end: new Date(start.getTime() + 45 * 60_000), shiftRel: rel, shiftId: rows[row] as string };
  }).sort(order);
  const got = await slotsOf(D);
  expect(got).toHaveLength(12);
  expect([...got].sort(order)).toEqual(want);
  expect(await slotsOf(D, s.stylists.asha)).toEqual(want.filter((x) => x.staffId === s.stylists.asha));

  for (const x of got) await expect(tryHold(x.staffId, x.start, x.shiftRel, x.shiftId), `${x.start.toISOString()}`).resolves.toBeUndefined();
  for (const [who, hhmm, row, rel] of EDGES) {
    await expect(tryHold(s.stylists[who], at(D, hhmm), rel, rows[row] as string), `${who} ${hhmm}`).rejects.toMatchObject({ code: 'MS015' });
  }

  // Each stored booking of the day, recomputed: the slots its stylist's row offers with the other bookings in place
  // include it, under the row it names. The lapsed hold is free in the read, so its slot is offered as it stands.
  const { rows: stored } = await db.admin.query<{ id: string; staff_id: string; from_at: Date; to_at: Date; pattern: string | null; change: string | null }>(
    `select id, staff_id::text, lower(during) as from_at, upper(during) as to_at, shift_pattern_id::text as pattern, shift_change_id::text as change
       from ops.booking where tenant_id = $1 and (lower(during) at time zone 'Asia/Kolkata')::date = $2::date order by lower(during)`,
    [s.tenantId, D],
  );
  expect(stored).toHaveLength(3);
  await withTx(pub, { kind: 'system', tenantId: s.tenantId }, async (c) => {
    const cal = await calendarIn(c, { shopId: s.shopId, serviceItemId: s.serviceId, day: D });
    const now = new Date();
    for (const b of stored) {
      expect([b.pattern, b.change]).toEqual([rows.asha, null]); // the key's row for Asha
      const others = { ...cal, busy: cal.busy.filter((x) => !(x.staffId === b.staff_id && x.from.getTime() === b.from_at.getTime())) };
      expect(offered(others, now)).toContainEqual({ staffId: b.staff_id, start: b.from_at, end: b.to_at, shiftRel: 'books.shift_pattern', shiftId: b.pattern });
    }
  });

  // Ravi's pattern fits 11:15–12:00, but his change governs D: a hold naming the pattern is refused by the database.
  await expect(hold('ravi', D, '11:15', 'books.shift_pattern', 'ravi.pattern')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
  await expect(hold('ravi', D, '11:15', 'books.shift_change', 'ravi.early')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
});

it('SLOT1 leave and holidays remove slots: a stylist’s leave (a half day too) clears their day, a holiday clears its branch’s or every branch’s day, and each reversal gives the slots back', async () => {
  const before = await slotsOf(L);
  const asha = before.filter((x) => x.staffId === s.stylists.asha);
  expect(asha.length).toBeGreaterThan(0);
  expect(before.length).toBeGreaterThan(asha.length); // Meena works L too: her leave was D's only

  const { leaveId } = await run(s.manager, 'leave.record', { staffId: s.stylists.asha, kind: 'paid', firstDay: L, lastDay: L, halfDay: true });
  expect(await slotsOf(L)).toEqual(before.filter((x) => x.staffId !== s.stylists.asha));
  await run(s.manager, 'leave.reverse', { leaveId, reason: 'entered_in_error' });
  expect(await slotsOf(L)).toEqual(before);

  await run(s.manager, 'holiday.set', { shopId: s.otherShopId, day: L, nameKey: 'diwali' });
  expect(await slotsOf(L)).toEqual(before); // another branch's holiday
  const { holidayId } = await run(s.manager, 'holiday.set', { shopId: s.shopId, day: L, nameKey: 'diwali' });
  expect(await slotsOf(L)).toEqual([]);
  await run(s.manager, 'holiday.reverse', { holidayId, reason: 'entered_in_error' });
  expect(await slotsOf(L)).toEqual(before);
  await run(s.owner, 'holiday.set', { day: L, nameKey: 'diwali' }); // every branch
  expect(await slotsOf(L)).toEqual([]);
});
