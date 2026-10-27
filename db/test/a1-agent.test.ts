// A1: the AI layer over the real database (the kirana seed, its watchers' findings, a second tenant), through the port
// the app builds (agent-port.ts): an answer renders its numbers from this run's cells; a free digit makes the run abstain;
// a forged ref, another tenant's ref and another run's ref are each refused by exactly one rule; a finding is explained
// from its own row and the books; draftFix proposes a draft whose numbers are cells, which executes only when the owner
// approves; and nothing but ids and fixed labels reaches a trace. Model turns are hand-written and replayed from
// packages/agent/fixtures/a1 (packages/agent/test/script.ts). Expected values are worked out from raw rows here.
import { businessDate, type CellRef, decide, formatMoney, runWatchers, withTx } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkAnswer, renderReply } from '../../packages/agent/src/answer.ts';
import type { TraceEvent } from '../../packages/agent/src/port.ts';
import { ask, draftFix, explainFinding, TRACE_LABELS } from '../../packages/agent/src/run.ts';
import { prepare, scripted, type Turn } from '../../packages/agent/test/script.ts';
import { type Kirana, seedKirana } from '../seed/kirana.ts';
import { agentPort, startRun } from './agent-port.ts';
import { openTestDb, type TestDb } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

const SUITE = 'a1';
const AS_OF = '2026-10-27';
const YESTERDAY = '2026-10-26';

let db: TestDb;
let k: Kirana;
let b: Shop;
let watched: Awaited<ReturnType<typeof runWatchers>>;
const traced: TraceEvent[] = [];
const runs: string[] = [];
const modelText: string[] = [];

beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  k = await seedKirana(db.app, { asOf: AS_OF });
  watched = await runWatchers(db.app, k.tenantId, AS_OF);
  b = await smallShop(db.app, 'B');
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

async function run(tenantId = k.tenantId, member = k.owner.memberId) {
  const runId = await startRun(db, tenantId, member);
  runs.push(runId);
  const { port, events } = agentPort(db, tenantId, runId);
  const trace = port.trace;
  port.trace = (e) => {
    traced.push(e);
    return trace(e);
  };
  return { runId, port, events };
}

const route = (desk: string): Turn => ({ json: { desk } });
const call = (name: string, args: unknown = {}): Turn => ({ tools: [{ name, args }] });
const note = (text: string): Turn => {
  modelText.push(text);
  return { text };
};
const say = (...segments: { text: string; refs: { read: number; row: number; col: string }[] }[]): Turn => {
  modelText.push(...segments.map((s) => s.text));
  return { json: { segments } };
};
const HAPPY = 'How did the counter do yesterday?';
const happy = () =>
  scripted(SUITE, [
    route('sales'),
    call('sales_by_day', { from: YESTERDAY, to: YESTERDAY }),
    note('Read 1, row 0 has yesterday.'),
    say({
      text: 'On ⟦1⟧ the counter took ⟦2⟧ over ⟦3⟧ bills; ⟦4⟧ came by UPI and ⟦5⟧ went on credit.',
      refs: ['day', 'total', 'bills', 'upi', 'on_credit'].map((col) => ({ read: 1, row: 0, col })),
    }),
  ]);
const OWES = 'Who owes me the most?';
const owes = () =>
  scripted(SUITE, [
    route('credit'),
    call('credit_balances'),
    note('Read 1, row 0 owes the most.'),
    say({ text: '⟦1⟧ owes ₹1,200, the most of anyone.', refs: [{ read: 1, row: 0, col: 'customer' }] }),
  ]);
const explain = () =>
  scripted(SUITE, [
    call('purchases_price_history', { item_id: 'item:1', days: 60 }),
    note('Read 0 is the rise; read 1 lists the bills.'),
    say(
      {
        text: '⟦1⟧ from ⟦2⟧ cost ⟦3⟧ a pack on bill ⟦4⟧ of ⟦5⟧, against ⟦6⟧ before.',
        refs: ['item', 'supplier', 'latest_cost', 'latest_bill_no', 'latest_bill_date', 'baseline_cost'].map((col) => ({ read: 0, row: 0, col })),
      },
      { text: 'The first bill of the window, on ⟦1⟧, was at ⟦2⟧.', refs: ['bill_date', 'unit_cost'].map((col) => ({ read: 1, row: 0, col })) },
    ),
  ]);
