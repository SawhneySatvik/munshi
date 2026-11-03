// What each role may read: one map from every named read (queries.ts) to the roles that may make it and the capability
// it needs, enforced where every snapshot is minted (mintIn) and where a stored one is loaded for a screen
// (views-common's storedSnapshots), so screens, Ask, Why?, recipes and read-aloud pass the same gate. Counter staff
// read the counter, the credit book and stock, and nothing else: what ringing up a sale needs (the quote, the receipt,
// the items, the customer's credit, points and package balance), stock on hand, and the stock findings in quantities
// only, since what stock cost the shop is the office's (OFFICE_COLUMNS, cut from every row a counter member is sent).
// Reports, bills, suppliers, settlements, growth, orders, packages, customers, the calendar, the brief and the office
// are the owner's and a manager's. A capability switched off refuses its reads for everyone. Only a member's own
// transaction is gated: a watcher, the brief and every other system or jobs scope has no member, and reads as before.
// `cap` names a capability only where the screens already ask for it (ai, site and messaging need a platform grant, so
// no read keys on them). `counter`: the narrow window of a report read the counter shows every role (today's takings,
// the quick tiles' best sellers), so the counter needs no read of its own and the report stays the owner's.
import type pg from 'pg';
import type { Capability } from './capabilities.ts';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import { type Session, withTx } from './session.ts';
import { addDays, businessDate } from './time.ts';
import { txState } from './tx-state.ts';

