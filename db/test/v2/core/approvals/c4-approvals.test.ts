// C4: nothing auto-applies. A draft (here: an agent run's reorder, citing the on-hand cell it relied on) changes the
// books only when a member allowed to run its command approves it; decide() executes it under the approver in one
// transaction with its audit entries, re-checking the cited cells first — evidence that changed makes the draft stale
// and nothing is written. Every number in a draft's payload is mapped to the cell it came from, and a draft that moves
// stock or money cites the current on-hand of each item it names, so a change after a watcher's as_of still stales it.
import { randomUUID } from 'node:crypto';
import {
  addDays,
  addMember,
  businessDate,
  type CellRef,
  CoreError,
  decide,
  formatRef,
  mintSnapshot,
  openSession,
  proposeDraft,
  recordPurchase,
  recordSale,
  recordWaste,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, sessionOf, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'C4');
  await db.sabotage();
});
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, params))).rows;

// The owner's question starts a run (ai.run stamps the owner as started_by); its reads are minted as the owner.
const newRun = async (shop: Shop) => {
  const runId = randomUUID();
  await tx(app, { tenant_id: shop.owner.tenantId, actor_id: shop.owner.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'question', 'stock')`, [shop.owner.tenantId, runId]),
  );
  return runId;
};
const asOwner = (shop: Shop) => ({ kind: 'member', session: shop.owner }) as const;
const deactivate = (memberId: string) =>
  withTx(app, { kind: 'member', session: s.owner }, (c) => c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [memberId]));
const num = (cell: unknown) => Number((cell as { num: string }).num);

// What the agent does inside a person's question: a run, a snapshot of what it read, a draft reordering what is on hand
// and citing that cell for the quantity.
async function agentDraft(item = s.biscuits) {
  const runId = await newRun(s);
  const snap = await mintSnapshot(app, asOwner(s), 'stock.on_hand', { item_id: item }, runId);
  const ref = { snapshotId: snap.id, row: 0, col: 'on_hand' };
  const qty = num(snap.rows[0]?.on_hand);
  const draftId = await proposeDraft(
    app,
    { session: s.owner, runId },
    { command: 'reorder.place', payload: { supplierId: s.supplier, lines: [{ itemId: item, qtyMilli: qty }] }, basedOn: [ref], payloadRefs: { 'lines[0].qtyMilli': ref } },
  );
  return { draftId, ref, qty };
}

// The MS-5 review's situation, in a fresh shop: 20 packs of butter bought ten days ago expire three days after last
// night's watcher run (its as_of); that run's watch.expiry snapshot holds the lot, and on-hand is 32 packs.
async function expiringLot() {
  const p = await smallShop(app, `C4-${randomUUID().slice(0, 4)}`);
  const asOf = addDays(businessDate(new Date(), 'Asia/Kolkata'), -1);
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const lot = { itemId: p.butter, qtyMilli: 20_000, unitCostMinor: 9000, expiresOn: addDays(asOf, 3) };
  await recordPurchase(app, p.manager, { supplierId: p.supplier, billNo: 'GT-EXP', billDate: tenDaysAgo.slice(0, 10), receivedAt: tenDaysAgo, lines: [lot] });
  const runId = await newRun(p);
  const expiry = await mintSnapshot(app, asOwner(p), 'watch.expiry', { as_of: asOf }, runId);
  const row = expiry.rows.findIndex((r) => r.item_id?.kind === 'text' && r.item_id.txt === p.butter);
  const at = (col: string): CellRef => ({ snapshotId: expiry.id, row, col });
  const held = await mintSnapshot(app, asOwner(p), 'stock.on_hand', { item_id: p.butter }, runId);
  const onHand: CellRef = { snapshotId: held.id, row: 0, col: 'on_hand' };
  expect(num(expiry.rows[row]?.at_risk)).toBe(20_000);
  expect(num(held.rows[0]?.on_hand)).toBe(32_000);
  const by = { session: p.owner, runId };
  return { p, by, at, onHand, held: async () => Number((await tx(app, { tenant_id: p.owner.tenantId }, (c) => c.query('select sum(qty_milli) as n from books.stock_move where item_id = $1', [p.butter]))).rows[0].n) };
}
const messages = async () => (await q('select count(*)::int as n from books.outbound_message'))[0].n as number;
const status = async (draftId: string) => (await q('select status from approval.draft where id = $1', [draftId]))[0]?.status;

it('C4 a draft approved by the owner executes under the owner in one transaction, and its audit chain verifies', async () => {
  const { draftId, ref, qty } = await agentDraft();
  expect(await status(draftId)).toBe('proposed');
  const before = await messages();
  const d = await decide(app, s.owner, draftId, 'approved');
  expect(d.status).toBe('executed');
  if (d.status !== 'executed') return;
  const messageId = d.result.messageId as string;
  expect(await messages()).toBe(before + 1);
  const [row] = await q(
    `select m.created_by, m.decision_id, t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id
      where m.id = $1`,
    [messageId],
  );
  expect(row).toEqual({ created_by: s.owner.memberId, decision_id: d.decisionId, body: `Reorder from C4 General Store (synthetic): ${qty / 1000} × Glucose biscuits 70 g.` });
  const [decision] = await q('select verdict, decided_by from approval.decision where id = $1', [d.decisionId]);
  expect(decision).toEqual({ verdict: 'approved', decided_by: s.owner.memberId });
  const audit = await q(
    `select entity, action, actor_id, decision_id, command from audit.audit_log where entity_id = any($1::uuid[]) order by seq`,
    [[messageId, draftId]],
  );
  expect(audit).toEqual([
    { entity: 'books.outbound_message', action: 'insert', actor_id: s.owner.memberId, decision_id: d.decisionId, command: 'reorder.place' },
    { entity: 'approval.draft', action: 'draft.executed', actor_id: s.owner.memberId, decision_id: d.decisionId, command: 'reorder.place' },
  ]);
  expect(await status(draftId)).toBe('executed');
  const [chain] = await q('select audit.verify_chain($1) as broken, count(*)::int as n from audit.audit_log', [s.owner.tenantId]);
  console.log(`C4 executed under the owner; audit chain of ${chain?.n} entries verifies (first broken: ${chain?.broken})`);
  expect(chain).toEqual({ broken: null, n: expect.any(Number) });
  expect(formatRef(ref)).toMatch(/^⟨snap:/);
});

it('C4 a draft whose evidence changed goes stale, and nothing executes', async () => {
  const { draftId, ref } = await agentDraft();
  // A sale after the draft: the on-hand the draft relied on is no longer true.
  await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 2000 }], payments: [{ method: 'cash', amountMinor: 2000 }] });
  const before = await messages();
  const d = await decide(app, s.owner, draftId, 'approved');
  expect(d).toEqual({ status: 'stale', changed: [formatRef(ref)] });
  expect(await messages()).toBe(before);
  expect(await status(draftId)).toBe('stale');
  expect(await q('select 1 from approval.decision where draft_id = $1', [draftId])).toEqual([]);
  const [entry] = await q(`select action, actor_id from audit.audit_log where entity = 'approval.draft' and entity_id = $1`, [draftId]);
  expect(entry).toEqual({ action: 'draft.stale', actor_id: s.owner.memberId });
});

it('C4 a rejected draft writes no book row, and a decided draft cannot be decided again', async () => {
  const { draftId } = await agentDraft(s.butter);
  const before = await messages();
  expect((await decide(app, s.owner, draftId, 'rejected', 'not_now')).status).toBe('rejected');
  expect(await messages()).toBe(before);
  const again = await decide(app, s.owner, draftId, 'approved').catch((e: unknown) => e);
  expect(again).toBeInstanceOf(CoreError);
  expect(again).toMatchObject({ code: 'not_proposed' });
  expect(await messages()).toBe(before);
});

it('C4 only a member whose role holds the command can approve it; a refused approval changes nothing', async () => {
  const { draftId } = await agentDraft();
  const before = await messages();
  const err = await decide(app, s.staff, draftId, 'approved').catch((e: unknown) => e);
  expect(err).toMatchObject({ code: 'refused', sqlstate: 'MS002' }); // v2 refuses the decision itself (stamp_decision)
  expect(await messages()).toBe(before);
  expect(await status(draftId)).toBe('proposed');
  expect(await q('select 1 from approval.decision where draft_id = $1', [draftId])).toEqual([]);
  expect((await decide(app, s.manager, draftId, 'approved')).status).toBe('executed');
});

it('C4 a draft must cite cells that exist in this tenant, and a payload its command accepts', async () => {
  const by = { session: s.owner };
  const held = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'stock.on_hand', { item_id: s.biscuits });
  const ref = { snapshotId: held.id, row: 0, col: 'on_hand' };
  const bogus = { snapshotId: randomUUID(), row: 0, col: 'on_hand' };
  const payload = { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: num(held.rows[0]?.on_hand) }] };
  const payloadRefs = { 'lines[0].qtyMilli': ref };
  const noCell = await proposeDraft(app, by, { command: 'reorder.place', payload, basedOn: [bogus], payloadRefs }).catch((e: unknown) => e);
  expect(noCell).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  const badPayload = await proposeDraft(app, by, { command: 'reorder.place', payload: { ...payload, totalMinor: 1 }, basedOn: [ref], payloadRefs }).catch(
    (e: unknown) => e,
  );
  expect(badPayload).toMatchObject({ code: 'invalid' });
  const noCommand = await proposeDraft(app, by, { command: 'books.anything', payload, basedOn: [ref], payloadRefs }).catch((e: unknown) => e);
  expect(noCommand).toMatchObject({ code: 'invalid', fields: ['command'] });
  const drafts = await withTx(app, { kind: 'member', session: s.owner }, (c) => c.query(`select count(*)::int as n from approval.draft where proposed_by = $1`, [s.owner.memberId]));
  expect(drafts.rows[0].n).toBe(0);
});

it("C4 every number in a draft's payload is mapped to a cell of its kind holding that number, and basedOn is never empty", async () => {
  const { p, by, at, onHand } = await expiringLot();
  const reorder = (qtyMilli: number) => ({ supplierId: p.supplier, lines: [{ itemId: p.butter, qtyMilli }] });
  const propose = (payload: unknown, basedOn: CellRef[], payloadRefs: Record<string, CellRef>) =>
    proposeDraft(app, by, { command: 'reorder.place', payload, basedOn, payloadRefs }).catch((e: unknown) => e);
  const qtyRef = { 'lines[0].qtyMilli': at('at_risk') };
  expect(await propose(reorder(20_000), [], qtyRef)).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  expect(await propose(reorder(20_000), [onHand], {})).toMatchObject({ code: 'invalid', fields: ['payloadRefs.lines[0].qtyMilli'] });
  const extra = await propose(reorder(20_000), [onHand], { ...qtyRef, 'lines[0].itemId': at('item_id') });
  expect(extra).toMatchObject({ code: 'invalid', fields: ['payloadRefs.lines[0].itemId'] }); // a ref for a non-number
  expect(await propose(reorder(21_000), [onHand], qtyRef)).toMatchObject({ code: 'invalid', fields: ['payloadRefs.lines[0].qtyMilli'] });
  // 9000 is the lot's unit cost (₹90, a money cell): not a quantity, though the digits match.
  expect(await propose(reorder(9000), [onHand], { 'lines[0].qtyMilli': at('unit_cost') })).toMatchObject({
    code: 'invalid',
    fields: ['payloadRefs.lines[0].qtyMilli'],
  });
  const draftId = await propose(reorder(20_000), [at('at_risk')], qtyRef);
  expect(draftId).toEqual(expect.any(String));
  const [stored] = (await tx(app, { tenant_id: p.owner.tenantId }, (c) => c.query('select payload_refs from approval.draft where id = $1', [draftId]))).rows;
  expect(stored).toEqual({ payload_refs: qtyRef });
});

it('C4 a cell a payload number came from is re-checked at approval like basedOn', async () => {
  const runId = await newRun(s);
  const butter = await mintSnapshot(app, asOwner(s), 'stock.on_hand', { item_id: s.butter }, runId);
  const biscuits = await mintSnapshot(app, asOwner(s), 'stock.on_hand', { item_id: s.biscuits }, runId);
  const qtyRef = { snapshotId: butter.id, row: 0, col: 'on_hand' };
  const draftId = await proposeDraft(
    app,
    { session: s.owner, runId },
    {
      command: 'reorder.place',
      payload: { supplierId: s.supplier, lines: [{ itemId: s.butter, qtyMilli: num(butter.rows[0]?.on_hand) }] },
      basedOn: [{ snapshotId: biscuits.id, row: 0, col: 'on_hand' }],
      payloadRefs: { 'lines[0].qtyMilli': qtyRef },
    },
  );
  await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.butter, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 6200 }] });
  const before = await messages();
  expect(await decide(app, s.owner, draftId, 'approved')).toEqual({ status: 'stale', changed: [formatRef(qtyRef)] });
  expect(await messages()).toBe(before);
});

it("C4 a stock or money draft must cite the current on-hand of every item it names; a watcher's dated read is not enough", async () => {
  const { p, by, at, onHand } = await expiringLot();
  const waste = { itemId: p.butter, qtyMilli: 20_000 };
  const qtyRef = { qtyMilli: at('at_risk') };
  const propose = (command: string, payload: unknown, basedOn: CellRef[], payloadRefs: Record<string, CellRef>) =>
    proposeDraft(app, by, { command, payload, basedOn, payloadRefs }).catch((e: unknown) => e);
  const BASED_ON = { code: 'invalid', fields: ['basedOn'] };
  // The reviewer's probe: evidence from watch.expiry alone, which stops at its as_of.
  expect(await propose('stock.waste', waste, [at('at_risk'), at('remaining')], qtyRef)).toMatchObject(BASED_ON);
  // The on-hand of another item, or a cell of the right read that is not the on-hand, does not cover this item.
  const biscuits = await mintSnapshot(app, asOwner(p), 'stock.on_hand', { item_id: p.biscuits }, by.runId);
  expect(await propose('stock.waste', waste, [at('at_risk'), { snapshotId: biscuits.id, row: 0, col: 'on_hand' }], qtyRef)).toMatchObject(BASED_ON);
  expect(await propose('stock.waste', waste, [at('at_risk'), { ...onHand, col: 'item' }], qtyRef)).toMatchObject(BASED_ON);
  // Money naming a customer must cite that customer's credit.balance (C7), not an item's on-hand; money naming no item or
  // customer is refused.
  const money = { amountMinor: at('unit_cost') };
  expect(await propose('credit.record', { customerId: p.customer, amountMinor: 9000 }, [onHand], money)).toMatchObject(BASED_ON);
  const day = businessDate(new Date(), 'Asia/Kolkata');
  expect(await propose('settlement.record', { channel: 'upi', businessDate: day, amountMinor: 9000, receivedOn: day }, [onHand], money)).toMatchObject(BASED_ON);
  expect(await propose('stock.waste', waste, [at('at_risk'), onHand], qtyRef)).toEqual(expect.any(String));
});

it("C4 a write-off recorded after a watcher's as_of makes a draft cited from it stale", async () => {
  const { p, by, at, onHand, held } = await expiringLot();
  const draftId = await proposeDraft(app, by, {
    command: 'stock.waste',
    payload: { itemId: p.butter, qtyMilli: 20_000 },
    basedOn: [at('at_risk'), at('remaining'), onHand],
    payloadRefs: { qtyMilli: at('at_risk') },
  });
  await recordWaste(app, p.staff, { itemId: p.butter, qtyMilli: 20_000 }); // staff write the lot off at the counter
  expect(await held()).toBe(12_000);
  const d = await decide(app, p.owner, draftId, 'approved');
  console.log(`C4 the probe's write-off after as_of: decide → ${d.status}; on hand stays ${(await held()) / 1000} packs`);
  expect(d).toEqual({ status: 'stale', changed: [formatRef(onHand)] });
  expect(await held()).toBe(12_000);
});

