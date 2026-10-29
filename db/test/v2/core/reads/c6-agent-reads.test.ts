// C6: the agent's named reads (packages/core/src/queries-agent.ts) over the kirana seed, minted the way an agent run
// mints them (the owner's run: evidence snapshots stamped with it). Expected values are worked out here in JS from the
// raw book rows (or from kirana.answers.json), never by running the read's own SQL.
import { readFileSync } from 'node:fs';
import { addDays, businessDate, type Cell, lineAmount, mintSnapshot } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Kirana, seedKirana } from '../../../../seed/kirana.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { startRun } from '../agent-port.ts';

type Answer = { kind: string; match: Record<string, string | number>; expect: Record<string, number> };
const ANSWERS = (JSON.parse(readFileSync(new URL('../../../../seed/kirana.answers.json', import.meta.url), 'utf8')) as { plants: Answer[] }).plants;
const AS_OF = '2026-10-27';
const TZ = 'Asia/Kolkata';
const day = (d: number) => addDays(AS_OF, d);

let db: TestDb;
let k: Kirana;
let runId: string;
beforeAll(async () => {
  db = await openTestDb();
  k = await seedKirana(db.as('munshi_app'), { asOf: AS_OF });
  runId = await startRun({ app: db.as('munshi_app'), agent: db.as('munshi_agent') }, k.owner);
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const mint = (name: string, params: unknown) => mintSnapshot(db.as('munshi_app'), { kind: 'member', session: k.owner }, name, params, runId);
// The raw book rows, read as the superuser (no read under test is involved).
const raw = async (sql: string) => (await db.admin.query(sql.replaceAll('$T', `'${k.tenantId}'`))).rows;
const n = (c: Cell | undefined) => (c && 'num' in c ? Number(c.num) : null);
const t = (c: Cell | undefined) => (c?.kind === 'text' ? c.txt : c?.kind === 'date' ? c.day : null);
const plain = (rows: Record<string, Cell>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([col, c]) => [col, n(c) ?? t(c)])));
const id = (name: string) => k.items.get(name) as string;

