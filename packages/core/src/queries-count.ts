// The hero chain's named reads (MS-8): what a shelf count and a read bill put on screen, and the current credit of one
// customer. Same rules as every named read (queries.ts). count.shelf and bill.lines read stored evidence (ops rows only
// core writes), so a re-check re-reads exactly what the draft cited; credit.balance is undated — the books as they
// stand — so a credit draft citing it goes stale when the customer's credit moves (approvals.ts, CURRENT).
// Type-only import: queries.ts spreads COUNT_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };
const stamp: Column = { kind: 'timestamp' };

// A figure's place on the bill, [x_min, y_min, x_max, y_max] on the 0–1000 grid, one integer cell per corner value.
const box = (p: string) => ({ [`${p}_x0`]: int, [`${p}_y0`]: int, [`${p}_x1`]: int, [`${p}_y1`]: int });
const corners = (col: string, p: string) =>
  [1, 2, 3, 4].map((n, k) => `bl.${col}[${n}] as ${p}_${['x0', 'y0', 'x1', 'y1'][k]}`).join(', ');

export const COUNT_QUERIES: [string, NamedQuery][] = [
  [
    // One shelf count: what the segment model's response holds, as packs or pieces of the item (matches × 1000 milli),
    // and when it was stored (a count too old cannot back a draft: approvals.ts).
    'count.shelf',
    {
      params: z.strictObject({ count_id: z.guid() }),
      order: ['count_id'],
      key: ['count_id'],
      columns: { count_id: text, item_id: text, item: text, counted: qty, counted_at: stamp },
      sql: `select sc.id::text as count_id, i.id::text as item_id, i.name as item, i.unit, (sc.matches * 1000)::bigint as counted,
                   sc.created_at as counted_at
              from ops.shelf_count sc
              join books.item i on i.tenant_id = sc.tenant_id and i.id = sc.item_id
             where sc.id = $1::uuid`,
    },
  ],
  [
    // A read bill's item lines in page order: the text as printed, the item it matched (null when none), its two
    // figures and the place of each on the page. The bill's supplier, number and date ride on every row, so each has a
    // cell (a purchase drafted from the bill must name exactly these: approvals.ts).
    'bill.lines',
    {
      params: z.strictObject({ bill_id: z.guid() }),
      order: ['bill_id'],
      key: ['line_no'],
      columns: {
        line_no: int,
        supplier_id: text,
        bill_no: text,
        bill_date: day,
        item_text: text,
        item_id: text,
        item: text,
        qty,
        ...box('qty'),
        unit_cost: rupees,
        ...box('cost'),
      },
      sql: `select bl.line_no, br.supplier_id::text as supplier_id, br.bill_no, br.bill_date::text as bill_date, bl.item_text, i.id::text as item_id, i.name as item,
                   coalesce(i.unit, 'unit') as unit, bl.qty_milli as qty, ${corners('qty_box', 'qty')},
                   bl.unit_cost_minor as unit_cost, t.currency, ${corners('cost_box', 'cost')}
              from ops.bill_line bl
              join ops.bill_read br on br.tenant_id = bl.tenant_id and br.id = bl.bill_read_id
              cross join ops.tenant t
              left join books.item i on i.tenant_id = bl.tenant_id and i.id = bl.item_id
             where bl.bill_read_id = $1::uuid
             order by bl.line_no
             limit 500`,
    },
  ],
  [
    // What one customer owes on credit (udhaar) now: every live entry, given and repaid. One row for a customer of
    // this tenant, owing nothing or not.
    'credit.balance',
    {
      params: z.strictObject({ customer_id: z.guid() }),
      order: ['customer_id'],
      key: ['customer_id'],
      columns: { customer_id: text, customer: text, balance: rupees },
      sql: `select c.id::text as customer_id, c.name as customer, t.currency,
                   coalesce((select sum(ce.amount_minor) from books.credit_entry ce
                              where ce.tenant_id = c.tenant_id and ce.customer_id = c.id and ce.currency = t.currency
                                and ce.reverses_id is null
                                and not exists (select 1 from books.credit_entry rv where rv.tenant_id = ce.tenant_id and rv.reverses_id = ce.id)), 0)::bigint as balance
              from books.customer c
              cross join ops.tenant t
             where c.id = $1::uuid`,
    },
  ],
];
