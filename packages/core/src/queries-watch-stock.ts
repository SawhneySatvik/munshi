// The Stock desk's new watchers: stock that has not sold for 45 days, and a held piece about to be released. Same rules
// as every named read (queries.ts). Type-only import: queries.ts spreads WATCH_STOCK_QUERIES while it is still being
// evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const day: Column = { kind: 'date' };
const instant: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;

export const WATCH_STOCK_QUERIES: [string, NamedQuery][] = [
  [
    // Dead stock: an item (a variant is its own item, named by its revision, beside its parent) with stock on hand at
    // the end of as_of and no sale in the 45 days to it — none at all, or the last sale (a live sale move) before them;
    // an item first stocked inside the 45 days is not yet dead. Valued at its latest bill cost, the cell at stake.
    'watch.dead_stock',
    {
      params: z.strictObject({ as_of: z.iso.date() }),
      order: ['as_of'],
      key: ['item_id'],
      columns: { item_id: text, parent_item_id: text, item: text, on_hand: qty, last_sold_on: day, unit_cost: rupees, stock_value: rupees },
      sql: `with tz as (select time_zone, currency from ops.tenant),
            bounds as (select (($1::date + 1)::timestamp at time zone (select time_zone from tz)) as end_at),
            moves as (
              select m.tenant_id, m.item_id, sum(m.qty_milli)::bigint as on_hand, min(m.at) as first_at,
                     max(m.at) filter (where m.kind = 'sale' and m.qty_milli < 0 and m.reverses_id is null
                                         and not exists (select 1 from books.stock_move rv where rv.tenant_id = m.tenant_id and rv.reverses_id = m.id)) as last_sale_at
                from books.stock_move m where m.at < (select end_at from bounds)
               group by m.tenant_id, m.item_id
            ),
            valued as (
              select mv.*, i.parent_item_id, i.unit, ${itemName('i')} as name,
                     (select pl.unit_cost_minor from books.purchase_line pl
                        join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
                       where pl.tenant_id = mv.tenant_id and pl.item_id = mv.item_id and p.bill_date <= $1::date
                       order by p.bill_date desc, pl.created_at desc limit 1) as unit_cost
                from moves mv join books.item i on i.tenant_id = mv.tenant_id and i.id = mv.item_id
            )
            select v.item_id::text as item_id, v.parent_item_id::text as parent_item_id, v.name as item, v.unit, v.on_hand,
                   (v.last_sale_at at time zone (select time_zone from tz))::date::text as last_sold_on, v.unit_cost,
                   (v.on_hand * v.unit_cost + 500) / 1000 as stock_value, (select currency from tz) as currency
              from valued v
             where v.on_hand > 0 and v.unit_cost is not null
               and coalesce(v.last_sale_at, v.first_at) < (select end_at from bounds) - interval '45 days'
             order by v.name, v.item_id
             limit 500`,
    },
  ],
  [
    // A piece held for a customer (ops.reservation, held) whose hold ends within 24 hours of the run's instant: the
    // owner extends or releases it. Its price is the item's price in effect now for the held quantity.
    'watch.hold_expiring',
    {
      params: z.strictObject({ as_of: z.iso.date(), at: z.iso.datetime() }),
      order: ['at'],
      key: ['reservation_id'],
      columns: { reservation_id: text, item_id: text, item: text, qty, held_until: instant, price: rupees },
      sql: `select r.id::text as reservation_id, r.item_id::text as item_id, ${itemName('i')} as item, r.qty_milli as qty, i.unit, r.held_until,
                   (select (r.qty_milli * pr.amount_minor + 500) / 1000 from books.price pr
                     where pr.tenant_id = r.tenant_id and pr.item_id = r.item_id and pr.effective_from <= $1::timestamptz
                     order by pr.effective_from desc, pr.created_at desc, pr.id desc limit 1)::bigint as price,
                   (select currency from ops.tenant) as currency
              from ops.reservation r join books.item i on i.tenant_id = r.tenant_id and i.id = r.item_id
             where r.state = 'held' and r.held_until > $1::timestamptz and r.held_until <= $1::timestamptz + interval '24 hours'
             order by r.held_until, r.id
             limit 500`,
    },
  ],
];
