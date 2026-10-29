// Named reads for sites: what a release publishes (BLUEPRINT §5.1, §2.10). Each is minted as a `release` snapshot inside
// the publishing transaction (publishRelease, site-release.ts) and pinned by it; the public API and the shop sites show
// only its cells. queries.ts spreads these into QUERIES (type-only import: it is still being evaluated when this loads).
// Each row carries the ids of the book rows its cells came from (`*_id` text columns), so "tap for source" can name the
// table and row of any published cell (SITE_SOURCES, site-api.ts). New columns are appended, never inserted: a reader may
// hold a column's position.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const ts: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };

// The latest revision in effect of an item (books.item_revision: the latest wins, R4 K1), and the latest price.
const revision = (item: string, cols: string) => `join lateral (select ${cols} from books.item_revision x where x.tenant_id = ${item}.tenant_id and x.item_id = ${item}.id and x.effective_from <= now()
                 order by x.effective_from desc, x.created_at desc, x.id desc limit 1) r on true`;
const price = (item: string) => `join lateral (select x.id, x.amount_minor, x.currency from books.price x where x.tenant_id = ${item}.tenant_id and x.item_id = ${item}.id and x.effective_from <= now()
                 order by x.effective_from desc, x.created_at desc, x.id desc limit 1) p on true`;

export const SITE_QUERIES: [string, NamedQuery][] = [
  [
    // The catalogue: every good and service on sale with a price in effect now, at that price (intake prices a cart from
    // these cells, CATALOGUE in intake.ts); its name, category, attributes and (for a service) duration from its latest
    // revision; a variant names its parent. No stock figure: what is on hand is not published.
    'site.catalogue',
    {
      params: z.strictObject({}),
      order: [],
      key: ['item_id'],
      columns: {
        item_id: text,
        item: text,
        kind: text,
        category: text,
        duration_min: int,
        price: rupees,
        price_id: text,
        revision_id: text,
        parent_id: text,
        parent: text,
        unit: text,
        attrs: text,
      },
      sql: `select i.id::text as item_id, r.name as item, i.kind, r.category, r.duration_min, p.amount_minor as price, p.currency,
       p.id::text as price_id, r.id::text as revision_id, i.parent_item_id::text as parent_id,
       (select x.name from books.item_revision x where x.tenant_id = i.tenant_id and x.item_id = i.parent_item_id and x.effective_from <= now()
         order by x.effective_from desc, x.created_at desc, x.id desc limit 1) as parent,
       i.unit, r.attrs::text as attrs
  from books.item i
  ${revision('i', 'x.id, x.name, x.category, x.duration_min, x.attrs, x.sellable')}
  ${price('i')}
 where i.kind in ('good', 'service') and r.sellable
 order by r.category nulls last, r.name, i.id limit 500`,
    },
  ],
  [
    // The package plans on sale (books.package_plan), each at its price in effect, with its stored value and validity.
    'site.packages',
    {
      params: z.strictObject({}),
      order: [],
      key: ['plan_id'],
      columns: {
        plan_id: text,
        item_id: text,
        plan: text,
        kind: text,
        price: rupees,
        price_id: text,
        value: { kind: 'money', currency: 'value_currency' },
        validity_days: int,
        revision_id: text,
      },
      sql: `select pp.id::text as plan_id, i.id::text as item_id, r.name as plan, pp.kind, p.amount_minor as price, p.currency, p.id::text as price_id,
       pp.value_minor as value, pp.currency as value_currency, pp.validity_days, r.id::text as revision_id
  from books.package_plan pp
  join books.item i on i.tenant_id = pp.tenant_id and i.id = pp.item_id
  ${revision('i', 'x.id, x.name, x.sellable')}
  ${price('i')}
 where r.sellable
 order by r.name, pp.id limit 500`,
    },
  ],
  [
    // A sessions plan's lines: the service and how many sessions of it.
    'site.package_lines',
    {
      params: z.strictObject({}),
      order: [],
      key: ['line_id'],
      columns: { plan_id: text, line_id: text, item_id: text, item: text, sessions: int, revision_id: text },
      sql: `select l.plan_id::text as plan_id, l.id::text as line_id, l.item_id::text as item_id, r.name as item, l.sessions, r.id::text as revision_id
  from books.package_plan_line l
  join books.item i on i.tenant_id = l.tenant_id and i.id = l.item_id
  ${revision('i', 'x.id, x.name')}
 order by l.plan_id, l.line_no limit 500`,
    },
  ],
  [
    // Published offers not yet over (an early end counts), with the code the owner published with it.
    'site.offers',
    {
      params: z.strictObject({}),
      order: [],
      key: ['offer_id'],
      columns: {
        offer_id: text,
        offer: text,
        kind: text,
        percent_bp: int,
        amount_off: rupees,
        scope: text,
        category: text,
        min_spend: rupees,
        code: text,
        starts_at: ts,
        ends_at: ts,
      },
      sql: `select o.id::text as offer_id, o.name as offer, o.kind, o.percent_bp, o.amount_off_minor as amount_off, o.currency, o.scope, o.category,
       o.min_spend_minor as min_spend, o.code, o.starts_at, least(o.ends_at, e.ended_at) as ends_at
  from books.offer o
  left join lateral (select min(x.ended_at) as ended_at from books.offer_end x where x.tenant_id = o.tenant_id and x.offer_id = o.id) e on true
 where o.published and least(o.ends_at, coalesce(e.ended_at, o.ends_at)) > now()
 order by o.starts_at, o.id limit 500`,
    },
  ],
  [
    // The items of the published offers scoped to items (books.offer_item).
    'site.offer_items',
    {
      params: z.strictObject({}),
      order: [],
      key: ['offer_item_id'],
      columns: { offer_id: text, offer_item_id: text, item_id: text },
      sql: `select x.offer_id::text as offer_id, x.id::text as offer_item_id, x.item_id::text as item_id
  from books.offer_item x join books.offer o on o.tenant_id = x.tenant_id and o.id = x.offer_id
 where o.published and o.ends_at > now()
 order by x.offer_id, x.item_id limit 500`,
    },
  ],
  [
    // Which capabilities were on when the release was published: the public role cannot read the switches, so a public
    // route that a capability gates (orders, holds) reads its state here.
    'site.capabilities',
    {
      params: z.strictObject({}),
      order: [],
      key: ['capability'],
      columns: { capability: text, state: text },
      sql: `select distinct on (s.capability) s.capability, case when s.is_on then 'on' else 'off' end as state
  from ops.capability_switch s
 order by s.capability, s.at desc, s.id desc limit 500`,
    },
  ],
];
