// The agent's named reads: what a specialist may look at, each a tool (packages/agent/src/tools.ts). Same rules as every
// named read (queries.ts): read-only under the tenant's RLS, at most 500 rows in a stable order (names and dates, never a
// uuid alone, so row numbers survive a reseed), integral numbers, declared columns and key. Reads over a window of days
// take an explicit `as_of` business date (the run's, never the model's), so a re-check re-reads the same window; the
// undated reads (items.list, purchases.last_price) show the books as they stand.
// Type-only import: queries.ts spreads AGENT_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const date = z.iso.date();
const MAX_SPAN_DAYS = 92;
const span = (p: { from: string; to: string }) => p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 < MAX_SPAN_DAYS;

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const zone = `(select time_zone from tz)`;
// A day's first instant in the shop's zone.
const startOf = (d: string) => `(${d}::timestamp at time zone ${zone})`;
// Not a reversal and not reversed.
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
// A line amount in minor units, rounded half away from zero (money.ts lineAmount).
const lineAmount = (x: string) => `(case when ${x} < 0 then -((-(${x}) + 500) / 1000) else (${x} + 500) / 1000 end)`;
// An item's name and category, from its latest revision in effect (books.item_revision: the latest wins, R4 K1).
const revision = (item: string) =>
  `join lateral (select r.name, r.category from books.item_revision r
                  where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
                  order by r.effective_from desc, r.created_at desc, r.id desc limit 1) rev on true`;
// A supplier's or customer's name: the vault's contact, through the party's link in effect (books.party_contact). Only
// ever an ORDER BY key: no person's name enters a snapshot cell (BLUEPRINT §2.6); a read carries the party's id.
const partyName = (party: 'customer_id' | 'supplier_id', alias: string) =>
  `(select ct.name from books.party_contact pc join ops.contact ct on ct.tenant_id = pc.tenant_id and ct.id = pc.contact_id
     where pc.tenant_id = ${alias}.tenant_id and pc.${party} = ${alias}.id and pc.effective_from <= now()
     order by pc.effective_from desc, pc.created_at desc, pc.id desc limit 1)`;

