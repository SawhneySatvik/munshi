// The named reads: the only SQL a snapshot can be minted from (mintSnapshot looks the name up here; nothing registers a
// query at runtime). Each runs read-only under the tenant's RLS, returns at most 500 rows in a stable order, and declares
// its stored columns (typed cells) and its key (the columns that identify a row when the read is re-run to re-check a
// draft's evidence, and that make a finding's dedupe key). The watch.* reads are the deterministic detectors: their
// thresholds are constants here, and each returns only rows that cross them.
import { z } from 'zod';
import { AGENT_QUERIES } from './queries-agent.ts';
import { APP_QUERIES } from './queries-app.ts';
import { BOOKING_QUERIES } from './queries-booking.ts';
import { CAMPAIGN_QUERIES } from './queries-campaigns.ts';
import { COUNT_QUERIES } from './queries-count.ts';
import { DESK_QUERIES } from './queries-desks.ts';
import { GRID_QUERIES } from './queries-grid.ts';
import { GROWTH_QUERIES } from './queries-growth.ts';
import { HOLD_QUERIES } from './queries-holds.ts';
import { INBOX_QUERIES } from './queries-inbox.ts';
import { INVOICE_QUERIES } from './queries-invoice.ts';
import { MEMORY_QUERIES } from './queries-memory.ts';
import { OFFER_QUERIES } from './queries-offers.ts';
import { ORDER_QUERIES } from './queries-orders.ts';
import { PACKAGE_QUERIES } from './queries-packages.ts';
import { PAYPAL_QUERIES } from './queries-paypal.ts';
import { PEOPLE_QUERIES } from './queries-people.ts';
import { SALE_QUERIES } from './queries-sale.ts';
import { SETTLEMENT_QUERIES } from './queries-settlements.ts';
import { SITE_QUERIES } from './queries-sites.ts';
import { STAFF_QUERIES } from './queries-staff.ts';
import { SURPLUS_QUERIES } from './queries-surplus.ts';
import { WATCH_BOOKING_QUERIES } from './queries-watch-bookings.ts';
import { WATCH_BRIEF_QUERIES } from './queries-watch-brief.ts';
import { WATCH_ORDER_QUERIES } from './queries-watch-orders.ts';
import { WATCH_PEOPLE_QUERIES } from './queries-watch-people.ts';
import { WATCH_STOCK_QUERIES } from './queries-watch-stock.ts';

export type ColumnKind = 'integer' | 'money' | 'quantity' | 'text' | 'date' | 'timestamp';
export type Column = { kind: ColumnKind; currency?: string; unit?: string }; // currency / unit: the column holding it
export type NamedQuery = { params: z.ZodType; order: string[]; key: string[]; columns: Record<string, Column>; sql: string };

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };
const asOf = z.strictObject({ as_of: z.iso.date() });

// Shared fragments. Every base table forces RLS, so ops.tenant is the one current tenant's row.
const TENANT = `tz as (select time_zone, currency from ops.tenant)`;
const notReversed = (table: string, alias: string) =>
  `not exists (select 1 from ${table} rv where rv.tenant_id = ${alias}.tenant_id and rv.reverses_id = ${alias}.id)`;
// An item's name, from its latest revision in effect (books.item_revision: the latest wins).
const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;
// A customer's or supplier's name: the vault's contact, through the party's link in effect (books.party_contact). Only
// ever an ORDER BY key: no person's name enters a snapshot cell, which is immutable and pinned and would outlive the
// person's erasure; a read carries the party's id, and screens name it.
const partyName = (party: 'customer_id' | 'supplier_id', alias: string) =>
  `(select ct.name from books.party_contact pc join ops.contact ct on ct.tenant_id = pc.tenant_id and ct.id = pc.contact_id
     where pc.tenant_id = ${alias}.tenant_id and pc.${party} = ${alias}.id and pc.effective_from <= now()
     order by pc.effective_from desc, pc.created_at desc, pc.id desc limit 1)`;

