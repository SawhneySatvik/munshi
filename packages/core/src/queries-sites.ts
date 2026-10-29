// Named reads for sites: what a release publishes (BLUEPRINT §5.1, §2.10). Each is minted as a `release` snapshot inside
// the publishing transaction (publishRelease, site-release.ts) and pinned by it; the public API and the shop sites show
// only its cells. queries.ts spreads these into QUERIES (type-only import: it is still being evaluated when this loads).
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const rupees: Column = { kind: 'money', currency: 'currency' };

export const SITE_QUERIES: [string, NamedQuery][] = [
  [
    // The catalogue: every good and service with a price in effect now, at that price (intake prices a cart from these
    // cells, CATALOGUE in intake.ts); its name, category and (for a service) duration from its latest revision. No stock
    // figure: what is on hand is not published.
    'site.catalogue',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: { item_id: text, item: text, kind: text, category: text, duration_min: int, price: rupees },
      sql: `select i.id::text as item_id, r.name as item, i.kind, r.category, r.duration_min, p.amount_minor as price, p.currency
  from books.item i
  join lateral (select x.name, x.category, x.duration_min from books.item_revision x where x.tenant_id = i.tenant_id and x.item_id = i.id and x.effective_from <= now()
                 order by x.effective_from desc, x.created_at desc, x.id desc limit 1) r on true
  join lateral (select x.amount_minor, x.currency from books.price x where x.tenant_id = i.tenant_id and x.item_id = i.id and x.effective_from <= now()
                 order by x.effective_from desc, x.created_at desc, x.id desc limit 1) p on true
 where i.kind in ('good', 'service')
 order by r.category nulls last, r.name, i.id limit 500`,
    },
  ],
];
