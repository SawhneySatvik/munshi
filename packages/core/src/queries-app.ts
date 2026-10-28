// The screens' named reads: what the counter prices and receipts from, a recorded bill's lines, every item's last
// bill price in one read, and a range's takings. Same rules as every named read (queries.ts). The quote's rounding is
// sale.record's (commands.ts, money.ts lineAmount), computed in SQL so no browser or server code does the arithmetic.
// Type-only import: queries.ts spreads APP_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const stamp: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const date = z.iso.date();
const span = (p: { from: string; to: string }) => p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 < 92;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
// A line amount in minor units, rounded half away from zero: money.ts lineAmount, which sale.record uses.
const lineAmount = (x: string) => `(case when ${x} < 0 then -((-(${x}) + 500) / 1000) else (${x} + 500) / 1000 end)`;

export const APP_QUERIES: [string, NamedQuery][] = [
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
              select l.n::int as line_no, i.id as item_id, i.name, i.unit, l.q as qty_milli, pr.amount_minor, pr.effective_from, pr.by,
                     case when pr.amount_minor is null then null else ${lineAmount('l.q * pr.amount_minor')} end as amount
                from unnest($1::uuid[], $2::bigint[]) with ordinality as l(item, q, n)
                join books.item i on i.id = l.item
                left join lateral (
                  select p.amount_minor, p.effective_from, case when p.decision_id is null then 'direct' else 'approved' end as by
                    from books.price p
                   where p.item_id = l.item and p.effective_from <= now() and p.currency = (select currency from t)
                   order by p.effective_from desc, p.created_at desc
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
    // A recorded sale: its lines at the prices it was sold at, the total, how it was paid (a tender not used is 0; the
    // rest is on the customer's credit) and when. The sale-level cells ride on every line row.
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
        total: rupees,
        cash: rupees,
        upi: rupees,
        card: rupees,
        on_credit: rupees,
        sold_at: stamp,
        customer: text,
      },
      sql: `select sl.line_no, i.name as item, i.unit, sl.qty_milli as qty, sl.unit_price_minor as unit_price,
                   ${lineAmount('sl.qty_milli * sl.unit_price_minor')}::bigint as amount, s.total_minor as total,
                   pay.cash, pay.upi, pay.card, (s.total_minor - pay.cash - pay.upi - pay.card)::bigint as on_credit,
                   s.sold_at, c.name as customer, s.currency
              from books.sale s
              join books.sale_line sl on sl.tenant_id = s.tenant_id and sl.sale_id = s.id
              join books.item i on i.tenant_id = sl.tenant_id and i.id = sl.item_id
              left join books.customer c on c.tenant_id = s.tenant_id and c.id = s.customer_id
              cross join lateral (
                select coalesce(sum(p.amount_minor) filter (where p.method = 'cash'), 0)::bigint as cash,
                       coalesce(sum(p.amount_minor) filter (where p.method = 'upi'), 0)::bigint as upi,
                       coalesce(sum(p.amount_minor) filter (where p.method = 'card'), 0)::bigint as card
                  from books.payment p
                 where p.tenant_id = s.tenant_id and p.sale_id = s.id and ${live('books.payment', 'p')}
              ) pay
             where s.id = $1::uuid
             order by sl.line_no
             limit 500`,
    },
  ],
  [
    // A recorded bill's lines by id: item, quantity, unit cost, amount and expiry, and the unit cost of the same item on
    // the bill before this one (null if none), so a price rise is two cells compared, never a subtraction.
    'bill.lines_for',
    {
      params: z.strictObject({ purchase_id: z.guid() }),
      order: ['purchase_id'],
      key: ['line_id'],
      columns: { line_id: text, line_no: int, item: text, qty, unit_cost: rupees, amount: rupees, expires_on: day, prev_unit_cost: rupees },
      sql: `select pl.id::text as line_id, pl.line_no, i.name as item, i.unit, pl.qty_milli as qty, pl.unit_cost_minor as unit_cost,
                   ${lineAmount('pl.qty_milli * pl.unit_cost_minor')}::bigint as amount, pl.expires_on::text as expires_on,
                   prev.unit_cost_minor as prev_unit_cost, pl.currency
              from books.purchase p
              join books.purchase_line pl on pl.tenant_id = p.tenant_id and pl.purchase_id = p.id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
              left join lateral (
                select b.unit_cost_minor
                  from books.purchase_line b
                  join books.purchase bp on bp.tenant_id = b.tenant_id and bp.id = b.purchase_id
                 where b.item_id = pl.item_id and ${live('books.purchase', 'bp')}
                   and (bp.bill_date, bp.created_at, b.line_no) < (p.bill_date, p.created_at, pl.line_no)
                 order by bp.bill_date desc, bp.created_at desc, b.line_no desc
                 limit 1
              ) prev on true
             where p.id = $1::uuid and ${live('books.purchase', 'p')}
             order by pl.line_no
             limit 500`,
    },
  ],
  [
    // Every item that has been bought, once, at its latest bill line: who supplied it, on which bill, at what unit cost.
    'purchases.last_prices',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: { item_id: text, item: text, supplier_id: text, supplier: text, bill_no: text, bill_date: day, unit_cost: rupees, qty },
      sql: `select distinct on (i.name, i.id) i.id::text as item_id, i.name as item, i.unit, s.id::text as supplier_id, s.name as supplier,
                   p.bill_no, p.bill_date::text as bill_date, pl.unit_cost_minor as unit_cost, pl.qty_milli as qty, pl.currency
              from books.purchase_line pl
              join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
              join books.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
             where ${live('books.purchase', 'p')}
             order by i.name, i.id, p.bill_date desc, p.created_at desc, pl.line_no desc
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
