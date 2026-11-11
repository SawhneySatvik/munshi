// Memory and "why this number": the notes in force, and the walk from one figure back to who approved it. Same rules as
// every named read (queries.ts): read-only under the tenant's RLS, at most 500 rows in a stable order, declared columns
// and key. A note's words are never a cell (a snapshot is immutable and would outlive a person's erasure): the memory
// read carries ids, codes and times, and the Keeper's desk reads the words beside it (memory.ts). Type-only import:
// queries.ts spreads MEMORY_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };

// Every named read is in exactly one of the three maps below (a gate holds them total), so the walk knows how each ends.

/**
 * The column of a read whose cell is the id of the one book row its figures come from, by read. A walk follows only
 * these: an id that is merely on the row (stock.on_hand's item_id leads to the item, not to the moves summed) would
 * claim a source it is not.
 */
export const SOURCE_ROW: Readonly<Record<string, string>> = {
  'watch.shrinkage': 'move_id',
  'watch.expiry': 'lot_id',
  'watch.short_settlement': 'settlement_id',
  'bill.lines_for': 'line_id',
  'purchases.price_history': 'line_id',
  'bills.recent': 'purchase_id',
};

/** Reads whose figures the books add up (or look up) over many rows, naming no single one: the walk ends at the read,
 * "a total read from the books", which is whole, not broken. */
export const AGGREGATE: readonly string[] = [
  'items.price', 'items.list', 'stock.on_hand', 'stock.available', 'stock.below_reorder',
  'sales.by_day', 'sales.by_item', 'sales.week_total', 'sale.quote', 'sale.quote_offers', 'sale.receipt',
  'purchases.last_price', 'purchases.last_prices',
  'credit.balance', 'credit.balances', 'credit.overdue_total', 'invoice.open_credit',
  'order.board', 'order.lines', 'order.due', 'order.request_lines', 'offer.detail', 'offers.list',
  'loyalty.balance', 'loyalty.balances', 'loyalty.rule', 'package.balance', 'package.holdings', 'package.plans',
  'invoice.detail', 'invoices.list', 'gst.summary', 'salary.preview', 'staff.advances',
  'settlements.reconcile', 'brief.figures',
  'growth.peak_hours', 'growth.customers', 'growth.basket', 'growth.slow_movers', 'growth.payment_mix',
  'watch.dead_stock', 'watch.price_creep', 'watch.overdue_credit', 'watch.missing_settlement', 'watch.order_late',
  'watch.advance_unapplied', 'watch.unrecovered_advance', 'watch.regulars_lapsing', 'watch.package_expiry',
  // surplus: the tally sums the gifts; what is left of a lot is the lot less the item's moves
  'surplus.impact', 'surplus.lot',
];

/** Reads of the shop's other records, not its ledger (a photo's count, a bill or message as read, bookings and holds,
 * a site's release, the runs, memory, this walk): the walk ends at the read, "read from the shop's records". */
export const UNWALKABLE: readonly string[] = [
  'count.shelf', 'bill.lines', 'order.extracts', 'inbox.extract', 'inbox.order_link', 'measurement.values', 'campaign.audience',
  'site.catalogue', 'site.packages', 'site.package_lines', 'site.offers', 'site.offer_items', 'site.capabilities',
  'watch.hold_expiring', 'watch.order_unanswered', 'watch.idle_stylist', 'watch.stylist_absent_booked', 'watch.unbilled_booking',
  'watch.hold_pressure', 'paypal.event', 'paypal.links', 'watch.paypal_unrecorded',
  'brief.ranked', 'desks.week', 'desks.trace', 'memory.in_force', 'why.chain',
  // the shop's surplus recipients (simulated), an ops record
  'surplus.recipients',
  // AI spend: the spend ledger and the budget, records of the shop's model calls, not its books
  'ai.spend_month', 'ai.spend_by_desk',
];

const UUID_RE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
// The cell `col` of stored row `row` of snapshot `s`, as text (null when the snapshot, the row or the column is not there).
const cellText = (s: string, row: string, col: string) =>
  `(${s}.rows -> ${row} -> (select (c.i - 1)::int from jsonb_array_elements(${s}.columns) with ordinality c(v, i) where c.v ->> 'n' = ${col}) ->> 't')`;
const asId = (x: string) => `(case when ${x} ~ '${UUID_RE}' then ${x}::uuid end)`;
// How deep the walk goes through a decision's own cited cells (0: the figure's read only).
const DEPTH = 2;

