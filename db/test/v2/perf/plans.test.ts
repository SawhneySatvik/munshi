// The v2 schema's plans at volume (db/test/v2/perf/volume.ts). After VACUUM (ANALYZE) — a plain ANALYZE leaves no
// visibility map, so index-only scans would be costed as heap reads that an autovacuumed table does not make — every
// named read, every statement of the counter sale and the order board is planned as munshi_app inside a transaction
// carrying the tenant's SET LOCAL context (a superuser bypasses RLS and would plan a different query). A plan fails on a
// Seq Scan over a growing table, anywhere in it (InitPlans, SubPlans and CTEs included), unless SEQ_ALLOWED holds that
// read and table, and on an allowed entry it no longer makes (stale); a read fails when its top-level estimate is more
// than 10 × max(rows, 1) of the rows the same SQL returns (a plan never estimates fewer than one row; a write's estimate
// is not judged). Each is then timed once with EXPLAIN (ANALYZE, BUFFERS); the report goes to stdout after the run.
// Runs only under vitest.perf.config.ts (MUNSHI_PERF), before a release; its red-proofs are test/v2/sabotage/perf.ts.
// Every test is top-level: redproof selects one by its own title.
import { addDays, openSession, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QUERIES } from '../../../../packages/core/src/queries.ts';
import { seedVolume, VOLUME, type Volume } from './volume.ts';
import { openTestDb, type TestDb, tx } from '../db.ts';

const PERF = process.env.MUNSHI_PERF === '1';

// The growing tables: the books, read as the books that grow with each day's trade (the catalogue
// and party masters — item, item_revision, price, customer, supplier, staff, party_contact, the roster — grow with the
// shop, not the day), plus the ops rows this volume adds that grow with trade: bookings, an
// order's intake and projection, and the photo evidence.
const GROWING = new Set([
  'snap.snapshot',
  'snap.pin',
  'audit.audit_log',
  'ai.trace',
  'ai.finding_event',
  'ai.run',
  'ai.finding',
  'ai.usage',
  'ops.message_text',
  'ops.inbound_message',
  'ops.delivery',
  'ops.idempotency',
  'ops.rate_counter',
  'ops.job_claim',
  'ops.login_session',
  'idp.attempt',
  'ops.tenant',
  'books.sale',
  'books.sale_line',
  'books.purchase',
  'books.purchase_line',
  'books.stock_move',
  'books.payment',
  'books.credit_entry',
  'books.settlement',
  'books.journal_entry',
  'books.journal_line',
  'books.order',
  'books.order_line',
  'books.order_step',
  'books.sale_discount',
  'books.loyalty_entry',
  'books.package_entry',
  'books.invoice',
  'books.invoice_line',
  'books.outbound_message',
  'books.attendance',
  'books.advance',
  'books.salary_line',
  'ops.booking',
  'ops.order_request',
  'ops.order_state',
  'ops.shelf_count',
  'ops.bill_read',
  'ops.bill_line',
]);

// The order board's reference read: every open order by step, then due date, off the projection's
// index (tenant_id, step, due_on). $1 is the open steps, ref.order_step's non-terminal codes, passed by the caller: an
// array the planner can see estimates each step from its statistics (42 rows estimated for 42 here), where an
// `any (array(select …))` subquery is opaque to it (500 estimated for the same 42).
const BOARD_SQL = `select st.step, st.order_id::text as order_id, o.code, o.kind, st.due_on::text as due_on, st.trial_on::text as trial_on,
       o.customer_id::text as customer_id
  from ops.order_state st
  join books.order o on o.tenant_id = st.tenant_id and o.id = st.order_id
 where st.step = any ($1::text[])
   and not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id)
 order by st.step, st.due_on nulls last, o.code
 limit 500`;

