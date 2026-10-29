// The Bookings desk's watchers (BLUEPRINT §7.3, §8.8): an idle stylist, a stylist away with confirmed bookings, a
// booking whose time passed with no sale, and holds that keep lapsing on one stylist's day. A stylist's day is the
// roster in effect (a day's change over the latest pattern for that weekday), at that branch, inside the branch's hours,
// and empty on leave or a holiday — the calendar booking_flow (BK2) books against. Same rules as every named read
// (queries.ts). Type-only import: queries.ts spreads WATCH_BOOKING_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const instant: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const asOf = z.strictObject({ as_of: z.iso.date() });
const atInstant = z.strictObject({ as_of: z.iso.date(), at: z.iso.datetime() });

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
const localDay = (at: string) => `(${at} at time zone (select time_zone from tz))::date`;
// A service's price in effect at an instant.
const servicePrice = (item: string, at: string) =>
  `(select pr.amount_minor from books.price pr where pr.tenant_id = b.tenant_id and pr.item_id = ${item} and pr.effective_from <= ${at}
     order by pr.effective_from desc, pr.created_at desc, pr.id desc limit 1)`;
// On leave that day (a live leave row covering it).
const onLeave = (staff: string, d: string) =>
  `exists (select 1 from books.leave l where l.tenant_id = ${staff}.tenant_id and l.staff_id = ${staff}.id and ${d} between l.first_day and l.last_day
             and ${live('books.leave', 'l')})`;

