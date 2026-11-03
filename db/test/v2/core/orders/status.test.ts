// The W2-close schema batch (BP-F5's findings): the order status page's read under its code only (order_code_public),
// an Instagram message as an order's intake (ops.inbound_message admits the channel), and the contact's erasure hold
// counting an advance kept as credit with its own sign. Red-proofs: test/v2/sabotage/orders.ts.
import { randomUUID } from 'node:crypto';
import { intakeInstagram, intakeSite, mintSnapshot, orderStatus, runCommand, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { acceptTenant } from '../../gates/lib.ts';
import { grant } from '../messaging/lib.ts';
import { asPublic, inbound, type OrderShop, orderShop, publish, SAREE, TEA, teaOrder } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let s: OrderShop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  s = await orderShop(app, 'Status');
  await db.sabotage();
});
afterAll(() => db?.close());

const run = async (who: OrderShop['owner'], name: string, input: unknown) => (await runCommand(app, who, name, input)) as Record<string, string>;
const codeOf = async (orderId: string) => (await db.admin.query<{ code: string }>('select code from books.order where id = $1', [orderId])).rows[0]?.code as string;

it('the status page reads an order’s steps only under its own code: never another order, never a list', async () => {
  const orderId = await teaOrder(app, s);
  await run(s.manager, 'order.step', { orderId, step: 'packed' });
  const other = await teaOrder(app, s);
  const code = await codeOf(orderId);
  const status = await orderStatus(pub, s.tenantId, code);
  expect(status).toMatchObject({ code, request: 'confirmed', current: 'packed', steps: [{ step: 'confirmed' }, { step: 'packed' }] });
  expect(await orderStatus(pub, s.tenantId, 'ORD-ZZZZ99')).toBeNull();
  expect(await orderStatus(pub, s.tenantId, 'not a code')).toBeNull();
  // The public role, with no code set or with one code set, lists nothing else.
  const counts = (code: string | null) =>
    tx(pub, { tenant_id: s.tenantId, ...(code ? { order_code: code } : {}) }, async (c) => ({
      orders: (await c.query<{ n: number }>('select count(*)::int as n from books.order')).rows[0]?.n,
      steps: (await c.query<{ n: number }>('select count(*)::int as n from books.order_step')).rows[0]?.n,
    }));
  expect(await counts(null)).toEqual({ orders: 0, steps: 0 });
  expect(await counts(code)).toEqual({ orders: 1, steps: 2 });
  expect(await counts(await codeOf(other))).toEqual({ orders: 1, steps: 1 });
});

it('an Instagram message is an order’s intake: the inbox stores it on its channel and its request is read as received', async () => {
  // An Instagram message reaches only a real shop the operator granted Instagram (19, M6).
  const ig = await orderShop(app, 'Status IG', { accept: (id) => acceptTenant(db.admin, id) });
  await grant(db, ig.tenantId, 'instagram', true, 'status_ig');
  const messageId = randomUUID();
  await asPublic(db, ig.tenantId, (c) =>
    c.query(`insert into ops.inbound_message (tenant_id, id, channel, provider_message_id, from_address, account_ref, kind, text, received_at) values ($1, $2, 'instagram', $3, '17841400000000001', 'status_ig', 'text', 'Do you have the saree in blue?', now())`, [
      ig.tenantId,
      messageId,
      `ig.${randomUUID()}`,
    ]),
  );
  const { code } = await asPublic(db, ig.tenantId, (c) => intakeInstagram(c, { shopId: ig.shopId, inboundMessageId: messageId }));
  expect(await orderStatus(pub, ig.tenantId, code)).toEqual({ code, request: 'received', current: null, steps: [] });
});

it('a contact whose order advance was kept as credit, and that credit then used, is erased: the hold counts the kept advance with its sign', async () => {
  const person = await run(s.owner, 'customer.create', { name: 'Kept advance (synthetic)', phone: '+919811177001' });
  const orderId = (await run(s.manager, 'order.confirm', { shopId: s.shopId, customerId: person.customerId, lines: [{ itemId: s.tea, qtyMilli: 1000 }] })).orderId as string;
  const { paymentId } = await run(s.staff, 'payment.record', { orderId, direction: 'in', method: 'cash', amountMinor: 5_000 });
  await run(s.manager, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  await run(s.owner, 'credit.record', { paymentId, amountMinor: 5_000 });
  // The customer spends the kept credit: a sale whose unpaid rest is exactly it brings the credit back to zero.
  await run(s.staff, 'sale.record', { shopId: s.shopId, customerId: person.customerId, lines: [{ itemId: s.tea, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: TEA - 5_000 }] });
  const erased = await withTx(app, { kind: 'member', session: s.owner }, (c) =>
    c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [person.contactId, s.owner.memberId]),
  );
  expect(erased.rowCount).toBe(1);
});

it('the inbox links a message to the site request whose code it quotes, read and never written', async () => {
  await publish(db, s, [[s.saree, 'Cotton saree', SAREE]]);
  const { code } = await asPublic(db, s.tenantId, (c) => intakeSite(c, { shopId: s.shopId, lines: [{ itemId: s.saree, qtyMilli: 1000 }] }));
  const quoting = await inbound(db, s.tenantId, 'text', `Hi, this is about order ${code.toLowerCase()}, can I collect it today?`);
  const plain = await inbound(db, s.tenantId, 'text', 'Do you have it in blue?');
  const link = async (message: string) =>
    (await mintSnapshot(app, { kind: 'member', session: s.owner }, 'inbox.order_link', { message_id: message })).rows.map((r) => [r.code, r.state]);
  expect(await link(quoting)).toEqual([[{ kind: 'text', txt: code }, { kind: 'text', txt: 'new' }]]);
  expect(await link(plain)).toEqual([]);
});
