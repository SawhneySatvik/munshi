// Settlement reconciliation's reads (P-4): a range of business days' UPI and card receipts beside the live payout the
// books hold for each, and the watcher for a day whose UPI payout never came. Receipts are what watch.short_settlement
// counts: live incoming payments by that method (sale tenders and udhaar repaid), bounded by instants a day wider than
// the range so payment_day's range serves them, the business date deciding exactly. Same rules as every named read
// (queries.ts). Type-only import: queries.ts spreads SETTLEMENT_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };

const TZ = `tz as (select time_zone, currency from ops.tenant)`;
const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
const receipts = (methods: string, from: string, to: string) => `select (p.paid_at at time zone (select time_zone from tz))::date as business_date, p.method as channel,
                     p.currency, sum(p.amount_minor)::bigint as receipts
                from books.payment p
               where p.direction = 'in' and p.method in (${methods}) and ${live('books.payment', 'p')}
                 and p.paid_at >= ((${from} - 1)::timestamp at time zone (select time_zone from tz))
                 and p.paid_at < ((${to} + 2)::timestamp at time zone (select time_zone from tz))
                 and (p.paid_at at time zone (select time_zone from tz))::date between ${from} and ${to}
               group by 1, 2, 3`;

export const SETTLEMENT_QUERIES: [string, NamedQuery][] = [
  [
    // Per business day and channel from `from` to `to` (at most 62 days): the receipts, the live payout recorded for it
    // (none: null), the difference, and the verdict as a code — matched, short, over, or missing (no payout recorded).
    'settlements.reconcile',
    {
      params: z
        .strictObject({ from: z.iso.date(), to: z.iso.date() })
        .refine((p) => p.from <= p.to && Date.parse(p.to) - Date.parse(p.from) <= 61 * 86_400_000, { path: ['to'] }),
      order: ['from', 'to'],
      key: ['business_date', 'channel'],
      columns: {
        business_date: day,
        channel: text,
        receipts: rupees,
        settled: rupees,
        difference: rupees,
        verdict: text,
        settlement_id: text,
        utr: text,
        received_on: day,
      },
      sql: `with ${TZ},
            received as (${receipts(`'upi', 'card'`, '$1::date', '$2::date')}),
            settled as (
              select s.business_date, s.channel, s.currency, s.id, s.amount_minor, s.utr, s.received_on
                from books.settlement s
               where ${live('books.settlement', 's')} and s.business_date between $1::date and $2::date
            )
            select coalesce(r.business_date, s.business_date)::text as business_date, coalesce(r.channel, s.channel) as channel,
                   coalesce(r.receipts, 0) as receipts, s.amount_minor as settled,
                   coalesce(r.receipts, 0) - coalesce(s.amount_minor, 0) as difference,
                   case when s.id is null then 'missing' when coalesce(r.receipts, 0) = s.amount_minor then 'matched'
                        when coalesce(r.receipts, 0) > s.amount_minor then 'short' else 'over' end as verdict,
                   s.id::text as settlement_id, s.utr, s.received_on::text as received_on,
                   coalesce(r.currency, s.currency) as currency
              from received r
              full join settled s on s.business_date = r.business_date and s.channel = r.channel and s.currency = r.currency
             order by 1, 2
             limit 500`,
    },
  ],
  [
    // Missing UPI payout: a business day from as_of − 30 to as_of − 3 (older than T+2) with at least ₹100 of UPI receipts
    // and no live UPI settlement. Only from the shop's first recorded UPI payout on: a shop that records none is not
    // reconciling, and every UPI day would read as missing.
    'watch.missing_settlement',
    {
      params: z.strictObject({ as_of: z.iso.date() }),
      order: ['as_of'],
      key: ['business_date'],
      columns: { business_date: day, received: rupees },
      sql: `with ${TZ},
            received as (${receipts(`'upi'`, '($1::date - 30)', '($1::date - 3)')})
            select r.business_date::text as business_date, r.receipts as received, r.currency
              from received r
             where r.receipts >= 10000
               and r.business_date >= (select min(s.business_date) from books.settlement s where s.channel = 'upi' and s.reverses_id is null)
               and not exists (select 1 from books.settlement s
                                where s.channel = 'upi' and s.business_date = r.business_date and s.currency = r.currency
                                  and ${live('books.settlement', 's')})
             order by r.business_date
             limit 500`,
    },
  ],
];
