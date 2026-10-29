// REV1, core's half: one *.reverse per book of trade (purchase, stock, credit, payment, settlement), each the person's own
// audited command. Which rows a record wrote is read independently of the command's own link-following: every row of
// every reversible table (ref.book_table) stamped with the original's transaction. Each must have exactly one reversal,
// in the reversal's transaction and nothing else there, every signed column negated, a child under the reversal of its
// header, the journal netting to zero per account. A second reversal is a conflict; a reverse undoes only what its own
// record command wrote, an approved draft's included; who may run it is ref.command_authority's; a replayed key writes
// nothing.
import { randomUUID } from 'node:crypto';
import { CoreError, decide, mintSnapshot, proposeDraft, recordSale, runCommand, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
let reversible: { rel: string; parent_rel: string | null; parent_col: string | null; signed_cols: string[] }[];
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'REV1');
  reversible = await q('select rel, parent_rel, parent_col, signed_cols from ref.book_table where reversible order by rel');
  await db.sabotage();
});
afterAll(() => db.close());

type Row = Record<string, unknown> & { id: string; reverses_id: string | null };
const q = async (sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, params))).rows;
const run = async (who: Session, name: string, input: unknown, key?: string) => (await runCommand(app, who, name, input, key)) as Record<string, string>;
const fails = (p: Promise<unknown>) => p.then(
  () => undefined,
  (e: unknown) => e,
);
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const onHand = async (item: string) => Number((await q('select coalesce(sum(qty_milli), 0) as n from books.stock_move where item_id = $1', [item]))[0].n);
const balance = async () => Number((await q('select coalesce(sum(amount_minor), 0) as n from books.credit_entry where customer_id = $1', [s.customer]))[0].n);
const reversals = async () =>
  Number(
    (
      await q(`select (select count(*) from books.purchase where reverses_id is not null) + (select count(*) from books.stock_move where reverses_id is not null)
                    + (select count(*) from books.credit_entry where reverses_id is not null) + (select count(*) from books.payment where reverses_id is not null)
                    + (select count(*) from books.settlement where reverses_id is not null) + (select count(*) from books.journal_entry where reverses_id is not null) as n`)
    )[0].n,
  );

// Every row of every reversible books table written in the transaction that wrote `id` in `rel`, by table.
async function writeSet(rel: string, id: string): Promise<Map<string, Row[]>> {
  const [{ txid }] = await q(`select created_txid as txid from ${rel} where id = $1`, [id]);
  const set = new Map<string, Row[]>();
  for (const t of reversible) {
    const rows = (await q(`select to_jsonb(t) as r from ${t.rel} t where created_txid = $1 order by id`, [txid])).map((x) => x.r as Row);
    if (rows.length) set.set(t.rel, rows);
  }
  return set;
}

// The reversal of the record that wrote `originalId` (in `rel`) is the reversal transaction's whole write set, row for
// row, and nets to zero. `expected` is what the record wrote, counted from its input, never from the code under test.
async function expectReversed(rel: string, originalId: string, reversalId: string, expected: Record<string, number>, by: Session, command: string) {
  const o = await writeSet(rel, originalId);
  const r = await writeSet(rel, reversalId);
  const counts = (m: Map<string, Row[]>) => Object.fromEntries([...m].map(([t, rows]) => [t, rows.length]));
  expect(counts(o)).toEqual(expected);
  expect(counts(r)).toEqual(expected);
  for (const t of reversible.filter((x) => o.has(x.rel))) {
    const orig = o.get(t.rel) as Row[];
    const rev = r.get(t.rel) as Row[];
    expect(orig.every((x) => x.reverses_id === null)).toBe(true);
    // each original reversed by exactly one row of the reversal's transaction
    expect(rev.map((x) => x.reverses_id).sort()).toEqual(orig.map((x) => x.id).sort());
    for (const x of rev) {
      const y = orig.find((z) => z.id === x.reverses_id) as Row;
      for (const col of t.signed_cols) expect([t.rel, col, Number(x[col])]).toEqual([t.rel, col, -Number(y[col])]);
      expect(x.reason).toEqual(expect.any(String));
      // a reversing child sits under the reversal of its original's header (check_reversal's rule, held here as well)
      if (t.parent_rel && t.parent_col) {
        const header = (r.get(t.parent_rel) as Row[]).find((h) => h.reverses_id === y[t.parent_col as string]);
        expect(x[t.parent_col]).toBe(header?.id);
      }
    }
    for (const col of t.signed_cols) expect([t.rel, col, [...orig, ...rev].reduce((a, x) => a + Number(x[col]), 0)]).toEqual([t.rel, col, 0]);
  }
  const lines = [...(o.get('books.journal_line') ?? []), ...(r.get('books.journal_line') ?? [])];
  const byAccount = new Map<string, number>();
  for (const l of lines) byAccount.set(l.account as string, (byAccount.get(l.account as string) ?? 0) + Number(l.amount_minor));
  expect([...byAccount.values()].filter((n) => n !== 0)).toEqual([]);
  // audited under the person who ran it, as their own command
  const ids = [...r.values()].flat().map((x) => x.id);
  const audit = await q('select actor_id, command, decision_id from audit.audit_log where entity_id = any($1::uuid[])', [ids]);
  expect(audit.length).toBe(ids.length);
  expect(new Set(audit.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ actor_id: by.memberId, command, decision_id: null })]));
}