export const MEMORY_QUERIES: [string, NamedQuery][] = [
  [
    // The notes in force (ai.memory_in_force: begun, not past valid_to, not ended, words not erased), newest first, each
    // with the decision it cites: that draft's command, who decided and when, who wrote the note and its window.
    'memory.in_force',
    {
      params: z.strictObject({}),
      order: [],
      key: ['memory_id'],
      columns: {
        memory_id: text,
        kind: text,
        decision_id: text,
        command: text,
        verdict: text,
        decided_by: text,
        decided_at: stamp,
        noted_by: text,
        valid_from: stamp,
        valid_to: stamp,
      },
      sql: `select n.id::text as memory_id, n.kind, n.decision_id::text as decision_id, dr.command, d.verdict,
                   d.decided_by::text as decided_by, d.created_at as decided_at, n.created_by::text as noted_by, n.valid_from, n.valid_to
              from ai.memory_in_force() n
              join approval.decision d on d.id = n.decision_id
              join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
             order by n.valid_from desc, n.id desc
             limit 500`,
    },
  ],
  [
    // Why a figure says what it says: a walk over the keys, no new table. From the figure's cell to its snapshot (the
    // read, who made it, when), to the book row that read's row came from (SOURCE_ROW; its audit entry says who wrote it
    // and under which decision), to that decision (its command, who approved, when), and on through the cells that
    // decision's draft cited, to a depth of two decisions. Each node names its parent; `path` lists the reads from the
    // figure down to it, so a member is sent only the nodes reached through reads their role may make (read-roles.ts).
    // A read in AGGREGATE ends in a `total` node (the books added up, whole), one in UNWALKABLE in an `end` node (the shop's
    // other records). A link that cannot be walked is a `break` node, labelled why: no_snapshot, no_cell, no_book_row (a
    // read names a source row the books do not hold) or no_rows (a read in none of the three maps: the totality gate
    // keeps that from happening).
    'why.chain',
    {
      params: z.strictObject({ snapshot_id: z.guid(), row: z.number().int().min(0).max(499), col: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/) }),
      order: ['snapshot_id', 'row', 'col'],
      key: ['step'],
      columns: { step: int, depth: int, kind: text, node: text, parent: text, label: text, member_id: text, at: stamp, path: text },
      sql: `with recursive
            src(q, col) as (select key, value from jsonb_each_text('${JSON.stringify(SOURCE_ROW)}'::jsonb)),
            agg(q) as (select jsonb_array_elements_text('${JSON.stringify(AGGREGATE)}'::jsonb)),
            other(q) as (select jsonb_array_elements_text('${JSON.stringify(UNWALKABLE)}'::jsonb)),
            root as (
              select s.id, s.query_name,
                     ($3 = '_count' and $2 = 0)
                     or ($2 < s.row_count and exists (select 1 from jsonb_array_elements(s.columns) c where c ->> 'n' = $3)) as has_cell
                from snap.snapshot s where s.id = $1::uuid
            ),
            walk(depth, snapshot_id, row_no, parent, path) as (
              select 0, r.id, $2::int, $1::text || '.' || $2::text || '.' || $3::text, r.query_name from root r where r.has_cell
              union
              select w.depth + 1, (x.ref ->> 'snapshotId')::uuid, (x.ref ->> 'row')::int, d.id::text, w.path || ',' || s2.query_name
                from walk w
                join snap.snapshot s on s.id = w.snapshot_id
                join src on src.q = s.query_name
                join audit.audit_log a on a.entity like 'books.%' and a.entity_id = ${asId(cellText('s', 'w.row_no', 'src.col'))}
                join approval.decision d on d.tenant_id = a.tenant_id and d.id = a.decision_id
                join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                cross join lateral (select v from jsonb_array_elements(dr.based_on) b(v)
                                    union select v from jsonb_each(dr.payload_refs) p(k, v)) x(ref)
                join snap.snapshot s2 on s2.id = ${asId("(x.ref ->> 'snapshotId')")}
               where w.depth < ${DEPTH}
            ),
            reads as (
              select w.depth, w.snapshot_id, w.row_no, w.parent, w.path, s.query_name, s.actor_id, s.created_at,
                     (select a.entity_id from src join audit.audit_log a on a.entity like 'books.%' and a.entity_id = ${asId(cellText('s', 'w.row_no', 'src.col'))}
                       where src.q = s.query_name limit 1) as entity_id,
                     exists (select 1 from src where src.q = s.query_name) as mapped
                from walk w join snap.snapshot s on s.id = w.snapshot_id
            ),
            rows_read as (
              select distinct on (a.entity_id) r.depth, r.snapshot_id::text || '.' || r.row_no::text as parent, r.path, a.entity, a.entity_id,
                     a.actor_id, a.decision_id, a.created_at
                from reads r join audit.audit_log a on a.entity like 'books.%' and a.entity_id = r.entity_id
               order by a.entity_id, r.depth
            ),
            nodes as (
              select 0 as depth, 0 as rank, 'figure' as kind, $1::text || '.' || $2::text || '.' || $3::text as node, null::text as parent,
                     $3::text as label, null::uuid as member_id, null::timestamptz as at, r.query_name as path
                from root r where r.has_cell
              union all
              select 0, 2, 'break', null, null, case when exists (select 1 from root) then 'no_cell' else 'no_snapshot' end, null, null, ''
               where not exists (select 1 from root r where r.has_cell)
              union all
              select r.depth, 1, 'read', r.snapshot_id::text || '.' || r.row_no::text, r.parent, r.query_name, r.actor_id, r.created_at, r.path
                from reads r
              union all
              select r.depth, 2,
                     case when r.mapped then 'break' when r.query_name in (select q from agg) then 'total'
                          when r.query_name in (select q from other) then 'end' else 'break' end,
                     null, r.snapshot_id::text || '.' || r.row_no::text,
                     case when r.mapped then 'no_book_row' when r.query_name in (select q from agg union all select q from other) then r.query_name else 'no_rows' end,
                     null, case when not r.mapped then r.created_at end, r.path
                from reads r where r.entity_id is null
              union all
              select x.depth, 3, 'row', x.entity_id::text, x.parent, x.entity, x.actor_id, x.created_at, x.path from rows_read x
              union all
              select x.depth, 4, 'decision', d.id::text, x.entity_id::text, dr.command, d.decided_by, d.created_at, x.path
                from rows_read x
                join approval.decision d on d.id = x.decision_id
                join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
            )
            select (row_number() over (order by n.depth, n.rank, n.parent nulls first, n.node nulls first) - 1)::bigint as step,
                   n.depth::bigint as depth, n.kind, n.node, n.parent, n.label, n.member_id::text as member_id, n.at, n.path
              from (select distinct * from nodes) n
             order by step
             limit 500`,
    },
  ],
];