const finding = (kind: string) => watched.raised.find((f) => f.kind === kind) as (typeof watched.raised)[number];

const rawRows = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const rupees = (minor: number) => formatMoney({ minor, currency: 'INR' });

it('A1 the happy path renders every number from a cell this run minted', async () => {
  const r = await run();
  const s = happy();
  const reply = await ask(HAPPY, { port: r.port, asOf: AS_OF, deps: s.deps });
  expect(s.left()).toBe(0);

  // Yesterday from the raw rows: sales by their business date, tenders from their payments.
  const sales = await rawRows(
    `select s.sold_at, s.total_minor::bigint as total,
            coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id), 0)::bigint as paid,
            coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id and p.method = 'upi'), 0)::bigint as upi
       from books.sale s where s.tenant_id = $1`,
    [k.tenantId],
  );
  const day = sales.filter((x) => businessDate(x.sold_at, 'Asia/Kolkata') === YESTERDAY);
  const sum = (f: (x: (typeof day)[number]) => number) => day.reduce((a, x) => a + f(x), 0);
  const want = `On ${YESTERDAY} the counter took ${rupees(sum((x) => Number(x.total)))} over ${day.length} bills; ${rupees(sum((x) => Number(x.upi)))} came by UPI and ${rupees(sum((x) => Number(x.total) - Number(x.paid)))} went on credit.`;
  console.log(`A1 rendered: ${renderReply(reply)[0]}`);
  expect(day.length).toBeGreaterThan(0);
  expect(renderReply(reply)).toEqual([want]);

  // Every cited cell is in a snapshot this run minted, for this tenant.
  expect(reply.kind).toBe('answer');
  if (reply.kind !== 'answer') return;
  const cited = [...new Set(reply.segments.flatMap((x) => x.refs.map((ref) => ref.snapshotId)))];
  const owners = await rawRows('select tenant_id::text as tenant, run_id::text as run from snap.snapshot where id = any($1::uuid[])', [cited]);
  expect(owners).toEqual([{ tenant: k.tenantId, run: r.runId }]);
});

it('A1 a free digit in the answer makes the run abstain', async () => {
  const r = await run();
  const s = owes();
  const reply = await ask(OWES, { port: r.port, asOf: AS_OF, deps: s.deps });
  expect(s.left()).toBe(0);
  expect(reply).toEqual({ kind: 'abstain', specialist: 'credit', missing: ['free_digit'] });
  expect(renderReply(reply)).toEqual(['Cannot verify: a number without a source.']);
});

// The refusals, on answers built against a real run: each ref is refused by exactly one rule.
async function refusal(ref: (snapshotId: string) => CellRef, scopeExtra: string[] = []) {
  const r = await run();
  const snap = await r.port.read('sales.by_day', { from: YESTERDAY, to: YESTERDAY });
  const scope = new Map<string, number | null>([[snap.snapshotId, null], ...scopeExtra.map((id): [string, null] => [id, null])]);
  const checked = await checkAnswer({ segments: [{ text: 'It was ⟦1⟧.', refs: [ref(snap.snapshotId)] }] }, scope, r.port.resolve);
  return { checked, port: r.port, snap };
}
const rulesOf = (c: Awaited<ReturnType<typeof checkAnswer>>) => (c.ok ? [] : c.failures.map((f) => f.rule));

it('A1 a forged ref is refused: a row or a column the snapshot does not have', async () => {
  const ok = await refusal((id) => ({ snapshotId: id, row: 0, col: 'total' }));
  expect(rulesOf(ok.checked)).toEqual([]); // the control: the real cell passes
  expect(rulesOf((await refusal((id) => ({ snapshotId: id, row: 999, col: 'total' }))).checked)).toEqual(['unresolved']);
  expect(rulesOf((await refusal((id) => ({ snapshotId: id, row: 0, col: 'profit' }))).checked)).toEqual(['unresolved']);
});

