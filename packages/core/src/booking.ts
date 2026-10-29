// Live bookings (BLUEPRINT §8.8): the public's hold, its release and its request; the desk's own booking and its
// handling (decline, cancel, no-show). All ops rows: a hold or a request blocks the calendar but changes no book; a
// person confirms with booking.confirm (commands-booking.ts), a command. The database holds every rule that matters (the
// exclusion, BK1; the calendar, BK2; the caps and the token, HOLD1). Core adds the quarter-hour grid and the future,
// derives the end from the service's length, and expires every lapsed hold before placing one: a lapsed hold still
// stored as held keeps its time in the exclusion and its device in one_hold_per_device. The public functions take the
// munshi_public pool and the tenant the site's slug names, never one from a payload.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Session, withTx } from './session.ts';
import { GRID_MIN } from './slots.ts';
import { businessDate, dayStart } from './time.ts';

const id = z.guid();
const hash = z.string().regex(/^[0-9a-f]{64}$/); // a sha256, as hex
const holdToken = z.string().min(16).max(128);
const givenToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
const version = z.string().regex(/^[a-z0-9_.-]{1,40}$/);
const reason = z.string().regex(/^[a-z_]{2,40}$/); // a ref.reason code; the table's key refuses one not for declines
const slot = {
  shopId: id,
  staffId: id,
  serviceItemId: id,
  start: z.iso.datetime({ offset: true }),
  shiftRel: z.enum(['books.shift_pattern', 'books.shift_change']),
  shiftId: id,
};
const holdPlace = z.strictObject({ ...slot, ipHash: hash, deviceHash: hash });
const holdRelease = z.strictObject({ holdId: id, holdToken });
const bookingRequest = z.strictObject({
  holdId: id,
  holdToken,
  name: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  note: z.string().trim().max(500).optional(),
  waUpdates: z.boolean(),
  noticeVersion: version,
  consentVersion: version,
  ipHash: hash.optional(),
});
const deskBooking = z.strictObject({ ...slot, customerId: id.optional() });
const bookingMove = z.strictObject({ bookingId: id, state: z.enum(['declined', 'cancelled', 'no_show']), reason: reason.optional() });

export type HoldInput = z.input<typeof holdPlace>;
export type BookingRequestInput = z.input<typeof bookingRequest>;
export type DeskBookingInput = z.input<typeof deskBooking>;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

const bytes = (hex: string) => Buffer.from(hex, 'hex');

// The span a slot takes: from a quarter hour of the shop's day, in the future, for the service's length in effect now
// (booking_flow checks the length against the same revision).
async function span(c: pg.PoolClient, i: { start: string; serviceItemId: string }): Promise<[Date, Date]> {
  const start = new Date(i.start);
  const { rows } = await c.query<{ time_zone: string; now: Date; duration_min: number | null }>(
    `select t.time_zone, now() as now,
            (select v.duration_min from books.item_revision v where v.item_id = $1 and v.effective_from <= now()
              order by v.effective_from desc, v.created_at desc, v.id desc limit 1) as duration_min
       from ops.tenant t`,
    [i.serviceItemId],
  );
  const t = rows[0];
  if (!t) throw new CoreError('not_found');
  const minute = (start.getTime() - dayStart(businessDate(start, t.time_zone), t.time_zone).getTime()) / 60_000;
  if (!Number.isInteger(minute) || minute % GRID_MIN !== 0 || start <= t.now) throw new CoreError('invalid', { fields: ['start'] });
  if (t.duration_min === null) throw new CoreError('invalid', { fields: ['serviceItemId'] });
  return [start, new Date(start.getTime() + t.duration_min * 60_000)];
}

const shiftIds = (i: { shiftRel: string; shiftId: string }) =>
  i.shiftRel === 'books.shift_pattern' ? [i.shiftId, null] : [null, i.shiftId];

// A hold on a free slot for the site's minutes (ops.site.hold_minutes). The token is returned once and kept only as
// its sha256. A taken slot is `conflict` (23P01); a second live hold from the device `conflict` (23505,
// one_hold_per_device); a fourth from the IP or a third on the stylist's day `invalid` (MS015).
export function placeHold(pub: pg.Pool, tenantId: string, input: HoldInput): Promise<{ holdId: string; holdToken: string; expiresAt: Date }> {
  const i = parse(holdPlace, input);
  return withTx(pub, { kind: 'system', tenantId }, (c) => placeHoldIn(c, i));
}

