// Live slots: for a shop, a service and a day, each stylist rostered there that day (the day's latest one-day change,
// else the latest weekly pattern in effect), minus live leave (a half day too), live holidays (this branch or every
// branch) and the shop's closed hours, minus every requested or confirmed booking and every hold still live, on the
// clock's quarter hours where the service's whole length fits. The rules are booking_flow's calendar check
// (14_sites_public.sql) row for row, so every slot offered is one the database accepts. Slot times are roster times,
// not book figures: each slot names the roster row it came from (shiftRel, shiftId), and a hold stores it. A read: it
// writes nothing, so a lapsed hold may still be stored as held, and counts as free here. It reads ids, days and times
// only, within the public role's column grants, so the site's GET and the app's calendar run the same code.
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Scope, withTx } from './session.ts';
import { localTime } from './time.ts';

export const GRID_MIN = 15;

export type ShiftRel = 'books.shift_pattern' | 'books.shift_change';
export type Slot = { staffId: string; start: Date; end: Date; shiftRel: ShiftRel; shiftId: string };

// A stylist's working window that day, in minutes after local midnight, already cut to the shop's hours.
type Shift = { staffId: string; shiftRel: ShiftRel; shiftId: string; from: number; to: number };
type Busy = { staffId: string; from: Date; to: Date };
export type Calendar = { day: string; timeZone: string; durationMin: number; shifts: Shift[]; busy: Busy[] };

export const slotQuery = z.strictObject({ shopId: z.guid(), serviceItemId: z.guid(), day: z.iso.date(), staffId: z.guid().optional() });
export type SlotQuery = z.input<typeof slotQuery>;

// Every quarter hour of each window where the service fits, after `now`, clear of the stylist's live bookings.
export function offered(cal: Calendar, now: Date): Slot[] {
  const out: Slot[] = [];
  for (const s of cal.shifts) {
    for (let m = Math.ceil(s.from / GRID_MIN) * GRID_MIN; m + cal.durationMin <= s.to; m += GRID_MIN) {
      const start = localTime(cal.day, m, cal.timeZone);
      const end = new Date(start.getTime() + cal.durationMin * 60_000);
      if (start <= now || cal.busy.some((b) => b.staffId === s.staffId && b.from < end && start < b.to)) continue;
      out.push({ staffId: s.staffId, start, end, shiftRel: s.shiftRel, shiftId: s.shiftId });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0));
}

// The roster in effect that day at the shop. A change for the day, at any branch, replaces the stylist's pattern
// (booking_flow reads it the same way); the shop's hours are the latest row in effect for the weekday.
const ROSTER = `
  with hours as (
    select h.opens, h.closes, h.closed from ops.shop_hours h
     where h.shop_id = $1 and h.weekday = extract(isodow from $2::date) and h.effective_from <= $2::date
     order by h.effective_from desc, h.created_at desc, h.id desc limit 1
  ),
  changed as (
    select distinct on (x.staff_id) x.id, x.staff_id, x.shop_id, x.starts, x.ends, x.off from books.shift_change x
     where x.day = $2::date order by x.staff_id, x.created_at desc, x.id desc
  ),
  patterned as (
    select distinct on (p.staff_id) p.id, p.staff_id, p.shop_id, p.starts, p.ends, p.off from books.shift_pattern p
     where p.weekday = extract(isodow from $2::date) and p.effective_from <= $2::date
     order by p.staff_id, p.effective_from desc, p.created_at desc, p.id desc
  ),
  roster as (
    select 'books.shift_change' as rel, c.id, c.staff_id, c.shop_id, c.starts, c.ends, c.off from changed c
    union all
    select 'books.shift_pattern', p.id, p.staff_id, p.shop_id, p.starts, p.ends, p.off from patterned p
     where not exists (select 1 from changed c where c.staff_id = p.staff_id)
  )
  select r.rel, r.id::text as id, r.staff_id::text as staff_id,
         (extract(epoch from greatest(r.starts, h.opens)) / 60)::float8 as from_min, (extract(epoch from least(r.ends, h.closes)) / 60)::float8 as to_min
    from roster r cross join hours h
   where r.shop_id = $1 and not r.off and not h.closed and ($3::uuid is null or r.staff_id = $3::uuid)
     and not exists (select 1 from books.leave l
                      where l.staff_id = r.staff_id and l.reverses_id is null and $2::date between l.first_day and l.last_day
                        and not exists (select 1 from books.leave x where x.tenant_id = l.tenant_id and x.reverses_id = l.id))
     and not exists (select 1 from books.holiday h
                      where h.day = $2::date and (h.shop_id is null or h.shop_id = $1) and h.reverses_id is null
                        and not exists (select 1 from books.holiday x where x.tenant_id = h.tenant_id and x.reverses_id = h.id))
   order by r.staff_id`;

