// BK1, BK2 and HOLD1 end to end through core: the public's holds and requests as munshi_public,
// the desk's bookings and booking.confirm as munshi_app. The database's exclusion, calendar check, caps and token check
// decide; core places holds on the quarter hour in the future and expires every lapsed hold first, so a lapsed hold
// never blocks. booking.confirm writes the customer through the vault and the customer's message naming the booking in
// the move's transaction, and the database refuses a confirm without it at commit (MS007). Each test has its own days.
// Red-proofs: test/v2/sabotage/core-staff.ts.
import { randomUUID } from 'node:crypto';
import {
  bookAtDesk,
  type HoldInput,
  localTime,
  moveBooking,
  placeHold,
  releaseHold,
  requestBooking,
  runCommand,
  type Session,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { monday, SAMPLE_PHONE, type Salon, salon, sha, type Stylist } from './salon.ts';

const TZ = 'Asia/Kolkata';
const at = (day: string, hhmm: string) => localTime(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let s: Salon;
const roster: Partial<Record<Stylist, string>> = {};

const fresh = () => sha(randomUUID());
const hold = (who: Stylist, day: string, hhmm: string, over: Partial<HoldInput> = {}) =>
  placeHold(pub, s.tenantId, {
    shopId: s.shopId,
    staffId: s.stylists[who],
    serviceItemId: s.serviceId,
    start: at(day, hhmm).toISOString(),
    shiftRel: 'books.shift_pattern',
    shiftId: roster[who] as string,
    ipHash: fresh(),
    deviceHash: fresh(),
    ...over,
  });
const desk = (who: Stylist, day: string, hhmm: string, by: Session = s.manager) =>
  bookAtDesk(app, by, {
    shopId: s.shopId,
    staffId: s.stylists[who],
    serviceItemId: s.serviceId,
    start: at(day, hhmm).toISOString(),
    shiftRel: 'books.shift_pattern',
    shiftId: roster[who] as string,
  });
const lapse = (holdId: string) => plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [holdId]);
const ask = (h: { holdId: string; holdToken: string }, waUpdates = true) =>
  requestBooking(pub, s.tenantId, { holdId: h.holdId, holdToken: h.holdToken, name: 'Kavya', phone: SAMPLE_PHONE, waUpdates, noticeVersion: 'v1', consentVersion: 'v1' });
const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const stateOf = async (id: string) => (await q('select state from ops.booking where id = $1', [id]))[0]?.state;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  s = await salon(app, 'BK');
  for (const who of ['asha', 'ravi', 'meena'] as const) {
    const r = await runCommand(app, s.manager, 'shift.pattern.set', {
      staffId: s.stylists[who],
      shopId: s.shopId,
      weekday: 1,
      starts: '09:00',
      ends: '18:00',
      effectiveFrom: '2026-03-01',
    });
    roster[who] = r.patternId as string;
  }
  await db.sabotage();
});
afterAll(() => db?.close());

it('two live bookings of one stylist never overlap: a hold or a desk booking over a taken slot is refused (23P01), another stylist may take the same time, and an expired hold frees its slot', async () => {
  const day = monday(1);
  await hold('asha', day, '10:00');
  await expect(hold('asha', day, '10:15')).rejects.toMatchObject({ code: 'conflict', sqlstate: '23P01' });
  await hold('ravi', day, '10:00');
  await expect(desk('asha', day, '10:30')).rejects.toMatchObject({ code: 'conflict', sqlstate: '23P01' });
  await desk('asha', day, '11:00');
  const lapsing = await hold('meena', day, '12:00');
  await lapse(lapsing.holdId);
  await hold('meena', day, '12:00'); // the lapsed hold is expired first, so its time is free
  expect(await stateOf(lapsing.holdId)).toBe('expired');
});