it('C6 items.list holds every item of the catalogue with what the books hold now', async () => {
  const snap = await mint('items.list', {});
  const moves = await raw(`select item_id::text as item_id, sum(qty_milli)::bigint as q from books.stock_move where tenant_id = $T group by item_id`);
  const held = new Map(moves.map((m) => [m.item_id as string, Number(m.q)]));
  const names = [...k.items.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  expect(k.items.size).toBe(60); // the board's "60 generic SKUs"
  expect(plain(snap.rows).map((r) => r.item)).toEqual(names);
  for (const r of plain(snap.rows)) expect(r.on_hand, String(r.item)).toBe(held.get(r.item_id as string) ?? 0);
});

it('C6 sales.by_day: bills, total and tenders per business day, a day without sales as zeros', async () => {
  const snap = await mint('sales.by_day', { from: day(-7), to: day(0) });
  const sales = await raw(`select s.id::text as id, s.sold_at, s.total_minor::bigint as total,
      coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id and p.direction = 'in' and p.method = 'cash'), 0)::bigint as cash,
      coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id and p.direction = 'in' and p.method = 'upi'), 0)::bigint as upi
    from books.sale s where s.tenant_id = $T`);
  const want = Array.from({ length: 8 }, (_, i) => {
    const d = day(-7 + i);
    const mine = sales.filter((s) => businessDate(s.sold_at, TZ) === d);
    const sum = (f: (s: (typeof sales)[number]) => number) => mine.reduce((a, s) => a + f(s), 0);
    const total = sum((s) => Number(s.total));
    const cash = sum((s) => Number(s.cash));
    const upi = sum((s) => Number(s.upi));
    return { day: d, bills: mine.length, total, cash, upi, card: 0, on_credit: total - cash - upi };
  });
  console.log(`C6 sales.by_day ${day(-1)}: ${JSON.stringify(want[6])}`);
  expect(want[6]?.bills).toBeGreaterThanOrEqual(30); // the seed's counter makes 30–45 bills a day
  expect(want[7]).toMatchObject({ bills: 0, total: 0 }); // day 0: no sale yet this morning
  expect(plain(snap.rows)).toEqual(want);
});

it('C6 sales.by_day refuses a window wider than 92 days or upside down', async () => {
  await expect(mint('sales.by_day', { from: day(-92), to: day(0) })).rejects.toMatchObject({ code: 'invalid' });
  await expect(mint('sales.by_day', { from: day(0), to: day(-1) })).rejects.toMatchObject({ code: 'invalid' });
  await expect(mint('sales.by_day', { from: day(-91), to: day(0) })).resolves.toBeTruthy();
});

it('C6 sales.by_item: the top sellers of the last 28 days by revenue', async () => {
  const snap = await mint('sales.by_item', { from: day(-28), to: day(-1), limit: 5 });
  const lines = await raw(`select l.item_id::text as item_id, l.sale_id::text as sale_id, l.qty_milli::bigint as q, l.unit_price_minor::bigint as p, s.sold_at
    from books.sale_line l join books.sale s on s.id = l.sale_id where l.tenant_id = $T`);
  const byItem = new Map<string, { sold: number; revenue: number; bills: Set<string> }>();
  for (const l of lines) {
    const d = businessDate(l.sold_at, TZ);
    if (d < day(-28) || d > day(-1)) continue;
    const e = byItem.get(l.item_id) ?? { sold: 0, revenue: 0, bills: new Set<string>() };
    e.sold += Number(l.q);
    e.revenue += lineAmount(Number(l.q), Number(l.p));
    e.bills.add(l.sale_id);
    byItem.set(l.item_id, e);
  }
  const names = new Map([...k.items].map(([name, itemId]) => [itemId, name]));
  const want = [...byItem]
    .map(([itemId, e]) => ({ item_id: itemId, item: names.get(itemId) as string, sold: e.sold, revenue: e.revenue, bills: e.bills.size }))
    .sort((a, b) => b.revenue - a.revenue || (a.item < b.item ? -1 : 1))
    .slice(0, 5);
  expect(want).toHaveLength(5);
  expect(plain(snap.rows)).toEqual(want);
});

it("C6 purchases.last_price: Butter 100 g's latest bill is Gupta Traders' at the crept cost", async () => {
  const creep = ANSWERS.find((a) => a.kind === 'price_creep') as Answer;
  const snap = await mint('purchases.last_price', { item_id: id('Butter 100 g') });
  const [last] = await raw(`select p.bill_no, p.bill_date::text as bill_date, pl.qty_milli::bigint as q from books.purchase_line pl
    join books.purchase p on p.id = pl.purchase_id where pl.tenant_id = $T and pl.item_id = '${id('Butter 100 g')}' order by p.bill_date desc limit 1`);
  expect(plain(snap.rows)).toEqual([
    {
      item_id: id('Butter 100 g'),
      item: 'Butter 100 g',
      supplier_id: k.suppliers.get(creep.match.supplier as string), // the supplier by id: no name in a cell
      bill_no: last.bill_no,
      bill_date: day(-6), // Gupta's weekly bills: days -27, -20, -13, -6 (answer key)
      unit_cost: creep.expect.latest_cost,
      qty: Number(last.q),
    },
  ]);
  expect(last.bill_date).toBe(day(-6));
});

it("C6 purchases.price_history: every Butter 100 g bill line of the window, Rs 56 until the creep and Rs 60 from day -30", async () => {
  const creep = ANSWERS.find((a) => a.kind === 'price_creep') as Answer;
  const snap = await mint('purchases.price_history', { item_id: id('Butter 100 g'), days: 60, as_of: AS_OF });
  const lines = await raw(`select pl.id::text as line_id, p.bill_date::text as bill_date, p.bill_no from books.purchase_line pl
    join books.purchase p on p.id = pl.purchase_id where pl.tenant_id = $T and pl.item_id = '${id('Butter 100 g')}'`);
  const want = lines
    .filter((l) => l.bill_date > day(-60) && l.bill_date <= AS_OF)
    .sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : 0))
    .map((l) => l.line_id);
  const rows = plain(snap.rows);
  expect(rows.map((r) => r.line_id)).toEqual(want);
  expect(rows.length).toBeGreaterThanOrEqual(8); // weekly bills over 60 days
  for (const r of rows) expect(r.unit_cost, String(r.bill_date)).toBe((r.bill_date as string) >= day(-30) ? creep.expect.latest_cost : creep.expect.baseline_cost);
});