it('REV1 purchase.reverse negates the bill, its lines, the stock it brought in and its journal, once each, netting to zero', async () => {
  const [biscuits, butter] = [await onHand(s.biscuits), await onHand(s.butter)];
  const p = await run(s.manager, 'purchase.record', {
    supplierId: s.supplier,
    billNo: 'GT-R1',
    billDate: day(2),
    lines: [
      { itemId: s.biscuits, qtyMilli: 24_000, unitCostMinor: 855, expiresOn: '2027-05-31' },
      { itemId: s.butter, qtyMilli: 1_500, unitCostMinor: 5_601 },
    ],
  });
  const r = await run(s.owner, 'purchase.reverse', { purchaseId: p.purchaseId, reason: 'entered_in_error' });
  expect(r).toEqual({ reversalId: expect.any(String) }); // ids only
  await expectReversed(
    'books.purchase',
    p.purchaseId as string,
    r.reversalId as string,
    { 'books.purchase': 1, 'books.purchase_line': 2, 'books.stock_move': 2, 'books.journal_entry': 1, 'books.journal_line': 2 },
    s.owner,
    'purchase.reverse',
  );
  expect([await onHand(s.biscuits), await onHand(s.butter)]).toEqual([biscuits, butter]);
  // the bill is no longer live, so it can be entered again as it should have been
  expect(await run(s.manager, 'purchase.record', { supplierId: s.supplier, billNo: 'GT-R1', billDate: day(2), lines: [{ itemId: s.biscuits, qtyMilli: 12_000, unitCostMinor: 855 }] })).toEqual({
    purchaseId: expect.any(String),
  });
  const [chain] = await q('select audit.verify_chain($1) as broken', [s.owner.tenantId]);
  expect(chain).toEqual({ broken: null });
});

it('REV1 stock.reverse negates a write-off or a count adjustment, once each', async () => {
  const before = await onHand(s.butter);
  const waste = await run(s.staff, 'stock.waste', { itemId: s.butter, qtyMilli: 2_000 });
  const count = await run(s.manager, 'stock.count', { itemId: s.butter, countedQtyMilli: before + 3_000 });
  const ws = await run(s.manager, 'stock.reverse', { moveId: waste.moveId, reason: 'wrong_figure' });
  const cs = await run(s.owner, 'stock.reverse', { moveId: count.moveId, reason: 'wrong_figure' });
  await expectReversed('books.stock_move', waste.moveId as string, ws.reversalId as string, { 'books.stock_move': 1 }, s.manager, 'stock.reverse');
  await expectReversed('books.stock_move', count.moveId as string, cs.reversalId as string, { 'books.stock_move': 1 }, s.owner, 'stock.reverse');
  expect(await onHand(s.butter)).toBe(before);
});

