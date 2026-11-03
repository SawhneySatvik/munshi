// The daily brief's reads: the ranking of a branch's open findings, whose order is itself a cell (`rank`) of a snapshot
// the brief pins, and the branch's figures for the morning. Same rules as every named read (queries.ts). Type-only
// import: queries.ts spreads WATCH_BRIEF_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const branch = z.strictObject({ as_of: z.iso.date(), shop_id: z.guid() });

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;

export const WATCH_BRIEF_QUERIES: [string, NamedQuery][] = [
  [
    // The top five open findings of a branch (its own and the tenant-wide ones), by |impact| × (1 + 0.05 × min(days
    // open, 14)) — computed exactly as |impact| × (20 + min(days, 14)) — then severity, then age. The impact is the
    // finding's own impact cell (none counts as zero); days open count business days from its first sighting to as_of.
    'brief.ranked',
    {
      params: branch,
      order: ['as_of', 'shop_id'],
      key: ['finding_id'],
      columns: { rank: int, finding_id: text, kind: text, desk: text, severity: text, days_open: int },
      sql: `with ${TZ},
            open as (
              select f.id, f.kind, f.desk, f.severity, f.first_seen_at,
                     greatest(0, $1::date - (f.first_seen_at at time zone (select time_zone from tz))::date) as days_open,
                     abs(coalesce((select (s.rows -> f.snapshot_row -> (c.i - 1)::int ->> 'n')::bigint
                                     from snap.snapshot s, jsonb_array_elements(s.columns) with ordinality c(v, i)
                                    where s.tenant_id = f.tenant_id and s.id = f.snapshot_id and c.v ->> 'n' = f.impact_col), 0)) as impact
                from ai.finding f
               where f.status = 'open' and (f.shop_id is null or f.shop_id = $2::uuid)
            ),
            scored as (
              select o.*, o.impact * (20 + least(o.days_open, 14)) as score,
                     case o.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end as weight
                from open o
            )
            select (row_number() over (order by s.score desc, s.weight desc, s.first_seen_at, s.id))::bigint as rank,
                   s.id::text as finding_id, s.kind, s.desk, s.severity, s.days_open::bigint as days_open
              from scored s
             order by s.score desc, s.weight desc, s.first_seen_at, s.id
             limit 5`,
    },
  ],
  [
    // A branch's morning: yesterday's live sales and their bills, today's requested and confirmed bookings, and the
    // tenant's package holdings lapsing within the week with value left. One row, always.
    'brief.figures',
    {
      params: branch,
      order: ['as_of', 'shop_id'],
      key: [],
      columns: { sales_yesterday: rupees, bills_yesterday: int, bookings_today: int, packages_expiring: int },
      sql: `with ${TZ},
            sold as (
              select coalesce(sum(s.total_minor), 0)::bigint as total, count(*)::bigint as bills
                from books.sale s
               where s.shop_id = $2::uuid and ${live('books.sale', 's')}
                 and (s.sold_at at time zone (select time_zone from tz))::date = $1::date - 1
            )
            select sold.total as sales_yesterday, sold.bills as bills_yesterday,
                   (select count(*) from ops.booking b where b.shop_id = $2::uuid and b.state in ('requested', 'confirmed')
                       and (lower(b.during) at time zone (select time_zone from tz))::date = $1::date)::bigint as bookings_today,
                   (select count(*) from books.package_holding h
                     where h.expires_on between $1::date and $1::date + 6
                       and coalesce((select e.value_after from books.package_entry e where e.tenant_id = h.tenant_id and e.holding_id = h.id
                                      order by e.seq desc limit 1), 0) > 0)::bigint as packages_expiring,
                   (select currency from tz) as currency
              from sold`,
    },
  ],
];