it('C6 stock.below_reorder: the items whose stock lasts fewer than 7 days at the last 28 days of sales', async () => {
  const snap = await mint('stock.below_reorder', { as_of: AS_OF });
  const moves = await raw(`select item_id::text as item_id, kind, qty_milli::bigint as q, at from books.stock_move where tenant_id = $T`);
  const end = Date.parse(`${day(1)}T00:00:00+05:30`);
  const from = end - 28 * 86_400_000;
  const names = new Map([...k.items].map(([name, itemId]) => [itemId, name]));
  const want = [...k.items.values()]
    .map((itemId) => {
      const mine = moves.filter((m) => m.item_id === itemId && m.at.getTime() < end);
      const onHand = mine.reduce((a, m) => a + Number(m.q), 0);
      const sold = -mine.filter((m) => m.kind === 'sale' && m.at.getTime() >= from).reduce((a, m) => a + Number(m.q), 0);
      return { itemId, item: names.get(itemId) as string, onHand, sold };
    })
    .filter((x) => x.sold > 0 && x.onHand * 28 < x.sold * 7)
    .map((x) => ({ ...x, cover: Math.trunc((x.onHand * 28) / x.sold), suggested: Math.ceil((Math.trunc((x.sold * 14) / 28) - x.onHand) / 1000) * 1000 }))
    .sort((a, b) => a.cover - b.cover || (a.item < b.item ? -1 : 1));
  const rows = plain(snap.rows);
  console.log(`C6 stock.below_reorder: ${rows.length} items: ${rows.map((r) => `${r.item} (${r.days_cover} days)`).join(', ')}`);
  expect(want.length).toBeGreaterThan(0);
  expect(rows.map((r) => [r.item, r.on_hand, r.sold_28d, r.days_cover, r.suggested])).toEqual(want.map((x) => [x.item, x.onHand, x.sold, x.cover, x.suggested]));
  // Each from a simulated supplier, named by id (no name in a cell); its name, through the seed's map, says so.
  const suppliers = new Map([...k.suppliers].map(([name, supplierId]) => [supplierId, name]));
  for (const r of rows) expect(suppliers.get(r.supplier_id as string), String(r.item)).toMatch(/\(simulated\)$/);
});

it('C6 credit.balances: what each customer owes and how much is past due, the overdue customers of the answer key first', async () => {
  const snap = await mint('credit.balances', { as_of: AS_OF });
  const entries = await raw(`select customer_id::text as customer_id, sum(amount_minor)::bigint as owed from books.credit_entry where tenant_id = $T group by customer_id`);
  const names = new Map([...k.customers].map(([name, customerId]) => [customerId, name]));
  const owing = entries.filter((e) => Number(e.owed) > 0).map((e) => [names.get(e.customer_id), Number(e.owed)]);
  // Each customer by id (no name in a cell), named here through the seed's map.
  const rows = plain(snap.rows).map((r): Record<string, string | number | null | undefined> => ({ ...r, customer: names.get(r.customer_id as string) }));
  expect(rows.map((r) => [r.customer, r.balance]).sort()).toEqual(owing.sort());
  const overdue = ANSWERS.filter((a) => a.kind === 'overdue_credit');
  expect(overdue).toHaveLength(3);
  // The three overdue customers lead (most past due first), then the ₹40 near miss; nobody else is past due.
  expect(rows.slice(0, 4).map((r) => [r.customer, r.overdue, r.balance])).toEqual([
    ...overdue.map((a) => [a.match.customer, a.expect.overdue, a.expect.balance]),
    ['Kamala D.', 4000, 4000],
  ]);
  expect(rows.slice(4).filter((r) => r.overdue !== 0)).toEqual([]);
  expect(rows[0]?.oldest_due_on).toBe(day(-31)); // Ramesh K.'s credit of day -61 fell due 30 days later
});

it("C6 bills.recent: the suppliers' bills of the last 9 days, newest first (a bill dated day -9 is outside)", async () => {
  const snap = await mint('bills.recent', { days: 9, as_of: AS_OF });
  const bills = await raw(`select p.id::text as id, p.bill_no, p.bill_date::text as bill_date, p.total_minor::bigint as total,
      (select count(*) from books.purchase_line pl where pl.purchase_id = p.id)::int as lines
    from books.purchase p where p.tenant_id = $T`);
  const want = bills
    .filter((b) => b.bill_date > day(-9) && b.bill_date <= AS_OF)
    .sort((a, b) => (a.bill_date > b.bill_date ? -1 : a.bill_date < b.bill_date ? 1 : a.bill_no < b.bill_no ? -1 : 1))
    .map((b) => [b.id, b.bill_no, b.bill_date, Number(b.total), b.lines]);
  expect(want.length).toBeGreaterThanOrEqual(3); // each of the 3 distributors bills weekly
  expect(bills.some((b) => b.bill_date === day(-9))).toBe(true); // the edge of the window: a Paneer lot's bill
  expect(plain(snap.rows).map((r) => [r.purchase_id, r.bill_no, r.bill_date, r.total, r.lines])).toEqual(want);
});
