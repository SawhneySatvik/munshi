// The watchers on people (BLUEPRINT §7.3): a staff advance not recovered after 30 days (the Staff desk), regular
// customers who stopped coming (Customers, campaigns) and a package about to lapse with value left (Packages). A person
// is an id in a cell, never a name (§2.6). Same rules as every named read (queries.ts). Type-only import: queries.ts
// spreads WATCH_PEOPLE_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const asOf = z.strictObject({ as_of: z.iso.date() });

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;

export const WATCH_PEOPLE_QUERIES: [string, NamedQuery][] = [
  [
    // A staff member's advances given by as_of, less what salary runs recovered (a reversed run's lines net out),
    // recoveries clearing the oldest advance first; flagged when the oldest advance still open was given more than 30
    // days before as_of. At stake: what is still outstanding.
    'watch.unrecovered_advance',
    {
      params: asOf,
      order: ['as_of'],
      key: ['staff_id'],
      columns: { staff_id: text, outstanding: rupees, oldest_given_on: day, days_outstanding: int },
      sql: `with given as (
              select a.tenant_id, a.staff_id, a.currency, a.given_on, a.amount_minor,
                     sum(a.amount_minor) over (partition by a.staff_id, a.currency order by a.given_on, a.id)::bigint as running
                from books.advance a where ${live('books.advance', 'a')} and a.given_on <= $1::date
            ),
            recovered as (
              select l.staff_id, l.currency, sum(l.advance_recovered_minor)::bigint as recovered from books.salary_line l group by l.staff_id, l.currency
            ),
            open as (
              select g.*, greatest(0, least(g.amount_minor, g.running - coalesce(r.recovered, 0))) as open_minor
                from given g left join recovered r using (staff_id, currency)
            ),
            per as (
              select o.tenant_id, o.staff_id, o.currency, sum(o.open_minor)::bigint as outstanding,
                     min(o.given_on) filter (where o.open_minor > 0) as oldest
                from open o group by o.tenant_id, o.staff_id, o.currency
            )
            select p.staff_id::text as staff_id, p.outstanding, p.oldest::text as oldest_given_on, $1::date - p.oldest as days_outstanding, p.currency
              from per p
             where p.outstanding > 0 and p.oldest < $1::date - 30
             order by p.oldest, p.staff_id
             limit 500`,
    },
  ],
  [
    // A regular who stopped coming: 3 or more live sales naming the customer, the last on or before as_of − 60. At
    // stake: their average monthly spend — what they spent × 30 / the days from their first visit to their last (at
    // least 30), rounded down.
    'watch.regulars_lapsing',
    {
      params: asOf,
      order: ['as_of'],
      key: ['customer_id'],
      columns: { customer_id: text, visits: int, first_visit_on: day, last_visit_on: day, spend: rupees, monthly_spend: rupees },
      sql: `with ${TZ},
            visits as (
              select s.customer_id, s.currency, count(*)::bigint as n, sum(s.total_minor)::bigint as spend,
                     min((s.sold_at at time zone (select time_zone from tz))::date) as first_on,
                     max((s.sold_at at time zone (select time_zone from tz))::date) as last_on
                from books.sale s
               where s.customer_id is not null and ${live('books.sale', 's')}
                 and s.sold_at < (($1::date + 1)::timestamp at time zone (select time_zone from tz))
               group by s.customer_id, s.currency
            )
            select v.customer_id::text as customer_id, v.n as visits, v.first_on::text as first_visit_on, v.last_on::text as last_visit_on,
                   v.spend, v.spend * 30 / greatest(v.last_on - v.first_on + 1, 30) as monthly_spend, v.currency
              from visits v
             where v.n >= 3 and v.last_on <= $1::date - 60
             order by v.last_on, v.customer_id
             limit 500`,
    },
  ],
  [
    // A package holding that lapses within 14 days of as_of — or has lapsed — with value or sessions left (the last
    // entry's running balances, b_package_tally). At stake: the value left. Before its expiry the recipe reminds the
    // customer; after it, it drafts package.expire, which clears the holding and so its finding.
    'watch.package_expiry',
    {
      params: asOf,
      order: ['as_of'],
      key: ['holding_id'],
      columns: { holding_id: text, customer_id: text, expires_on: day, days_left: int, value_left: rupees, sessions_left: int },
      sql: `with held as (
              select h.id, h.customer_id, h.expires_on, h.currency,
                     coalesce((select e.value_after from books.package_entry e where e.tenant_id = h.tenant_id and e.holding_id = h.id
                                order by e.seq desc limit 1), 0)::bigint as value_left,
                     (select coalesce(sum((select e.sessions_after from books.package_entry e
                                            where e.tenant_id = h.tenant_id and e.holding_id = h.id and e.item_id = pl.item_id
                                            order by e.seq desc limit 1)), 0)
                        from books.package_plan_line pl where pl.tenant_id = h.tenant_id and pl.plan_id = h.plan_id)::bigint as sessions_left
                from books.package_holding h
               where h.expires_on <= $1::date + 14
            )
            select h.id::text as holding_id, h.customer_id::text as customer_id, h.expires_on::text as expires_on, h.expires_on - $1::date as days_left,
                   h.value_left, h.sessions_left, h.currency
              from held h
             where h.value_left > 0 or h.sessions_left > 0
             order by h.expires_on, h.id
             limit 500`,
    },
  ],
];