// The Seq Scans over a growing table reviewed and allowed: the planner's costed choice at this volume,
// where an index path exists and costs more (or ties). Each entry is one read and one table, why, and what was measured here —
// the whole plan's cost as planned, then with enable_seqscan off, and the table's rows (each run reports the pair
// afresh). Anything else that seq-scans a growing table fails until it is reviewed; an entry whose read no longer
// seq-scans its table fails as stale, so the list only shrinks as the reads and the schema improve.
const FULL_HISTORY = 'reads all of the tenant’s history by design';
const SMALL_JOIN = 'a hash join over a table still small after a year beats a key lookup per line';
const STAFF_MONTHS = 'a year of a salon’s advances and salary lines (a few a month for each of 12 staff) is read whole cheaper than by key';
const SEQ_ALLOWED: [read: string, table: string, why: string, measured: string][] = [
  ['stock.below_reorder', 'books.purchase_line', `${FULL_HISTORY}: the latest bill of every item`, 'cost 13,745 vs 14,306; 16,000 rows'],
  ['stock.below_reorder', 'books.purchase', `${FULL_HISTORY}: the latest bill of every item`, 'cost 13,745 vs 14,306; 2,000 rows'],
  ['watch.expiry', 'books.purchase_line', `${FULL_HISTORY}: every lot with an expiry`, 'cost 14,475 vs 14,732; 16,000 rows'],
  ['watch.expiry', 'books.purchase', `${FULL_HISTORY}: every lot with an expiry`, 'cost 14,475 vs 14,732; 2,000 rows'],
  ['purchases.last_prices', 'books.purchase_line', `${FULL_HISTORY}: the latest bill line of every item`, 'cost 3,014 vs 3,581; 16,000 rows'],
  ['purchases.last_prices', 'books.purchase', `${FULL_HISTORY}: the latest bill line of every item`, 'cost 3,014 vs 3,581; 2,000 rows'],
  ['watch.price_creep', 'books.purchase_line', `${FULL_HISTORY}: 90 days of bill lines, a quarter of the year`, 'cost 1,675 vs 2,196; 16,000 rows'],
  ['credit.balances', 'books.credit_entry', `${FULL_HISTORY}: every live entry, oldest credit cleared first`, 'cost 647 vs 802; 3,000 rows'],
  ['watch.overdue_credit', 'books.credit_entry', `${FULL_HISTORY}: every live entry, oldest credit cleared first`, 'cost 651 vs 810; 3,000 rows'],
  ['credit.overdue_total', 'books.credit_entry', `${FULL_HISTORY}: every live entry, oldest credit cleared first`, 'cost 293 vs 452; 3,000 rows'],
  ['bill.lines_for', 'books.purchase', SMALL_JOIN, 'cost 202 vs 242; 2,000 rows'],
  ['order board', 'books.order', `${SMALL_JOIN} (the open orders' headers)`, 'cost 119 vs 183; 2,000 rows'],
  // Since the receipts are read off payment_day, the month's settlements are scanned
  // whole — a tie inside the planner's 1% fuzz that held in 8 of 8 fresh ANALYZE samples (a settlement-led lateral form
  // avoids the scan at 25 times the cost, 5,832).
  ['watch.short_settlement', 'books.settlement', `${SMALL_JOIN} (the month's settlements)`, 'cost 232 vs 230; 364 rows'],
  // Later reads, measured on the volume as it now stands.
  ['order.board', 'books.order', `${SMALL_JOIN} (the open orders' headers)`, 'cost 119 vs 183; 2,000 rows'],
  ['watch.order_late', 'books.order', `${SMALL_JOIN} (the late orders' headers)`, 'cost 337 vs 401; 2,000 rows'],
  // A tie inside the planner's fuzz that a fresh ANALYZE sample flips either way (index in two runs, a scan in the third).
  ['watch.advance_unapplied', 'ops.order_state', `${SMALL_JOIN} (the open orders' steps)`, 'a scan plan at cost 3,067 in one run, the index plan at 2,468 in the next; 2,000 rows'],
  ['watch.dead_stock', 'books.stock_move', `${FULL_HISTORY}: every item's moves to as_of, its stock and last sale`, 'cost 248,850 vs 249,512; 168,729 rows'],
  ['growth.slow_movers', 'books.stock_move', `${FULL_HISTORY}: every item's moves to as_of, its stock and last sale (watch.dead_stock's shape)`, 'cost 241,567 vs 242,334; 168,729 rows'],
  ['salary.preview', 'books.advance', STAFF_MONTHS, 'cost 15,243 vs 35,341; 96 rows'],
  ['salary.preview', 'books.salary_line', STAFF_MONTHS, 'cost 15,243 vs 35,341; 120 rows'],
  ['staff.advances', 'books.advance', STAFF_MONTHS, 'cost 9 vs 15; 96 rows'],
  ['staff.advances', 'books.salary_line', STAFF_MONTHS, 'cost 9 vs 15; 120 rows'],
  ['watch.unrecovered_advance', 'books.advance', STAFF_MONTHS, 'cost 26 vs 45; 96 rows'],
  ['watch.unrecovered_advance', 'books.salary_line', STAFF_MONTHS, 'cost 26 vs 45; 120 rows'],
];

type Node = {
  'Node Type': string;
  Schema?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Plan Rows': number;
  'Total Cost': number;
  'Actual Rows'?: number;
  'Tuples Inserted'?: number;
  Plans?: Node[];
};
type Explained = {
  Plan: Node;
  'Planning Time'?: number;
  'Execution Time'?: number;
  Triggers?: { 'Trigger Name': string; Time: number; Calls: number }[];
};