export const AGENT_QUERIES: [string, NamedQuery][] = [
  [
    // Every item with what the books hold now: the specialist's way from a name to an item.
    'items.list',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: { item_id: text, item: text, category: text, on_hand: qty },
      sql: `select i.id::text as item_id, rev.name as item, rev.category, i.unit,
                   coalesce((select sum(m.qty_milli) from books.stock_move m where m.tenant_id = i.tenant_id and m.item_id = i.id), 0)::bigint as on_hand
              from books.item i
              ${revision('i')}
             order by rev.name, i.id
             limit 500`,
    },
  ],
  [
    // Counter sales per business day from..to (at most 92 days; a day with no sale is a row of zeros): bills, the
    // total, how it was paid, and what was left on the customer's credit. The days are an integer series, which the
    // planner sizes from its bounds; a timestamp series it sizes at a guess (200 rows estimated for 7, BP-DB-6).
    'sales.by_day',
    {
      params: z.strictObject({ from: date, to: date }).refine(span),
      order: ['from', 'to'],
      key: ['day'],
      columns: { day, bills: int, total: rupees, cash: rupees, upi: rupees, card: rupees, on_credit: rupees },
      sql: `with ${TZ},
            sales as (
              select s.id, s.total_minor, (s.sold_at at time zone ${zone})::date as day, pay.cash, pay.upi, pay.card
                from books.sale s
                cross join lateral (
                  select coalesce(sum(p.amount_minor) filter (where p.method = 'cash'), 0) as cash,
                         coalesce(sum(p.amount_minor) filter (where p.method = 'upi'), 0) as upi,
                         coalesce(sum(p.amount_minor) filter (where p.method = 'card'), 0) as card
                    from books.payment p
                   where p.tenant_id = s.tenant_id and p.sale_id = s.id and p.direction = 'in' and ${live('books.payment', 'p')}
                ) pay
               where ${live('books.sale', 's')} and s.currency = (select currency from tz)
                 and s.sold_at >= ${startOf('$1::date')} and s.sold_at < ${startOf('($2::date + 1)')}
            )
            select d.day::text as day, count(s.id)::bigint as bills, coalesce(sum(s.total_minor), 0)::bigint as total,
                   coalesce(sum(s.cash), 0)::bigint as cash, coalesce(sum(s.upi), 0)::bigint as upi, coalesce(sum(s.card), 0)::bigint as card,
                   coalesce(sum(s.total_minor - s.cash - s.upi - s.card), 0)::bigint as on_credit, (select currency from tz) as currency
              from (select $1::date + n as day from generate_series(0, $2::date - $1::date) as n) as d
              left join sales s on s.day = d.day
             group by d.day
             order by d.day
             limit 500`,
    },
  ],
  [
    // The best sellers from..to by revenue (at most 92 days, at most 50 items): units sold, revenue, bills.
    'sales.by_item',
    {
      params: z.strictObject({ from: date, to: date, limit: z.number().int().min(1).max(50) }).refine(span),
      order: ['from', 'to', 'limit'],
      key: ['item_id'],
      columns: { item_id: text, item: text, sold: qty, revenue: rupees, bills: int },
      sql: `with ${TZ},
            lines as (
              select l.item_id, l.sale_id, l.qty_milli, ${lineAmount('l.qty_milli * l.unit_price_minor')} as amount
                from books.sale s
                join books.sale_line l on l.tenant_id = s.tenant_id and l.sale_id = s.id
               where ${live('books.sale', 's')} and s.currency = (select currency from tz)
                 and s.sold_at >= ${startOf('$1::date')} and s.sold_at < ${startOf('($2::date + 1)')}
            )
            select i.id::text as item_id, rev.name as item, i.unit, sum(l.qty_milli)::bigint as sold, sum(l.amount)::bigint as revenue,
                   count(distinct l.sale_id)::bigint as bills, (select currency from tz) as currency
              from lines l
              join books.item i on i.id = l.item_id
              ${revision('i')}
             group by i.id, rev.name, i.unit
             order by revenue desc, rev.name, i.id
             limit $3`,
    },
  ],
  [
    // The item's latest bill line: who supplied it, on which bill, at what unit cost, how many.
    'purchases.last_price',
    {
      params: z.strictObject({ item_id: z.guid() }),
      order: ['item_id'],
      key: ['item_id'],
      columns: { item_id: text, item: text, supplier_id: text, bill_no: text, bill_date: day, unit_cost: rupees, qty },
      sql: `select i.id::text as item_id, rev.name as item, i.unit, s.id::text as supplier_id, p.bill_no,
                   p.bill_date::text as bill_date, pl.unit_cost_minor as unit_cost, pl.qty_milli as qty, pl.currency
              from books.purchase_line pl
              join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
              join books.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
              ${revision('i')}
             where pl.item_id = $1::uuid and ${live('books.purchase', 'p')}
             order by p.bill_date desc, p.created_at desc, pl.line_no desc
             limit 1`,
    },
  ],
  [
    // Every bill line for the item in the `days` days to as_of (at most 180): the unit cost on each bill, by date.
    'purchases.price_history',
    {
      params: z.strictObject({ item_id: z.guid(), days: z.number().int().min(1).max(180), as_of: date }),
      order: ['item_id', 'days', 'as_of'],
      key: ['line_id'],
      columns: { line_id: text, item: text, bill_date: day, bill_no: text, supplier_id: text, unit_cost: rupees, qty },
      sql: `select pl.id::text as line_id, rev.name as item, i.unit, p.bill_date::text as bill_date, p.bill_no, s.id::text as supplier_id,
                   pl.unit_cost_minor as unit_cost, pl.qty_milli as qty, pl.currency
              from books.purchase_line pl
              join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
              join books.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
              ${revision('i')}
             where pl.item_id = $1::uuid and ${live('books.purchase', 'p')}
               and p.bill_date > $3::date - $2::int and p.bill_date <= $3::date
             order by p.bill_date, p.bill_no, pl.line_no
             limit 500`,
    },
  ],
  [
    // Below the reorder point: there is no reorder level in the books, so the point is cover — what is on hand at the
    // end of as_of lasts fewer than 7 days at the last 28 days' sales. Suggested: enough for 14 days, whole units up.
    // The supplier is the one on the item's latest bill.
    'stock.below_reorder',
    {
      params: z.strictObject({ as_of: date }),
      order: ['as_of'],
      key: ['item_id'],
      columns: { item_id: text, item: text, on_hand: qty, sold_28d: qty, days_cover: int, suggested: qty, supplier_id: text },
      sql: `with ${TZ},
            bounds as (select ${startOf('($1::date + 1)')} as end_at),
            held as (
              select item_id, sum(qty_milli)::bigint as on_hand from books.stock_move where at < (select end_at from bounds) group by item_id
            ),
            sold as (
              select item_id, -sum(qty_milli)::bigint as sold from books.stock_move
               where kind = 'sale' and at >= (select end_at from bounds) - interval '28 days' and at < (select end_at from bounds)
               group by item_id
            ),
            last_bill as (
              select distinct on (pl.item_id) pl.item_id, p.supplier_id
                from books.purchase_line pl
                join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
               where p.bill_date <= $1::date and ${live('books.purchase', 'p')}
               order by pl.item_id, p.bill_date desc, p.created_at desc
            ),
            cover as (
              select i.id, rev.name, i.unit, coalesce(h.on_hand, 0) as on_hand, s.sold, b.supplier_id
                from books.item i
                ${revision('i')}
                join sold s on s.item_id = i.id
                left join held h on h.item_id = i.id
                left join last_bill b on b.item_id = i.id
               where s.sold > 0 and coalesce(h.on_hand, 0) * 28 < s.sold * 7
            )
            select c.id::text as item_id, c.name as item, c.unit, c.on_hand, c.sold as sold_28d, (c.on_hand * 28 / c.sold)::bigint as days_cover,
                   ((c.sold * 14 / 28 - c.on_hand + 999) / 1000 * 1000)::bigint as suggested, c.supplier_id::text as supplier_id
              from cover c
             order by days_cover, c.name, c.id
             limit 500`,
    },
  ],
  [
    // What each customer owes on credit (udhaar) at the end of as_of, and how much of it is past due: repayments clear
    // the oldest credit first. Customers who owe nothing are left out.
    'credit.balances',
    {
      params: z.strictObject({ as_of: date }),
      order: ['as_of'],
      key: ['customer_id'],
      columns: { customer_id: text, balance: rupees, overdue: rupees, oldest_due_on: day },
      sql: `with ${TZ},
            entries as (
              select ce.customer_id, ce.id, ce.amount_minor, ce.due_on, ce.at
                from books.credit_entry ce
               where ${live('books.credit_entry', 'ce')} and ce.currency = (select currency from tz)
                 and ce.at < ${startOf('($1::date + 1)')}
            ),
            repaid as (select customer_id, -sum(amount_minor)::bigint as repaid from entries where amount_minor < 0 group by customer_id),
            given as (
              select e.*, sum(e.amount_minor) over (partition by e.customer_id order by e.at, e.id)::bigint as running
                from entries e where e.amount_minor > 0
            ),
            open as (
              select g.customer_id, g.due_on, greatest(0, least(g.amount_minor, g.running - coalesce(r.repaid, 0)))::bigint as open_minor
                from given g left join repaid r using (customer_id)
            ),
            per as (
              select customer_id, sum(open_minor)::bigint as balance,
                     coalesce(sum(open_minor) filter (where due_on < $1::date), 0)::bigint as overdue,
                     min(due_on) filter (where open_minor > 0) as oldest_due_on
                from open group by customer_id
            )
            select p.customer_id::text as customer_id, p.balance, p.overdue, p.oldest_due_on::text as oldest_due_on,
                   (select currency from tz) as currency
              from per p
              join books.customer c on c.id = p.customer_id
             where p.balance > 0
             order by p.overdue desc, p.balance desc, ${partyName('customer_id', 'c')}, c.id
             limit 500`,
    },
  ],
  [
    // Suppliers' bills dated in the `days` days to as_of (at most 31), newest first.
    'bills.recent',
    {
      params: z.strictObject({ days: z.number().int().min(1).max(31), as_of: date }),
      order: ['days', 'as_of'],
      key: ['purchase_id'],
      columns: { purchase_id: text, bill_no: text, bill_date: day, supplier_id: text, total: rupees, lines: int },
      sql: `select p.id::text as purchase_id, p.bill_no, p.bill_date::text as bill_date, p.supplier_id::text as supplier_id,
                   p.total_minor as total,
                   (select count(*) from books.purchase_line pl where pl.tenant_id = p.tenant_id and pl.purchase_id = p.id)::bigint as lines,
                   p.currency
              from books.purchase p
             where ${live('books.purchase', 'p')} and p.bill_date > $2::date - $1::int and p.bill_date <= $2::date
             order by p.bill_date desc, p.bill_no
             limit 500`,
    },
  ],
];
