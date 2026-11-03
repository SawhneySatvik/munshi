// Named reads for packages: one holding's balance per service (the cell a redemption screen shows and a package.expire
// draft cites, so a redemption after it makes the draft stale: approvals' CURRENT), and the holdings with what each has
// left. Balances are the database's running ones (b_package_tally): each service's last sessions_after and the
// holding's last value_after. A holder is a customer id, never a name. Type-only import: queries.ts spreads
// PACKAGE_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const day: Column = { kind: 'date' };
const rupees: Column = { kind: 'money', currency: 'currency' };

const itemName = (item: string) =>
  `(select r.name from books.item_revision r where r.tenant_id = ${item}.tenant_id and r.item_id = ${item}.id and r.effective_from <= now()
     order by r.effective_from desc, r.created_at desc, r.id desc limit 1)`;
const valueLeft = (h: string) =>
  `coalesce((select e.value_after from books.package_entry e where e.tenant_id = ${h}.tenant_id and e.holding_id = ${h}.id order by e.seq desc limit 1), 0)`;
const sessionsLeft = (h: string, item: string) =>
  `coalesce((select e.sessions_after from books.package_entry e where e.tenant_id = ${h}.tenant_id and e.holding_id = ${h}.id and e.item_id = ${item}
              order by e.seq desc limit 1), 0)`;

export const PACKAGE_QUERIES: [string, NamedQuery][] = [
  [
    'package.balance',
    {
      params: z.strictObject({ holding_id: z.guid() }),
      order: ['holding_id'],
      key: ['holding_id', 'item_id'],
      columns: { holding_id: text, customer_id: text, item_id: text, item: text, sessions_left: int, value_left: rupees, expires_on: day },
      sql: `select h.id::text as holding_id, h.customer_id::text as customer_id, pl.item_id::text as item_id, ${itemName('i')} as item,
                   ${sessionsLeft('h', 'pl.item_id')}::bigint as sessions_left, ${valueLeft('h')}::bigint as value_left,
                   h.expires_on::text as expires_on, h.currency
              from books.package_holding h
              join books.package_plan_line pl on pl.tenant_id = h.tenant_id and pl.plan_id = h.plan_id
              join books.item i on i.tenant_id = pl.tenant_id and i.id = pl.item_id
             where h.id = $1::uuid
             order by pl.line_no
             limit 500`,
    },
  ],
  [
    // Every holding (or one customer's), soonest to expire first: its package, the day sold and its expiry, the sessions
    // left over all its services, and the value left.
    'package.holdings',
    {
      params: z.strictObject({ customer_id: z.guid().nullable().default(null) }),
      order: ['customer_id'],
      key: ['holding_id'],
      columns: { holding_id: text, customer_id: text, package: text, sold_on: day, expires_on: day, sessions_left: int, value_left: rupees },
      sql: `select h.id::text as holding_id, h.customer_id::text as customer_id, ${itemName('i')} as package, h.starts_on::text as sold_on,
                   h.expires_on::text as expires_on,
                   (select coalesce(sum(${sessionsLeft('h', 'pl.item_id')}), 0) from books.package_plan_line pl
                     where pl.tenant_id = h.tenant_id and pl.plan_id = h.plan_id)::bigint as sessions_left,
                   ${valueLeft('h')}::bigint as value_left, h.currency
              from books.package_holding h
              join books.package_plan p on p.tenant_id = h.tenant_id and p.id = h.plan_id
              join books.item i on i.tenant_id = p.tenant_id and i.id = p.item_id
             where $1::uuid is null or h.customer_id = $1::uuid
             order by h.expires_on, h.id
             limit 500`,
    },
  ],
  [
    // Every package plan (the packages screen): its package item, its price in effect (books.price), how long it
    // lasts, and one row per service with its sessions, by package name then line.
    'package.plans',
    {
      params: z.strictObject({}),
      order: [],
      key: ['plan_id', 'line_no'],
      columns: { plan_id: text, item_id: text, package: text, price: rupees, validity_days: int, line_no: int, service_id: text, service: text, sessions: int },
      sql: `select p.id::text as plan_id, p.item_id::text as item_id, ${itemName('i')} as package,
                   (select pr.amount_minor from books.price pr where pr.tenant_id = p.tenant_id and pr.item_id = p.item_id and pr.effective_from <= now()
                     order by pr.effective_from desc, pr.created_at desc, pr.id desc limit 1) as price,
                   p.validity_days::bigint as validity_days, pl.line_no::bigint as line_no, pl.item_id::text as service_id, ${itemName('s')} as service,
                   pl.sessions::bigint as sessions, t.currency
              from books.package_plan p
              join books.package_plan_line pl on pl.tenant_id = p.tenant_id and pl.plan_id = p.id
              join books.item i on i.tenant_id = p.tenant_id and i.id = p.item_id
              join books.item s on s.tenant_id = pl.tenant_id and s.id = pl.item_id
              cross join ops.tenant t
             order by 3, p.id, pl.line_no
             limit 500`,
    },
  ],
];