it('C4 only an active member allowed to approve a command may reject it or have it marked stale', async () => {
  const { draftId } = await agentDraft();
  const REFUSED = { code: 'refused', sqlstate: 'MS002' };
  const decisions = async () => q('select 1 from approval.decision where draft_id = $1', [draftId]);
  // Staff do not hold reorder.place: they may not turn it down either.
  expect(await decide(app, s.staff, draftId, 'rejected', 'not_now').catch((e: unknown) => e)).toMatchObject(REFUSED);
  await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1000 }] });
  expect(await decide(app, s.staff, draftId, 'approved').catch((e: unknown) => e)).toMatchObject(REFUSED); // nor mark it stale
  // A manager signed in, then deactivated: the session outlives the membership, the authority does not.
  const gone = await sessionOf(app, s.owner.tenantId, await addMember(app, s.owner, { name: 'Former manager', role: 'manager' }));
  await deactivate(gone.memberId);
  expect(await decide(app, gone, draftId, 'rejected', 'not_now').catch((e: unknown) => e)).toMatchObject(REFUSED);
  expect(await decide(app, gone, draftId, 'approved').catch((e: unknown) => e)).toMatchObject(REFUSED);
  expect(await status(draftId)).toBe('proposed');
  expect(await decisions()).toEqual([]);
  expect((await decide(app, s.manager, draftId, 'approved')).status).toBe('stale');
  const other = await agentDraft();
  expect((await decide(app, s.manager, other.draftId, 'rejected', 'not_now')).status).toBe('rejected');
});

