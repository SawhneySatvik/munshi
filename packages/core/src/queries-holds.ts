// Named reads for holds on a piece (BLUEPRINT §8.4): what the books hold of each good, what live holds keep back, and
// what is left to sell, each a cell. A hold is ops, never a book, so "available" is two cells' difference computed here,
// never a stock row. Type-only import: queries.ts spreads HOLD_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

// The two halves of availability, shared with holdPiece (reservations.ts) so a refused hold and the shown cell can never
// disagree. A hold past held_until that the jobs runner has not yet expired is already free (as a lapsed slot hold is).
export const onHandOf = (item: string) =>
  `(select coalesce(sum(m.qty_milli), 0) from books.stock_move m where m.tenant_id = ${item}.tenant_id and m.item_id = ${item}.id)::bigint`;
export const liveHeld = (item: string) =>
  `ops.reservation r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.state = 'held' and r.held_until > now()`;

export const HOLD_QUERIES: [string, NamedQuery][] = [
  [
    // Every good: on hand, held by live holds, how many holds, and what is left (on hand − held).
    'stock.available',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: { item_id: text, item: text, on_hand: qty, held: qty, holds: int, available: qty },
      sql: `select i.id::text as item_id, rev.name as item, i.unit, oh.on_hand, h.held, h.holds, oh.on_hand - h.held as available
              from books.item i
              join lateral (select r.name from books.item_revision r
                             where r.tenant_id = i.tenant_id and r.item_id = i.id and r.effective_from <= now()
                             order by r.effective_from desc, r.created_at desc, r.id desc limit 1) rev on true
              cross join lateral (select ${onHandOf('i')} as on_hand) oh
              cross join lateral (select coalesce(sum(r.qty_milli), 0)::bigint as held, count(*)::bigint as holds from ${liveHeld('i')}) h
             where i.kind = 'good'
             order by rev.name, i.id
             limit 500`,
    },
  ],
];
