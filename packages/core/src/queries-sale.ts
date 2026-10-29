// Named reads for the counter sale: the quote before a bill is recorded, the receipt after, and a range's takings. An
// item's name is its latest revision in effect; a customer is named by id only: no person's name enters a cell
// (BLUEPRINT §2.6), since a pinned snapshot would outlive their erasure. Type-only import: queries.ts spreads
// SALE_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const date = z.iso.date();
const span = (p: { from: string; to: string }) => p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 < 92;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;
// A line amount in minor units, rounded half away from zero: money.ts lineAmount, which sale.record uses.
const lineAmount = (x: string) => `(case when ${x} < 0 then -((-(${x}) + 500) / 1000) else (${x} + 500) / 1000 end)`;
// D-053's split, as sale.record's splitByValue does it: over `src`'s rows of value `v` > 0, per group `grp`, the amount
// `d` pro rata by value; every row but the largest (by value, then line_no) rounded down, the largest the remainder up
// to its own value, any excess a paisa each to the next largest. Gives (grp, line_no, share).
const split = (src: string, grp: string, v: string, d: string) =>
  `select grp, line_no, (case when r = 1 then least(d - sum(f) over w, v)
                              else f + case when r - 1 <= greatest(d - sum(f) over w - vmax, 0) then 1 else 0 end end)::bigint as share
     from (select *, case when r = 1 then 0 else floor(d::numeric * v / vt)::bigint end as f
             from (select ${grp} as grp, line_no, ${v} as v, ${d} as d, sum(${v}) over (partition by ${grp}) as vt,
                          max(${v}) over (partition by ${grp}) as vmax, row_number() over (partition by ${grp} order by ${v} desc, line_no) as r
                     from ${src} where ${v} > 0) a) b
   window w as (partition by grp)`;
const offerCode = z.string().regex(/^[A-Z0-9]{4,16}$/);

