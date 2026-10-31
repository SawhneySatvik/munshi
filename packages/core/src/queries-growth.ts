// Growth readings (the Paytm edition's /app/growth): peak hours by weekday, new versus repeat customers, the average
// basket by week, slow movers and the payment-mode mix, all from the shop's own live sales and payments. Same rules as
// every named read (queries.ts): read-only under the tenant's RLS, at most 500 rows in a stable order, integral numbers,
// declared columns and key; every figure is derived here in SQL, so a screen only ever renders cells. A window is
// WINDOW_DAYS business days ending at `as_of` (the caller passes yesterday: today's counter is still open). No customer
// name or id is ever a cell: the customer reading is counts only. Type-only import: queries.ts spreads GROWTH_QUERIES
// while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

export const WINDOW_DAYS = 28;
export const SLOW_DAYS = 30;
const asOf = z.strictObject({ as_of: z.iso.date() });

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const zone = `(select time_zone from tz)`;
const startOf = (d: string) => `(${d}::timestamp at time zone ${zone})`;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;
// The window's live sales in the shop's currency, with the shop-local time of each.
const WINDOW_SALES = `select s.id, s.tenant_id, s.customer_id, s.total_minor, s.sold_at, (s.sold_at at time zone ${zone}) as local_at
                from books.sale s
               where ${live('books.sale', 's')} and s.currency = (select currency from tz)
                 and s.sold_at >= ${startOf(`($1::date - ${WINDOW_DAYS - 1})`)} and s.sold_at < ${startOf('($1::date + 1)')}`;

