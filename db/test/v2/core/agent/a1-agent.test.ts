// A1: the AI layer over the real database (the kirana seed, its watchers' findings, a second tenant), through the port
// the app builds (agent-port.ts): an answer renders its numbers from this run's cells; a free digit makes the run abstain;
// a forged ref, another tenant's ref and another run's ref are each refused by exactly one rule; a finding is explained
// from its own row and the books; draftFix proposes a draft whose numbers are cells, which executes only when the owner
// approves; and nothing but ids and fixed labels reaches a trace. Model turns are hand-written and replayed from
// packages/agent/fixtures/a1 (packages/agent/test/script.ts). Expected values are worked out from raw rows here.
import { addDays, businessDate, type CellRef, decide, formatMoney, runWatchers, type Session, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkAnswer, renderReply, renderSegment } from '../../../../../packages/agent/src/answer.ts';
import type { TraceEvent } from '../../../../../packages/agent/src/port.ts';
import { ask, draftFix, explainFinding, TRACE_LABELS } from '../../../../../packages/agent/src/run.ts';
import { prepare, scripted, type Turn } from '../../../../../packages/agent/test/script.ts';
import { type Kirana, seedKirana } from '../../../../seed/kirana.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { type Shop, smallShop } from '../shop.ts';

const SUITE = 'a1';
const AS_OF = '2026-10-27';
const YESTERDAY = '2026-10-26';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let k: Kirana;
let b: Shop;
let watched: Awaited<ReturnType<typeof runWatchers>>;
const traced: TraceEvent[] = [];
const runs: string[] = [];
const modelText: string[] = [];

beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  k = await seedKirana(app, { asOf: AS_OF });
  watched = await runWatchers(jobs, k.tenantId, AS_OF);
  b = await smallShop(app, 'B');
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const pools = () => ({ app, agent: db.as('munshi_agent') });

// A question the member asks: the run and everything it writes are that member's.
async function run(session: Session = k.owner) {
  const runId = await startRun(pools(), session);
  runs.push(runId);
  const { port, events } = agentPort(pools(), session, runId);
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
    // The customer is an id cell (no name in a cell), so the answer cites the balance; its typed figure is the free digit.
    say({ text: 'The largest balance is ⟦1⟧: a customer owes ₹1,200, the most of anyone.', refs: [{ read: 1, row: 0, col: 'balance' }] }),
  ]);