it('REV1 payment.reverse negates a repayment, the credit it repaid and its journal, and a supplier payment with its journal', async () => {
  const owed = await balance();
  const repaid = await run(s.staff, 'payment.record', { direction: 'in', customerId: s.customer, method: 'upi', amountMinor: 4_000 });
  const paidOut = await run(s.manager, 'payment.record', { direction: 'out', supplierId: s.supplier, method: 'bank', amountMinor: 30_000, reference: 'NEFT-1' });
  const ri = await run(s.owner, 'payment.reverse', { paymentId: repaid.paymentId, reason: 'duplicate' });
  const ro = await run(s.owner, 'payment.reverse', { paymentId: paidOut.paymentId, reason: 'wrong_figure' });
  await expectReversed(
    'books.payment',
    repaid.paymentId as string,
    ri.reversalId as string,
    { 'books.payment': 1, 'books.credit_entry': 1, 'books.journal_entry': 1, 'books.journal_line': 2 },
    s.owner,
    'payment.reverse',
  );
  await expectReversed(
    'books.payment',
    paidOut.paymentId as string,
    ro.reversalId as string,
    { 'books.payment': 1, 'books.journal_entry': 1, 'books.journal_line': 2 },
    s.owner,
    'payment.reverse',
  );
  expect(await balance()).toBe(owed);
});

it('REV1 credit.reverse negates credit given and its journal, once', async () => {
  const owed = await balance();
  const given = await run(s.manager, 'credit.record', { customerId: s.customer, amountMinor: 15_000, dueOn: day(-10) });
  const r = await run(s.owner, 'credit.reverse', { creditId: given.creditId, reason: 'wrong_figure' });
  await expectReversed('books.credit_entry', given.creditId as string, r.reversalId as string, { 'books.credit_entry': 1, 'books.journal_entry': 1, 'books.journal_line': 2 }, s.owner, 'credit.reverse');
  expect(await balance()).toBe(owed);
});

it("REV1 settlement.reverse negates a payout and its journal, once; the day's settlement may then be recorded again", async () => {
  const payout = { channel: 'upi', businessDate: day(1), amountMinor: 52_000, reference: 'UTR-77', receivedOn: day(0) };
  const first = await run(s.manager, 'settlement.record', payout);
  const r = await run(s.owner, 'settlement.reverse', { settlementId: first.settlementId, reason: 'wrong_figure' });
  await expectReversed('books.settlement', first.settlementId as string, r.reversalId as string, { 'books.settlement': 1, 'books.journal_entry': 1, 'books.journal_line': 2 }, s.owner, 'settlement.reverse');
  expect(await run(s.manager, 'settlement.record', { ...payout, amountMinor: 25_000 })).toEqual({ settlementId: expect.any(String) });
});

