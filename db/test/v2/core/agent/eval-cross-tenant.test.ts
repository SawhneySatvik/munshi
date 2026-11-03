// The cross-tenant suite over the real database: a ref to another shop's snapshot cell resolves to nothing
// under this shop's RLS, so an answer citing one is "Cannot verify"; copy or a reply carrying one is refused by core
// (K3); and an order draft citing another shop's price or quantity cell is refused (ORD4). The pure half (the renderer
// and the copy writer's refs) is packages/agent/test/cross-tenant. Red-proofs: test/v2/sabotage/agent-chat-and-evals.ts.
import { type CellRef, CANNOT_VERIFY, formatRef, intakeWhatsapp, mintSnapshot, writeReply } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkAnswer, renderReply } from '../../../../../packages/agent/src/answer.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { refused } from '../../gates/lib.ts';
import { asPublic, inbound, type OrderShop, orderShop } from '../orders/lib.ts';
import { inboxRun } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let a: OrderShop;
let b: OrderShop;
let foreign: { price: CellRef; balance: CellRef };

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  a = await orderShop(app, 'Cross A');
  b = await orderShop(app, 'Cross B');
  // Shop B's own cells: its tea's price in effect and a customer's balance.
  const price = await mintSnapshot(app, { kind: 'member', session: b.owner }, 'items.price', { item_id: b.tea });
  const balance = await mintSnapshot(app, { kind: 'member', session: b.owner }, 'credit.balance', { customer_id: b.customer });
  foreign = { price: { snapshotId: price.id, row: 0, col: 'price' }, balance: { snapshotId: balance.id, row: 0, col: 'balance' } };
  await db.sabotage();
}, 120_000);
afterAll(() => db?.close());

it('a ref to another shop’s snapshot resolves to nothing under this shop’s RLS, so an answer citing it is “Cannot verify”', async () => {
  const { port } = await inboxRun(db, a.owner);
  expect(await port.resolve(foreign.price)).toBeNull();
  // Even admitted to the run's scope by mistake, the cell is not this shop's: the validator reports it, and the reply
  // renders as "Cannot verify", never the other shop's figure.
  const checked = await checkAnswer({ segments: [{ text: 'Chai ⟦1⟧ ki hai.', refs: [foreign.price] }] }, new Map([[foreign.price.snapshotId, null]]), (r) => port.resolve(r));
  expect(checked).toEqual({ ok: false, failures: [{ segment: 0, rule: 'unresolved', ref: 0 }] });
  const [shown] = renderReply({ kind: 'abstain', specialist: null, missing: ['unresolved'] });
  expect(shown?.startsWith(`${CANNOT_VERIFY}:`)).toBe(true);
  // Shop B, asking about its own cell, sees it.
  const own = await inboxRun(db, b.owner);
  expect(await own.port.resolve(foreign.price)).toMatchObject({ kind: 'money' });
});

it('copy or a reply whose ref token names another shop’s cell is refused by core, and stores no words', async () => {
  const run = await inboxRun(db, a.owner);
  const body = `Aapka baaki ${formatRef(foreign.balance)} hai.`;
  expect(await refused(run.port.writeReply(body))).toMatchObject({ code: 'invalid' });
  expect(await refused(writeReply(app, { session: a.owner }, body))).toMatchObject({ code: 'invalid' });
  expect((await db.admin.query('select count(*)::int as n from ops.message_text where tenant_id = $1 and body like $2', [a.tenantId, '%snap:%'])).rows).toEqual([{ n: 0 }]);
});

it('an order draft citing another shop’s price cell, or another shop’s quantity cell, is refused', async () => {
  const messageId = await inbound(db, a.tenantId, 'text', '2 Assam tea 250 g');
  const { requestId } = await asPublic(db, a.tenantId, (c) => intakeWhatsapp(c, { shopId: a.shopId, inboundMessageId: messageId }));
  const run = await inboxRun(db, a.manager);
  const [qty] = await run.port.recordExtracts(messageId, [{ field: 'quantity', start: 0, end: 1 }]);
  const [item] = await run.port.recordExtracts(messageId, [{ field: 'item', start: 2, end: 17 }]);
  expect(item).toEqual({ extractId: expect.any(String), itemId: a.tea });
  expect(qty).toEqual({ extractId: expect.any(String) });
  const read = await run.port.read('order.extracts', { message_id: messageId, run_id: run.runId });
  const own = await run.port.read('items.price', { item_id: a.tea });
  const quantity: CellRef = { snapshotId: read.snapshotId, row: 0, col: 'qty' };
  const draft = (price: CellRef, q: CellRef = quantity) =>
    run.port.propose({
      command: 'order.confirm',
      payload: { requestId, customerId: a.customer, lines: [{ itemId: a.tea, qtyMilli: 2000 }] },
      basedOn: [q, price],
      payloadRefs: { 'lines[0].qtyMilli': q },
    });
  expect(await refused(draft(foreign.price))).toMatchObject({ code: 'invalid' });
  // Shop B's quantity cell, read over B's own message.
  const bMessage = await inbound(db, b.tenantId, 'text', '2 Assam tea 250 g');
  const bRun = await inboxRun(db, b.manager);
  await bRun.port.recordExtracts(bMessage, [{ field: 'quantity', start: 0, end: 1 }]);
  await bRun.port.recordExtracts(bMessage, [{ field: 'item', start: 2, end: 17 }]);
  const bRead = await bRun.port.read('order.extracts', { message_id: bMessage, run_id: bRun.runId });
  expect(await refused(draft({ snapshotId: own.snapshotId, row: 0, col: 'price' }, { snapshotId: bRead.snapshotId, row: 0, col: 'qty' }))).toMatchObject({ code: 'invalid' });
  // With this shop's own cells the same draft is proposed.
  expect(await draft({ snapshotId: own.snapshotId, row: 0, col: 'price' })).toEqual(expect.any(String));
});