export const GROWTH_QUERIES: [string, NamedQuery][] = [
  [
    // For each weekday that had a sale: the hour of the day with the most bills (the earlier hour on a tie), its bills and takings.
    'growth.peak_hours',
    {
      params: asOf,
      order: ['as_of'],
      key: ['weekday'],
      columns: { weekday: text, hour: int, bills: int, total: rupees },
      sql: `with ${TZ},
            w as (${WINDOW_SALES}),
            h as (
              select extract(isodow from local_at)::int as dow, extract(hour from local_at)::int as hr, count(*) as bills, sum(total_minor) as total
                from w group by 1, 2
            ),
            p as (select distinct on (dow) dow, hr, bills, total from h order by dow, bills desc, hr)
            select substr('MonTueWedThuFriSatSun', (dow - 1) * 3 + 1, 3) as weekday, hr::bigint as hour, bills::bigint as bills, total::bigint as total,
                   (select currency from tz) as currency
              from p order by dow
             limit 7`,
    },
  ],
  [
    // One row: the customers named on the window's bills, how many are new (their only bill ever is in the window) and how
    // many repeat (two or more bills in the window, or a bill before it), and the bills with no customer recorded.
    'growth.customers',
    {
      params: asOf,
      order: ['as_of'],
      key: ['customers'],
      columns: { customers: int, new_customers: int, repeat_customers: int, named_bills: int, anonymous_bills: int },
      sql: `with ${TZ},
            w as (${WINDOW_SALES}),
            c as (
              select tenant_id, customer_id, count(*) as n,
                     exists (select 1 from books.sale p where p.tenant_id = w.tenant_id and p.customer_id = w.customer_id
                                and p.sold_at < ${startOf(`($1::date - ${WINDOW_DAYS - 1})`)} and ${live('books.sale', 'p')}) as before
                from w where customer_id is not null group by tenant_id, customer_id
            )
            select (select count(*) from c)::bigint as customers,
                   (select count(*) from c where n = 1 and not before)::bigint as new_customers,
                   (select count(*) from c where n > 1 or before)::bigint as repeat_customers,
                   (select count(*) from w where customer_id is not null)::bigint as named_bills,
                   (select count(*) from w where customer_id is null)::bigint as anonymous_bills`,
    },
  ],
  [
    // The average basket (takings per bill) for each of the window's four weeks, oldest first, and whether it rose or fell
    // against the week before ('none' for the first week or a week without bills).
    'growth.basket',
    {
      params: asOf,
      order: ['as_of'],
      key: ['week_from'],
      columns: { week_from: day, bills: int, total: rupees, average: rupees, trend: text },
      sql: `with ${TZ},
            w as (${WINDOW_SALES}),
            wk as (
              select k, ($1::date - ${WINDOW_DAYS - 1} + 7 * k) as week_from,
                     (select count(*) from w where (local_at::date - ($1::date - ${WINDOW_DAYS - 1})) / 7 = k)::bigint as bills,
                     (select coalesce(sum(total_minor), 0) from w where (local_at::date - ($1::date - ${WINDOW_DAYS - 1})) / 7 = k)::bigint as total
                from generate_series(0, ${WINDOW_DAYS / 7 - 1}) as k
            ),
            a as (select *, case when bills > 0 then (total + bills / 2) / bills end as average from wk)
            select week_from::text as week_from, bills::bigint as bills, total::bigint as total, average::bigint as average,
                   case when average is null or lag(average) over (order by k) is null then 'none'
                        when average > lag(average) over (order by k) then 'up' when average < lag(average) over (order by k) then 'down' else 'flat' end as trend,
                   (select currency from tz) as currency
              from a order by k`,
    },
  ],
  [
    // Goods in stock with no sale for days days (or never, and bought longer ago than that): what is on the shelf and the
    // day of its last sale. The least recently sold first.
    'growth.slow_movers',
    {
      params: z.strictObject({ as_of: z.iso.date(), days: z.number().int().min(7).max(180) }),
      order: ['as_of', 'days'],
      key: ['item_id'],
      columns: { item_id: text, item: text, on_hand: qty, last_sold_on: day },
      sql: `with ${TZ},
            bounds as (select (($1::date + 1)::timestamp at time zone ${zone}) as end_at),
            moves as (
              select m.tenant_id, m.item_id, sum(m.qty_milli)::bigint as on_hand, min(m.at) as first_at,
                     max(m.at) filter (where m.kind = 'sale' and m.qty_milli < 0 and m.reverses_id is null
                                         and not exists (select 1 from books.stock_move rv where rv.tenant_id = m.tenant_id and rv.reverses_id = m.id)) as last_sale_at
                from books.stock_move m where m.at < (select end_at from bounds)
               group by m.tenant_id, m.item_id
            )
            select mv.item_id::text as item_id, ${itemName('i')} as item, i.unit, mv.on_hand,
                   (mv.last_sale_at at time zone ${zone})::date::text as last_sold_on
              from moves mv join books.item i on i.tenant_id = mv.tenant_id and i.id = mv.item_id
             where mv.on_hand > 0 and coalesce(mv.last_sale_at, mv.first_at) < (select end_at from bounds) - make_interval(days => $2::int)
             order by mv.last_sale_at nulls first, 2, mv.item_id
             limit 50`,
    },
  ],
  [
    // The money received in the window by how it was paid, as recorded (cash, UPI, card, bank): payments, the amount, and the
    // share of all money received in basis points. Sales left on credit are not payments and are not in it.
    'growth.payment_mix',
    {
      params: asOf,
      order: ['as_of'],
      key: ['method'],
      columns: { method: text, payments: int, amount: rupees, share_bp: int },
      sql: `with ${TZ},
            p as (
              select pm.method, count(*) as payments, sum(pm.amount_minor)::bigint as amount
                from books.payment pm
               where pm.direction = 'in' and ${live('books.payment', 'pm')} and pm.currency = (select currency from tz)
                 and pm.paid_at >= ${startOf(`($1::date - ${WINDOW_DAYS - 1})`)} and pm.paid_at < ${startOf('($1::date + 1)')}
               group by pm.method
            )
            select method, payments::bigint as payments, amount::bigint as amount,
                   (case when sum(amount) over () > 0 then (amount * 10000 + (sum(amount) over ())::bigint / 2) / (sum(amount) over ())::bigint else 0 end)::bigint as share_bp,
                   (select currency from tz) as currency
              from p order by array_position(array['cash', 'upi', 'card', 'bank'], method)
             limit 500`,
    },
  ],
];