it('REV1 a second reversal of an original is a conflict and writes nothing; two at once record one', async () => {
  const given = await run(s.owner, 'credit.record', { customerId: s.customer, amountMinor: 7_000 });
  await run(s.owner, 'credit.reverse', { creditId: given.creditId, reason: 'duplicate' });
  const before = await reversals();
  const again = await fails(run(s.owner, 'credit.reverse', { creditId: given.creditId, reason: 'duplicate' }));
  expect(again).toBeInstanceOf(CoreError);
  expect(again).toMatchObject({ code: 'conflict', fields: ['creditId'] });
  expect(await reversals()).toBe(before);

  // A double tap: both pass the check, one meets the other's row at the unique reverses_id index.
  const other = await run(s.owner, 'credit.record', { customerId: s.customer, amountMinor: 3_000 });
  const tapped = await Promise.allSettled([1, 2].map(() => run(s.owner, 'credit.reverse', { creditId: other.creditId, reason: 'duplicate' })));
  expect(tapped.map((t) => t.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((tapped.find((t) => t.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
  expect(await reversals()).toBe(before + 2); // the credit entry and its journal entry, once
  const [net] = await q('select sum(amount_minor)::int as n, count(*)::int as rows from books.credit_entry where id = $1 or reverses_id = $1', [other.creditId]);
  expect(net).toEqual({ n: 0, rows: 2 });
});

it('REV1 a reversal needs a reason allowed for the reversal use, and a reversal is never itself reversed', async () => {
  const payout = await run(s.owner, 'settlement.record', { channel: 'card', businessDate: day(3), amountMinor: 9_900, receivedOn: day(2) });
  const before = await reversals();
  // not_now is a ref.reason code, allowed for a decision but not for a reversal: the row's key to ref.reason_use refuses it
  for (const reason of ['not_now', 'no_such_reason']) {
    expect(await fails(run(s.owner, 'settlement.reverse', { settlementId: payout.settlementId, reason }))).toMatchObject({ code: 'invalid', sqlstate: '23503' });
  }
  expect(await fails(run(s.owner, 'settlement.reverse', { settlementId: payout.settlementId, reason: 'Wrong figure' }))).toMatchObject({ code: 'invalid', fields: ['reason'] });
  expect(await reversals()).toBe(before);
  const r = await run(s.owner, 'settlement.reverse', { settlementId: payout.settlementId, reason: 'other' });
  expect(await fails(run(s.owner, 'settlement.reverse', { settlementId: r.reversalId, reason: 'other' }))).toMatchObject({ code: 'invalid', fields: ['settlementId'] });
  expect(await reversals()).toBe(before + 2);
});

it("REV1 a reverse undoes only what its own record command wrote: a sale's stock move, tender and credit, and a repayment's credit, are not",
  async () => {
    const sale = (await recordSale(app, s.staff, {
      shopId: s.shopId,
      customerId: s.customer,
      lines: [{ itemId: s.biscuits, qtyMilli: 2_000 }],
      payments: [{ method: 'upi', amountMinor: 1_000 }],
    })) as { saleId: string };
    const [move] = await q('select id from books.stock_move where source_id = $1', [sale.saleId]);
    const [tender] = await q('select id from books.payment where sale_id = $1', [sale.saleId]);
    const [owed] = await q('select id from books.credit_entry where sale_id = $1', [sale.saleId]);
    const [bought] = await q(
      `select m.id from books.stock_move m where m.source_rel = 'books.purchase' and m.reverses_id is null
          and not exists (select 1 from books.stock_move x where x.reverses_id = m.id) limit 1`,
    );
    const repaid = await run(s.owner, 'payment.record', { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: 500 });
    const [repaidCredit] = await q('select id from books.credit_entry where payment_id = $1', [repaid.paymentId]);
    // each a real row, so the refusal is the command's and not the input schema's
    const found = [move, bought, tender, owed, repaidCredit].map((r) => r?.id as string);
    expect(found.filter((x) => /^[0-9a-f-]{36}$/.test(x ?? '')).length).toBe(5);
    const before = await reversals();
    const attempts: [string, Record<string, string>][] = [
      ['stock.reverse', { moveId: found[0] as string }],
      ['stock.reverse', { moveId: found[1] as string }],
      ['payment.reverse', { paymentId: found[2] as string }],
      ['credit.reverse', { creditId: found[3] as string }],
      ['credit.reverse', { creditId: found[4] as string }],
    ];
    const outcomes = [];
    for (const [command, input] of attempts) {
      const e = await fails(run(s.owner, command, { ...input, reason: 'entered_in_error' }));
      outcomes.push([command, e instanceof CoreError ? `${e.code}:${e.fields}` : 'reversed']);
    }
    expect(outcomes).toEqual(attempts.map(([command, input]) => [command, `invalid:${Object.keys(input)[0]}`]));
    expect(await reversals()).toBe(before);
  },
);

// BLUEPRINT §2.4 and 15_trade_journal.sql: money is reversed by the owner alone; stock by the owner or a manager; staff,
// who record sales, payments and write-offs, reverse nothing.
const MAY_REVERSE: Record<string, string[]> = {
  'purchase.reverse': ['owner'],
  'stock.reverse': ['owner', 'manager'],
  'credit.reverse': ['owner'],
  'payment.reverse': ['owner'],
  'settlement.reverse': ['owner'],
};

it('REV1 who may reverse is ref.command_authority: the owner every book, a manager stock only, staff nothing; a refusal writes nothing', async () => {
  let n = 10;
  const originals: Record<string, () => Promise<Record<string, string>>> = {
    'purchase.reverse': async () => ({ purchaseId: (await run(s.owner, 'purchase.record', { supplierId: s.supplier, billNo: `GT-A${n++}`, billDate: day(1), lines: [{ itemId: s.butter, qtyMilli: 1_000, unitCostMinor: 5_600 }] })).purchaseId as string }),
    'stock.reverse': async () => ({ moveId: (await run(s.owner, 'stock.waste', { itemId: s.biscuits, qtyMilli: 1_000 })).moveId as string }),
    'credit.reverse': async () => ({ creditId: (await run(s.owner, 'credit.record', { customerId: s.customer, amountMinor: 1_000 })).creditId as string }),
    'payment.reverse': async () => ({ paymentId: (await run(s.owner, 'payment.record', { direction: 'out', supplierId: s.supplier, method: 'cash', amountMinor: 1_000 })).paymentId as string }),
    'settlement.reverse': async () => ({ settlementId: (await run(s.owner, 'settlement.record', { channel: 'card', businessDate: day(n++), amountMinor: 1_000, receivedOn: day(0) })).settlementId as string }),
  };
  const members: Record<string, Session> = { owner: s.owner, manager: s.manager, staff: s.staff };
  // the reversal rows each writes among those reversals() counts: a purchase's header, its line's stock move and its
  // journal entry; a stock move alone; any other book's row and its journal entry
  const WRITES: Record<string, number> = { 'purchase.reverse': 3, 'stock.reverse': 1, 'credit.reverse': 2, 'payment.reverse': 2, 'settlement.reverse': 2 };
  const seen: string[] = [];
  for (const [command, make] of Object.entries(originals)) {
    for (const [role, who] of Object.entries(members)) {
      const input = { ...(await make()), reason: 'entered_in_error' };
      const before = await reversals();
      const outcome = await run(who, command, input).then(
        () => 'reversed',
        (e: CoreError) => e.code,
      );
      expect([command, role, outcome]).toEqual([command, role, MAY_REVERSE[command]?.includes(role) ? 'reversed' : 'refused']);
      expect(await reversals()).toBe(before + (outcome === 'reversed' ? (WRITES[command] as number) : 0));
      seen.push(`${command}:${role}`);
    }
  }
  expect(seen.length).toBe(15);
});

it('IDEM1 a replayed reverse returns the first reversal and writes nothing', async () => {
  const payout = await run(s.owner, 'settlement.record', { channel: 'upi', businessDate: day(20), amountMinor: 11_000, receivedOn: day(19) });
  const first = await runCommand(app, s.owner, 'settlement.reverse', { settlementId: payout.settlementId, reason: 'duplicate' }, 'reverse-tap-0001');
  const after = await reversals();
  expect(await runCommand(app, s.owner, 'settlement.reverse', { settlementId: payout.settlementId, reason: 'duplicate' }, 'reverse-tap-0001')).toEqual(first);
  expect(await reversals()).toBe(after);
  const [net] = await q('select count(*)::int as rows, sum(amount_minor)::int as n from books.settlement where id = $1 or reverses_id = $1', [payout.settlementId]);
  expect(net).toEqual({ rows: 2, n: 0 });
});

// The evidence-backed books (a drafted count or bill, a watcher's write-off) are rows an approved draft wrote: their audit
// entry names the draft's command, so the same reverse undoes them, as the reverser's own command.
it("REV1 an approved draft's row is reversed by a person's own command: the reversal is theirs, the original keeps its decision", async () => {
  const runId = randomUUID();
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'question', 'stock')`, [s.owner.tenantId, runId]),
  );
  const held = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'stock.on_hand', { item_id: s.butter }, runId);
  const ref = { snapshotId: held.id, row: 0, col: 'on_hand' };
  const qty = Number((held.rows[0]?.on_hand as { num?: string } | undefined)?.num);
  expect(qty).toBeGreaterThan(0);
  const draftId = await proposeDraft(
    app,
    { session: s.owner, runId },
    { command: 'stock.waste', payload: { itemId: s.butter, qtyMilli: qty }, basedOn: [ref], payloadRefs: { qtyMilli: ref } },
  );
  const d = await decide(app, s.owner, draftId, 'approved');
  if (d.status !== 'executed') throw new Error(`draft ${d.status}`);
  const moveId = d.result.moveId as string;
  expect(await onHand(s.butter)).toBe(0);
  const r = await run(s.manager, 'stock.reverse', { moveId, reason: 'wrong_figure' });
  await expectReversed('books.stock_move', moveId, r.reversalId as string, { 'books.stock_move': 1 }, s.manager, 'stock.reverse');
  expect(await q('select actor_id, command, decision_id from audit.audit_log where entity_id = $1', [moveId])).toEqual([
    { actor_id: s.owner.memberId, command: 'stock.waste', decision_id: d.decisionId },
  ]);
  expect(await onHand(s.butter)).toBe(qty);
});
