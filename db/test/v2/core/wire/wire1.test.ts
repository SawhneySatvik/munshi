// The joins between areas. A sale finishes one obligation in its own transaction: an order (ORD3: its
// lines at the promised prices, its advance applied first, the delivered step and the customer's update), a held piece
// (sold) or a confirmed booking (done); its reversal leaves them finished and holds the advance again. payment.record and
// credit.record take an order's advance and its way back. And the capability gaps: an approved draft keeps
// its rows only while its capability is on, a command's parts (udhaar, offers, points, stitching) are checked against
// the input, a new hold needs holds, and an item's kind needs a capability that admits it.
// Red-proofs: test/v2/sabotage/core-wire.ts.
import { randomUUID } from 'node:crypto';
import {
  advanceHeld,
  bookAtDesk,
  decide,
  declineHold,
  holdPiece,
  localTime,
  mintSnapshot,
  proposeDraft,
  runCommand,
  type Session,
  switchCapability,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { ask, type Boutique, boutique } from '../holds/boutique.ts';
import { failure, type OrderShop, orderShop, TEA, teaOrder } from '../orders/lib.ts';
import { monday, type Salon, salon } from '../staff/salon.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let o: OrderShop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  o = await orderShop(app, 'Wire');
  await db.sabotage();
});
afterAll(() => db?.close());

