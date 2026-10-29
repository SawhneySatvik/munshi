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
  [
    // The order requests a message names by code (BP-F3b): a customer who placed a cart on the site sends "Order
    // ORD-7K2Q …" on WhatsApp, and the inbox shows that request beside the message. The link is read, never written:
    // the webhook only inserts, and a site request carries no message id (21).
    'inbox.order_link',
    {
      params: z.strictObject({ message_id: z.guid() }),
      order: ['message_id'],
      key: ['request_id'],
      columns: { request_id: text, code: text, state: text },
      sql: `select r.id::text as request_id, r.code, r.state
              from ops.inbound_message i
              join ops.order_request r on r.tenant_id = i.tenant_id
                and r.code = any (array(select m[1] from regexp_matches(upper(coalesce(i.text, i.transcript, '')), '(ORD-[A-Z0-9]{4,6})', 'g') m))
             where i.id = $1::uuid and i.erased_at is null
             order by r.created_at, r.id
             limit 5`,
    },
  ],
];
