// PayPal's named reads: what an invoice's sale still owes, and what a confirmed order still needs beyond its advance (the
// cells a PayPal link for that invoice or order asks for); one stored payment notification as cells (the amount PayPal
// says it received, which a "record this payment" draft cites); the shop's links as they stand (what Ask reads); and the
// watcher for a notification no live payment records yet. A payment records a notification when it is
// a live incoming payment from the link's customer whose reference is PayPal's invoice id (payment.record's reference).
// Same rules as every named read (queries.ts). Type-only import: queries.ts spreads PAYPAL_QUERIES while it is still
// being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';
import { unappliedAdvance } from './queries-orders.ts';

const text: Column = { kind: 'text' };
const stamp: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };

const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;

const recorded = (e: string, l: string) =>
  `exists (select 1 from books.payment p
            where p.tenant_id = ${e}.tenant_id and p.direction = 'in' and p.customer_id = ${l}.customer_id and p.reference = ${e}.reference
              and ${live('books.payment', 'p')})`;

/** Where link `l` stands: asked (approved, not yet at PayPal), sent (made, unpaid), paid (PayPal reports it paid; the books
 * do not show it yet), recorded (a live payment records it), failed or cancelled. */
export const linkState = (l: string) => `case when ${l}.status in ('cancelled', 'cancel_queued') then 'cancelled'
                        when ${l}.status = 'failed' then 'failed'
                        when exists (select 1 from ops.payment_event e where e.tenant_id = ${l}.tenant_id and e.link_id = ${l}.id and ${recorded('e', l)}) then 'recorded'
                        when exists (select 1 from ops.payment_event e where e.tenant_id = ${l}.tenant_id and e.link_id = ${l}.id) then 'paid'
                        when ${l}.status = 'sent' then 'sent'
                        else 'asked' end`;

const EVENT_COLUMNS = {
  event_id: text,
  link_id: text,
  customer_id: text,
  reference: text,
  amount: rupees,
  received_at: stamp,
  matches_link: text,
  same_currency: text,
  recorded: text,
};
const EVENT_SELECT = (where: string) => `select e.id::text as event_id, l.id::text as link_id, l.customer_id::text as customer_id, l.order_id::text as order_id, e.reference,
                   e.amount_minor as amount, e.currency, e.received_at,
                   case when e.matches_link then 'yes' else 'no' end as matches_link,
                   case when e.currency = (select currency from ops.tenant) then 'yes' else 'no' end as same_currency,
                   case when ${recorded('e', 'l')} then 'yes' else 'no' end as recorded
              from ops.payment_event e
              join ops.paypal_link l on l.tenant_id = e.tenant_id and l.id = e.link_id
             where ${where}`;

