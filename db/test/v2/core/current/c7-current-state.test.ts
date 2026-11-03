// C7: two core rules. A stock-reducing command (a write-off, a count below the
// books) cannot take on-hand below zero at execution, and a count waits for a stock move of its item in flight; and an
// undated per-customer read, credit.balance(customer_id), lets a credit or payment draft cite the customer's current
// state, so it goes stale when that moves. Expected values are worked out from the shop's rows.
import { command, decide, execute, mintSnapshot, parseInput, proposeDraft, recordSale, recordWaste, runCommand } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const onHand = async (item: string) => Number((await db.admin.query('select coalesce(sum(qty_milli), 0) as n from books.stock_move where item_id = $1', [item])).rows[0].n);
const BELOW = (field: string) => ({ code: 'invalid', fields: [field] });

it('a write-off cannot take on-hand below zero', async () => {
  const s = await smallShop(app, 'C7-waste');
  expect(await onHand(s.biscuits)).toBe(48_000);
  expect(await recordWaste(app, s.staff, { itemId: s.biscuits, qtyMilli: 50_000 }).catch((e: unknown) => e)).toMatchObject(BELOW('qtyMilli'));
  expect(await onHand(s.biscuits)).toBe(48_000);
  await recordWaste(app, s.staff, { itemId: s.biscuits, qtyMilli: 48_000 }); // down to zero is allowed
  expect(await onHand(s.biscuits)).toBe(0);
});

it('a count in the past cannot take on-hand below zero once the moves after it are added', async () => {
  const s = await smallShop(app, 'C7-count');
  const before = new Date(Date.now() - 3_600_000).toISOString(); // after the bill (a day ago), before the sale below
  await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 30_000 }], payments: [{ method: 'cash', amountMinor: 30_000 }] });
  expect(await onHand(s.biscuits)).toBe(18_000);
  // 5 counted an hour ago: 5 − 30 sold since = −25.
  const low = await runCommand(app, s.owner, 'stock.count', { itemId: s.biscuits, countedQtyMilli: 5000, countedAt: before }).catch((e: unknown) => e);
  expect(low).toMatchObject(BELOW('countedQtyMilli'));
  expect(await onHand(s.biscuits)).toBe(18_000);
  await runCommand(app, s.owner, 'stock.count', { itemId: s.biscuits, countedQtyMilli: 40_000, countedAt: before }); // 40 − 30 = 10
  expect(await onHand(s.biscuits)).toBe(10_000);
});

it('a count waits for a write-off in flight, so it never states books that have just changed', async () => {
  const s = await smallShop(app, 'C7-race');
  // A write-off of 30 is executed and held open (as decide or runCommand holds it before its commit)...
  const first = await app.connect();
  try {
    await first.query('begin');
    await first.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'stock.waste', true)`, [
      s.owner.tenantId,
      s.staff.memberId,
    ]);
    const waste = command('stock.waste');
    await execute(first, waste, parseInput(waste, { itemId: s.biscuits, qtyMilli: 30_000 }));
    // ...while a count that saw the books at 48 starts: it waits for the write-off, then finds 18 and is refused.
    let settled = false;
    const count = runCommand(app, s.owner, 'stock.count', { itemId: s.biscuits, countedQtyMilli: 40_000, expectedQtyMilli: 48_000 })
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    await first.query('commit');
    expect(await count).toMatchObject({ code: 'conflict', fields: ['expectedQtyMilli'] });
  } finally {
    first.release();
  }
  expect(await onHand(s.biscuits)).toBe(18_000);
});

it("a credit draft cites the customer's current balance from credit.balance, and goes stale when it moves", async () => {
  const s: Shop = await smallShop(app, 'C7-credit');
  const sell = (packs: number) =>
    recordSale(app, s.staff, { shopId: s.shopId, customerId: s.customer, lines: [{ itemId: s.biscuits, qtyMilli: packs * 1000 }], payments: [] });
  await sell(2); // ₹20 on credit
  const runId = await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, async (c) =>
    (await c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'credit') returning id`, [s.owner.tenantId])).rows[0].id as string,
  );
  const system = { kind: 'member', session: s.owner } as const; // the run's reads, minted as the owner whose run it is
  const balance = await mintSnapshot(app, system, 'credit.balance', { customer_id: s.customer }, runId);
  expect(balance.rows).toEqual([
    { customer_id: { kind: 'text', txt: s.customer }, balance: { kind: 'money', num: '2000', currency: 'INR' } },
  ]);
  const owed = { snapshotId: balance.id, row: 0, col: 'balance' };
  const repay = { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: 2000 };
  // The same ₹20 from a dated read (credit.balances as of a day) is not the current state.
  const dated = await mintSnapshot(app, system, 'credit.balances', { as_of: new Date().toISOString().slice(0, 10) }, runId);
  const datedRef = { snapshotId: dated.id, row: 0, col: 'balance' };
  const propose = (basedOn: (typeof owed)[], ref: typeof owed) =>
    proposeDraft(app, { session: s.owner, runId }, { command: 'payment.record', payload: repay, basedOn, payloadRefs: { amountMinor: ref } }).catch((e: unknown) => e);
  expect(await propose([datedRef], datedRef)).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  const draftId = await propose([owed], owed);
  expect(draftId).toEqual(expect.any(String));
  await sell(1); // the balance moves before the owner looks
  expect(await decide(app, s.owner, draftId as string, 'approved')).toMatchObject({ status: 'stale' });
  // A fresh draft on the current balance executes.
  const now = await mintSnapshot(app, system, 'credit.balance', { customer_id: s.customer }, runId);
  const fresh = { snapshotId: now.id, row: 0, col: 'balance' };
  const repayAll = await proposeDraft(app, { session: s.owner, runId }, { command: 'payment.record', payload: { ...repay, amountMinor: 3000 }, basedOn: [fresh], payloadRefs: { amountMinor: fresh } });
  expect((await decide(app, s.owner, repayAll, 'approved')).status).toBe('executed');
  const after = await mintSnapshot(app, system, 'credit.balance', { customer_id: s.customer }, runId);
  expect(after.rows[0]?.balance).toEqual({ kind: 'money', num: '0', currency: 'INR' });
});