export const MEMBER_ROLES = ['owner', 'manager', 'staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

type Params = Record<string, unknown>;
export type ReadRule = { roles: readonly MemberRole[]; cap: Capability | null; counter?: (p: Params, today: string) => boolean };

const ALL: readonly MemberRole[] = MEMBER_ROLES;
/** The owner and a manager: the office's reads, and every draft on Home (counter staff see only their own). */
export const OFFICE_ROLES: readonly MemberRole[] = ['owner', 'manager'];
const OFFICE = OFFICE_ROLES;
const all = (cap: Capability | null = null): ReadRule => ({ roles: ALL, cap });
const office = (cap: Capability | null = null): ReadRule => ({ roles: OFFICE, cap });

export const READ_ROLES: Readonly<Record<string, ReadRule>> = {
  // the counter
  'items.list': all(),
  'items.price': all(),
  'sale.quote': all(),
  'sale.quote_offers': all(),
  'sale.receipt': all(),
  // today's takings on the counter; the day report is the office's
  'sales.by_day': { ...office(), counter: (p, today) => p.from === today && p.to === today },
  // the counter's quick tiles: the best sellers of the four weeks to today
  'sales.by_item': { ...office(), counter: (p, today) => p.to === today && typeof p.from === 'string' && p.from >= addDays(today, -27) },
  'sales.week_total': office(),
  // stock
  'stock.on_hand': all(),
  'stock.available': all(),
  'stock.below_reorder': all(),
  'count.shelf': all(),
  // the credit book, and the customer at the counter: their points and a package's balance
  'credit.balance': all(),
  'credit.balances': all(),
  'credit.overdue_total': office(),
  'loyalty.balance': all('loyalty'),
  'package.balance': all(),
  // customers, loyalty, packages and orders: the office's screens
  'loyalty.balances': office('loyalty'),
  'loyalty.rule': office('loyalty'),
  'package.holdings': office(),
  'package.plans': office(),
  'order.board': office('orders'),
  'order.lines': office('orders'),
  'order.request_lines': office('orders'),
  'measurement.values': office('orders'),
  'order.extracts': office(),
  // bills, suppliers and what was paid for stock
  'bills.recent': office(),
  'bill.lines': office(),
  'bill.lines_for': office(),
  'purchases.last_price': office(),
  'purchases.last_prices': office(),
  'purchases.price_history': office(),
  // money: settlements, growth, invoices, offers
  'settlements.reconcile': office(),
  'growth.basket': office(),
  'growth.customers': office(),
  'growth.payment_mix': office(),
  'growth.peak_hours': office(),
  'growth.slow_movers': office(),
  'gst.summary': office('gst'),
  'invoices.list': office('gst'),
  'invoice.detail': office('gst'),
  'invoice.open_credit': office(),
  'paypal.event': office(),
  'offers.list': office('offers'),
  'offer.detail': office(),
  // staff records and pay
  'staff.advances': office('staff'),
  'salary.preview': office('salary'),
  // the brief, the office, the inbox and campaigns
  'brief.figures': office(),
  'brief.ranked': office(),
  'desks.week': office(),
  'desks.trace': office(),
  // AI spend against the budget: AI staff's figures
  'ai.spend_month': office(),
  'ai.spend_by_desk': office(),
  'inbox.extract': office(),
  'inbox.order_link': office(),
  'campaign.audience': office(),
  // memory: the notes in force are the office's; "why this number" is anyone's, each node cut to what their
  // role may read (rowsFor)
  'memory.in_force': office(),
  'why.chain': all(),
  // a site release (the owner publishes it; release_check holds who)
  'site.capabilities': office(),
  'site.catalogue': office(),
  'site.offer_items': office(),
  'site.offers': office(),
  'site.package_lines': office(),
  'site.packages': office(),
  // surplus for good: the recipients (simulated), the impact tally and what is left of a lot are the office's, on the
  // stock capability
  'surplus.recipients': office('stock'),
  'surplus.impact': office('stock'),
  'surplus.lot': office('stock'),
  // the watchers' reads, behind a finding's Why? and its fix: staff see the stock findings (their quantities only), each
  // under its watcher's capability (watchers.ts WATCHERS `needs`)
  'watch.shrinkage': all('stock'),
  'watch.expiry': all('stock'),
  'watch.dead_stock': all('stock'),
  'watch.hold_expiring': office('holds'),
  'watch.price_creep': office('buying'),
  'watch.overdue_credit': office('credit'),
  'watch.short_settlement': office('counter'),
  'watch.missing_settlement': office('counter'),
  'watch.unrecovered_advance': office('staff'),
  'watch.regulars_lapsing': office('campaigns'),
  'watch.package_expiry': office('packages'),
  'watch.idle_stylist': office('bookings'),
  'watch.stylist_absent_booked': office('bookings'),
  'watch.unbilled_booking': office('bookings'),
  'watch.hold_pressure': office('bookings'),
  'watch.order_unanswered': office('orders'),
  'watch.order_late': office('orders'),
  'watch.advance_unapplied': office('orders'),
  'watch.paypal_unrecorded': office('credit'),
};

// The screens that show no named read of their own, by the same rule: each gated as if it were a read (mayReadIn).
export const SCREENS: Readonly<Record<string, ReadRule>> = {
  'screen.calendar': office('bookings'),
  'screen.requests': office(),
  'screen.customers': office(),
  // a real shop's way in (onboarding.ts): the waiting page (only its owner signs in to a pending shop; once it
  // is accepted, counter staff have no use for it) and Home's Getting started
  'screen.waiting': office(),
  'screen.getting_started': office(),
};

// Ask's desks (packages/agent/src/tools.ts DESKS) by the same rule: who may route to each, and the capability that
// opens it (packages/agent/src/desks.ts DESK_REGISTRY: the Stock desk, Sales & Money's sales, its udhaar part).
export const ASK_DESKS: Readonly<Record<string, { roles: readonly MemberRole[]; cap: Capability }>> = {
  stock: { roles: ALL, cap: 'stock' },
  sales: { roles: OFFICE, cap: 'counter' },
  credit: { roles: ALL, cap: 'credit' },
};

/** Columns only the office sees, whatever the read: what stock cost the shop (a purchase's unit cost, the value at risk,
 * the stock's value, a shrinkage's loss). Cut from every row sent to another role (rowsFor). */
export const OFFICE_COLUMNS: ReadonlySet<string> = new Set(['unit_cost', 'at_risk_value', 'stock_value', 'loss']);

/** Whether `role` may make the read at all (its window aside), the capabilities aside. */
export const roleMayRead = (role: string, name: string): boolean => (READ_ROLES[name]?.roles as readonly string[] | undefined)?.includes(role) === true;

/** The columns of `name` that `role` is not sent (OFFICE_COLUMNS, for a role outside the office). */
export const hiddenColumns = (role: string, name: string): string[] =>
  (OFFICE_ROLES as readonly string[]).includes(role) ? [] : Object.keys(QUERIES.get(name)?.columns ?? {}).filter((col) => OFFICE_COLUMNS.has(col));

/** Rows as `role` may see them: the columns it is not sent cut out (the stored snapshot stays whole). */
export function rowsFor<T>(role: string, name: string, rows: Record<string, T>[]): Record<string, T>[] {
  // A why.chain node reached through a read the role may not make is cut, and every node under it (its path names
  // them). Outside the office the walk stops at the book row: no decision, nothing under one (depth above zero), and no
  // row's writer, who under a decision is its approver (staff are offered no Why? on the office's decisions).
  if (name === 'why.chain') {
    const reached = (path: unknown) => typeof path === 'string' && path.split(',').every((q) => q === '' || roleMayRead(role, q));
    const txt = (cell: unknown) => (cell as { txt?: unknown } | undefined)?.txt;
    rows = rows.filter((row) => reached(txt(row.path)));
    if (!(OFFICE_ROLES as readonly string[]).includes(role)) {
      const atRoot = (cell: unknown) => (cell as { num?: unknown } | undefined)?.num === '0';
      rows = rows
        .filter((row) => txt(row.kind) !== 'decision' && atRoot(row.depth))
        .map((row) => (txt(row.kind) === 'row' ? Object.fromEntries(Object.entries(row).filter(([col]) => col !== 'member_id')) : row));
    }
  }
  const hidden = hiddenColumns(role, name);
  return hidden.length ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([col]) => !hidden.includes(col)))) : rows;
}