it("A1 a cross-tenant ref is refused: another tenant's cell does not resolve under this tenant, even if it were in scope", async () => {
  const theirs = await run(b.owner.tenantId, b.owner.memberId);
  const snap = await theirs.port.read('stock.on_hand', { item_id: b.biscuits });
  const ref: CellRef = { snapshotId: snap.snapshotId, row: 0, col: 'on_hand' };
  expect(await theirs.port.resolve(ref)).toEqual({ kind: 'quantity', num: '48000', unit: 'pack' }); // it exists, for B
  const { checked } = await refusal(() => ref, [snap.snapshotId]); // planted in A's scope: the run rule is out of the way
  expect(rulesOf(checked)).toEqual(['unresolved']);
});

it('A1 a ref minted by another run is refused, though it resolves', async () => {
  const shrink = finding('shrinkage');
  const ref: CellRef = { snapshotId: shrink.snapshotId, row: shrink.row, col: 'loss' };
  const { checked, port } = await refusal(() => ref);
  expect(await port.resolve(ref)).toMatchObject({ kind: 'money' }); // same tenant: it resolves
  expect(rulesOf(checked)).toEqual(['not_this_run']);
});

it("A1 explainFinding cites the finding's own row and what the desk read behind it", async () => {
  const creep = finding('price_creep');
  const r = await run();
  const s = explain();
  const reply = await explainFinding(creep.findingId, { port: r.port, asOf: AS_OF, deps: s.deps });
  expect(s.left()).toBe(0);
  const [latest] = await rawRows(
    `select p.bill_no, p.bill_date::text as bill_date from books.purchase_line pl join books.purchase p on p.id = pl.purchase_id
      where pl.item_id = $1 order by p.bill_date desc limit 1`,
    [k.items.get('Butter 100 g')],
  );
  const [first] = await rawRows(
    `select p.bill_date::text as bill_date, pl.unit_cost_minor::bigint as cost from books.purchase_line pl join books.purchase p on p.id = pl.purchase_id
      where pl.item_id = $1 and p.bill_date > $2::date - 60 order by p.bill_date limit 1`,
    [k.items.get('Butter 100 g'), AS_OF],
  );
  expect(renderReply(reply)).toEqual([
    `Butter 100 g from Gupta Traders (simulated) cost ₹60 a pack on bill ${latest.bill_no} of ${latest.bill_date}, against ₹56 before.`,
    `The first bill of the window, on ${first.bill_date}, was at ${rupees(Number(first.cost))}.`,
  ]);
  if (reply.kind !== 'answer') return;
  expect(reply.segments[0]?.refs.every((ref) => ref.snapshotId === creep.snapshotId && ref.row === creep.row)).toBe(true);
});