const walk = (n: Node, out: Node[] = []): Node[] => {
  out.push(n);
  for (const c of n.Plans ?? []) walk(c, out);
  return out;
};
const rel = (n: Node) => `${n.Schema}.${n['Relation Name']}`;
// Every node that reads a table or an index, as "Node Type [using index] on schema.table".
const scans = (top: Node) =>
  walk(top)
    .filter((n) => n['Relation Name'] || n['Index Name'])
    .map((n) => `${n['Node Type']}${n['Index Name'] ? ` using ${n['Index Name']}` : ''}${n['Relation Name'] ? ` on ${rel(n)}` : ''}`);
const seqScanned = (top: Node) => new Set(walk(top).filter((n) => n['Node Type'] === 'Seq Scan' && GROWING.has(rel(n))).map(rel));
const allowedFor = (read: string) => SEQ_ALLOWED.filter(([r]) => r === read).map(([, table]) => table);
// Entries whose two costs tie inside the planner's fuzz (about 1%): either plan may win on another day's data, so the
// stale check skips them; the Seq Scan is allowed, never required.
// watch.dead_stock's pair (248,850 vs 249,512) is 0.3% apart, over books.stock_move, whose ANALYZE sample differs per build.
const TIES = new Set(['watch.short_settlement books.settlement', 'watch.dead_stock books.stock_move', 'watch.advance_unapplied ops.order_state']);
// rows: what the statement returned, for a read; null for a write.
function faults(read: string, top: Node, rows: number | null): string[] {
  const seq = seqScanned(top);
  const allowed = allowedFor(read);
  const bad = [...seq].filter((t) => !allowed.includes(t)).map((t) => `Seq Scan on ${t}`);
  bad.push(...allowed.filter((t) => !seq.has(t) && !TIES.has(`${read} ${t}`)).map((t) => `stale entry: ${read} no longer seq-scans ${t}`));
  if (rows !== null && top['Plan Rows'] > 10 * Math.max(rows, 1)) bad.push(`estimated ${top['Plan Rows']} rows for ${rows}`);
  return bad;
}
// An allowed read planned again with enable_seqscan off: the cost of the index path it passed over.
async function seqOffCost(c: pg.PoolClient, sql: string, values: unknown[]): Promise<number> {
  await c.query('set local enable_seqscan = off');
  const { rows } = await c.query(`explain (format json) ${sql}`, values);
  await c.query('set local enable_seqscan = on');
  return (rows[0]['QUERY PLAN'][0] as Explained).Plan['Total Cost'];
}

const ms = (n: number | undefined) => `${(n ?? 0).toFixed(2)} ms`;
// A statement's timing; the foreign-key triggers summed into one figure.
function timing(e: Explained | undefined): string {
  const keys = (e?.Triggers ?? []).filter((t) => t['Trigger Name'].startsWith('RI_ConstraintTrigger'));
  const named = (e?.Triggers ?? []).filter((t) => !t['Trigger Name'].startsWith('RI_ConstraintTrigger')).map((t) => `${t['Trigger Name']} ${ms(t.Time)}`);
  if (keys.length) named.push(`${keys.length} foreign keys ${ms(keys.reduce((a, t) => a + t.Time, 0))}`);
  return `planning ${ms(e?.['Planning Time'])}, execution ${ms(e?.['Execution Time'])}${named.length ? ` (triggers: ${named.join(', ')})` : ''}`;
}

const REPORT: string[] = [];
const note = (line: string) => REPORT.push(line);

let db: TestDb;
let app: pg.Pool;
let v: Volume;
type Fx = {
  asOf: string;
  at: string;
  item: string;
  items: string[];
  customer: string;
  sale: string;
  purchase: string;
  billRead: string;
  count: string;
  // The salon's (Elite's) and the tailors'.
  branch: string;
  month: string;
  salonItems: string[];
  member: string;
  offer: string;
  offerCode: string;
  holding: string;
  invoice: string;
  staff: string;
  order: string;
  openSteps: string[];
};
let fx: Fx;
const day = (n: number) => addDays(fx.asOf, n);

