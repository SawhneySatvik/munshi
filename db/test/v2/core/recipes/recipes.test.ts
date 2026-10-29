// RCP and TAINT: recipes turn a finding into a draft by a fixed mapping (BLUEPRINT §7.5), and every number the draft
// carries is a cell — checked here against core's real proposeDraft, which resolves every ref and refuses a payload
// number with no cell holding it. A shelf count 8 packs short (₹68) drafts a reorder of the latest bill line's 48 packs;
// ₹300 of udhaar 10 days past due drafts a credit_due reminder whose figure is the customer's current credit.balance
// cell (a ref, not a number). customer.remind is BP-F3a's command, not on this branch: its stand-in here has F3a's
// input shape, registered for this file only, as ms22a's hooks test does. A run a person started by tapping one recipe
// that reads untrusted text is tainted: the agent's port refuses every other proposal before core sees it, and the
// database's taint list refuses one that gets past. Red-proofs: test/v2/sabotage/core-ai.ts.
import { addDays, businessDate, COMMANDS, countStock, type CellRef, decide, localTime, parseRef, recordSale, resolveRef, runCommand, runWatchers, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type AgentPort, TaintRefused, tappedPort } from '../../../../../packages/agent/src/port.ts';
import { draftFix } from '../../../../../packages/agent/src/run.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { type Shop, smallShop } from '../shop.ts';

type Def = typeof COMMANDS extends ReadonlyMap<string, infer D> ? D : never;
const commands = COMMANDS as Map<string, Def>;

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let today: string;
let found: Map<string, string>; // kind → finding id

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Recipes');
  today = businessDate(new Date(), 'Asia/Kolkata');
  // F3a's customer.remind input, a stand-in until it merges: the figure is a ref string, so the payload holds no number.
  const remind = (d: Record<string, unknown>) =>
    Object.keys(d).sort().join() === 'customerId,figure,template' &&
    typeof d.customerId === 'string' &&
    (d.template === 'credit_due' || d.template === 'package_expiring') &&
    typeof d.figure === 'string' &&
    parseRef(d.figure) !== null;
  commands.set('customer.remind', {
    input: { safeParse: (data: unknown) => (remind(data as Record<string, unknown>) ? { success: true, data } : { success: false, error: { issues: [{ path: [] }] } }) } as never,
    run: async () => ({}),
    draftOnly: true,
  });
  await countStock(app, s.manager, { itemId: s.biscuits, countedQtyMilli: 40_000 }); // 48 on the books
  const rice = ((await runCommand(app, s.owner, 'item.create', { name: 'Rice bag 5 kg', unit: 'pack' })) as { itemId: string }).itemId;
  await runCommand(app, s.owner, 'price.set', { itemId: rice, amountMinor: 15_000, effectiveFrom: localTime(addDays(today, -100), 0, 'Asia/Kolkata').toISOString() });
  await recordSale(app, s.staff, {
    shopId: s.shopId,
    soldAt: localTime(addDays(today, -40), 600, 'Asia/Kolkata').toISOString(),
    customerId: s.customer,
    lines: [{ itemId: rice, qtyMilli: 2000 }],
    payments: [],
  });
  const run = await runWatchers(jobs, s.owner.tenantId, today);
  found = new Map(run.raised.map((r) => [r.kind, r.findingId]));
  await db.sabotage();
}, 120_000);
afterAll(async () => {
  commands.delete('customer.remind');
  await db.close();
});

const pools = () => ({ app, agent: db.as('munshi_agent') });
const draftRow = (id: string) =>
  tx(app, { tenant_id: s.owner.tenantId }, async (c) => (await c.query('select command, payload, based_on, payload_refs, finding_id::text, run_id::text, status from approval.draft where id = $1', [id])).rows[0]);
const cell = (ref: CellRef | string) => tx(app, { tenant_id: s.owner.tenantId }, (c) => resolveRef(c, ref));

