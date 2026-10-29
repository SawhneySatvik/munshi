// Named reads for campaigns. Type-only import: queries.ts spreads CAMPAIGN_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };

const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;

export const CAMPAIGN_QUERIES: [string, NamedQuery][] = [
  [
    // Who a campaign would reach now: the customers in its segment whom it may message, by id only (no name or phone
    // enters a cell). The consent rule is b_outbound_derive's own (the latest marketing consent on the campaign's
    // channel, from the customer's current, unerased contact, granted), so every customer here is one the database
    // will accept; and a STOP from that phone since the consent excludes them at once, before anyone records the
    // withdrawal (fail closed). The segment and its days are the campaign's, fixed once composed. More than 500 is
    // refused when minted, never cut short: approval sends to exactly this set (K5).
    'campaign.audience',
    {
      params: z.strictObject({ campaign_id: z.guid() }),
      order: ['campaign_id'],
      key: ['customer_id'],
      columns: { customer_id: text },
      sql: `with g as (
              select c.channel, c.segment,
                     coalesce(c.segment_days, case c.segment when 'bought_within_days' then 90 when 'lapsed_regulars' then 60 else 14 end) as days,
                     (now() at time zone (select time_zone from ops.tenant))::date as today
                from ops.campaign c where c.id = $1::uuid
            ),
            cur as (
              select distinct on (p.customer_id) p.tenant_id, p.customer_id, p.contact_id
                from books.party_contact p
               where p.customer_id is not null and p.effective_from <= now()
               order by p.customer_id, p.effective_from desc, p.created_at desc, p.id desc
            ),
            reach as (
              select cur.tenant_id, cur.customer_id
                from cur
                join ops.contact ct on ct.tenant_id = cur.tenant_id and ct.id = cur.contact_id and ct.erased_at is null and ct.phone_e164 is not null
                join lateral (select k.granted, k.created_at from books.customer_consent k
                               where k.tenant_id = cur.tenant_id and k.customer_id = cur.customer_id and k.contact_id = cur.contact_id
                                 and k.channel = (select channel from g) and k.purpose = 'marketing'
                               order by k.created_at desc, k.id desc limit 1) k on k.granted
               where not exists (select 1 from ops.inbound_message i
                                  where i.tenant_id = cur.tenant_id and i.from_address = ct.phone_e164 and i.opt_out and i.received_at > k.created_at)
            ),
            sales as (
              select s.customer_id, count(*) as n, max(s.sold_at) as last_at
                from books.sale s where s.customer_id is not null and ${live('books.sale', 's')}
               group by s.customer_id
            )
            select r.customer_id::text as customer_id
              from reach r, g
             where case g.segment
                     when 'bought_within_days' then exists (
                       select 1 from sales x where x.customer_id = r.customer_id and x.last_at >= now() - make_interval(days => g.days))
                     when 'lapsed_regulars' then exists (
                       select 1 from sales x where x.customer_id = r.customer_id and x.n >= 2 and x.last_at < now() - make_interval(days => g.days))
                     else exists (
                       select 1 from books.package_holding h
                        where h.tenant_id = r.tenant_id and h.customer_id = r.customer_id and h.expires_on between g.today and g.today + g.days)
                   end
             order by r.customer_id
             limit 501`,
    },
  ],
];