const at = (day: string, hhmm: string) => localTime(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Asia/Kolkata');
const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const run = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string | null>;
const held = (orderId: string) => withTx(app, { kind: 'system', tenantId: o.tenantId }, (c) => advanceHeld(c, orderId));
const unbalanced = (tenantId: string) =>
  q(`select entry_id from books.journal_line where tenant_id = $1 group by entry_id, currency having sum(amount_minor) <> 0`, [tenantId]);
const stepOf = async (orderId: string) => (await q('select step from ops.order_state where order_id = $1', [orderId]))[0]?.step;
const sellTea = (orderId: string, extra: Record<string, unknown> = {}, by: Session = o.staff) =>
  run(by, 'sale.record', { shopId: o.shopId, orderId, lines: [{ itemId: o.tea, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: TEA - 10_000 }], ...extra });

// A tea order the customer paid ₹100 towards, ready for collection; then the tea's price goes up.
async function readyOrder(): Promise<string> {
  const orderId = await teaOrder(app, o);
  await run(o.staff, 'payment.record', { orderId, direction: 'in', method: 'upi', amountMinor: 10_000 });
  await run(o.manager, 'order.step', { orderId, step: 'ready' });
  return orderId;
}

it('a sale naming an order sells its lines at the promised price, applies the advance it holds, and writes the delivered step with the customer’s update', async () => {
  const orderId = await readyOrder();
  expect(await held(orderId)).toBe(10_000);
  await run(o.owner, 'price.set', { itemId: o.tea, amountMinor: 30_000, effectiveFrom: new Date(Date.now() - 1000).toISOString() });
  const r = await sellTea(orderId);
  expect(Object.keys(r).sort()).toEqual(['messageId', 'saleId', 'stepId']);
  const [line] = await q(
    `select l.unit_price_minor::int as unit, l.order_line_id = ol.id as same_line, s.order_id::text as order_id, s.customer_id::text as customer
       from books.sale_line l join books.sale s on s.tenant_id = l.tenant_id and s.id = l.sale_id
       join books.order_line ol on ol.tenant_id = l.tenant_id and ol.order_id = s.order_id
      where l.sale_id = $1`,
    [r.saleId],
  );
  expect(line).toEqual({ unit: TEA, same_line: true, order_id: orderId, customer: o.customer });
  expect(await stepOf(orderId)).toBe('delivered');
  const [update] = await q('select template_code, order_id::text as order_id from books.outbound_message where id = $1', [r.messageId]);
  expect(update).toEqual({ template_code: 'order_delivered', order_id: orderId });
  // The advance went first: the bill's journal debits customer_advance by it, the tender is the rest, nothing is owed.
  const journal = await q(
    `select l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      where e.source_rel = 'books.sale' and e.source_id = $1 and l.account in ('customer_advance', 'cash', 'receivable') order by l.account`,
    [r.saleId],
  );
  expect(journal).toEqual([
    { account: 'cash', amount: TEA - 10_000 },
    { account: 'customer_advance', amount: 10_000 },
  ]);
  expect(await held(orderId)).toBe(0);
  expect(await unbalanced(o.tenantId)).toEqual([]);
});

it('a sale naming an order sells exactly its lines to its customer: another quantity, another customer or a second delivery is refused and writes nothing', async () => {
  const orderId = await readyOrder();
  const before = (await q('select count(*)::int as n from books.sale where tenant_id = $1', [o.tenantId]))[0].n;
  expect(await failure(() => sellTea(orderId, { lines: [{ itemId: o.tea, qtyMilli: 2000 }] }))).toMatchObject({ code: 'invalid', fields: ['lines'] });
  const other = (await run(o.owner, 'customer.create', { name: 'Someone else (synthetic)' })).customerId as string;
  expect(await failure(() => sellTea(orderId, { customerId: other }))).toMatchObject({ code: 'invalid', fields: ['customerId'] });
  expect((await q('select count(*)::int as n from books.sale where tenant_id = $1', [o.tenantId]))[0].n).toBe(before);
  await sellTea(orderId);
  expect(await failure(() => sellTea(orderId))).toMatchObject({ code: 'invalid' });
});

it('a delivery’s reversal leaves the order delivered and holds its advance again, which then goes back as a refund', async () => {
  const orderId = await readyOrder();
  const sale = await sellTea(orderId);
  expect(await held(orderId)).toBe(0);
  await run(o.owner, 'sale.reverse', { saleId: sale.saleId, reason: 'returned_goods' });
  expect(await stepOf(orderId)).toBe('delivered');
  expect(await held(orderId)).toBe(10_000);
  expect(await run(o.owner, 'payment.record', { orderId, direction: 'out', method: 'upi', amountMinor: 10_000 })).toEqual({ paymentId: expect.any(String) });
  expect(await held(orderId)).toBe(0);
  expect(await unbalanced(o.tenantId)).toEqual([]);
});

it('payment.record takes an order’s advance and credit.record keeps what is held as the customer’s credit, as direct commands', async () => {
  const orderId = await teaOrder(app, o);
  const { paymentId } = await run(o.staff, 'payment.record', { orderId, direction: 'in', method: 'cash', amountMinor: 5_000 });
  expect(await held(orderId)).toBe(5_000);
  await run(o.manager, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  expect(await run(o.owner, 'credit.record', { paymentId, amountMinor: 5_000 })).toEqual({ creditId: expect.any(String) });
  expect(await held(orderId)).toBe(0);
  const [credit] = await q('select amount_minor::int as n, customer_id::text as c from books.credit_entry where payment_id = $1', [paymentId]);
  expect(credit).toEqual({ n: -5_000, c: o.customer });
});

let b: Boutique;
it('a sale naming a held piece marks it sold in the sale’s transaction; a new hold needs holds on, while a decline runs with it off', async () => {
  b = await boutique(app, 'Wire holds');
  const reservationId = await ask(pub, b, b.kurta);
  await holdPiece(app, b.manager, reservationId);
  await runCommand(app, b.staff, 'sale.record', {
    shopId: b.shopId,
    reservationId,
    lines: [{ itemId: b.kurta, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amountMinor: 120_000 }],
  });
  expect((await q('select state from ops.reservation where id = $1', [reservationId]))[0]?.state).toBe('sold');

  const later = await ask(pub, b, b.kurta);
  const declined = await ask(pub, b, b.kurta);
  await switchCapability(app, b.owner, 'holds', false);
  expect(await failure(() => holdPiece(app, b.manager, later))).toMatchObject({ code: 'capability_off', fields: ['holds'] });
  expect((await q('select state from ops.reservation where id = $1', [later]))[0]?.state).toBe('requested');
  await declineHold(app, b.manager, declined, 'not_now');
  expect((await q('select state from ops.reservation where id = $1', [declined]))[0]?.state).toBe('declined');
});

let salonShop: Salon;
it('a sale naming a confirmed booking marks it done; points are earned only while loyalty is on', async () => {
  salonShop = await salon(app, 'Wire salon');
  const s = salonShop;
  const day = monday(2);
  const pattern = await run(s.manager, 'shift.pattern.set', { staffId: s.stylists.asha, shopId: s.shopId, weekday: 1, starts: '09:00', ends: '18:00', effectiveFrom: '2026-03-01' });
  for (const cap of ['loyalty']) await switchCapability(app, s.owner, cap as 'loyalty', true);
  await run(s.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 10, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
  const customer = (await run(s.owner, 'customer.create', { name: 'Regular (synthetic)' })).customerId as string;
  const book = async (hhmm: string) =>
    (
      await bookAtDesk(app, s.manager, {
        shopId: s.shopId,
        staffId: s.stylists.asha,
        serviceItemId: s.serviceId,
        start: at(day, hhmm).toISOString(),
        shiftRel: 'books.shift_pattern',
        shiftId: pattern.patternId as string,
        customerId: customer,
      })
    ).bookingId;
  const sell = (bookingId: string) =>
    run(s.manager, 'sale.record', { shopId: s.shopId, bookingId, customerId: customer, lines: [{ itemId: s.serviceId, qtyMilli: 1000 }], payments: [{ method: 'upi', amountMinor: 40_000 }] });
  const points = async () =>
    Number((await q(`select coalesce(sum(points), 0) as n from books.loyalty_entry where tenant_id = $1 and customer_id = $2`, [s.tenantId, customer]))[0].n);

  const first = await book('10:00');
  await sell(first);
  expect((await q('select state from ops.booking where id = $1', [first]))[0]?.state).toBe('done');
  expect(await points()).toBe(400);
  expect(await failure(() => sell(first))).toMatchObject({ code: 'conflict', fields: ['bookingId'] });

  await switchCapability(app, s.owner, 'loyalty', false);
  await sell(await book('11:00'));
  expect(await points()).toBe(400);
});

it('a sale’s parts are checked against its input: an udhaar rest needs credit, an offer code offers and points loyalty, each refused by name', async () => {
  const shop = await orderShop(app, 'Wire parts');
  await run(shop.owner, 'offer.create', { name: 'Diwali (synthetic)', kind: 'percent_off', percentBp: 1000, scope: 'all', code: 'DIWALI10', endsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const sale = (extra: Record<string, unknown>) =>
    failure(() => run(shop.staff, 'sale.record', { shopId: shop.shopId, customerId: shop.customer, lines: [{ itemId: shop.saree, qtyMilli: 1000 }], payments: [], ...extra }));
  await switchCapability(app, shop.owner, 'credit', false);
  await switchCapability(app, shop.owner, 'offers', false);
  expect(await sale({})).toMatchObject({ code: 'capability_off', fields: ['credit'] });
  expect(await sale({ offerCodes: ['DIWALI10'], payments: [{ method: 'cash', amountMinor: 224_910 }] })).toMatchObject({ code: 'capability_off', fields: ['offers'] });
  expect(await sale({ redeemPoints: 10, payments: [{ method: 'cash', amountMinor: 249_900 }] })).toMatchObject({ code: 'capability_off', fields: ['loyalty'] });
  // Paid in full, with no part in use, the counter still sells.
  expect(await sale({ payments: [{ method: 'cash', amountMinor: 249_900 }] })).toEqual({ saleId: expect.any(String) });
});

let kirana: Shop;
it('a kirana confirms a goods order but not a stitching one, and makes goods but not services', async () => {
  kirana = await smallShop(app, 'Wire kirana');
  const order = (kind: string) =>
    failure(() => run(kirana.manager, 'order.confirm', { shopId: kirana.shopId, customerId: kirana.customer, kind, lines: [{ itemId: kirana.biscuits, qtyMilli: 1000 }] }));
  expect(await order('goods')).toMatchObject({ orderId: expect.any(String) });
  expect(await order('stitching')).toMatchObject({ code: 'capability_off', fields: ['stitching'] });
  expect(await failure(() => run(kirana.owner, 'item.create', { kind: 'service', name: 'Home delivery', durationMin: 30 }))).toMatchObject({ code: 'capability_off', fields: ['kind'] });
  expect(await run(kirana.owner, 'item.create', { name: 'Rusk 200 g', unit: 'pack' })).toEqual({ itemId: expect.any(String) });
});

it('an approved draft keeps its rows only while its capability is on: switched off between proposal and approval, it is refused and the draft stays proposed', async () => {
  const s = await smallShop(app, 'Wire draft');
  const runId = randomUUID();
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'question', 'stock')`, [s.owner.tenantId, runId]),
  );
  const snap = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'stock.on_hand', { item_id: s.biscuits }, runId);
  const ref = { snapshotId: snap.id, row: 0, col: 'on_hand' };
  const qty = Number((snap.rows[0]!.on_hand as { num: string }).num);
  const draftId = await proposeDraft(
    app,
    { session: s.owner, runId },
    { command: 'reorder.place', payload: { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: qty }] }, basedOn: [ref], payloadRefs: { 'lines[0].qtyMilli': ref } },
  );
  await switchCapability(app, s.owner, 'buying', false);
  expect(await failure(() => decide(app, s.owner, draftId, 'approved'))).toMatchObject({ code: 'capability_off', fields: ['buying'] });
  const [d] = await q('select status from approval.draft where id = $1', [draftId]);
  expect(d?.status).toBe('proposed');
  expect((await q('select count(*)::int as n from books.outbound_message where tenant_id = $1', [s.owner.tenantId]))[0].n).toBe(0);
});
