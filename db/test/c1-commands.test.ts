// C1: core's direct commands write the books through the guard: amounts re-derived from the books (a caller cannot send
// a total), every journal entry balanced, every row audited under the member who ran it, and a member without the
// command's authority refused with nothing written.
import { CoreError, countStock, placeReorder, recordPayment, recordPurchase, recordSale, recordSettlement, recordWaste, runCommand } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

let db: TestDb;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  s = await smallShop(db.app, 'C1');
  await db.sabotage();
});
afterAll(() => db.close());

const q = async (sql: string, params: unknown[] = []) => (await tx(db.app, { tenant: s.owner.tenantId }, (c) => c.query(sql, params))).rows;
const onHand = async (item: string) => Number((await q('select coalesce(sum(qty_milli), 0) as n from books.stock_move where item_id = $1', [item]))[0].n);
const unbalanced = () =>
  q(`select entry_id from books.journal_line group by entry_id, currency having sum(amount_minor) <> 0`);
const audited = async (table: string, id: string) =>
  q('select actor_id, command, decision_id from audit.audit_log where entity = $1 and entity_id = $2', [table, id]);

it('C1 a counter sale is priced from the books, takes the rest as credit, balances and is audited under the seller', async () => {
  const before = await onHand(s.biscuits);
  // 3 packs at ₹10 + 1.5 packs of butter at ₹62 (₹93): ₹123, of which ₹100 by UPI and ₹23 on credit.
  const r = (await recordSale(db.app, s.staff, {
    shopId: s.shopId,
    customerId: s.customer,
    lines: [
      { itemId: s.biscuits, qtyMilli: 3000 },
      { itemId: s.butter, qtyMilli: 1500 },
    ],
    payments: [{ method: 'upi', amountMinor: 10_000 }],
  })) as { saleId: string; totalMinor: number; creditMinor: number };
  expect(r).toMatchObject({ totalMinor: 12_300, creditMinor: 2_300 });
  const [sale] = await q('select total_minor, created_by from books.sale where id = $1', [r.saleId]);
  expect(sale).toEqual({ total_minor: '12300', created_by: s.staff.memberId });
  expect(await onHand(s.biscuits)).toBe(before - 3000);
  const [credit] = await q('select amount_minor, due_on::text as due_on from books.credit_entry where sale_id = $1', [r.saleId]);
  expect(credit?.amount_minor).toBe('2300');
  const lines = await q(
    `select l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.id = l.entry_id
      where e.source_id = $1 order by l.account`,
    [r.saleId],
  );
  expect(lines).toEqual([
    { account: 'receivable', amount: 2300 },
    { account: 'sales', amount: -12300 },
    { account: 'upi_clearing', amount: 10000 },
  ]);
  expect(await unbalanced()).toEqual([]);
  expect(await audited('books.sale', r.saleId)).toEqual([{ actor_id: s.staff.memberId, command: 'sale.record', decision_id: null }]);
});

it('C1 a sale paying more than the books price is refused, and an unpaid rest needs a customer', async () => {
  const over = await recordSale(db.app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1100 }] }).catch((e) => e);
  expect(over).toBeInstanceOf(CoreError);
  expect(over).toMatchObject({ code: 'invalid', fields: ['payments'] });
  const unpaid = await recordSale(db.app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }], payments: [] }).catch((e) => e);
  expect(unpaid).toMatchObject({ code: 'invalid', fields: ['customerId'] });
});

it('C1 a purchase from a bill stocks its lines with expiry and posts inventory against payable', async () => {
  const before = await onHand(s.butter);
  const r = (await recordPurchase(db.app, s.manager, {
    supplierId: s.supplier,
    billNo: 'GT-C1',
    billDate: '2026-10-20',
    lines: [{ itemId: s.butter, qtyMilli: 6000, unitCostMinor: 5650, expiresOn: '2027-04-30' }],
  })) as { purchaseId: string; totalMinor: number };
  expect(r.totalMinor).toBe(33_900);
  expect(await onHand(s.butter)).toBe(before + 6000);
  const moves = await q('select expires_on::text as expires_on from books.stock_move where source_id = $1', [r.purchaseId]);
  expect(moves).toEqual([{ expires_on: '2027-04-30' }]);
  const lines = await q(
    `select l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.id = l.entry_id
      where e.source_id = $1 order by l.account`,
    [r.purchaseId],
  );
  expect(lines).toEqual([
    { account: 'inventory', amount: 33900 },
    { account: 'payable', amount: -33900 },
  ]);
});

it('C1 a stock count writes the difference from the books as one adjustment, and nothing when it agrees', async () => {
  const books = await onHand(s.biscuits);
  const short = (await countStock(db.app, s.manager, { itemId: s.biscuits, countedQtyMilli: books - 2000 })) as { adjustedQtyMilli: number; moveId: string };
  expect(short.adjustedQtyMilli).toBe(-2000);
  expect(await onHand(s.biscuits)).toBe(books - 2000);
  const exact = (await countStock(db.app, s.manager, { itemId: s.biscuits, countedQtyMilli: books - 2000 })) as { adjustedQtyMilli: number; moveId: null };
  expect(exact).toMatchObject({ adjustedQtyMilli: 0, moveId: null });
});

it('C1 waste, a credit repayment and a settlement write their rows and balanced entries', async () => {
  const books = await onHand(s.butter);
  await recordWaste(db.app, s.staff, { itemId: s.butter, qtyMilli: 1000 });
  expect(await onHand(s.butter)).toBe(books - 1000);
  const pay = (await recordPayment(db.app, s.staff, { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: 2000 })) as { paymentId: string };
  const [repaid] = await q('select amount_minor from books.credit_entry where payment_id = $1', [pay.paymentId]);
  expect(repaid?.amount_minor).toBe('-2000');
  await recordPayment(db.app, s.owner, { direction: 'out', supplierId: s.supplier, method: 'bank', amountMinor: 33_900, reference: 'NEFT (recorded)' });
  await recordSettlement(db.app, s.owner, { channel: 'upi', businessDate: '2026-10-26', amountMinor: 10_000, receivedOn: '2026-10-27' });
  await runCommand(db.app, s.owner, 'credit.record', { customerId: s.customer, amountMinor: 5000 });
  expect(await unbalanced()).toEqual([]);
});

it('C1 a reorder is a message to the simulated supplier, its text composed from the books', async () => {
  const r = (await placeReorder(db.app, s.owner, { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: 48_000 }] })) as { messageId: string };
  const [m] = await q('select recipient_kind, recipient_id, body from books.outbound_message where id = $1', [r.messageId]);
  expect(m).toEqual({ recipient_kind: 'supplier', recipient_id: s.supplier, body: 'Reorder from C1 General Store (synthetic): 48 × Glucose biscuits 70 g.' });
});

it('C1 a member without the authority is refused, and nothing is written', async () => {
  const before = (await q('select count(*)::int as n from books.purchase'))[0].n;
  const err = await recordPurchase(db.app, s.staff, {
    supplierId: s.supplier,
    billNo: 'GT-STAFF',
    billDate: '2026-10-21',
    lines: [{ itemId: s.butter, qtyMilli: 1000, unitCostMinor: 5600 }],
  }).catch((e) => e);
  expect(err).toBeInstanceOf(CoreError);
  expect(err).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect((await q('select count(*)::int as n from books.purchase'))[0].n).toBe(before);
});