/** The asker of a member's transaction: their role, the shop's switched-on capabilities, the reads (and screens) and Ask
 * desks those allow, the reads they see whole (no column cut), and the shop's business date, taken once per transaction
 * so the counter's view and the counter window agree across midnight. */
export type Asker = {
  role: MemberRole;
  on: ReadonlySet<string>;
  reads: ReadonlySet<string>;
  whole: ReadonlySet<string>;
  desks: ReadonlySet<string>;
  timeZone: string;
  today: string;
};

const allowed = (rule: { roles: readonly MemberRole[]; cap: Capability | null }, role: MemberRole, on: ReadonlySet<string>) =>
  rule.roles.includes(role) && (rule.cap === null || on.has(rule.cap));

/**
 * The acting member of this transaction as the read gate sees them, looked up once per transaction (withTx's memo). A
 * system scope of withTx's has none. On a transaction withTx did not open, the actor is read from the transaction's own
 * context, so a member's read never passes ungated: fail closed. A member who is not an active member of this shop is
 * refused outright.
 */
export async function askerIn(c: pg.ClientBase): Promise<Asker | null> {
  const tx = txState(c);
  if (tx?.memo.has('asker')) return tx.memo.get('asker') as Asker | null;
  const { rows } = await c.query<{ actor: string | null; role: string | null; on: string[]; time_zone: string | null }>(
    `with a as (select coalesce($1::uuid, nullif(current_setting('munshi.actor_id', true), '')::uuid) as actor)
     select a.actor::text as actor,
            (select m.role from ops.member m where m.id = a.actor and m.active) as role,
            array(select r.code from ref.capability r
                   where coalesce((select s.is_on from ops.capability_switch s where s.capability = r.code order by s.at desc, s.id desc limit 1), false)) as on,
            (select t.time_zone from ops.tenant t) as time_zone
       from a`,
    [tx?.memberId ?? null],
  );
  const r = rows[0];
  if (!r?.actor) {
    tx?.memo.set('asker', null);
    return null;
  }
  const role = r.role as MemberRole | null;
  if (!role || !MEMBER_ROLES.includes(role) || !r.time_zone) throw new CoreError('not_for_role', { fields: ['role'] });
  const on = new Set(r.on);
  const rules: Record<string, ReadRule> = { ...READ_ROLES, ...SCREENS };
  const reads = new Set(Object.keys(rules).filter((name) => allowed(rules[name] as ReadRule, role, on)));
  const asker: Asker = {
    role,
    on,
    reads,
    whole: new Set([...reads].filter((name) => hiddenColumns(role, name).length === 0)),
    desks: new Set(Object.keys(ASK_DESKS).filter((desk) => allowed(ASK_DESKS[desk] as ReadRule, role, on))),
    timeZone: r.time_zone,
    today: businessDate(new Date(), r.time_zone),
  };
  tx?.memo.set('asker', asker);
  return asker;
}

/**
 * The gate mintIn asks before a member's read runs: refused (not_for_role) unless the member's role may make it, or it
 * falls in the counter window (on the transaction's one business date); refused (capability_off) while its capability
 * is off. A read the map does not name is refused for every member. No member: no gate.
 */
export async function refuseRead(c: pg.ClientBase, name: string, params: Params): Promise<void> {
  const asker = await askerIn(c);
  if (!asker) return;
  const rule = READ_ROLES[name];
  if (!rule) throw new CoreError('not_for_role', { fields: ['name'] });
  const window = rule.counter?.(params, asker.today) === true;
  // The role before the capability: a read not for this role is refused as such whether its capability is on or off,
  // so a refusal never tells a member which of the office's capabilities the shop has switched on.
  if (!rule.roles.includes(asker.role) && !window) throw new CoreError('not_for_role', { fields: ['name'] });
  if (rule.cap !== null && !asker.on.has(rule.cap)) throw new CoreError('capability_off', { fields: [rule.cap] });
}

/** Whether the member of this transaction may make `name`, a read or a screen (role and capability, no window): a
 * screen's own gate. A system scope may. */
export async function mayReadIn(c: pg.ClientBase, name: string): Promise<boolean> {
  const asker = await askerIn(c);
  return !asker || asker.reads.has(name);
}

/** mayReadIn in the member's own transaction: a server action's gate, before any run, model call or write. */
export function memberMayRead(pool: pg.Pool, session: Session, name: string): Promise<boolean> {
  return withTx(pool, { kind: 'member', session }, (c) => mayReadIn(c, name));
}