// Each named read's parameters over the kirana's year, as of today (no sale yet today), or over the shop whose data the
// read is about (TENANT_OF). A read without one fails its own test and the coverage test: whoever adds a read adds
// its fixture here.
const FIXTURES: Record<string, () => unknown> = {
  'items.list': () => ({}),
  'items.price': () => ({ item_id: fx.item }),
  // The volume holds no campaign and no inbox message: both plan as key lookups that return nothing (as order.extracts).
  'campaign.audience': () => ({ campaign_id: '00000000-0000-4000-8000-000000000001' }),
  'inbox.extract': () => ({ message_id: '00000000-0000-4000-8000-000000000002' }),
  'inbox.order_link': () => ({ message_id: '00000000-0000-4000-8000-000000000002' }),
  'site.catalogue': () => ({}),
  'site.packages': () => ({}),
  'site.package_lines': () => ({}),
  'site.offers': () => ({}),
  'site.offer_items': () => ({}),
  'site.capabilities': () => ({}),
  'sales.by_day': () => ({ from: day(-7), to: day(-1) }),
  'sales.by_item': () => ({ from: day(-28), to: day(-1), limit: 20 }),
  'purchases.last_price': () => ({ item_id: fx.item }),
  'purchases.price_history': () => ({ item_id: fx.item, days: 90, as_of: fx.asOf }),
  'stock.below_reorder': () => ({ as_of: fx.asOf }),
  'credit.balances': () => ({ as_of: fx.asOf }),
  'bills.recent': () => ({ days: 7, as_of: fx.asOf }),
  'count.shelf': () => ({ count_id: fx.count }),
  'bill.lines': () => ({ bill_id: fx.billRead }),
  'credit.balance': () => ({ customer_id: fx.customer }),
  'bill.lines_for': () => ({ purchase_id: fx.purchase }),
  'purchases.last_prices': () => ({}),
  'sale.quote': () => ({ item_ids: fx.items, qty_milli: fx.items.map(() => 1000) }),
  'sale.receipt': () => ({ sale_id: fx.sale }),
  'sales.week_total': () => ({ from: day(-7), to: day(-1) }),
  'stock.on_hand': () => ({ item_id: fx.item }),
  'watch.shrinkage': () => ({ as_of: fx.asOf }),
  'watch.price_creep': () => ({ as_of: fx.asOf }),
  'watch.expiry': () => ({ as_of: fx.asOf }),
  'watch.overdue_credit': () => ({ as_of: fx.asOf }),
  'credit.overdue_total': () => ({ as_of: fx.asOf }),
  'watch.short_settlement': () => ({ as_of: fx.asOf }),
  'watch.missing_settlement': () => ({ as_of: fx.asOf }),
  'settlements.reconcile': () => ({ from: day(-30), to: day(-1) }),
  'growth.peak_hours': () => ({ as_of: day(-1) }),
  'growth.customers': () => ({ as_of: day(-1) }),
  'growth.basket': () => ({ as_of: day(-1) }),
  'growth.slow_movers': () => ({ as_of: day(-1), days: 30 }),
  'growth.payment_mix': () => ({ as_of: day(-1) }),
  // The office's desks: the cast and its mapping as apps/web/lib/cast.ts passes them; the volume holds no trace of
  // a known run, so desks.trace plans as the key lookup it is (0 rows).
  'desks.week': () => ({
    cast: ['munshi', 'tally', 'ledger', 'dash', 'echo', 'bloom', 'keeper'],
    desks: { ask: 'munshi', brief: 'munshi', watch: 'munshi', stock: 'tally', shelf: 'tally', bills: 'ledger', recipe: 'dash', replies: 'echo' },
    triggers: { question: 'munshi', photo: 'tally', inbox: 'echo', recipe: 'dash' },
  }),
  'desks.trace': () => ({ run_id: fx.order }),
  // AI spend: this month's, against the budget, and by desk; the volume holds no spend row.
  'ai.spend_month': () => ({}),
  'ai.spend_by_desk': () => ({}),
  'sale.quote_offers': () => ({
    item_ids: fx.salonItems,
    qty_milli: fx.salonItems.map(() => 1000),
    offer_codes: [fx.offerCode],
    customer_id: fx.member,
    redeem_points: 50,
  }),
  'order.board': () => ({ steps: fx.openSteps }),
  'order.lines': () => ({ order_id: fx.order }),
  // The volume holds no order message or measurement: each is planned as the lookup by key it is (0 rows).
  'order.extracts': () => ({ message_id: fx.order, run_id: fx.order }),
  'measurement.values': () => ({ measurement_id: fx.order }),
  'offer.detail': () => ({ offer_id: fx.offer }),
  'offers.list': () => ({}),
  'loyalty.balance': () => ({ customer_id: fx.member }),
  'package.balance': () => ({ holding_id: fx.holding }),
  'package.holdings': () => ({ customer_id: null }),
  'invoice.detail': () => ({ invoice_id: fx.invoice }),
  // PayPal: an invoice's open credit; the volume holds no PayPal notice, so the event is the lookup by key it is
  'invoice.open_credit': () => ({ invoice_id: fx.invoice }),
  'paypal.event': () => ({ event_id: fx.order }),
  'watch.paypal_unrecorded': () => ({ as_of: fx.asOf }),
  'invoices.list': () => ({ shop_id: fx.branch, month: fx.month }),
  'gst.summary': () => ({ month: fx.month }),
  'salary.preview': () => ({ period_start: `${fx.asOf.slice(0, 8)}01`, period_end: fx.asOf, shop_id: fx.branch }),
  'staff.advances': () => ({ staff_id: fx.staff }),
  'stock.available': () => ({}),
  'watch.dead_stock': () => ({ as_of: fx.asOf }),
  'watch.hold_expiring': () => ({ as_of: fx.asOf, at: fx.at }),
  'watch.order_unanswered': () => ({ as_of: fx.asOf, at: fx.at }),
  'watch.order_late': () => ({ as_of: fx.asOf }),
  'watch.advance_unapplied': () => ({ as_of: fx.asOf }),
  'watch.unrecovered_advance': () => ({ as_of: fx.asOf }),
  'watch.regulars_lapsing': () => ({ as_of: fx.asOf }),
  'watch.package_expiry': () => ({ as_of: fx.asOf }),
  'watch.idle_stylist': () => ({ as_of: fx.asOf }),
  'watch.stylist_absent_booked': () => ({ as_of: fx.asOf }),
  'watch.unbilled_booking': () => ({ as_of: fx.asOf, at: fx.at }),
  'watch.hold_pressure': () => ({ as_of: fx.asOf, at: fx.at }),
  'brief.ranked': () => ({ as_of: fx.asOf, shop_id: fx.branch }),
  'brief.figures': () => ({ as_of: fx.asOf, shop_id: fx.branch }),
};

