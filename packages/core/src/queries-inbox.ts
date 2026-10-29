// Named reads for the inbox. Type-only import: queries.ts spreads INBOX_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };

export const INBOX_QUERIES: [string, NamedQuery][] = [
  [
    // The figures read off one inbox message, each from its span (inbox.ts): an amount in paise, a count, a date. No
    // quote: the customer's words stay in the erasable message, and a screen shows the span by its offsets from there.
    'inbox.extract',
    {
      params: z.strictObject({ message_id: z.guid() }),
      order: ['message_id'],
      key: ['extract_id'],
      columns: { extract_id: text, field: text, amount: rupees, quantity: int, day, span_start: int, span_end: int },
      sql: `select e.id::text as extract_id, e.field,
                   case when e.field = 'amount' then e.num end as amount, (select currency from ops.tenant) as currency,
                   case when e.field = 'quantity' then e.num / 1000 end as quantity,
                   e.day::text as day, e.span_start, e.span_end
              from ops.inbound_extract e
             where e.message_id = $1::uuid
             order by e.span_start, e.id
             limit 500`,
    },
  ],
];