const explain = () =>
  scripted(SUITE, [
    call('purchases_price_history', { item_id: 'item:1', days: 60 }),
    note('Read 0 is the rise; read 1 lists the bills.'),
    say(
      {
        // The supplier is an id cell (no name in a cell); the item's name is a revision's, not a person's.
        text: '⟦1⟧ cost ⟦2⟧ a pack on bill ⟦3⟧ of ⟦4⟧, against ⟦5⟧ before.',
        refs: ['item', 'latest_cost', 'latest_bill_no', 'latest_bill_date', 'baseline_cost'].map((col) => ({ read: 0, row: 0, col })),
      },
      { text: 'The earliest bill of the window, on ⟦1⟧, was at ⟦2⟧.', refs: ['bill_date', 'unit_cost'].map((col) => ({ read: 1, row: 0, col })) },
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
            coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id and p.direction = 'in'), 0)::bigint as paid,
            coalesce((select sum(p.amount_minor) from books.payment p where p.sale_id = s.id and p.direction = 'in' and p.method = 'upi'), 0)::bigint as upi
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
  const theirs = await run(b.owner);
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

it('A1 an answer names a person only by citing their customer_id or supplier_id cell; every other id is refused', async () => {
  const r = await run();
  const credit = await r.port.read('credit.balances', { as_of: AS_OF });
  const items = await r.port.read('items.list', {});
  const scope = new Map<string, number | null>([
    [credit.snapshotId, null],
    [items.snapshotId, null],
  ]);
  const at = (snapshotId: string, col: string): CellRef => ({ snapshotId, row: 0, col });
  // The credit book's first row is the answer key's most overdue customer: the cell holds their id, never their name.
  expect(await r.port.resolve(at(credit.snapshotId, 'customer_id'))).toEqual({ kind: 'text', txt: k.customers.get('Ramesh K.') });
  const named = await checkAnswer({ segments: [{ text: '⟦1⟧ owes ⟦2⟧.', refs: [at(credit.snapshotId, 'customer_id'), at(credit.snapshotId, 'balance')] }] }, scope, r.port.resolve);
  expect(rulesOf(named)).toEqual([]);
  // The screen shows the person's name from people.ts; the plain renderer, a fixed word.
  expect(named.ok && renderSegment(named.segments[0] as Parameters<typeof renderSegment>[0])).toBe(`[customer] owes ${rupees(120_000)}.`);
  const other = await checkAnswer({ segments: [{ text: '⟦1⟧ sells best.', refs: [at(items.snapshotId, 'item_id')] }] }, scope, r.port.resolve);
  expect(rulesOf(other)).toEqual(['id_ref']); // an item's id is no one's name
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
    `Butter 100 g cost ₹60 a pack on bill ${latest.bill_no} of ${latest.bill_date}, against ₹56 before.`,
    `The earliest bill of the window, on ${first.bill_date}, was at ${rupees(Number(first.cost))}.`,
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
  // A message's words live in ops.message_text (erasable); the book row names them by text_id.
  const messages = async () =>
    (
      await rawRows(
        'select t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.tenant_id = $1',
        [k.tenantId],
      )
    ).map((m) => m.body as string);
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
  const [draft] = await rawRows('select status, source, run_id::text as run, finding_id::text as finding from approval.draft where id = $1', [fix.draftId]);
  expect(draft).toEqual({ status: 'proposed', source: 'run', run: r.runId, finding: biscuits?.id });
  expect(await messages()).toEqual([]); // proposed, not applied

  const decided = await decide(app, k.owner, fix.draftId, 'approved');
  expect(decided.status).toBe('executed');
  expect(await messages()).toEqual([`Reorder from Sharma General Store (synthetic): ${Number(last.qty) / 1000} × Glucose biscuits 70 g.`]);
  const broken = await withTx(app, { kind: 'member', session: k.owner }, async (c) => (await c.query('select audit.verify_chain($1) as b', [k.tenantId])).rows[0].b);
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
  const stored = await rawRows('select kind, label, ids from ai.trace where run_id = any($1::uuid[]) order by run_id, seq', [runs]);
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
  for (const e of stored) for (const label of e.label.split(':')) expect(TRACE_LABELS.has(label), label).toBe(true); // a list is stored joined by ':'
  for (const e of traced) for (const id of e.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
});

// Fix cycle 1: the agent explains or drafts only for a finding that is open and still seen by the latest watcher run of
// its kind, and proposes no second draft while one for the finding awaits a decision. Dismissed and resolved are final
// (ai.finding_flow), so each is its own finding: the expiry finding dismissed by the owner with a dismiss code, and a
// finding the jobs role raised under a key no watcher returns, then resolved.
it('A1 a dismissed or resolved finding is neither explained nor drafted', async () => {
  const f = finding('expiry');
  const r = await run();
  expect(await r.port.finding(f.findingId)).toMatchObject({ status: 'open', current: true, openDraft: false });
  await tx(app, { tenant_id: k.tenantId, actor_id: k.owner.memberId }, (c) =>
    c.query(`update ai.finding set status = 'dismissed', close_reason = 'not_relevant' where id = $1`, [f.findingId]),
  );
  const resolved = await tx(jobs, { tenant_id: k.tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, first_run_id, last_run_id)
       values ($1, 'stock', 'expiry', 'expiry:planted', 'low', $2, $3, '\\x00', $4, $4) returning id`,
      [k.tenantId, f.snapshotId, f.row, watched.runId],
    );
    await c.query(`update ai.finding set status = 'resolved' where id = $1`, [rows[0]?.id]);
    return rows[0]?.id as string;
  });
  for (const [id, status] of [
    [f.findingId, 'dismissed'],
    [resolved, 'resolved'],
  ]) {
    expect(await r.port.finding(id as string), status).toMatchObject({ status });
    expect(await explainFinding(id as string, { port: r.port, asOf: AS_OF })).toEqual({ kind: 'abstain', specialist: null, missing: ['finding_closed'] });
    expect(await draftFix(id as string, { port: r.port, asOf: AS_OF })).toEqual({ kind: 'none', reason: 'closed' });
  }
  // The watchers still see the expiry, and leave its dismissed key to rest: nothing raised, the dismissal stands.
  expect((await runWatchers(jobs, k.tenantId, AS_OF)).raised).toEqual([]);
  expect(await r.port.finding(f.findingId)).toMatchObject({ status: 'dismissed' });
});

it('A1 one draft per finding awaits a decision: draftFix proposes no second one', async () => {
  const f = watched.raised.filter((x) => x.kind === 'shrinkage')[1] as (typeof watched.raised)[number];
  const open = async () => (await rawRows("select id::text as id from approval.draft where finding_id = $1 and status = 'proposed'", [f.findingId])).map((d) => d.id as string);
  // A rejection carries a decision reason code (approval.decision refuses one without).
  for (const id of await open()) await decide(app, k.owner, id, 'rejected', 'not_now'); // left by an earlier test of this file
  const first = await draftFix(f.findingId, { port: (await run()).port, asOf: AS_OF });
  expect(first.kind).toBe('proposed');
  expect((await (await run()).port.finding(f.findingId))?.openDraft).toBe(true);
  expect(await draftFix(f.findingId, { port: (await run()).port, asOf: AS_OF })).toEqual({ kind: 'none', reason: 'open_draft' });
  expect(await open()).toHaveLength(1);
  if (first.kind === 'proposed') await decide(app, k.owner, first.draftId, 'rejected', 'not_now');
  expect(await draftFix(f.findingId, { port: (await run()).port, asOf: AS_OF })).toMatchObject({ kind: 'proposed' }); // decided: a new one may go
});

// Last in the file: it moves the watchers' date on, which every finding of the seed then falls behind.
it('A1 a finding the latest watcher run still sees stays current; one it no longer sees is refused', async () => {
  const shrink = finding('shrinkage');
  const r = await run();
  const again = await runWatchers(jobs, k.tenantId, AS_OF); // the same day: nothing new, every situation still there
  expect(again.raised).toEqual([]);
  expect(again.rows).toBeGreaterThan(0);
  const [latest] = await rawRows(
    "select id::text as id, rows -> $2::int as cells from snap.snapshot where run_id = $1 and query_name = 'watch.shrinkage'",
    [again.runId, shrink.row],
  );
  const seen = await r.port.finding(shrink.findingId);
  // Its cells are the latest run's row, so it keeps its own pinned snapshot (row_sha256): explained from the same row.
  expect(seen).toMatchObject({ status: 'open', current: true, snapshotId: shrink.snapshotId, row: shrink.row });
  expect(latest?.id).not.toBe(shrink.snapshotId);
  const [own] = await rawRows('select rows -> $2::int as cells from snap.snapshot where id = $1', [shrink.snapshotId, shrink.row]);
  expect(own?.cells).toEqual(latest?.cells); // the same situation, cell for cell
  expect(seen?.cells.move_id).toEqual({ kind: 'text', txt: own?.cells[0].t });
  await runWatchers(jobs, k.tenantId, addDays(AS_OF, 45)); // the count is now outside the shrinkage window
  expect(await r.port.finding(shrink.findingId)).toMatchObject({ status: 'open', current: false });
  expect(await explainFinding(shrink.findingId, { port: r.port, asOf: AS_OF })).toEqual({ kind: 'abstain', specialist: null, missing: ['finding_stale'] });
  expect(await draftFix(shrink.findingId, { port: r.port, asOf: AS_OF })).toEqual({ kind: 'none', reason: 'stale' });
});