export const PAYPAL_QUERIES: [string, NamedQuery][] = [
  [
    // An invoice's sale and what it still owes on credit, oldest debt paid first: the customer's repayments are not
    // tied to sales, so the sale's open credit is its live credit, less whatever of the customer's balance is covered
    // by credit given after it, never below nothing. A reversed sale has none (its credit is reversed), and says so.
    'invoice.open_credit',
    {
      params: z.strictObject({ invoice_id: z.guid() }),
      order: ['invoice_id'],
      key: ['invoice_id'],
      columns: { invoice_id: text, sale_id: text, customer_id: text, kind: text, sale_reversed: text, open: rupees },
      sql: `with v as (select v.tenant_id, v.id, v.sale_id, v.kind, v.currency, s.customer_id, s.sold_at
                         from books.invoice v join books.sale s on s.tenant_id = v.tenant_id and s.id = v.sale_id
                        where v.id = $1::uuid),
                 ce as (select c.* from books.credit_entry c, v
                         where c.tenant_id = v.tenant_id and c.customer_id = v.customer_id and c.currency = v.currency
                           and ${live('books.credit_entry', 'c')})
            select v.id::text as invoice_id, v.sale_id::text as sale_id, v.customer_id::text as customer_id, v.kind,
                   case when exists (select 1 from books.sale r where r.tenant_id = v.tenant_id and r.reverses_id = v.sale_id)
                        then 'yes' else 'no' end as sale_reversed,
                   v.currency,
                   greatest(0, least(
                     coalesce((select sum(ce.amount_minor) from ce where ce.sale_id = v.sale_id and ce.amount_minor > 0), 0),
                     coalesce((select sum(ce.amount_minor) from ce), 0)
                       - coalesce((select sum(ce.amount_minor) from ce
                                    where ce.amount_minor > 0 and ce.sale_id is distinct from v.sale_id and ce.at > v.sold_at), 0)
                   ))::bigint as open
              from v`,
    },
  ],
  [
    // A confirmed order and what it still needs: its lines' total at the promised prices (the lines order.lines shows),
    // the advance still held, and the rest, never below nothing. `open` says whether the order can still take an advance:
    // not voided and its current step not terminal (delivered or cancelled).
    'order.due',
    {
      params: z.strictObject({ order_id: z.guid() }),
      order: ['order_id'],
      key: ['order_id'],
      columns: { order_id: text, code: text, customer_id: text, open: text, total: rupees, advance: rupees, due: rupees },
      sql: `with o as (select o.*, ${unappliedAdvance('o')} as held,
                              (select coalesce(sum(l.gross_minor), 0) from books.order_line l
                                where l.tenant_id = o.tenant_id and l.order_id = o.id and l.reverses_id is null)::bigint as lines_total
                         from books.order o
                        where o.id = $1::uuid and o.reverses_id is null)
            select o.id::text as order_id, o.code, o.customer_id::text as customer_id,
                   case when not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id)
                         and exists (select 1 from ops.order_state st join ref.order_step r on r.code = st.step
                                      where st.tenant_id = o.tenant_id and st.order_id = o.id and not r.terminal)
                        then 'yes' else 'no' end as open,
                   o.currency, o.lines_total as total, o.held as advance, greatest(0, o.lines_total - o.held)::bigint as due
              from o`,
    },
  ],
  [
    // One stored notification: its link, the link's customer (and order, for an order's link), PayPal's invoice id, the
    // amount PayPal received and when; whether that is what the link asked, whether it is in the shop's currency, and
    // whether a live payment already records it.
    'paypal.event',
    {
      params: z.strictObject({ event_id: z.guid() }),
      order: ['event_id'],
      key: ['event_id'],
      columns: { ...EVENT_COLUMNS, order_id: text },
      sql: `${EVENT_SELECT('e.id = $1::uuid')}`,
    },
  ],
  [
    // The shop's PayPal links as they stand, newest first: whom each asks, for what (a credit balance, a bill or an
    // order), the amount asked, where it stands (linkState) and whether its WhatsApp message went. No time and no order
    // code: what is current, so the same books read the same rows.
    'paypal.links',
    {
      params: z.strictObject({}),
      order: [],
      key: ['link_id'],
      columns: { link_id: text, customer_id: text, purpose: text, state: text, messaged: text, amount: rupees },
      sql: `select l.id::text as link_id, l.customer_id::text as customer_id, l.purpose,
                   ${linkState('l')} as state,
                   case when exists (select 1 from approval.draft d where d.tenant_id = l.tenant_id and d.command = 'customer.remind' and d.status = 'executed'
                                      and d.payload ->> 'template' = 'paypal_link' and d.payload ->> 'linkId' = l.id::text)
                        then 'yes' else 'no' end as messaged,
                   l.amount_minor as amount, l.currency
              from ops.paypal_link l
             order by l.created_at desc, l.id
             limit 200`,
    },
  ],
  [
    // A PayPal payment received by the end of `as_of`, in the shop's own currency, that no live payment records yet: the
    // money is with PayPal and the books do not show it. One row per notification. One in another currency can never be
    // recorded as a payment here, so it is shown on its link ("currency differs") and never raised.
    'watch.paypal_unrecorded',
    {
      params: z.strictObject({ as_of: z.iso.date() }),
      order: ['as_of'],
      key: ['event_id'],
      columns: EVENT_COLUMNS,
      sql: `${EVENT_SELECT(`e.received_at < (($1::date + 1)::timestamp at time zone (select time_zone from ops.tenant))
                 and e.currency = (select currency from ops.tenant) and not ${recorded('e', 'l')}`)}
             order by e.received_at, e.id
             limit 500`,
    },
  ],
];
