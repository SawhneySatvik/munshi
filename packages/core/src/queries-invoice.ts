// Named reads for GST invoices: one invoice, bill of supply or credit note with every printed figure as a cell (its
// lines, each with its discount, taxable value, rate, CGST, SGST and total, and its header on every row); a branch's
// invoices in a month; and the month's GST summary by rate, read from the invoice lines, credit notes netting against
// what they cancel, which equals the journal's output-tax sums. Months are the shop's (the tenant's zone), by issue
// time. Type-only import: queries.ts spreads INVOICE_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };
const qty: Column = { kind: 'quantity', unit: 'unit' };

const month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const inMonth = (at: string, m: string) =>
  `${at} >= ((${m} || '-01')::date::timestamp at time zone (select time_zone from ops.tenant))
   and ${at} < (((${m} || '-01')::date + interval '1 month')::timestamp at time zone (select time_zone from ops.tenant))`;
const PAGE = 500;

export const INVOICE_QUERIES: [string, NamedQuery][] = [
  [
    'invoice.detail',
    {
      params: z.strictObject({ invoice_id: z.guid() }),
      order: ['invoice_id'],
      key: ['line_no'],
      columns: {
        line_no: int,
        description: text,
        hsn_sac: text,
        qty,
        discount: rupees,
        taxable: rupees,
        rate_bp: int,
        cgst: rupees,
        sgst: rupees,
        line_total: rupees,
        invoice_id: text,
        kind: text,
        series: text,
        fy: text,
        number: int,
        issued_at: stamp,
        seller_gstin: text,
        buyer_gstin: text,
        place_of_supply: text,
        original_invoice_id: text,
        sale_id: text,
        shop_id: text,
        invoice_taxable: rupees,
        invoice_cgst: rupees,
        invoice_sgst: rupees,
        invoice_total: rupees,
      },
      sql: `select l.line_no, l.description, l.hsn_sac, it.unit, l.qty_milli as qty, l.discount_minor as discount, l.taxable_minor as taxable, l.rate_bp,
                   l.cgst_minor as cgst, l.sgst_minor as sgst, l.total_minor as line_total,
                   v.id::text as invoice_id, v.kind, v.series, v.fy, v.number, v.issued_at, v.seller_gstin, v.buyer_gstin, v.place_of_supply,
                   v.original_invoice_id::text as original_invoice_id, v.sale_id::text as sale_id, v.shop_id::text as shop_id,
                   v.taxable_minor as invoice_taxable, v.cgst_minor as invoice_cgst, v.sgst_minor as invoice_sgst, v.total_minor as invoice_total, v.currency
              from books.invoice v
              join books.invoice_line l on l.tenant_id = v.tenant_id and l.invoice_id = v.id
              join books.sale_line sl on sl.tenant_id = l.tenant_id and sl.id = l.sale_line_id
              join books.item it on it.tenant_id = sl.tenant_id and it.id = sl.item_id
             where v.id = $1::uuid
             order by l.line_no
             limit 500`,
    },
  ],
  [
    // A branch's invoices, bills of supply and credit notes issued in a month, 500 to a page (page 0 first), in the
    // order they were issued.
    'invoices.list',
    {
      params: z.strictObject({ shop_id: z.guid(), month, page: z.number().int().min(0).max(1000).default(0) }),
      order: ['shop_id', 'month', 'page'],
      key: ['invoice_id'],
      columns: {
        invoice_id: text,
        kind: text,
        series: text,
        fy: text,
        number: int,
        issued_at: stamp,
        sale_id: text,
        taxable: rupees,
        cgst: rupees,
        sgst: rupees,
        total: rupees,
      },
      sql: `select v.id::text as invoice_id, v.kind, v.series, v.fy, v.number, v.issued_at, v.sale_id::text as sale_id,
                   v.taxable_minor as taxable, v.cgst_minor as cgst, v.sgst_minor as sgst, v.total_minor as total, v.currency
              from books.invoice v
             where v.shop_id = $1::uuid and ${inMonth('v.issued_at', '$2::text')}
             order by v.issued_at, v.id
             limit ${PAGE} offset $3::int * ${PAGE}`,
    },
  ],
  [
    // The month's GST by rate over every branch: the invoice lines' taxable value, CGST, SGST and totals, credit notes
    // included (their figures are negative), and how many lines.
    'gst.summary',
    {
      params: z.strictObject({ month }),
      order: ['month'],
      key: ['rate_bp'],
      columns: { rate_bp: int, lines: int, taxable: rupees, cgst: rupees, sgst: rupees, total: rupees },
      sql: `select l.rate_bp, count(*)::bigint as lines, sum(l.taxable_minor)::bigint as taxable, sum(l.cgst_minor)::bigint as cgst,
                   sum(l.sgst_minor)::bigint as sgst, sum(l.total_minor)::bigint as total, min(v.currency) as currency
              from books.invoice v
              join books.invoice_line l on l.tenant_id = v.tenant_id and l.invoice_id = v.id
             where ${inMonth('v.issued_at', '$1::text')}
             group by l.rate_bp
             order by l.rate_bp
             limit 500`,
    },
  ],
];