// A stylist's bookings that block a slot that day: requested, confirmed, or a hold that has not lapsed, at any branch
// (the exclusion is per stylist).
const BUSY = `
  select b.staff_id::text as staff_id, lower(b.during) as from_at, upper(b.during) as to_at
    from ops.booking b cross join ops.tenant t
   where b.staff_id = any($1::uuid[])
     and b.during && tstzrange($2::date::timestamp at time zone t.time_zone, ($2::date + 1)::timestamp at time zone t.time_zone, '[)')
     and (b.state in ('requested', 'confirmed') or (b.state = 'held' and b.expires_at > now()))`;

export async function calendarIn(c: pg.PoolClient, q: z.output<typeof slotQuery>): Promise<Calendar> {
  const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');
  if (t.length !== 1) throw new CoreError('not_found');
  const timeZone = (t[0] as { time_zone: string }).time_zone;
  // The duration in effect now, as booking_flow checks it; a service off sale offers nothing.
  const { rows: d } = await c.query<{ duration_min: number }>(
    `select v.duration_min from books.item_revision v where v.item_id = $1 and v.effective_from <= now() and v.sellable
        and v.id = (select x.id from books.item_revision x where x.tenant_id = v.tenant_id and x.item_id = v.item_id and x.effective_from <= now()
                     order by x.effective_from desc, x.created_at desc, x.id desc limit 1)
        and v.duration_min is not null`,
    [q.serviceItemId],
  );
  const durationMin = d[0]?.duration_min;
  if (durationMin === undefined) return { day: q.day, timeZone, durationMin: 0, shifts: [], busy: [] };
  const { rows: r } = await c.query<{ rel: ShiftRel; id: string; staff_id: string; from_min: number; to_min: number }>(ROSTER, [
    q.shopId,
    q.day,
    q.staffId ?? null,
  ]);
  const shifts = r.map((x) => ({ staffId: x.staff_id, shiftRel: x.rel, shiftId: x.id, from: x.from_min, to: x.to_min }));
  const { rows: b } = await c.query<{ staff_id: string; from_at: Date; to_at: Date }>(BUSY, [shifts.map((s) => s.staffId), q.day]);
  return { day: q.day, timeZone, durationMin, shifts, busy: b.map((x) => ({ staffId: x.staff_id, from: x.from_at, to: x.to_at })) };
}

// Inside the caller's transaction (a page's one transaction, or the site's read as the public role).
export async function slotsIn(c: pg.PoolClient, query: SlotQuery): Promise<Slot[]> {
  const r = slotQuery.safeParse(query);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(query)') });
  const cal = await calendarIn(c, r.data);
  const { rows } = await c.query<{ now: Date }>('select now() as now');
  return offered(cal, (rows[0] as { now: Date }).now);
}

export function freeSlots(pool: pg.Pool, scope: Scope, query: SlotQuery): Promise<Slot[]> {
  return withTx(pool, scope, (c) => slotsIn(c, query));
}
