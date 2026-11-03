// Named reads for offers and loyalty: an offer as the owner set it, with whether it is in effect now and its live
// redemptions (sales with an unreversed discount naming it, as b_offer_cap counts them); every offer; and a customer's
// points. A campaign's "20% off" is a cell of offer.detail. Type-only import: queries.ts spreads OFFER_QUERIES while it
// is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };
const rupees: Column = { kind: 'money', currency: 'currency' };

const OFFER_COLUMNS: Record<string, Column> = {
  offer_id: text,
  name: text,
  kind: text,
  code: text,
  scope: text,
  category: text,
  percent_bp: int,
  amount_off: rupees,
  min_spend: rupees,
  max_redemptions: int,
  per_customer_limit: int,
  starts_at: stamp,
  ends_at: stamp,
  ended_at: stamp,
  in_effect: int,
  published: int,
  redemptions: int,
};
const offerRows = (where: string) => `
  select o.id::text as offer_id, o.name, o.kind, o.code, o.scope, o.category, o.percent_bp, o.amount_off_minor as amount_off,
         o.min_spend_minor as min_spend, o.max_redemptions, o.per_customer_limit, o.starts_at, o.ends_at, e.ended_at,
         (o.starts_at <= now() and now() < o.ends_at and (e.ended_at is null or e.ended_at > now()))::int as in_effect, o.published::int as published,
         (select count(distinct d.sale_id) from books.sale_discount d
           where d.tenant_id = o.tenant_id and d.offer_id = o.id and d.reverses_id is null
             and not exists (select 1 from books.sale_discount r where r.tenant_id = d.tenant_id and r.reverses_id = d.id))::bigint as redemptions,
         coalesce(o.currency, t.currency) as currency
    from books.offer o
    cross join ops.tenant t
    left join books.offer_end e on e.tenant_id = o.tenant_id and e.offer_id = o.id
   where ${where}`;

export const OFFER_QUERIES: [string, NamedQuery][] = [
  [
    'offer.detail',
    {
      params: z.strictObject({ offer_id: z.guid() }),
      order: ['offer_id'],
      key: ['offer_id'],
      columns: OFFER_COLUMNS,
      sql: offerRows('o.id = $1::uuid'),
    },
  ],
  [
    // Every offer, the latest to start first.
    'offers.list',
    {
      params: z.strictObject({}),
      order: [],
      key: ['offer_id'],
      columns: OFFER_COLUMNS,
      sql: `${offerRows('true')} order by o.starts_at desc, o.id limit 500`,
    },
  ],
  [
    // A customer's points (the last entry's balance, b_loyalty_tally's), and what they are worth under the rule in effect.
    'loyalty.balance',
    {
      params: z.strictObject({ customer_id: z.guid() }),
      order: ['customer_id'],
      key: ['customer_id'],
      columns: { customer_id: text, points: int, value: rupees, min_redeem: int },
      sql: `select c.id::text as customer_id, b.points, (b.points * r.point_value_minor)::bigint as value, r.min_redeem, t.currency
              from books.customer c
              cross join ops.tenant t
              cross join lateral (select coalesce((select e.balance_after from books.loyalty_entry e where e.tenant_id = c.tenant_id and e.customer_id = c.id
                                                    order by e.seq desc limit 1), 0)::bigint as points) b
              left join lateral (select l.point_value_minor, l.min_redeem from books.loyalty_rule l
                                  where l.tenant_id = c.tenant_id and l.effective_from <= now() and l.currency = t.currency
                                  order by l.effective_from desc, l.created_at desc, l.id desc limit 1) r on true
             where c.id = $1::uuid`,
    },
  ],
  [
    // Every customer holding points (the last entry's balance, b_loyalty_tally's), by customer id: the customers screen's
    // points column. A customer with none has no row.
    'loyalty.balances',
    {
      params: z.strictObject({}),
      order: [],
      key: ['customer_id'],
      columns: { customer_id: text, points: int },
      sql: `select c.id::text as customer_id, b.points
              from books.customer c
              cross join lateral (select e.balance_after::bigint as points from books.loyalty_entry e where e.tenant_id = c.tenant_id and e.customer_id = c.id
                                   order by e.seq desc limit 1) b
             where b.points > 0
             order by c.id
             limit 500`,
    },
  ],
  [
    // The loyalty rule in effect (the latest, in the shop's currency): points per ₹100 of net, a point's worth, the
    // fewest points a redemption takes. No row before the owner sets one.
    'loyalty.rule',
    {
      params: z.strictObject({}),
      order: [],
      key: ['rule_id'],
      columns: { rule_id: text, earn_per_100: int, point_value: rupees, min_redeem: int, effective_from: stamp },
      sql: `select l.id::text as rule_id, l.earn_per_100::bigint as earn_per_100, l.point_value_minor as point_value, l.min_redeem::bigint as min_redeem,
                   l.effective_from, l.currency
              from books.loyalty_rule l cross join ops.tenant t
             where l.effective_from <= now() and l.currency = t.currency
             order by l.effective_from desc, l.created_at desc, l.id desc
             limit 1`,
    },
  ],
];