it('RCP shrinkage → reorder.place: the 48 packs of the latest bill line, from its supplier, every number a cell core resolved', async () => {
  expect([...found.keys()].sort()).toEqual(['overdue_credit', 'shrinkage']);
  const runId = await startRun(pools(), s.owner);
  const fix = await draftFix(found.get('shrinkage') as string, { port: agentPort(pools(), s.owner, runId).port, asOf: today });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'reorder.place', payload: { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: 48_000 }] } });
  if (fix.kind !== 'proposed') return;
  const d = await draftRow(fix.draftId);
  expect(d).toMatchObject({ command: 'reorder.place', finding_id: found.get('shrinkage'), run_id: runId, status: 'proposed' });
  expect(await cell(d.payload_refs['lines[0].qtyMilli'])).toEqual({ kind: 'quantity', num: '48000', unit: 'pack' });
  for (const ref of d.based_on as CellRef[]) expect(await cell(ref), JSON.stringify(ref)).not.toBeNull();
  expect((d.based_on as CellRef[]).map((r) => r.col)).toEqual(['item_id', 'item', 'missing', 'supplier_id', 'qty', 'on_hand']);
  expect(await cell((d.based_on as CellRef[])[2] as CellRef)).toEqual({ kind: 'quantity', num: '8000', unit: 'pack' });
});

it("RCP overdue credit → customer.remind (credit_due): no number in the payload; its figure is the customer's current balance cell, ₹300", async () => {
  const runId = await startRun(pools(), s.owner);
  const fix = await draftFix(found.get('overdue_credit') as string, { port: agentPort(pools(), s.owner, runId).port, asOf: today });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'customer.remind', payload: { customerId: s.customer, template: 'credit_due' } });
  if (fix.kind !== 'proposed') return;
  const d = await draftRow(fix.draftId);
  expect(d.payload_refs).toEqual({});
  const numbers: unknown[] = [];
  JSON.parse(JSON.stringify(d.payload), (_, v) => {
    if (typeof v === 'number') numbers.push(v);
    return v;
  });
  expect(numbers).toEqual([]); // no number anywhere in the stored payload
  const figure = parseRef(d.payload.figure as string) as CellRef;
  expect(await cell(figure)).toEqual({ kind: 'money', num: '30000', currency: 'INR' });
  expect(d.based_on).toContainEqual(figure);
  const [snap] = (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query('select query_name, params from snap.snapshot where id = $1', [figure.snapshotId]))).rows;
  expect(snap).toEqual({ query_name: 'credit.balance', params: { customer_id: s.customer } });
});

it('TAINT a run tapped for purchase.record that reads bill text is tainted; its port then refuses every other proposal before core, and the database refuses one that gets past', async () => {
  // A draft for a finding awaits no second one: the drafts the tests above left are rejected first.
  const open = await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query<{ id: string }>("select id::text from approval.draft where status = 'proposed'"));
  for (const { id } of open.rows) await decide(app, s.owner, id, 'rejected', 'not_now');
  const runId = await startRun(pools(), s.owner);
  const base = agentPort(pools(), s.owner, runId).port;
  const proposed: string[] = [];
  const inner: AgentPort = {
    ...base,
    propose: (d) => {
      proposed.push(d.command);
      return base.propose(d);
    },
    taint: async () => {
      await withTx(app, { kind: 'member', session: s.owner }, (c) => c.query('update ai.run set tainted = true where id = $1', [runId]));
    },
  };
  const port = tappedPort(inner, 'purchase.record');
  const tainted = async () => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query('select tainted from ai.run where id = $1', [runId]))).rows[0]?.tainted;
  expect(await tainted()).toBe(false);
  await port.read('bill.lines', { bill_id: '00000000-0000-4000-8000-000000000000' });
  expect(await tainted()).toBe(true);
  expect(await draftFix(found.get('shrinkage') as string, { port, asOf: today })).toEqual({ kind: 'none', reason: 'tainted' });
  await expect(port.propose({ command: 'reorder.place', payload: {}, basedOn: [], payloadRefs: {} })).rejects.toBeInstanceOf(TaintRefused);
  expect(proposed).toEqual([]); // core never saw them
  // The tapped recipe's command does reach core (which judges the draft on its own rules).
  await expect(port.propose({ command: 'purchase.record', payload: {}, basedOn: [], payloadRefs: {} })).rejects.toMatchObject({ code: 'invalid' });
  expect(proposed).toEqual(['purchase.record']);
  // Past the agent's port, the database's taint list refuses the reorder for this run.
  const fix = await draftFix(found.get('shrinkage') as string, { port: inner, asOf: today }).catch((e: unknown) => e);
  expect(fix).toMatchObject({ code: 'refused', sqlstate: 'MS002' });
  expect((await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query('select count(*)::int as n from approval.draft where run_id = $1', [runId]))).rows[0]?.n).toBe(0);
});