it('A1 draftFix proposes a reorder whose numbers are cells, and nothing changes until the owner approves it', async () => {
  const r = await run();
  const shrinks = watched.raised.filter((f) => f.kind === 'shrinkage');
  const findings = await Promise.all(shrinks.map((f) => r.port.finding(f.findingId)));
  const biscuits = findings.find((f) => f?.cells.item?.kind === 'text' && f.cells.item.txt === 'Glucose biscuits 70 g');
  expect(biscuits).toBeTruthy();
  const messages = async () => (await rawRows('select body from books.outbound_message where tenant_id = $1', [k.tenantId])).map((m) => m.body as string);
  expect(await messages()).toEqual([]);

  const fix = await draftFix(biscuits?.id as string, { port: r.port, asOf: AS_OF });
  expect(fix.kind).toBe('proposed');
  if (fix.kind !== 'proposed') return;

  // Every number of the payload is the value of the cell its path names, and that cell is cited.
  const payload = fix.payload as { supplierId: string; lines: { itemId: string; qtyMilli: number }[] };
  const qtyRef = fix.payloadRefs['lines[0].qtyMilli'] as CellRef;
  expect(Object.keys(fix.payloadRefs)).toEqual(['lines[0].qtyMilli']); // the payload's only number
  expect(await r.port.resolve(qtyRef)).toEqual({ kind: 'quantity', num: String(payload.lines[0]?.qtyMilli), unit: 'pack' });
  expect(fix.basedOn).toContainEqual(qtyRef);
  // basedOn cites the finding's row and the current stock (an undated read).
  expect(fix.basedOn.filter((ref) => ref.snapshotId === biscuits?.snapshotId && ref.row === biscuits.row).map((ref) => ref.col)).toEqual(['item_id', 'item', 'missing']);
  const queries = await rawRows('select id::text as id, query_name, run_id::text as run from snap.snapshot where id = any($1::uuid[])', [[...new Set(fix.basedOn.map((x) => x.snapshotId))]]);
  expect(queries.map((q) => q.query_name).sort()).toEqual(['purchases.last_price', 'stock.on_hand', 'watch.shrinkage']);

  // The usual quantity from the item's latest bill, from its supplier.
  const [last] = await rawRows(
    `select p.supplier_id::text as supplier, pl.qty_milli::bigint as qty from books.purchase_line pl join books.purchase p on p.id = pl.purchase_id
      where pl.item_id = $1 order by p.bill_date desc, p.created_at desc limit 1`,
    [k.items.get('Glucose biscuits 70 g')],
  );
  expect(payload).toEqual({ supplierId: last.supplier, lines: [{ itemId: k.items.get('Glucose biscuits 70 g'), qtyMilli: Number(last.qty) }] });
  const [draft] = await rawRows('select status, run_id::text as run, finding_id::text as finding, proposed_by from approval.draft where id = $1', [fix.draftId]);
  expect(draft).toEqual({ status: 'proposed', run: r.runId, finding: biscuits?.id, proposed_by: null });
  expect(await messages()).toEqual([]); // proposed, not applied

  const decided = await decide(db.app, k.owner, fix.draftId, 'approved');
  expect(decided.status).toBe('executed');
  expect(await messages()).toEqual([`Reorder from Sharma General Store (synthetic): ${Number(last.qty) / 1000} × Glucose biscuits 70 g.`]);
  const broken = await withTx(db.app, { kind: 'member', session: k.owner }, async (c) => (await c.query('select audit.verify_chain($1) as b', [k.tenantId])).rows[0].b);
  expect(broken).toBeNull();
});

it('A1 nothing but ids and fixed labels reaches a trace: no question, name, bill text or model text', async () => {
  // Its own runs (the recorded turns of the tests above), so it holds when run alone: a question answered, one that
  // abstains, a finding explained, and a draft proposed for each shrinkage finding.
  traced.length = 0;
  runs.length = 0;
  await ask(HAPPY, { port: (await run()).port, asOf: AS_OF, deps: happy().deps });
  await ask(OWES, { port: (await run()).port, asOf: AS_OF, deps: owes().deps });
  await explainFinding(finding('price_creep').findingId, { port: (await run()).port, asOf: AS_OF, deps: explain().deps });
  const shrinks = watched.raised.filter((f) => f.kind === 'shrinkage');
  expect(shrinks).toHaveLength(2);
  for (const f of shrinks) await draftFix(f.findingId, { port: (await run()).port, asOf: AS_OF });
  const stored = await rawRows('select kind, label, refs from ops.run_trace where run_id = any($1::uuid[]) order by run_id, seq', [runs]);
  console.log(`A1 traces: ${traced.length} events over ${runs.length} runs, ${stored.length} stored`);
  expect(traced.length).toBeGreaterThan(20);
  expect(stored.length).toBe(traced.length);
  const untrusted = [
    HAPPY,
    OWES,
    ...k.customers.keys(),
    ...k.items.keys(),
    ...k.suppliers.keys(),
    'GT-',
    ...modelText,
  ];
  const all = JSON.stringify([traced, stored]);
  for (const text of untrusted) expect(all.includes(text), text).toBe(false);
  for (const e of traced) for (const label of e.label.split(',')) expect(TRACE_LABELS.has(label), label).toBe(true);
  for (const e of traced) for (const id of e.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
});
