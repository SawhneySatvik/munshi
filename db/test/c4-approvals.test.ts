// C4: nothing auto-applies. A draft (here: an agent run's reorder, citing the on-hand cell it relied on) changes the
// books only when a member allowed to run its command approves it; decide() executes it under the approver in one
// transaction with its audit entries, re-checking the cited cells first — evidence that changed makes the draft stale
// and nothing is written.
import { randomUUID } from 'node:crypto';
import { CoreError, decide, formatRef, mintSnapshot, proposeDraft, recordSale, withTx } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

let db: TestDb;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  s = await smallShop(db.app, 'C4');
  await db.sabotage();
});
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(db.app, { tenant: s.owner.tenantId }, (c) => c.query(sql, params))).rows;

// What the agent does inside a person's question: a run, a snapshot of what it read, a draft citing the cell.
async function agentDraft(item = s.biscuits, qty = 48_000) {
  const runId = randomUUID();
  await tx(db.app, { tenant: s.owner.tenantId }, (c) =>
    c.query(`insert into ops.run (tenant_id, id, trigger, started_by) values ($1, $2, 'question', $3)`, [s.owner.tenantId, runId, s.owner.memberId]),
  );
  const snap = await mintSnapshot(db.app, { kind: 'system', tenantId: s.owner.tenantId }, 'stock.on_hand', { item_id: item }, runId);
  const ref = { snapshotId: snap.id, row: 0, col: 'on_hand' };
  const draftId = await proposeDraft(
    db.app,
    { tenantId: s.owner.tenantId, runId },
    { command: 'reorder.place', payload: { supplierId: s.supplier, lines: [{ itemId: item, qtyMilli: qty }] }, basedOn: [ref] },
  );
  return { draftId, ref };
}
const messages = async () => (await q('select count(*)::int as n from books.outbound_message'))[0].n as number;
const status = async (draftId: string) => (await q('select status from approval.draft where id = $1', [draftId]))[0]?.status;

it('C4 a draft approved by the owner executes under the owner in one transaction, and its audit chain verifies', async () => {
  const { draftId, ref } = await agentDraft();
  expect(await status(draftId)).toBe('proposed');
  const before = await messages();
  const d = await decide(db.app, s.owner, draftId, 'approved');
  expect(d.status).toBe('executed');
  if (d.status !== 'executed') return;
  const messageId = d.result.messageId as string;
  expect(await messages()).toBe(before + 1);
  const [row] = await q('select created_by, decision_id, body from books.outbound_message where id = $1', [messageId]);
  expect(row).toEqual({ created_by: s.owner.memberId, decision_id: d.decisionId, body: 'Reorder from C4 General Store (synthetic): 48 × Glucose biscuits 70 g.' });
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
  await recordSale(db.app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 2000 }], payments: [{ method: 'cash', amountMinor: 2000 }] });
  const before = await messages();
  const d = await decide(db.app, s.owner, draftId, 'approved');
  expect(d).toEqual({ status: 'stale', changed: [formatRef(ref)] });
  expect(await messages()).toBe(before);
  expect(await status(draftId)).toBe('stale');
  expect(await q('select 1 from approval.decision where draft_id = $1', [draftId])).toEqual([]);
  const [entry] = await q(`select action, actor_id from audit.audit_log where entity = 'approval.draft' and entity_id = $1`, [draftId]);
  expect(entry).toEqual({ action: 'draft.stale', actor_id: s.owner.memberId });
});

it('C4 a rejected draft writes no book row, and a decided draft cannot be decided again', async () => {
  const { draftId } = await agentDraft(s.butter, 12_000);
  const before = await messages();
  expect((await decide(db.app, s.owner, draftId, 'rejected', 'enough stock')).status).toBe('rejected');
  expect(await messages()).toBe(before);
  const again = await decide(db.app, s.owner, draftId, 'approved').catch((e: unknown) => e);
  expect(again).toBeInstanceOf(CoreError);
  expect(again).toMatchObject({ code: 'not_proposed' });
  expect(await messages()).toBe(before);
});

it('C4 only a member whose role holds the command can approve it; a refused approval changes nothing', async () => {
  const { draftId } = await agentDraft();
  const before = await messages();
  const err = await decide(db.app, s.staff, draftId, 'approved').catch((e: unknown) => e);
  expect(err).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect(await messages()).toBe(before);
  expect(await status(draftId)).toBe('proposed');
  expect(await q('select 1 from approval.decision where draft_id = $1', [draftId])).toEqual([]);
  expect((await decide(db.app, s.manager, draftId, 'approved')).status).toBe('executed');
});

it('C4 a draft must cite cells that exist in this tenant, and a payload its command accepts', async () => {
  const by = { session: s.owner };
  const bogus = { snapshotId: randomUUID(), row: 0, col: 'on_hand' };
  const payload = { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }] };
  const noCell = await proposeDraft(db.app, by, { command: 'reorder.place', payload, basedOn: [bogus] }).catch((e: unknown) => e);
  expect(noCell).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  const badPayload = await proposeDraft(db.app, by, { command: 'reorder.place', payload: { ...payload, totalMinor: 1 }, basedOn: [] }).catch((e: unknown) => e);
  expect(badPayload).toMatchObject({ code: 'invalid' });
  const noCommand = await proposeDraft(db.app, by, { command: 'books.anything', payload, basedOn: [] }).catch((e: unknown) => e);
  expect(noCommand).toMatchObject({ code: 'invalid', fields: ['command'] });
  const drafts = await withTx(db.app, { kind: 'member', session: s.owner }, (c) => c.query(`select count(*)::int as n from approval.draft where proposed_by = $1`, [s.owner.memberId]));
  expect(drafts.rows[0].n).toBe(0);
});