it('C4 a Session opens only for an active member of its own tenant', async () => {
  const t = s.owner.tenantId;
  expect(await openSession(app, t, s.manager.memberId)).toEqual({ tenantId: t, memberId: s.manager.memberId });
  const other = await smallShop(app, 'C4-other');
  expect(await openSession(app, t, other.manager.memberId)).toBeNull();
  const gone = await addMember(app, s.owner, { name: 'Left the shop', role: 'staff' });
  await deactivate(gone);
  expect(await openSession(app, t, gone)).toBeNull();
  expect(await openSession(app, t, 'not-a-uuid')).toBeNull();
});

it('C4 a finding has at most one open draft: a second proposal conflicts until the first is decided', async () => {
  const first = await agentDraft();
  const findingId = randomUUID();
  const T = s.owner.tenantId;
  await tx(db.as('munshi_jobs'), { tenant_id: T }, async (c) => {
    const run = (await c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [T])).rows[0].id;
    await c.query(
      `insert into ai.finding (tenant_id, id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, first_run_id, last_run_id)
       values ($1, $2, 'stock', 'shrinkage', $3, 'medium', $4, 0, '\\x00', $5, $5)`,
      [T, findingId, `c4-open-draft:${findingId}`, first.ref.snapshotId, run],
    );
  });
  const again = async () => {
    const runId = await newRun(s);
    const snap = await mintSnapshot(app, asOwner(s), 'stock.on_hand', { item_id: s.biscuits }, runId);
    const ref = { snapshotId: snap.id, row: 0, col: 'on_hand' };
    return proposeDraft(
      app,
      { session: s.owner, runId },
      {
        command: 'reorder.place',
        payload: { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: num(snap.rows[0]?.on_hand) }] },
        basedOn: [ref],
        payloadRefs: { 'lines[0].qtyMilli': ref },
        findingId,
      },
    );
  };
  const one = await again();
  const refused = await again().catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(CoreError);
  expect(refused).toMatchObject({ code: 'conflict', sqlstate: '23505', constraint: 'draft_open_per_finding' });
  expect(String((refused as Error).message)).not.toContain(findingId); // a fixed message, no row values
  expect((await decide(app, s.manager, one, 'rejected', 'not_now')).status).toBe('rejected');
  expect(await again()).toEqual(expect.any(String));
});