it('a hold outside the shift, on leave, on a holiday, off the quarter hour or in the past is refused, and so is a request after its hold expired', async () => {
  const [day, onLeave, closed] = [monday(2), monday(3), monday(4)];
  await expect(hold('asha', day, '17:30')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' }); // ends 18:15, after the shift
  await expect(hold('asha', day, '10:05')).rejects.toMatchObject({ code: 'invalid', fields: ['start'] });
  await expect(hold('asha', monday(-2), '10:00')).rejects.toMatchObject({ code: 'invalid', fields: ['start'] }); // a Monday gone by
  await runCommand(app, s.manager, 'leave.record', { staffId: s.stylists.asha, kind: 'unpaid', firstDay: onLeave, lastDay: onLeave });
  await expect(hold('asha', onLeave, '10:00')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
  await runCommand(app, s.manager, 'holiday.set', { shopId: s.shopId, day: closed, nameKey: 'holi' });
  await expect(hold('ravi', closed, '10:00')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
  const h = await hold('meena', day, '11:00');
  await lapse(h.holdId);
  await expect(ask(h)).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
  await hold('asha', day, '10:00'); // the day itself takes a hold
});

it('a second live hold from one device, a fourth from one IP hash or a third on one stylist’s day is refused; a lapsed hold on another stylist frees its device and its IP; a hold moves only with its token', async () => {
  const [day, other] = [monday(5), monday(6)];
  const device = fresh();
  const first = await hold('asha', day, '09:00', { deviceHash: device });
  await expect(hold('ravi', day, '09:00', { deviceHash: device })).rejects.toMatchObject({ code: 'conflict', sqlstate: '23505', constraint: 'one_hold_per_device' });
  await lapse(first.holdId);
  await hold('ravi', day, '09:00', { deviceHash: device }); // Asha's lapsed hold no longer holds the device

  const ip = fresh();
  const third = [];
  for (const who of ['asha', 'ravi', 'meena'] as const) third.push(await hold(who, day, '11:00', { ipHash: ip }));
  const fourth = hold('asha', day, '13:00', { ipHash: ip });
  await expect(fourth).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });
  await lapse((third[2] as { holdId: string }).holdId);
  await hold('asha', day, '13:00', { ipHash: ip }); // Meena's lapsed hold no longer counts against the IP

  await hold('meena', other, '10:00');
  await hold('meena', other, '12:00');
  await expect(hold('meena', other, '14:00')).rejects.toMatchObject({ code: 'invalid', sqlstate: 'MS015' });

  const h = await hold('asha', other, '10:00');
  await expect(releaseHold(pub, s.tenantId, { holdId: h.holdId, holdToken: 'not-the-token-at-all' })).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS018' });
  await expect(ask({ holdId: h.holdId, holdToken: 'not-the-token-at-all' })).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS018' });
  expect(await stateOf(h.holdId)).toBe('held');
  await ask(h);
  expect(await stateOf(h.holdId)).toBe('requested');
  expect(await q('select contact_name, contact_phone_e164 from ops.booking_contact where booking_id = $1', [h.holdId])).toEqual([
    { contact_name: 'Sample customer', contact_phone_e164: SAMPLE_PHONE }, // a demo pins the samples
  ]);
  const gone = await hold('ravi', other, '15:00');
  await releaseHold(pub, s.tenantId, { holdId: gone.holdId, holdToken: gone.holdToken });
  expect(await stateOf(gone.holdId)).toBe('cancelled');
});

it('booking.confirm writes the customer through the vault and the customer’s message naming the booking with the move, under the person who confirms; the database refuses a confirm without the message at commit (MS007)', async () => {
  const day = monday(7);
  const h = await hold('asha', day, '10:00');
  await ask(h);
  await expect(runCommand(app, s.desk, 'booking.confirm', { bookingId: h.holdId })).rejects.toMatchObject({ code: 'refused' });
  const r = (await runCommand(app, s.manager, 'booking.confirm', { bookingId: h.holdId })) as Record<string, string>;
  expect(Object.keys(r).sort()).toEqual(['bookingId', 'customerId', 'messageId', 'textId']);
  expect(await q('select state, customer_id::text, handled_by::text from ops.booking where id = $1', [h.holdId])).toEqual([
    { state: 'confirmed', customer_id: r.customerId, handled_by: s.manager.memberId },
  ]);
  // The person is in the vault, linked by id; the books hold no name.
  expect(
    await q(
      `select ct.name, ct.phone_e164 from books.party_contact p join ops.contact ct on ct.tenant_id = p.tenant_id and ct.id = p.contact_id where p.customer_id = $1`,
      [r.customerId],
    ),
  ).toEqual([{ name: 'Sample customer', phone_e164: SAMPLE_PHONE }]);
  const [m] = await q(
    `select m.channel, m.recipient_kind, m.recipient_id::text, m.template_code, m.booking_id::text, m.created_by::text, t.body, m.body_sha256 = t.body_sha256 as same,
            d.mode
       from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id
       join ops.delivery d on d.tenant_id = m.tenant_id and d.message_id = m.id
      where m.id = $1`,
    [r.messageId],
  );
  expect(m).toMatchObject({
    channel: 'whatsapp',
    recipient_kind: 'customer',
    recipient_id: r.customerId,
    template_code: 'booking_confirmed',
    booking_id: h.holdId,
    created_by: s.manager.memberId,
    same: true,
    mode: 'recorded',
  });
  expect(m.body).toMatch(/^BK Salon \(synthetic\): your booking is confirmed\. Haircut at Kalkaji, .+ at 10:00\.$/);
  const audited = await q(
    `select entity, actor_id::text, command from audit.audit_log where tenant_id = $1 and entity_id = any($2::uuid[]) and entity like 'books.%' order by entity`,
    [s.tenantId, [r.customerId, r.messageId]],
  );
  expect(audited).toEqual([
    { entity: 'books.customer', actor_id: s.manager.memberId, command: 'booking.confirm' },
    { entity: 'books.outbound_message', actor_id: s.manager.memberId, command: 'booking.confirm' },
  ]);

  // The same phone (a demo's sample) books again: the vault's contact and its customer are reused, by SMS this time.
  const again = await hold('ravi', day, '10:00');
  await ask(again, false);
  const r2 = (await runCommand(app, s.owner, 'booking.confirm', { bookingId: again.holdId })) as Record<string, string>;
  expect(r2.customerId).toBe(r.customerId);
  expect((await q('select channel from books.outbound_message where id = $1', [r2.messageId]))[0]?.channel).toBe('sms');
  expect(await q('select count(*)::int as n from ops.contact where tenant_id = $1 and phone_e164 = $2', [s.tenantId, SAMPLE_PHONE])).toEqual([{ n: 1 }]);

  await expect(runCommand(app, s.manager, 'booking.confirm', { bookingId: h.holdId })).rejects.toMatchObject({ code: 'conflict' }); // confirmed already
  const held = await hold('meena', day, '10:00');
  await expect(runCommand(app, s.manager, 'booking.confirm', { bookingId: held.holdId })).rejects.toMatchObject({ code: 'conflict' }); // not requested

  // Without the message, the move does not commit.
  const bare = await hold('meena', day, '12:00');
  await ask(bare);
  const silent = withTx(app, { kind: 'member', session: s.manager, command: 'booking.confirm' }, (c) =>
    c.query(`update ops.booking set state = 'confirmed', customer_id = $2 where id = $1`, [bare.holdId, r.customerId]),
  );
  await expect(silent).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  expect(await stateOf(bare.holdId)).toBe('requested');
});

it('the desk handles a booking as ops: a request is declined only with a reason code, by an owner or manager; a confirmed booking is cancelled or marked a no-show; none writes a book', async () => {
  const day = monday(8);
  const books = async () => (await q(`select count(*)::int as n from audit.audit_log where tenant_id = $1 and entity like 'books.%'`, [s.tenantId]))[0]?.n;
  const h = await hold('asha', day, '10:00');
  await ask(h);
  const before = await books();
  await expect(moveBooking(app, s.manager, { bookingId: h.holdId, state: 'declined' })).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  await expect(moveBooking(app, s.desk, { bookingId: h.holdId, state: 'declined', reason: 'staff_unavailable' })).rejects.toMatchObject({ code: 'refused' });
  await moveBooking(app, s.manager, { bookingId: h.holdId, state: 'declined', reason: 'staff_unavailable' });
  expect(await q('select state, reason from ops.booking where id = $1', [h.holdId])).toEqual([{ state: 'declined', reason: 'staff_unavailable' }]);
  const { bookingId: walkIn } = await desk('ravi', day, '10:00');
  await moveBooking(app, s.owner, { bookingId: walkIn, state: 'no_show' });
  const { bookingId: phoned } = await desk('meena', day, '10:00');
  await moveBooking(app, s.manager, { bookingId: phoned, state: 'cancelled' });
  expect([await stateOf(walkIn), await stateOf(phoned)]).toEqual(['no_show', 'cancelled']);
  expect(await books()).toBe(before);
});
