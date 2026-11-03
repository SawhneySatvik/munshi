// Surplus for good: the shop's recipients and the impact tally of what it has given, two named reads with the same
// rules as every other (queries.ts). Recipients are simulated, every one (ops.surplus_recipient refuses any other), and
// a read of them carries their id, name, kind and area; the tally is ops.surplus_impact's one row: gifts not reversed,
// valued at the lot's cost, only those in the shop's currency summed (other_currency_gifts counts the rest, which the
// screen shows as "Cannot verify"). Both are the office's (read-roles.ts). Type-only import: queries.ts spreads
// SURPLUS_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

export const SURPLUS_QUERIES: [string, NamedQuery][] = [
  [
    // Every recipient the shop has listed, by name. Keyed by id, so a recipient added later stales no cited row.
    'surplus.recipients',
    {
      params: z.strictObject({}),
      order: [],
      key: ['id'],
      columns: { id: text, name: text, kind: text, area: text },
      sql: `select r.id::text as id, r.name, r.kind, r.area from ops.surplus_recipient r order by r.name, r.id limit 500`,
    },
  ],
  [
    // One live lot (a line of an unreversed purchase, with an expiry) and what is left of it now, read as the listing's
    // trigger reads it: its quantity, at most the item's stock on hand less the lots of the item that expire after it.
    'surplus.lot',
    {
      params: z.strictObject({ lot_id: z.guid() }),
      order: ['lot_id'],
      key: ['lot_id'],
      columns: { lot_id: text, item_id: text, item: text, expires_on: { kind: 'date' }, left: qty },
      sql: `with live as (
              select pl.* from books.purchase_line pl
                join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
               where pl.expires_on is not null and p.reverses_id is null
                 and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id)
            )
            select l.id::text as lot_id, l.item_id::text as item_id,
                   (select r.name from books.item_revision r where r.tenant_id = i.tenant_id and r.item_id = i.id and r.effective_from <= now()
                     order by r.effective_from desc, r.created_at desc, r.id desc limit 1) as item,
                   i.unit, l.expires_on::text as expires_on,
                   greatest(0, least(l.qty_milli,
                     coalesce((select sum(m.qty_milli) from books.stock_move m where m.tenant_id = l.tenant_id and m.item_id = l.item_id), 0)
                     - coalesce((select sum(o.qty_milli) from live o where o.item_id = l.item_id and (o.expires_on, o.id) > (l.expires_on, l.id)), 0)))::bigint as left
              from live l join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
             where l.id = $1::uuid`,
    },
  ],
  [
    // The impact tally, all time: gifts, distinct items among them, and their value at cost not wasted.
    'surplus.impact',
    {
      params: z.strictObject({}),
      order: [],
      key: ['currency'],
      columns: { gifts: int, items: int, value: rupees, other_currency_gifts: int },
      sql: `select s.gifts::bigint as gifts, s.items::bigint as items, s.value_minor as value, s.currency::text as currency,
                   s.other_currency_gifts::bigint as other_currency_gifts
              from ops.surplus_impact() s`,
    },
  ],
];