// The tenant a read is planned under when not the kirana's: the salon's bookings, staff, packages, offers, loyalty, GST
// and findings (and its regulars who stopped coming: the kirana's credit customers come every week), the tailors'
// orders. No shop holds a piece in the volume, so stock.available and watch.hold_expiring plan the kirana's stock beside
// an empty ops.reservation.
const TENANT_OF: Record<string, 'elite' | 'tailors'> = {
  'sale.quote_offers': 'elite',
  'offer.detail': 'elite',
  'offers.list': 'elite',
  'loyalty.balance': 'elite',
  'package.balance': 'elite',
  'package.holdings': 'elite',
  'invoice.detail': 'elite',
  'invoice.open_credit': 'elite',
  'invoices.list': 'elite',
  'gst.summary': 'elite',
  'salary.preview': 'elite',
  'staff.advances': 'elite',
  'watch.unrecovered_advance': 'elite',
  'watch.regulars_lapsing': 'elite',
  'watch.package_expiry': 'elite',
  'watch.idle_stylist': 'elite',
  'watch.stylist_absent_booked': 'elite',
  'watch.unbilled_booking': 'elite',
  'watch.hold_pressure': 'elite',
  'brief.ranked': 'elite',
  'brief.figures': 'elite',
  'order.board': 'tailors',
  'order.lines': 'tailors',
  'order.extracts': 'tailors',
  'measurement.values': 'tailors',
  'watch.order_unanswered': 'tailors',
  'watch.order_late': 'tailors',
  'watch.advance_unapplied': 'tailors',
};

// A pool whose clients record each statement core sends: `plan` EXPLAINs it (FORMAT JSON, VERBOSE), then runs it;
// `analyze` runs a write once, through EXPLAIN (ANALYZE, BUFFERS), handing back the rows it wrote, and a read twice, for
// its rows and for its timing. withTx needs only connect, query and release.
type Stmt = { sql: string; ms: number; explained?: Explained; rows?: number };
function recording(pool: pg.Pool, mode: 'plan' | 'analyze', log: Stmt[]): pg.Pool {
  const connect = async () => {
    const c = await pool.connect();
    const query = async (q: string | pg.QueryConfig, values?: unknown[]) => {
      const text = typeof q === 'string' ? q : q.text;
      const params = typeof q === 'string' ? values : q.values;
      const sql = text.replace(/\s+/g, ' ').trim();
      const t = performance.now();
      if (/^(begin|commit|rollback)\b/i.test(sql)) {
        const r = await c.query(text);
        log.push({ sql, ms: performance.now() - t });
        return r;
      }
      if (mode === 'plan') {
        const { rows } = await c.query(`explain (format json, verbose) ${text}`, params);
        const r = await c.query(text, params);
        log.push({ sql, ms: performance.now() - t, explained: rows[0]['QUERY PLAN'][0], rows: r.rowCount ?? 0 });
        return r;
      }
      if (/^(select|with)\b/i.test(sql)) {
        const r = await c.query(text, params);
        const { rows } = await c.query(`explain (analyze, buffers, format json) ${text}`, params);
        log.push({ sql, ms: performance.now() - t, explained: rows[0]['QUERY PLAN'][0], rows: r.rowCount ?? 0 });
        return r;
      }
      const { rows } = await c.query(`explain (analyze, buffers, format json, verbose) ${text}`, params);
      const explained: Explained = rows[0]['QUERY PLAN'][0];
      log.push({ sql, ms: performance.now() - t, explained });
      return { rows: [], rowCount: explained.Plan['Tuples Inserted'] ?? explained.Plan.Plans?.[0]?.['Actual Rows'] ?? 0 };
    };
    return { query, release: (err?: boolean | Error) => c.release(err) };
  };
  return { connect } as unknown as pg.Pool;
}

