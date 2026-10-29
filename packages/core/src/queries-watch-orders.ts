// The Orders desk's watchers (BLUEPRINT §7.3, §8.12): a request left unanswered, an order past its due date, and an
// advance on a closed order that was neither refunded nor applied. Same rules as every named read (queries.ts); the
// thresholds are constants here. A row names its branch (shop_id), so its finding is that branch's. Type-only import:
// queries.ts spreads WATCH_ORDER_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const instant: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const asOf = z.strictObject({ as_of: z.iso.date() });
const atInstant = z.strictObject({ as_of: z.iso.date(), at: z.iso.datetime() });

const liveOrder = (o: string) =>
  `${o}.reverses_id is null and not exists (select 1 from books.order v where v.tenant_id = ${o}.tenant_id and v.reverses_id = ${o}.id)`;
// A line amount in minor units, rounded half away from zero: money.ts lineAmount, which sale.record uses.
const lineAmount = (x: string) => `(case when ${x} < 0 then -((-(${x}) + 500) / 1000) else (${x} + 500) / 1000 end)`;

export const WATCH_ORDER_QUERIES: [string, NamedQuery][] = [
  [
    // A request from any channel still new or drafted 30 minutes after it arrived, and not past its expiry. Its total is
    // derived from its lines (a site or widget request's) at the prices in effect at the run's instant, with the
    // counter's line function; null when it has no lines or one is unpriced. No waiting time is a cell: it would change
    // on every run.
    'watch.order_unanswered',
    {
      params: atInstant,
      order: ['at'],
      key: ['request_id'],
      columns: { request_id: text, shop_id: text, code: text, channel: text, state: text, received_at: instant, total: rupees },
      sql: `select r.id::text as request_id, r.shop_id::text as shop_id, r.code, r.channel, r.state, r.created_at as received_at,
                   (select case when count(p.amount_minor) = jsonb_array_length(r.lines)
                                then sum(${lineAmount("(l.v ->> 'qtyMilli')::bigint * p.amount_minor")}) end
                      from jsonb_array_elements(r.lines) l(v)
                      left join lateral (select pr.amount_minor from books.price pr
                                          where pr.tenant_id = r.tenant_id and pr.item_id = (l.v ->> 'itemId')::uuid
                                            and pr.effective_from <= $1::timestamptz
                                          order by pr.effective_from desc, pr.created_at desc, pr.id desc limit 1) p on true)::bigint as total,
                   (select currency from ops.tenant) as currency
              from ops.order_request r
             where r.state in ('new', 'drafted') and r.created_at <= $1::timestamptz - interval '30 minutes' and r.expires_at > $1::timestamptz
             order by r.created_at, r.id
             limit 500`,
    },
  ],
  [
    // An order whose due date has passed while its current step (ops.order_state, written only by the steps' trigger)
    // is neither ready nor terminal; its total is its lines' gross (a reversed line nets out). The terminal steps are
    // named (ref.order_step's two) so the planner estimates the open orders from its statistics, as the partial index
    // order_state_late holds them; a join to ref.order_step estimated every order (500 for 5 at volume).
    'watch.order_late',
    {
      params: asOf,
      order: ['as_of'],
      key: ['order_id'],
      columns: { order_id: text, shop_id: text, code: text, kind: text, step: text, due_on: day, days_late: int, total: rupees },
      sql: `select o.id::text as order_id, o.shop_id::text as shop_id, o.code, o.kind, st.step, st.due_on::text as due_on,
                   $1::date - st.due_on as days_late,
                   (select coalesce(sum(l.gross_minor), 0) from books.order_line l where l.tenant_id = o.tenant_id and l.order_id = o.id)::bigint as total,
                   o.currency
              from books.order o
              join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id
             where ${liveOrder('o')} and st.due_on < $1::date and st.step not in ('ready', 'cancelled', 'delivered')
             order by st.due_on, o.code, o.id
             limit 500`,
    },
  ],
  [
    // An advance on a cancelled or delivered order that is neither refunded nor applied (§8.12): its payments in less
    // refunds out, less the delivery sales' debits to customer_advance, less credit entries naming its payments — the
    // same sum the erasure hold reads (contact_hold, 21_orders.sql). Only an order a payment names can hold one (an
    // advance is such a payment, and a delivery sale applies or a credit entry keeps only what one paid in), so the
    // closed orders are read through payment_order, not all of them (500 estimated for 25 at volume).
    'watch.advance_unapplied',
    {
      params: asOf,
      order: [],
      key: ['order_id'],
      columns: { order_id: text, shop_id: text, code: text, step: text, unapplied: rupees },
      sql: `with unapplied as (
              select o.tenant_id, o.id, o.shop_id, o.code, o.currency, st.step,
                     coalesce((select sum(case p.direction when 'in' then p.amount_minor else -p.amount_minor end) from books.payment p
                                where p.tenant_id = o.tenant_id and p.order_id = o.id), 0)
                     - coalesce((select sum(l.amount_minor) from books.journal_line l
                                   join books.journal_entry j on j.tenant_id = l.tenant_id and j.id = l.entry_id
                                   join books.sale s on s.tenant_id = j.tenant_id and s.id = j.source_id
                                  where l.tenant_id = o.tenant_id and s.order_id = o.id and l.account = 'customer_advance'), 0)
                     - coalesce((select sum(e.amount_minor) from books.credit_entry e
                                   join books.payment p on p.tenant_id = e.tenant_id and p.id = e.payment_id
                                  where e.tenant_id = o.tenant_id and p.order_id = o.id), 0) as amount
                from books.order o
                join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id
               where ${liveOrder('o')} and st.step in ('cancelled', 'delivered')
                 and exists (select 1 from books.payment p where p.tenant_id = o.tenant_id and p.order_id = o.id)
            )
            select u.id::text as order_id, u.shop_id::text as shop_id, u.code, u.step, u.amount::bigint as unapplied, u.currency
              from unapplied u
             where u.amount <> 0
             order by u.code, u.id
             limit 500`,
    },
  ],
];