export const SALE_QUERIES: [string, NamedQuery][] = [
  [
    // The counter's bill before it is recorded. The lines travel as two parallel arrays (a driver turns an array of
    // objects into a Postgres array literal, not JSON). The price is the one sale.record would pick right now: the
    // latest books.price in effect, in the shop's currency; a line with none has null price and amount, and then so
    // does the total. price_by says whether the price came from an approved draft or a person's own entry.
    'sale.quote',
    {
      params: z
        .strictObject({
          item_ids: z.array(z.guid()).min(1).max(100),
          qty_milli: z.array(z.number().int().positive().max(1_000_000_000)).min(1).max(100),
        })
        .refine((p) => p.item_ids.length === p.qty_milli.length),
      order: ['item_ids', 'qty_milli'],
      key: ['line_no'],
      columns: { line_no: int, item_id: text, item: text, qty, unit_price: rupees, price_from: stamp, price_by: text, amount: rupees, total: rupees },
      sql: `with t as (select currency from ops.tenant),
            priced as (
              select l.n::int as line_no, i.id as item_id, ${itemName('i')} as name, i.unit, l.q as qty_milli, pr.amount_minor, pr.effective_from, pr.by,
                     case when pr.amount_minor is null then null else ${lineAmount('l.q * pr.amount_minor')} end as amount
                from unnest($1::uuid[], $2::bigint[]) with ordinality as l(item, q, n)
                join books.item i on i.id = l.item
                left join lateral (
                  select p.amount_minor, p.effective_from, case when p.decision_id is null then 'direct' else 'approved' end as by
                    from books.price p
                   where p.item_id = l.item and p.effective_from <= now() and p.currency = (select currency from t)
                   order by p.effective_from desc, p.created_at desc, p.id desc
                   limit 1
                ) pr on true
            )
            select line_no, item_id::text as item_id, name as item, unit, qty_milli as qty, amount_minor as unit_price, effective_from as price_from,
                   by as price_by, amount,
                   (case when count(*) filter (where amount is null) over () > 0 then null else sum(amount) over () end)::bigint as total,
                   (select currency from t) as currency
              from priced
             order by line_no
             limit 500`,
    },
  ],
  [
    // A recorded sale: its lines at the prices it was sold at, each line's discounts and what it came to, the total, how
    // it was paid (a tender not used is 0; the rest is on the customer's credit) and when. The sale-level cells ride on
    // every line row.
    'sale.receipt',
    {
      params: z.strictObject({ sale_id: z.guid() }),
      order: ['sale_id'],
      key: ['line_no'],
      columns: {
        line_no: int,
        item: text,
        qty,
        unit_price: rupees,
        amount: rupees,
        discount: rupees,
        net: rupees,
        total: rupees,
        cash: rupees,
        upi: rupees,
        card: rupees,
        on_credit: rupees,
        sold_at: stamp,
        customer_id: text,
      },
      sql: `select sl.line_no, ${itemName('i')} as item, i.unit, sl.qty_milli as qty, sl.unit_price_minor as unit_price,
                   sl.gross_minor as amount, off.amount as discount, (sl.gross_minor - off.amount)::bigint as net, s.total_minor as total,
                   pay.cash, pay.upi, pay.card, (s.total_minor - pay.cash - pay.upi - pay.card)::bigint as on_credit,
                   s.sold_at, s.customer_id::text as customer_id, s.currency
              from books.sale s
              join books.sale_line sl on sl.tenant_id = s.tenant_id and sl.sale_id = s.id
              join books.item i on i.tenant_id = sl.tenant_id and i.id = sl.item_id
              cross join lateral (
                select coalesce(sum(p.amount_minor) filter (where p.method = 'cash'), 0)::bigint as cash,
                       coalesce(sum(p.amount_minor) filter (where p.method = 'upi'), 0)::bigint as upi,
                       coalesce(sum(p.amount_minor) filter (where p.method = 'card'), 0)::bigint as card
                  from books.payment p
                 where p.tenant_id = s.tenant_id and p.sale_id = s.id and ${live('books.payment', 'p')}
              ) pay
              cross join lateral (
                select coalesce(sum(d.amount_minor), 0)::bigint as amount from books.sale_discount d
                 where d.tenant_id = sl.tenant_id and d.sale_id = sl.sale_id and d.line_no = sl.line_no
              ) off
             where s.id = $1::uuid
             order by sl.line_no
             limit 500`,
    },
  ],
  [
    // The counter's bill with its offer codes and a loyalty redemption, judged now as sale.record judges them at the
    // moment of sale (O1: a sale recorded now equals this to the paisa). An offer counts if it is in effect, covers a
    // line that is not a package, and its in-scope gross meets its minimum spend; each line takes at most one offer,
    // its best percentage (a tie to the lower offer id), else the lowest-id amount-off covering it, whose amount (at
    // most its lines' gross) is split over its lines by D-053. Points count when the customer is named, they reach the
    // rule's minimum, their value is no more than the bill after offers and within the balance; they are split by D-053
    // over the lines after offers. A code that does not count adds nothing here; sale.record refuses it. A line with no
    // price has no amount, and then neither has any total.
    'sale.quote_offers',
    {
      params: z
        .strictObject({
          item_ids: z.array(z.guid()).min(1).max(100),
          qty_milli: z.array(z.number().int().positive().max(1_000_000_000)).min(1).max(100),
          offer_codes: z
            .array(offerCode)
            .max(3)
            .refine((c) => new Set(c).size === c.length)
            .default([]),
          customer_id: z.guid().nullable().default(null),
          redeem_points: z.number().int().positive().max(1_000_000_000).nullable().default(null),
        })
        .refine((p) => p.item_ids.length === p.qty_milli.length),
      order: ['item_ids', 'qty_milli', 'offer_codes', 'customer_id', 'redeem_points'],
      key: ['line_no'],
      columns: {
        line_no: int,
        item_id: text,
        item: text,
        qty,
        unit_price: rupees,
        amount: rupees,
        offer_id: text,
        offer_discount: rupees,
        points_discount: rupees,
        discount: rupees,
        net: rupees,
        total_gross: rupees,
        total_discount: rupees,
        total: rupees,
        points_redeemed: int,
        points_earned: int,
      },
      sql: `with t as (select currency from ops.tenant),
            lines as (
              select l.n::int as line_no, i.id as item_id, i.kind, i.unit, l.q as qty_milli, rev.name, rev.category, pr.amount_minor,
                     case when pr.amount_minor is null then null else ${lineAmount('l.q * pr.amount_minor')} end as gross
                from unnest($1::uuid[], $2::bigint[]) with ordinality as l(item, q, n)
                join books.item i on i.id = l.item
                left join lateral (select r.name, r.category from books.item_revision r
                                    where r.tenant_id = i.tenant_id and r.item_id = i.id and r.effective_from <= now()
                                    order by r.effective_from desc, r.created_at desc, r.id desc limit 1) rev on true
                left join lateral (select p.amount_minor from books.price p
                                    where p.item_id = l.item and p.effective_from <= now() and p.currency = (select currency from t)
                                    order by p.effective_from desc, p.created_at desc, p.id desc limit 1) pr on true
            ),
            offers as (
              select o.* from books.offer o
               where o.code = any($3::text[]) and o.starts_at <= now() and now() < o.ends_at
                 and not exists (select 1 from books.offer_end e where e.tenant_id = o.tenant_id and e.offer_id = o.id and e.ended_at <= now())
            ),
            covers as (
              select o.id as offer_id, o.kind, o.percent_bp, o.amount_off_minor, o.min_spend_minor, l.line_no, l.gross
                from offers o
                join lines l on l.kind <> 'package' and l.gross is not null
                 and (o.scope = 'all' or (o.scope = 'category' and l.category = o.category)
                      or (o.scope = 'items' and exists (select 1 from books.offer_item oi where oi.tenant_id = o.tenant_id and oi.offer_id = o.id and oi.item_id = l.item_id)))
            ),
            eligible as (
              select c.* from covers c where (select sum(x.gross) from covers x where x.offer_id = c.offer_id) >= coalesce(c.min_spend_minor, 0)
            ),
            pct as (
              select distinct on (line_no) line_no, offer_id, (gross * percent_bp + 5000) / 10000 as amount
                from eligible where kind = 'percent_off' order by line_no, percent_bp desc, offer_id
            ),
            amt_lines as (
              select distinct on (e.line_no) e.line_no, e.offer_id, e.gross, e.amount_off_minor
                from eligible e where e.kind = 'amount_off' and not exists (select 1 from pct p where p.line_no = e.line_no)
               order by e.line_no, e.offer_id
            ),
            amt as (${split('amt_lines', 'offer_id', 'gross', 'least(amount_off_minor, sum(gross) over (partition by offer_id))')}),
            offer_off as (select line_no, offer_id, amount from pct union all select line_no, grp, share from amt),
            after as (
              select l.line_no, case when l.kind = 'package' then 0 else l.gross - coalesce(o.amount, 0) end as open
                from lines l left join offer_off o on o.line_no = l.line_no
            ),
            rule as (
              select earn_per_100, point_value_minor, min_redeem from books.loyalty_rule
               where effective_from <= now() and currency = (select currency from t)
               order by effective_from desc, created_at desc, id desc limit 1
            ),
            redeem as (
              select $5::bigint as points, $5::bigint * r.point_value_minor as d from rule r
               where $4::uuid is not null and $5::bigint >= r.min_redeem
                 and $5::bigint * r.point_value_minor <= (select sum(open) from after)
                 and $5::bigint <= coalesce((select e.balance_after from books.loyalty_entry e where e.customer_id = $4::uuid order by e.seq desc limit 1), 0)
            ),
            loyal_src as (select 0 as grp, a.line_no, a.open, r.d from after a cross join redeem r),
            loyal as (${split('loyal_src', 'grp', 'open', 'd')}),
            billed as (
              select l.*, case when o.amount > 0 then o.offer_id end as offer_id, coalesce(o.amount, 0) as offer_off, coalesce(y.share, 0) as points_off
                from lines l left join offer_off o on o.line_no = l.line_no left join loyal y on y.line_no = l.line_no
            ),
            totals as (
              select case when count(*) filter (where gross is null) > 0 then null else sum(gross) end as gross,
                     sum(offer_off + points_off) as discount
                from billed
            )
            select b.line_no, b.item_id::text as item_id, b.name as item, b.unit, b.qty_milli as qty, b.amount_minor as unit_price, b.gross as amount,
                   b.offer_id::text as offer_id, b.offer_off::bigint as offer_discount, b.points_off::bigint as points_discount,
                   (b.offer_off + b.points_off)::bigint as discount, (b.gross - b.offer_off - b.points_off)::bigint as net,
                   x.gross::bigint as total_gross, x.discount::bigint as total_discount, (x.gross - x.discount)::bigint as total,
                   coalesce((select points from redeem), 0)::bigint as points_redeemed,
                   case when $4::uuid is null or x.gross is null then 0
                        else coalesce((select ((x.gross - x.discount) * r.earn_per_100) / 10000 from rule r), 0) end::bigint as points_earned,
                   (select currency from t) as currency
              from billed b cross join totals x
             order by b.line_no
             limit 500`,
    },
  ],
  [
    // Counter sales from..to (at most 92 days) as one row: bills, the total, each tender's total, what was left on credit.
    'sales.week_total',
    {
      params: z.strictObject({ from: date, to: date }).refine(span),
      order: ['from', 'to'],
      key: ['bills'],
      columns: { bills: int, total: rupees, cash: rupees, upi: rupees, card: rupees, on_credit: rupees },
      sql: `with t as (select time_zone, currency from ops.tenant),
            sales as (
              select s.id, s.total_minor, pay.cash, pay.upi, pay.card
                from books.sale s
                cross join lateral (
                  select coalesce(sum(p.amount_minor) filter (where p.method = 'cash'), 0) as cash,
                         coalesce(sum(p.amount_minor) filter (where p.method = 'upi'), 0) as upi,
                         coalesce(sum(p.amount_minor) filter (where p.method = 'card'), 0) as card
                    from books.payment p
                   where p.tenant_id = s.tenant_id and p.sale_id = s.id and ${live('books.payment', 'p')}
                ) pay
               where ${live('books.sale', 's')} and s.currency = (select currency from t)
                 and s.sold_at >= ($1::date::timestamp at time zone (select time_zone from t))
                 and s.sold_at < (($2::date + 1)::timestamp at time zone (select time_zone from t))
            )
            select count(id)::bigint as bills, coalesce(sum(total_minor), 0)::bigint as total, coalesce(sum(cash), 0)::bigint as cash,
                   coalesce(sum(upi), 0)::bigint as upi, coalesce(sum(card), 0)::bigint as card,
                   coalesce(sum(total_minor - cash - upi - card), 0)::bigint as on_credit, (select currency from t) as currency
              from sales`,
    },
  ],
];
