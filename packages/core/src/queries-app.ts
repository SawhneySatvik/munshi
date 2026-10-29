// The screens' named reads: what the counter prices and receipts from, a recorded bill's lines, every item's last
// bill price in one read, and a range's takings. Same rules as every named read (queries.ts). The quote's rounding is
// sale.record's (commands.ts, money.ts lineAmount), computed in SQL so no browser or server code does the arithmetic.
// Type-only import: queries.ts spreads APP_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;
// A line amount in minor units, rounded half away from zero: money.ts lineAmount, which sale.record uses.
const lineAmount = (x: string) => `(case when ${x} < 0 then -((-(${x}) + 500) / 1000) else (${x} + 500) / 1000 end)`;

export const APP_QUERIES: [string, NamedQuery][] = [
  [
    // A recorded bill's lines by id: item, quantity, unit cost, amount and expiry, and the unit cost of the same item on
    // the bill before this one (null if none), so a price rise is two cells compared, never a subtraction.
    'bill.lines_for',
    {
      params: z.strictObject({ purchase_id: z.guid() }),
      order: ['purchase_id'],
      key: ['line_id'],
      columns: { line_id: text, line_no: int, item: text, qty, unit_cost: rupees, amount: rupees, expires_on: day, prev_unit_cost: rupees },
      sql: `select pl.id::text as line_id, pl.line_no, i.name as item, i.unit, pl.qty_milli as qty, pl.unit_cost_minor as unit_cost,
                   ${lineAmount('pl.qty_milli * pl.unit_cost_minor')}::bigint as amount, pl.expires_on::text as expires_on,
                   prev.unit_cost_minor as prev_unit_cost, pl.currency
              from books.purchase p
              join books.purchase_line pl on pl.tenant_id = p.tenant_id and pl.purchase_id = p.id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
              left join lateral (
                select b.unit_cost_minor
                  from books.purchase_line b
                  join books.purchase bp on bp.tenant_id = b.tenant_id and bp.id = b.purchase_id
                 where b.item_id = pl.item_id and ${live('books.purchase', 'bp')}
                   and (bp.bill_date, bp.created_at, b.line_no) < (p.bill_date, p.created_at, pl.line_no)
                 order by bp.bill_date desc, bp.created_at desc, b.line_no desc
                 limit 1
              ) prev on true
             where p.id = $1::uuid and ${live('books.purchase', 'p')}
             order by pl.line_no
             limit 500`,
    },
  ],
  [
    // Every item that has been bought, once, at its latest bill line: who supplied it, on which bill, at what unit cost.
    'purchases.last_prices',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: { item_id: text, item: text, supplier_id: text, supplier: text, bill_no: text, bill_date: day, unit_cost: rupees, qty },
      sql: `select distinct on (i.name, i.id) i.id::text as item_id, i.name as item, i.unit, s.id::text as supplier_id, s.name as supplier,
                   p.bill_no, p.bill_date::text as bill_date, pl.unit_cost_minor as unit_cost, pl.qty_milli as qty, pl.currency
              from books.purchase_line pl
              join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
              join books.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
             where ${live('books.purchase', 'p')}
             order by i.name, i.id, p.bill_date desc, p.created_at desc, pl.line_no desc
             limit 500`,
    },
  ],
];
