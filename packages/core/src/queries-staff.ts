// Named reads for staff and salary: the period's salary preview (the figures a salary.run draft cites, salary.ts) and a
// staff member's outstanding advances. Ids and figures only: a staff member's name is the vault's, never a cell.
// queries.ts spreads them into QUERIES (type-only import: it is still being evaluated when this module loads).
import { z } from 'zod';
import type { NamedQuery } from './queries.ts';
import { previewParams, SALARY_PREVIEW } from './salary.ts';

const text = { kind: 'text' } as const;
const rupees = { kind: 'money', currency: 'currency' } as const;
const days = { kind: 'quantity', unit: 'unit' } as const;

export const STAFF_QUERIES: [string, NamedQuery][] = [
  [
    'salary.preview',
    {
      params: previewParams,
      order: ['period_start', 'period_end', 'shop_id'],
      key: ['staff_id'],
      columns: {
        staff_id: text,
        terms_id: text,
        pay_kind: text,
        pay: rupees,
        days,
        unpaid_days: days,
        gross: rupees,
        outstanding: rupees,
        recovered: rupees,
        net: rupees,
      },
      sql: SALARY_PREVIEW,
    },
  ],
  [
    // What a staff member has taken ahead of pay and not yet had recovered by a salary run, per currency.
    'staff.advances',
    {
      params: z.strictObject({ staff_id: z.guid() }),
      order: ['staff_id'],
      key: ['staff_id', 'currency'],
      columns: { staff_id: text, currency: text, given: rupees, recovered: rupees, outstanding: rupees },
      sql: `with given as (select a.currency, sum(a.amount_minor) as n from books.advance a where a.staff_id = $1::uuid group by a.currency),
                 recovered as (select l.currency, sum(l.advance_recovered_minor) as n from books.salary_line l where l.staff_id = $1::uuid group by l.currency)
            select $1::text as staff_id, g.currency, g.n as given, coalesce(r.n, 0) as recovered, g.n - coalesce(r.n, 0) as outstanding
              from given g left join recovered r on r.currency = g.currency
             order by g.currency`,
    },
  ],
];