// The same in the caller's transaction (the public API claims its idempotency key in it). The API passes a token it can
// derive again for a replay; without one the token is fresh and random.
export async function placeHoldIn(c: pg.PoolClient, input: HoldInput, holdToken?: string): Promise<{ holdId: string; holdToken: string; expiresAt: Date }> {
  const i = parse(holdPlace, input);
  const [from, to] = await span(c, i);
  // Every lapsed hold of the tenant, not only this stylist's: the device or the IP may have held another stylist.
  await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()`);
  const token = holdToken === undefined ? randomBytes(32).toString('base64url') : parse(givenToken, holdToken);
  const { rows } = await c.query<{ id: string; expires_at: Date }>(
    `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash,
                              device_hash, shift_pattern_id, shift_change_id)
     select s.tenant_id, s.id, $1, $2, $3, tstzrange($4, $5, '[)'), 'held', 'site', sha256(convert_to($6, 'UTF8')), $7, $8, $9, $10
       from ops.site s
     returning id, expires_at`,
    [i.shopId, i.staffId, i.serviceItemId, from, to, token, bytes(i.ipHash), bytes(i.deviceHash), ...shiftIds(i)],
  );
  const made = rows[0];
  if (!made) throw new CoreError('not_found'); // the tenant has no site
  return { holdId: made.id, holdToken: token, expiresAt: made.expires_at };
}

// The token travels in munshi.hold_token; booking_flow compares its sha256, so an id alone moves nothing.
async function withToken(c: pg.PoolClient, token: string) {
  await c.query(`select set_config('munshi.hold_token', $1, true)`, [token]);
}

export function releaseHold(pub: pg.Pool, tenantId: string, input: z.input<typeof holdRelease>): Promise<{ holdId: string }> {
  return withTx(pub, { kind: 'system', tenantId }, (c) => releaseHoldIn(c, input));
}

export async function releaseHoldIn(c: pg.PoolClient, input: z.input<typeof holdRelease>): Promise<{ holdId: string }> {
  const i = parse(holdRelease, input);
  await withToken(c, i.holdToken);
  const r = await c.query(`update ops.booking set state = 'cancelled' where id = $1 and state = 'held'`, [i.holdId]);
  if (r.rowCount !== 1) throw new CoreError('not_found');
  return { holdId: i.holdId };
}

// The customer's details turn a live hold into a request the desk confirms: the move and the contact row in one
// transaction (booking_contact_guard holds it). On a demo the database pins the name and phone to the samples.
export function requestBooking(pub: pg.Pool, tenantId: string, input: BookingRequestInput): Promise<{ bookingId: string }> {
  return withTx(pub, { kind: 'system', tenantId }, (c) => requestBookingIn(c, tenantId, input));
}

export async function requestBookingIn(c: pg.PoolClient, tenantId: string, input: BookingRequestInput): Promise<{ bookingId: string }> {
  const i = parse(bookingRequest, input);
  await withToken(c, i.holdToken);
  const { rows } = await c.query<{ site_id: string }>(`update ops.booking set state = 'requested' where id = $1 and state = 'held' returning site_id`, [
    i.holdId,
  ]);
  const held = rows[0];
  if (!held) throw new CoreError('not_found');
  await c.query(
    `insert into ops.booking_contact (tenant_id, booking_id, site_id, contact_name, contact_phone_e164, note, wa_updates, notice_version,
                                      consent_version, ip_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [tenantId, i.holdId, held.site_id, i.name, i.phone, i.note ?? null, i.waUpdates, i.noticeVersion, i.consentVersion, i.ipHash ? bytes(i.ipHash) : null],
  );
  return { bookingId: i.holdId };
}

// A walk-in or a phone call, booked by an owner or manager at the desk: confirmed in one step (source app). It is an
// ops row like any booking; naming a customer here sends nothing.
export function bookAtDesk(app: pg.Pool, session: Session, input: DeskBookingInput): Promise<{ bookingId: string }> {
  const i = parse(deskBooking, input);
  return withTx(app, { kind: 'member', session }, async (c) => {
    const [from, to] = await span(c, i);
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.booking (tenant_id, shop_id, staff_id, service_item_id, during, state, source, customer_id, shift_pattern_id, shift_change_id)
       values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'confirmed', 'app', $7, $8, $9) returning id`,
      [session.tenantId, i.shopId, i.staffId, i.serviceItemId, from, to, i.customerId ?? null, ...shiftIds(i)],
    );
    return { bookingId: (rows[0] as { id: string }).id };
  });
}

// The desk's handling of a request or a confirmed booking: declined (with a reason code), cancelled, or a no-show.
// booking_flow allows only an active owner's or manager's move, and only from requested or confirmed.
export function moveBooking(app: pg.Pool, session: Session, input: z.input<typeof bookingMove>): Promise<{ bookingId: string }> {
  const i = parse(bookingMove, input);
  return withTx(app, { kind: 'member', session }, async (c) => {
    const r = await c.query('update ops.booking set state = $2, reason = $3 where id = $1', [i.bookingId, i.state, i.reason ?? null]);
    if (r.rowCount !== 1) throw new CoreError('not_found');
    return { bookingId: i.bookingId };
  });
}
