// Named reads for orders. No person's name enters a cell: a customer is an id, a quote's typist a member id, and
// screens name them (people.ts). Type-only import: queries.ts spreads ORDER_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;

// An order's advance still held: its payments in less refunds out, less the delivery sales' debits to
// customer_advance, less what was kept as the customer's credit (a credit entry naming one of its payments, negative:
// in the customer's favour, so it is added). `o` is a books.order alias.
export const unappliedAdvance = (o: string) =>
  `(coalesce((select sum(case p.direction when 'in' then p.amount_minor else -p.amount_minor end) from books.payment p
               where p.tenant_id = ${o}.tenant_id and p.order_id = ${o}.id), 0)
    - coalesce((select sum(jl.amount_minor) from books.journal_line jl
                  join books.journal_entry j on j.tenant_id = jl.tenant_id and j.id = jl.entry_id
                  join books.sale s on s.tenant_id = j.tenant_id and s.id = j.source_id
                 where jl.tenant_id = ${o}.tenant_id and s.order_id = ${o}.id and jl.account = 'customer_advance'), 0)
    + coalesce((select sum(e.amount_minor) from books.credit_entry e join books.payment p on p.tenant_id = e.tenant_id and p.id = e.payment_id
                 where e.tenant_id = ${o}.tenant_id and p.order_id = ${o}.id), 0))::bigint`;

export const ORDER_QUERIES: [string, NamedQuery][] = [
  [
    // The board: every live order at one of `steps` (the caller passes ref.order_step's non-terminal codes), from the
    // projection z_order_state keeps. Measured at volume: estimated 42 rows for 42, 0.28 ms.
    'order.board',
    {
      params: z.strictObject({ steps: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1).max(20) }),
      order: ['steps'],
      key: ['order_id'],
      columns: { step: text, order_id: text, code: text, kind: text, due_on: day, trial_on: day, customer_id: text },
      sql: `select st.step, st.order_id::text as order_id, o.code, o.kind, st.due_on::text as due_on, st.trial_on::text as trial_on, o.customer_id::text as customer_id
  from ops.order_state st join books.order o on o.tenant_id = st.tenant_id and o.id = st.order_id
 where st.step = any ($1::text[])
   and not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id)
 order by st.step, st.due_on nulls last, o.code limit 500`,
    },
  ],
  [
    // An order's card: its lines at the promised prices, each priced by a books.price row or by a member's own typed
    // quote (priced_by `quote`, quoted_by the member who typed it, shown "typed by <name>"); the total is the lines'
    // sum and the advance what is still held. Both ride on every line row.
    'order.lines',
    {
      params: z.strictObject({ order_id: z.guid() }),
      order: ['order_id'],
      key: ['line_no'],
      columns: {
        line_no: int,
        item_id: text,
        item: text,
        qty,
        unit_price: rupees,
        priced_by: text,
        quoted_by: text,
        amount: rupees,
        total: rupees,
        advance: rupees,
      },
      sql: `select l.line_no, l.item_id::text as item_id, ${itemName('i')} as item, i.unit, l.qty_milli as qty, l.unit_price_minor as unit_price,
                   case when l.quote_input_id is null then 'price' else 'quote' end as priced_by, q.member_id::text as quoted_by,
                   l.gross_minor as amount, (sum(l.gross_minor) over ())::bigint as total, ${unappliedAdvance('o')} as advance, l.currency
              from books.order o
              join books.order_line l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.reverses_id is null
              join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
              left join ops.member_input q on q.tenant_id = l.tenant_id and q.id = l.quote_input_id
             where o.id = $1::uuid
             order by l.line_no
             limit 500`,
    },
  ],
  [
    // A run's reading of an order message: each quantity span the database re-parsed (ops.inbound_extract),
    // paired in reading order with the run's item span of the same rank, which names the catalogue item code matched
    // (a quantity span cannot name its item). A quantity whose item matched nothing has no unit, so its cell is null
    // and no draft can cite it.
    'order.extracts',
    {
      params: z.strictObject({ message_id: z.guid(), run_id: z.guid() }),
      order: ['message_id', 'run_id'],
      key: ['extract_id'],
      columns: { line_no: int, extract_id: text, item_id: text, qty, span_start: int, span_end: int },
      sql: `with x as (
              select e.*, row_number() over (partition by e.field order by e.span_start, e.id) as n
                from ops.inbound_extract e
               where e.message_id = $1::uuid and e.run_id = $2::uuid and e.field in ('item', 'quantity')
            )
            select q.n::int as line_no, q.id::text as extract_id, i.item_id::text as item_id, it.unit,
                   case when it.unit is null then null else q.num end as qty, q.span_start, q.span_end
              from x q
              left join x i on i.field = 'item' and i.n = q.n
              left join books.item it on it.tenant_id = i.tenant_id and it.id = i.item_id
             where q.field = 'quantity'
             order by q.n
             limit 500`,
    },
  ],
  [
    // A waiting site or widget request's lines as order.confirm would price them now (the orders screen's requests):
    // the stored quantity, the books.price in effect and the counter's line amount (money.ts lineAmount: half away from
    // zero), with the lines' total on every row. A line with no price in effect has null price and amount, and then so
    // has the total. A message request has no stored lines, so no rows.
    'order.request_lines',
    {
      params: z.strictObject({ request_id: z.guid() }),
      order: ['request_id'],
      key: ['line_no'],
      columns: { line_no: int, item_id: text, item: text, qty, unit_price: rupees, amount: rupees, total: rupees },
      sql: `with l as (
              select r.tenant_id, x.n, (x.v ->> 'itemId')::uuid as item_id, (x.v ->> 'qtyMilli')::bigint as qty_milli
                from ops.order_request r cross join lateral jsonb_array_elements(r.lines) with ordinality x(v, n)
               where r.id = $1::uuid
            ),
            priced as (
              select l.*, i.unit, ${itemName('i')} as item,
                     (select p.amount_minor from books.price p where p.tenant_id = l.tenant_id and p.item_id = l.item_id and p.effective_from <= now()
                        and p.currency = (select currency from ops.tenant) order by p.effective_from desc, p.created_at desc, p.id desc limit 1) as unit_price
                from l join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
            )
            select n::bigint as line_no, item_id::text as item_id, item, unit, qty_milli as qty, unit_price,
                   ((qty_milli * unit_price + 500) / 1000)::bigint as amount,
                   (case when count(unit_price) over () = count(*) over () then sum((qty_milli * unit_price + 500) / 1000) over () end)::bigint as total,
                   (select currency from ops.tenant) as currency
              from priced
             order by n
             limit 500`,
    },
  ],
  [
    // A measurement's values, one per point, in millimetres; null once erased with its contact.
    'measurement.values',
    {
      params: z.strictObject({ measurement_id: z.guid() }),
      order: ['measurement_id'],
      key: ['point'],
      columns: { point: text, mm: int },
      sql: 'select v.point, v.mm from ops.measurement_value v where v.measurement_id = $1::uuid order by v.point limit 500',
    },
  ],
];