beforeAll(async () => {
  if (!PERF) return;
  db = await openTestDb();
  app = db.as('munshi_app');
  const t = performance.now();
  v = await seedVolume(db.admin);
  note(`volume built and proved in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  await db.admin.query('vacuum (analyze)');
  const one = async (sql: string) => (await db.admin.query(sql, [v.kirana.tenantId])).rows[0];
  const popular = (
    await db.admin.query(
      'select item_id::text as id from books.sale_line where tenant_id = $1 group by item_id order by count(*) desc, item_id limit 4',
      [v.kirana.tenantId],
    )
  ).rows.map((r) => r.id as string);
  const bill = await one(
    'select id::text as id, bill_read_id::text as bill from books.purchase where tenant_id = $1 and bill_read_id is not null order by bill_date desc, id desc limit 1',
  );
  const [salon, tailors] = [v.elite.tenantId, v.tailors.tenantId];
  const of = async (sql: string, tenant: string) => (await db.admin.query(sql, [tenant])).rows[0];
  fx = {
    asOf: (await db.admin.query(`select (now() at time zone 'Asia/Kolkata')::date::text as d`)).rows[0].d,
    at: `${new Date().toISOString().slice(0, 19)}Z`,
    item: popular[0] as string,
    items: popular,
    customer: (
      await one(
        'select customer_id::text as id from books.credit_entry where tenant_id = $1 group by customer_id order by sum(amount_minor) desc, customer_id limit 1',
      )
    ).id,
    sale: (await one('select id::text as id from books.sale where tenant_id = $1 order by sold_at desc limit 1')).id,
    purchase: bill.id,
    billRead: bill.bill,
    count: (await one('select id::text as id from ops.shelf_count where tenant_id = $1 order by created_at desc limit 1')).id,
    branch: (await of(`select id::text as id from ops.shop where tenant_id = $1 and name like 'South%'`, salon)).id,
    month: (await db.admin.query(`select to_char(date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month', 'YYYY-MM') as m`)).rows[0].m,
    salonItems: (
      await db.admin.query(
        `select distinct on (kind) id::text as id from books.item where tenant_id = $1 and kind in ('service', 'good') order by kind, id`,
        [salon],
      )
    ).rows.map((r) => r.id as string),
    member: (await of('select customer_id::text as id from books.loyalty_entry where tenant_id = $1 order by balance_after desc, customer_id limit 1', salon)).id,
    ...(await of(
      'select id::text as offer, code as "offerCode" from books.offer where tenant_id = $1 and starts_at <= now() and now() < ends_at order by starts_at desc limit 1',
      salon,
    )),
    holding: (
      await of(
        `select h.id::text as id from books.package_holding h where h.tenant_id = $1
            and exists (select 1 from books.package_entry x where x.tenant_id = h.tenant_id and x.holding_id = h.id and x.kind = 'redeemed')
          order by h.starts_on desc, h.id limit 1`,
        salon,
      )
    ).id,
    invoice: (await of('select id::text as id from books.invoice where tenant_id = $1 order by issued_at desc, id limit 1', salon)).id,
    staff: (await of('select staff_id::text as id from books.advance where tenant_id = $1 order by given_on desc, id limit 1', salon)).id,
    order: (
      await of(
        `select o.id::text as id from books.order o join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id
          where o.tenant_id = $1 and st.step <> 'cancelled' and exists (select 1 from books.payment p where p.tenant_id = o.tenant_id and p.order_id = o.id)
          order by o.created_at desc limit 1`,
        tailors,
      )
    ).id,
    openSteps: (await db.admin.query('select array_agg(code order by code) as steps from ref.order_step where not terminal')).rows[0].steps,
  };
  // A lookup that found nothing would plan a read for a key the volume does not hold.
  expect(Object.entries(fx).filter(([, x]) => x === undefined || x === null)).toEqual([]);
  await db.sabotage();
}, 900_000);

afterAll(async () => {
  if (!PERF) return;
  console.log(`\n${REPORT.join('\n')}\n`);
  await db?.close();
});

it.skipIf(!PERF)('the volume holds the year it promises, row for row', async () => {
  const n = async (sql: string, ...params: unknown[]) => Number((await db.admin.query(sql, params)).rows[0].n);
  const [k, e, t] = [v.kirana.tenantId, v.elite.tenantId, v.tailors.tenantId];
  expect(await n('select count(*) as n from books.sale where tenant_id = $1', k)).toBe(VOLUME.kirana.sales);
  expect(await n('select count(*) as n from books.sale_line where tenant_id = $1', k)).toBe(VOLUME.kirana.saleLines);
  expect(await n('select count(*) as n from books.purchase where tenant_id = $1', k)).toBe(VOLUME.kirana.purchases);
  expect(await n('select count(*) as n from books.credit_entry where tenant_id = $1', k)).toBe(VOLUME.kirana.creditEntries);
  expect(await n('select count(*) as n from ops.booking where tenant_id = $1', e)).toBe(VOLUME.elite.bookings);
  expect(await n('select count(*) as n from books.sale where tenant_id = $1', e)).toBe(VOLUME.elite.sales);
  expect(await n('select count(distinct shop_id) as n from books.sale where tenant_id = $1', e)).toBe(VOLUME.elite.shops);
  expect(await n('select count(*) as n from books.order where tenant_id = $1', t)).toBe(VOLUME.tailors.orders);
  expect(await n('select count(*) as n from books.order_step where tenant_id = $1', t)).toBe(VOLUME.tailors.steps);
  expect(await n('select count(*) as n from ops.tenant where sandbox')).toBe(VOLUME.sandboxes);
  const tables = (
    await db.admin.query<{ schema: string; name: string }>(
      `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname in ('ops', 'books', 'audit', 'ai', 'snap', 'approval') order by 1, 2`,
    )
  ).rows;
  const counts: string[] = [];
  for (const { schema, name } of tables) {
    const c = await n(`select count(*) as n from ${schema}."${name}"`);
    if (c > 0) counts.push(`${schema}.${name} ${c}`);
  }
  note(`rows, counted: ${counts.join(', ')}`);
});

it.skipIf(!PERF)('every named read has a fixture here, and every fixture a read; every allowed Seq Scan names a read and a growing table', () => {
  expect(QUERIES.size).toBeGreaterThan(20);
  expect(Object.keys(FIXTURES).sort()).toEqual([...QUERIES.keys()].sort());
  for (const read of Object.keys(TENANT_OF)) expect(QUERIES.has(read), read).toBe(true);
  expect(SEQ_ALLOWED.length).toBe(23);
  for (const [read, table] of SEQ_ALLOWED) {
    expect(QUERIES.has(read) || read === 'order board', read).toBe(true);
    expect(GROWING.has(table), `${read} ${table}`).toBe(true);
  }
  expect(new Set(SEQ_ALLOWED.map(([r, t]) => `${r} ${t}`)).size).toBe(SEQ_ALLOWED.length);
});

for (const name of QUERIES.keys()) {
  it.skipIf(!PERF)(`${name} plans without a Seq Scan over a growing table, its estimate within 10× of its rows`, async () => {
    const q = QUERIES.get(name);
    const fixture = FIXTURES[name];
    if (!q || !fixture) throw new Error(`no fixture for ${name}`);
    const params = q.params.parse(fixture()) as Record<string, unknown>;
    const values = q.order.map((key) => params[key]);
    const { top, rows, analyzed, off } = await tx(app, { tenant_id: v[TENANT_OF[name] ?? 'kirana'].tenantId }, async (c) => {
      const { rows: explained } = await c.query(`explain (format json, verbose) ${q.sql}`, values);
      const r = await c.query(q.sql, values);
      const { rows: a } = await c.query(`explain (analyze, buffers, format json) ${q.sql}`, values);
      const off = allowedFor(name).length ? await seqOffCost(c, q.sql, values) : null;
      return { top: (explained[0]['QUERY PLAN'][0] as Explained).Plan, rows: r.rowCount ?? 0, analyzed: a[0]['QUERY PLAN'][0] as Explained, off };
    });
    const bad = faults(name, top, rows);
    note(`${bad.length ? 'FAIL' : 'pass'} ${name}${TENANT_OF[name] ? ` (${TENANT_OF[name]})` : ''}: estimated ${top['Plan Rows']}, returned ${rows}; cost ${top['Total Cost']}${off === null ? '' : ` (${off} with enable_seqscan off; allowed: ${allowedFor(name).join(', ')})`}; ${timing(analyzed)}${bad.length ? `\n       fault: ${bad.join('; ')}` : ''}`);
    note(`       ${scans(top).join('; ')}`);
    expect(bad, `${name}: ${scans(top).join('; ')}`).toEqual([]);
  });
}

it.skipIf(!PERF)('the counter sale plans every statement without a Seq Scan over a growing table, and is timed', async () => {
  const session = (await openSession(app, v.kirana.tenantId, v.kirana.staffId)) as Session;
  expect(session).not.toBeNull();
  // A staff member's sale of the four best sellers, ₹1 by UPI and the rest on a credit customer's account: every
  // statement sale.record has (the credit entry too), with the idempotency key every counter write carries.
  const input = {
    shopId: v.kirana.shopId,
    customerId: fx.customer,
    lines: fx.items.map((itemId) => ({ itemId, qtyMilli: 1000 })),
    payments: [{ method: 'upi', amountMinor: 100 }],
  };
  const planned: Stmt[] = [];
  await runCommand(recording(app, 'plan', planned), session, 'sale.record', input, 'perf-sale-planned');
  const statements = planned.filter((s) => s.explained);
  // context, the key's claim, the tenant, the prices, the loyalty rule (a named customer), the branch's GST registration,
  // sale, lines, stock out, payment, credit (with its capability's switch), journal entry and lines, the base
  // capability's switch after the body, the key's result (the kirana has no loyalty rule and no registration: no points,
  // no invoice)
  expect(statements.length).toBe(16);
  const bad: string[] = [];
  for (const s of statements) {
    const top = (s.explained as Explained).Plan;
    const read = /^(select|with)\b/i.test(s.sql);
    const f = faults('sale.record', top, read ? (s.rows as number) : null);
    bad.push(...f.map((x) => `${s.sql.slice(0, 60)}: ${x}`));
    note(`${f.length ? 'FAIL' : 'pass'} sale.record: ${s.sql.slice(0, 80)}${read ? ` (estimated ${top['Plan Rows']}, returned ${s.rows})` : ''}`);
    note(`       ${scans(top).join('; ')}${f.length ? `\n       fault: ${f.join('; ')}` : ''}`);
  }
  const timed: Stmt[] = [];
  const t = performance.now();
  await runCommand(recording(app, 'analyze', timed), session, 'sale.record', input, 'perf-sale-timed');
  const wall = performance.now() - t;
  note(`counter sale, EXPLAIN (ANALYZE, BUFFERS) per statement (measured; ${fx.items.length} lines, ${ms(wall)} wall clock for the whole command, recording included):`);
  for (const s of timed) note(`  ${s.sql.slice(0, 72).padEnd(72)} ${s.explained ? timing(s.explained) : `round trip ${ms(s.ms)}`}`);
  // And as the app runs it, nothing recorded: five sales one after another, each its own key.
  const plain: number[] = [];
  for (let i = 0; i < 5; i++) {
    const at = performance.now();
    await runCommand(app, session, 'sale.record', input, `perf-sale-plain-${i}`);
    plain.push(performance.now() - at);
  }
  note(`counter sale as the app runs it (measured wall clock, client to commit, 5 in a row): ${plain.map(ms).join(', ')}`);
  expect(bad).toEqual([]);
});

it.skipIf(!PERF)('the order board plans without a Seq Scan over a growing table, its estimate within 10× of its rows, and is timed', async () => {
  const { top, rows, analyzed, off } = await tx(app, { tenant_id: v.tailors.tenantId }, async (c) => {
    const open = (await c.query('select array_agg(code order by code) as steps from ref.order_step where not terminal')).rows[0].steps;
    const { rows: explained } = await c.query(`explain (format json, verbose) ${BOARD_SQL}`, [open]);
    const r = await c.query(BOARD_SQL, [open]);
    const { rows: a } = await c.query(`explain (analyze, buffers, format json) ${BOARD_SQL}`, [open]);
    const off = await seqOffCost(c, BOARD_SQL, [open]);
    return { top: (explained[0]['QUERY PLAN'][0] as Explained).Plan, rows: r.rowCount ?? 0, analyzed: a[0]['QUERY PLAN'][0] as Explained, off };
  });
  expect(rows).toBeGreaterThan(0);
  const bad = faults('order board', top, rows);
  note(`${bad.length ? 'FAIL' : 'pass'} order board: estimated ${top['Plan Rows']}, returned ${rows}; cost ${top['Total Cost']} (${off} with enable_seqscan off; allowed: ${allowedFor('order board').join(', ')}); ${timing(analyzed)} (EXPLAIN ANALYZE, BUFFERS, measured)${bad.length ? `\n       fault: ${bad.join('; ')}` : ''}`);
  note(`       ${scans(top).join('; ')}`);
  expect(bad).toEqual([]);
});