export const WATCH_BOOKING_QUERIES: [string, NamedQuery][] = [
  [
    // An idle stylist: over the three days from as_of, 40% or more of their rostered minutes at a branch hold no
    // requested or confirmed booking. At stake: the idle hours × their average service price, from the last 90 days'
    // live sale lines naming them (walk-ins included, R4 N5), rounded half up to a whole paisa; null with no such line.
    'watch.idle_stylist',
    {
      params: asOf,
      order: ['as_of'],
      key: ['staff_id', 'shop_id'],
      columns: {
        staff_id: text,
        shop_id: text,
        from_day: day,
        rostered_minutes: int,
        booked_minutes: int,
        idle_minutes: int,
        avg_price: rupees,
        idle_value: rupees,
      },
      sql: `with ${TZ},
            days as (select ($1::date + g)::date as d from generate_series(0, 2) g),
            roster as (
              select s.tenant_id, s.id as staff_id, d.d, coalesce(ch.shop_id, pat.shop_id) as shop_id,
                     case when ch.id is not null then ch.off else pat.off end as off,
                     case when ch.id is not null then ch.starts else pat.starts end as starts,
                     case when ch.id is not null then ch.ends else pat.ends end as ends
                from books.staff s cross join days d
                left join lateral (select x.* from books.shift_change x where x.tenant_id = s.tenant_id and x.staff_id = s.id and x.day = d.d
                                    order by x.created_at desc, x.id desc limit 1) ch on true
                left join lateral (select x.* from books.shift_pattern x
                                    where x.tenant_id = s.tenant_id and x.staff_id = s.id and x.weekday = extract(isodow from d.d) and x.effective_from <= d.d
                                    order by x.effective_from desc, x.created_at desc, x.id desc limit 1) pat on true
               where (ch.id is not null or pat.id is not null) and not ${onLeave('s', 'd.d')}
            ),
            open_minutes as (
              select r.*, h.opens, h.closes,
                     greatest(0, extract(epoch from (least(r.ends, h.closes) - greatest(r.starts, h.opens))) / 60)::bigint as minutes
                from roster r
                join lateral (select x.* from ops.shop_hours x where x.tenant_id = r.tenant_id and x.shop_id = r.shop_id
                                and x.weekday = extract(isodow from r.d) and x.effective_from <= r.d
                               order by x.effective_from desc, x.created_at desc, x.id desc limit 1) h on not h.closed
               where not r.off
                 and not exists (select 1 from books.holiday hd where hd.tenant_id = r.tenant_id and hd.day = r.d
                                    and (hd.shop_id is null or hd.shop_id = r.shop_id) and ${live('books.holiday', 'hd')})
            ),
            per as (
              select o.tenant_id, o.staff_id, o.shop_id, sum(o.minutes)::bigint as rostered,
                     sum((select coalesce(sum(extract(epoch from upper(b.during) - lower(b.during)) / 60), 0) from ops.booking b
                           where b.tenant_id = o.tenant_id and b.staff_id = o.staff_id and b.shop_id = o.shop_id
                             and b.state in ('requested', 'confirmed') and ${localDay('lower(b.during)')} = o.d))::bigint as booked
                from open_minutes o group by o.tenant_id, o.staff_id, o.shop_id
            ),
            priced as (
              select p.*, (select sum(l.gross_minor) / count(*) from books.sale_line l join books.sale sa on sa.tenant_id = l.tenant_id and sa.id = l.sale_id
                            where l.tenant_id = p.tenant_id and l.staff_id = p.staff_id and l.item_kind = 'service' and ${live('books.sale_line', 'l')}
                              and ${localDay('sa.sold_at')} between $1::date - 90 and $1::date - 1)::bigint as avg_price
                from per p
            )
            select p.staff_id::text as staff_id, p.shop_id::text as shop_id, $1::date::text as from_day, p.rostered as rostered_minutes,
                   p.booked as booked_minutes, p.rostered - p.booked as idle_minutes, p.avg_price,
                   ((p.rostered - p.booked) * p.avg_price + 30) / 60 as idle_value, (select currency from tz) as currency
              from priced p
             where p.rostered > 0 and (p.rostered - p.booked) * 100 >= p.rostered * 40
             order by p.staff_id, p.shop_id
             limit 500`,
    },
  ],
  [
    // A stylist on leave, or marked absent or on leave by the day's counting mark (an owner's or manager's over their
    // own, then the latest, R4 K13), on a day from as_of through the next six that holds their confirmed bookings. At
    // stake: those bookings' service prices.
    'watch.stylist_absent_booked',
    {
      params: asOf,
      order: ['as_of'],
      key: ['staff_id', 'day'],
      columns: { staff_id: text, shop_id: text, day, bookings: int, value: rupees },
      sql: `with ${TZ},
            booked as (
              select b.tenant_id, b.staff_id, b.shop_id, ${localDay('lower(b.during)')} as d, count(*) as n,
                     sum(${servicePrice('b.service_item_id', 'lower(b.during)')}) as value
                from ops.booking b
               where b.state = 'confirmed' and ${localDay('lower(b.during)')} between $1::date and $1::date + 6
               group by b.tenant_id, b.staff_id, b.shop_id, ${localDay('lower(b.during)')}
            )
            select bk.staff_id::text as staff_id, bk.shop_id::text as shop_id, bk.d::text as day, bk.n::bigint as bookings, bk.value::bigint as value,
                   (select currency from tz) as currency
              from booked bk join books.staff s on s.tenant_id = bk.tenant_id and s.id = bk.staff_id
             where ${onLeave('s', 'bk.d')}
                or (select a.status from books.attendance a where a.tenant_id = s.tenant_id and a.staff_id = s.id and a.day = bk.d
                     order by (a.marked_by_role in ('owner', 'manager')) desc, a.created_at desc, a.id desc limit 1) in ('absent', 'leave')
             order by bk.d, bk.staff_id
             limit 500`,
    },
  ],
  [
    // A booking whose time ended before the run's instant (within the last 30 days) that is still confirmed, with no
    // live sale naming it: the visit was never billed, or never marked. At stake: the service's price at its time.
    'watch.unbilled_booking',
    {
      params: atInstant,
      order: ['at'],
      key: ['booking_id'],
      columns: { booking_id: text, shop_id: text, staff_id: text, service_item_id: text, starts_at: instant, price: rupees },
      sql: `select b.id::text as booking_id, b.shop_id::text as shop_id, b.staff_id::text as staff_id, b.service_item_id::text as service_item_id,
                   lower(b.during) as starts_at, ${servicePrice('b.service_item_id', 'lower(b.during)')}::bigint as price,
                   (select currency from ops.tenant) as currency
              from ops.booking b
             where b.state = 'confirmed' and upper(b.during) <= $1::timestamptz and upper(b.during) > $1::timestamptz - interval '30 days'
               and not exists (select 1 from books.sale sa where sa.tenant_id = b.tenant_id and sa.booking_id = b.id and ${live('books.sale', 'sa')})
             order by lower(b.during), b.id
             limit 500`,
    },
  ],
  [
    // Hold pressure (review B7): in the hour to the run's instant, the public's holds on one stylist's day lapsed
    // unconverted — expired, whether or not the sweep has marked them yet — three or more times. At stake: the held
    // slots' service prices. (A hold refused by its caps leaves no row, so this reads lapsed holds only.)
    'watch.hold_pressure',
    {
      params: atInstant,
      order: ['at'],
      key: ['staff_id', 'day'],
      columns: { staff_id: text, shop_id: text, day, holds: int, held_value: rupees },
      sql: `with ${TZ}
            select b.staff_id::text as staff_id, b.shop_id::text as shop_id, ${localDay('lower(b.during)')}::text as day, count(*)::bigint as holds,
                   sum(${servicePrice('b.service_item_id', 'lower(b.during)')})::bigint as held_value, (select currency from tz) as currency
              from ops.booking b
             where b.hold_token_sha256 is not null and b.state in ('held', 'expired')
               and b.expires_at <= $1::timestamptz and b.expires_at > $1::timestamptz - interval '1 hour'
             group by b.staff_id, b.shop_id, ${localDay('lower(b.during)')}
            having count(*) >= 3
             order by 3, 1
             limit 500`,
    },
  ],
];