export const QUERIES: ReadonlyMap<string, NamedQuery> = new Map<string, NamedQuery>([
  ...AGENT_QUERIES,
  ...COUNT_QUERIES,
  ...APP_QUERIES,
  ...SALE_QUERIES,
  ...ORDER_QUERIES,
  ...OFFER_QUERIES,
  ...PEOPLE_QUERIES,
  ...PACKAGE_QUERIES,
  ...CAMPAIGN_QUERIES,
  ...SITE_QUERIES,
  ...GRID_QUERIES,
  ...INVOICE_QUERIES,
  ...STAFF_QUERIES,
  ...BOOKING_QUERIES,
  ...INBOX_QUERIES,
  ...HOLD_QUERIES,
  ...WATCH_STOCK_QUERIES,
  ...WATCH_ORDER_QUERIES,
  ...WATCH_PEOPLE_QUERIES,
  ...WATCH_BOOKING_QUERIES,
  ...WATCH_BRIEF_QUERIES,
  ...SURPLUS_QUERIES,
  ...SETTLEMENT_QUERIES,
  ...GROWTH_QUERIES,
  ...DESK_QUERIES,
  ...PAYPAL_QUERIES,
  ...MEMORY_QUERIES,
  [
    'stock.on_hand',
    {
      params: z.strictObject({ item_id: z.guid() }),
      order: ['item_id'],
      key: ['item_id'],
      columns: { item_id: text, item: text, on_hand: qty },
      sql: `select i.id::text as item_id, ${itemName('i')} as item, i.unit,
                   (select coalesce(sum(m.qty_milli), 0) from books.stock_move m where m.tenant_id = i.tenant_id and m.item_id = i.id)::bigint as on_hand
              from books.item i
             where i.id = $1::uuid`,
    },
  ],
  [
    // Shelf shrinkage: a stock count in the 30 days to as_of that found fewer units than the books, worth at least
    // ₹50 at the latest bill cost and at least 5% of what the books said.
    'watch.shrinkage',
    {
      params: asOf,
      order: ['as_of'],
      key: ['move_id'],
      columns: { move_id: text, item_id: text, item: text, counted_on: day, expected: qty, counted: qty, missing: qty, unit_cost: rupees, loss: rupees },
      sql: `with ${TENANT},
            counts as (
              select m.tenant_id, m.id, m.item_id, -m.qty_milli as missing, m.at,
                     (m.at at time zone (select time_zone from tz))::date as counted_on
                from books.stock_move m
               where m.kind = 'count_adjust' and m.qty_milli < 0 and m.reverses_id is null and ${notReversed('books.stock_move', 'm')}
                 and (m.at at time zone (select time_zone from tz))::date between $1::date - 30 and $1::date
            ),
            valued as (
              select c.id, c.item_id, ${itemName('i')} as name, i.unit, c.counted_on, c.missing,
                     (select coalesce(sum(s.qty_milli), 0)::bigint from books.stock_move s
                       where s.tenant_id = c.tenant_id and s.item_id = c.item_id and s.at < c.at) as expected,
                     (select pl.unit_cost_minor from books.purchase_line pl
                        join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
                       where pl.tenant_id = c.tenant_id and pl.item_id = c.item_id and p.bill_date <= c.counted_on
                       order by p.bill_date desc, pl.created_at desc limit 1) as unit_cost
                from counts c join books.item i on i.tenant_id = c.tenant_id and i.id = c.item_id
            )
            select v.id::text as move_id, v.item_id::text as item_id, v.name as item, v.unit, v.counted_on::text as counted_on,
                   v.expected, v.expected - v.missing as counted, v.missing, v.unit_cost,
                   (v.missing * v.unit_cost + 500) / 1000 as loss, (select currency from tz) as currency
              from valued v
             where v.unit_cost is not null
               and (v.missing * v.unit_cost + 500) / 1000 >= 5000
               and v.missing * 100 >= v.expected * 5
             order by v.name, v.id
             limit 500`,
    },
  ],
  [
    // Distributor price creep: a supplier's latest bill cost for an item at least 5% above that supplier's own median
    // for the item over days 30–90 before as_of, seen on at least 2 bills in the last 30 days.
    'watch.price_creep',
    {
      params: asOf,
      order: ['as_of'],
      key: ['supplier_id', 'item_id'],
      columns: {
        supplier_id: text,
        item_id: text,
        item: text,
        baseline_cost: rupees,
        latest_cost: rupees,
        creep_bp: int,
        bills: int,
        latest_bill_no: text,
        latest_bill_date: day,
      },
      sql: `with obs as (
              select p.tenant_id, p.supplier_id, pl.item_id, p.bill_date, p.bill_no, pl.unit_cost_minor as cost, pl.currency, pl.created_at
                from books.purchase p
                join books.purchase_line pl on pl.tenant_id = p.tenant_id and pl.purchase_id = p.id
               where p.reverses_id is null and ${notReversed('books.purchase', 'p')}
                 and p.bill_date between $1::date - 90 and $1::date
            ),
            base as (
              select tenant_id, supplier_id, item_id, currency, percentile_disc(0.5) within group (order by cost) as baseline
                from obs where bill_date < $1::date - 30 group by tenant_id, supplier_id, item_id, currency
            ),
            latest as (
              select distinct on (supplier_id, item_id, currency) tenant_id, supplier_id, item_id, currency, cost, bill_no, bill_date
                from obs order by supplier_id, item_id, currency, bill_date desc, created_at desc
            ),
            raised as (
              select o.supplier_id, o.item_id, o.currency, count(*) as bills
                from obs o join base b using (supplier_id, item_id, currency)
               where o.bill_date >= $1::date - 30 and o.cost * 100 >= b.baseline * 105
               group by o.supplier_id, o.item_id, o.currency
            )
            select l.supplier_id::text as supplier_id, l.item_id::text as item_id, ${itemName('i')} as item,
                   b.baseline as baseline_cost, l.cost as latest_cost, (l.cost - b.baseline) * 10000 / b.baseline as creep_bp,
                   r.bills, l.bill_no as latest_bill_no, l.bill_date::text as latest_bill_date, l.currency
              from latest l
              join base b using (supplier_id, item_id, currency)
              join raised r using (supplier_id, item_id, currency)
              join books.supplier s on s.tenant_id = l.tenant_id and s.id = l.supplier_id
              join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
             where l.cost * 100 >= b.baseline * 105 and r.bills >= 2
             order by ${partyName('supplier_id', 's')}, item
             limit 500`,
    },
  ],
  [
    // Stock expiring within 7 days that will not sell first: per bill line (a lot), what is left of it if the oldest
    // expiry sells first, minus what the last 28 days' sales rate sells before it expires; flagged when at least ₹50.
    'watch.expiry',
    {
      params: asOf,
      order: ['as_of'],
      key: ['lot_id'],
      columns: {
        lot_id: text,
        item_id: text,
        item: text,
        expires_on: day,
        days_left: int,
        remaining: qty,
        sells_before: qty,
        at_risk: qty,
        unit_cost: rupees,
        at_risk_value: rupees,
      },
      sql: `with ${TENANT},
            bounds as (select (($1::date + 1)::timestamp at time zone (select time_zone from tz)) as end_at),
            on_hand as (
              select item_id, sum(qty_milli)::bigint as qty from books.stock_move where at < (select end_at from bounds) group by item_id
            ),
            lots as (
              select pl.tenant_id, pl.id, pl.item_id, pl.expires_on, pl.qty_milli, pl.unit_cost_minor,
                     coalesce(sum(pl.qty_milli) over (partition by pl.item_id order by pl.expires_on desc, pl.id desc
                                                      rows between unbounded preceding and 1 preceding), 0)::bigint as later
                from books.purchase_line pl
                join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
               where pl.expires_on is not null and p.bill_date <= $1::date and p.reverses_id is null and ${notReversed('books.purchase', 'p')}
            ),
            sold as (
              select item_id, -sum(qty_milli)::bigint as last_28 from books.stock_move
               where kind = 'sale' and at >= (select end_at from bounds) - interval '28 days' and at < (select end_at from bounds)
               group by item_id
            ),
            risk as (
              select l.*, ${itemName('i')} as name, i.unit, l.expires_on - $1::date as days_left,
                     greatest(0, least(l.qty_milli, coalesce(h.qty, 0) - l.later)) as remaining,
                     (coalesce(s.last_28, 0) * (l.expires_on - $1::date) + 27) / 28 as sells_before
                from lots l
                join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
                left join on_hand h on h.item_id = l.item_id
                left join sold s on s.item_id = l.item_id
               where l.expires_on between $1::date and $1::date + 7
            )
            select r.id::text as lot_id, r.item_id::text as item_id, r.name as item, r.unit, r.expires_on::text as expires_on,
                   r.days_left, r.remaining, least(r.sells_before, r.remaining) as sells_before,
                   r.remaining - r.sells_before as at_risk, r.unit_cost_minor as unit_cost,
                   ((r.remaining - r.sells_before) * r.unit_cost_minor + 500) / 1000 as at_risk_value, (select currency from tz) as currency
              from risk r
             where r.remaining - r.sells_before > 0 and ((r.remaining - r.sells_before) * r.unit_cost_minor + 500) / 1000 >= 5000
             order by r.expires_on, r.name, r.id
             limit 500`,
    },
  ],
  [
    // Overdue credit (udhaar): what a customer still owes on credit due before as_of (given more than 30 days ago),
    // repayments clearing the oldest credit first; flagged from ₹100.
    'watch.overdue_credit',
    {
      params: asOf,
      order: ['as_of'],
      key: ['customer_id'],
      columns: { customer_id: text, balance: rupees, overdue: rupees, oldest_due_on: day, days_overdue: int },
      sql: `with ${TENANT},
            entries as (
              select ce.tenant_id, ce.id, ce.customer_id, ce.amount_minor, ce.currency, ce.due_on, ce.at
                from books.credit_entry ce
               where ce.reverses_id is null and ${notReversed('books.credit_entry', 'ce')}
                 and ce.at < (($1::date + 1)::timestamp at time zone (select time_zone from tz))
            ),
            repaid as (
              select customer_id, currency, -sum(amount_minor)::bigint as repaid from entries where amount_minor < 0 group by customer_id, currency
            ),
            given as (
              select e.*, sum(e.amount_minor) over (partition by e.customer_id, e.currency order by e.at, e.id)::bigint as running
                from entries e where e.amount_minor > 0
            ),
            open as (
              select g.tenant_id, g.customer_id, g.currency, g.due_on,
                     greatest(0, least(g.amount_minor, g.running - coalesce(r.repaid, 0))) as open_minor
                from given g left join repaid r using (customer_id, currency)
            ),
            per as (
              select tenant_id, customer_id, currency, sum(open_minor)::bigint as balance,
                     coalesce(sum(open_minor) filter (where due_on < $1::date), 0)::bigint as overdue,
                     min(due_on) filter (where due_on < $1::date and open_minor > 0) as oldest_due_on
                from open group by tenant_id, customer_id, currency
            )
            select p.customer_id::text as customer_id, p.balance, p.overdue,
                   p.oldest_due_on::text as oldest_due_on, $1::date - p.oldest_due_on as days_overdue, p.currency
              from per p join books.customer c on c.tenant_id = p.tenant_id and c.id = p.customer_id
             where p.overdue >= 10000
             order by ${partyName('customer_id', 'c')}, customer_id
             limit 500`,
    },
  ],
  [
    // The overdue-credit card's own numbers: the customers watch.overdue_credit flags (same open-balance rule, same ₹100
    // threshold, same as_of), what they owe past due, and the shortest credit term among those overdue entries — each
    // was given at least that many days before it fell due, so all of it has been owed for more than that. An entry
    // due before the day it was given has no term: it counts as zero days, never a negative one, and it is not left out
    // (leaving it out would claim its money had been owed as long as the others'). One row, always (no customers: 0,
    // ₹0 and a null term), so its key is empty.
    'credit.overdue_total',
    {
      params: asOf,
      order: ['as_of'],
      key: [],
      columns: { customers: int, overdue: rupees, credit_days: int },
      sql: `with ${TENANT},
            entries as (
              select ce.customer_id, ce.amount_minor, ce.currency, ce.due_on, ce.at, ce.id
                from books.credit_entry ce
               where ce.reverses_id is null and ${notReversed('books.credit_entry', 'ce')}
                 and ce.at < (($1::date + 1)::timestamp at time zone (select time_zone from tz))
            ),
            repaid as (
              select customer_id, currency, -sum(amount_minor)::bigint as repaid from entries where amount_minor < 0 group by customer_id, currency
            ),
            given as (
              select e.*, sum(e.amount_minor) over (partition by e.customer_id, e.currency order by e.at, e.id)::bigint as running
                from entries e where e.amount_minor > 0
            ),
            open as (
              select g.customer_id, g.currency, g.due_on, greatest(0, g.due_on - (g.at at time zone (select time_zone from tz))::date) as term,
                     greatest(0, least(g.amount_minor, g.running - coalesce(r.repaid, 0))) as open_minor
                from given g left join repaid r using (customer_id, currency)
            ),
            per as (
              select customer_id, currency, coalesce(sum(open_minor) filter (where due_on < $1::date), 0)::bigint as overdue,
                     min(term) filter (where due_on < $1::date and open_minor > 0) as term
                from open group by customer_id, currency
            )
            select count(p.customer_id)::bigint as customers, coalesce(sum(p.overdue), 0)::bigint as overdue,
                   min(p.term) as credit_days, t.currency
              from tz t left join per p on p.currency = t.currency and p.overdue >= 10000
             group by t.currency`,
    },
  ],
  [
    // Short UPI settlement: a recorded settlement in the 30 days to as_of at least ₹100 below the UPI receipts the
    // books hold for the business day it settles. The receipts are bounded by instants a day wider than the window, so
    // payment_day's range serves them; the business-date test decides, exactly, in a zone whose midnight repeats too.
    'watch.short_settlement',
    {
      params: asOf,
      order: ['as_of'],
      key: ['settlement_id'],
      columns: {
        settlement_id: text,
        business_date: day,
        received: rupees,
        settled: rupees,
        short: rupees,
        received_on: day,
        reference: text,
      },
      sql: `with ${TENANT},
            received as (
              select (p.paid_at at time zone (select time_zone from tz))::date as business_date, p.currency, sum(p.amount_minor)::bigint as received
                from books.payment p
               where p.direction = 'in' and p.method = 'upi' and p.reverses_id is null and ${notReversed('books.payment', 'p')}
                 and p.paid_at >= (($1::date - 32)::timestamp at time zone (select time_zone from tz))
                 and p.paid_at < (($1::date + 2)::timestamp at time zone (select time_zone from tz))
                 and (p.paid_at at time zone (select time_zone from tz))::date between $1::date - 31 and $1::date
               group by 1, 2
            )
            select s.id::text as settlement_id, s.business_date::text as business_date, r.received, s.amount_minor as settled,
                   r.received - s.amount_minor as short, s.received_on::text as received_on, s.reference, s.currency
              from books.settlement s
              join received r on r.business_date = s.business_date and r.currency = s.currency
             where s.channel = 'upi' and s.reverses_id is null and ${notReversed('books.settlement', 's')}
               and s.business_date between $1::date - 30 and $1::date
               and r.received - s.amount_minor >= 10000
             order by s.business_date, s.id
             limit 500`,
    },
  ],
]);
