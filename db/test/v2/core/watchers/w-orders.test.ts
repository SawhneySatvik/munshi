// W-ORD: the Orders desk's watchers (BLUEPRINT §7.3), keyed by the `orders` capability, against a planted key worked by
// hand: one request left unanswered past 30 minutes (and one declined, the control), one order past due while still at
// its first step (and one ready, one not yet due, the controls), one cancelled order holding a ₹500 advance (and one
// refunded in full, one still open, the controls). Orders, steps and advances are planted under their commands' labels
// (plant.ts). With `orders` switched off the shop gets none of these findings. Red-proofs: test/v2/sabotage/core-ai.ts.
import { businessDate, runWatchers, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';
import { asCommand, asMember, findings, one, plusDays, setCapability, TENANT } from './plant.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let today: string;
const codes = new Map<string, string>(); // code → order or request id

const MIN = 60_000;

async function order(by: Session, code: string, dueOn: string, qtyMilli: number) {
  return asCommand(app, by, 'order.confirm', async (c) => {
    const price = await one<{ id: string; amount_minor: string }>(c, 'select id, amount_minor from books.price where item_id = $1 order by effective_from desc limit 1', [s.biscuits]);
    const o = await one<{ id: string }>(
      c,
      `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values (${TENANT}, $1, $2, 'goods', $3, 'INR') returning id`,
      [s.shopId, s.customer, code],
    );
    const unit = Number(price.amount_minor);
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
       values (${TENANT}, $1, 1, $2, 'good', $3, $4, $5, $6, 'INR')`,
      [o.id, s.biscuits, price.id, qtyMilli, unit, (qtyMilli * unit) / 1000],
    );
    await c.query(`insert into books.order_step (tenant_id, order_id, step, due_on, at) values (${TENANT}, $1, 'confirmed', $2, now())`, [o.id, dueOn]);
    codes.set(code, o.id);
    return o.id;
  });
}
const step = (orderId: string, command: string, to: string, reason: string | null = null) =>
  asCommand(app, s.manager, command, (c) => c.query(`insert into books.order_step (tenant_id, order_id, step, reason, at) values (${TENANT}, $1, $2, $3, now())`, [orderId, to, reason]));
const advance = (orderId: string, direction: 'in' | 'out', amount: number) =>
  asCommand(app, s.manager, 'payment.record', (c) =>
    c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, order_id, paid_at) values (${TENANT}, $1, 'cash', $2, 'INR', $3, $4, now())`, [
      direction,
      amount,
      s.customer,
      orderId,
    ]),
  );

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Orders');
  today = businessDate(new Date(), 'Asia/Kolkata');
  // Requests: one left new, one declined.
  for (const code of ['ORD-WAIT1', 'ORD-DECL1']) {
    const r = await asMember(app, s.manager, (c) =>
      one<{ id: string }>(c, `insert into ops.order_request (tenant_id, shop_id, code, channel, kind) values (${TENANT}, $1, $2, 'whatsapp', 'goods') returning id`, [s.shopId, code]),
    );
    codes.set(code, r.id);
  }
  await asMember(app, s.manager, (c) => c.query(`update ops.order_request set state = 'declined', reason = 'not_now' where id = $1`, [codes.get('ORD-DECL1')]));
  // Orders: late (3 days past due, 2 packs of ₹10), ready though past due, not yet due.
  await order(s.manager, 'ORD-LATE1', plusDays(today, -3), 2000);
  await step(await order(s.manager, 'ORD-REDY1', plusDays(today, -2), 1000), 'order.step', 'ready');
  await order(s.manager, 'ORD-SOON1', plusDays(today, 2), 1000);
  // Advances: ₹500 on an order then cancelled; ₹300 on one cancelled and refunded; ₹200 on one still open.
  const kept = await order(s.manager, 'ORD-CANC1', plusDays(today, -5), 1000);
  await advance(kept, 'in', 50_000);
  await step(kept, 'order.cancel', 'cancelled', 'customer_cancelled');
  const refunded = await order(s.manager, 'ORD-RFND1', plusDays(today, 5), 1000);
  await advance(refunded, 'in', 30_000);
  await step(refunded, 'order.cancel', 'cancelled', 'customer_cancelled');
  await advance(refunded, 'out', 30_000);
  await advance(await order(s.manager, 'ORD-OPEN1', plusDays(today, 5), 1000), 'in', 20_000);
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const ORDER_KINDS = "kind in ('order_unanswered', 'order_late', 'advance_unapplied')";

it('W-ORD the order watchers find the planted request, late order and unapplied advance, and nothing else; none while orders is off', async () => {
  // Instants measured from the waiting request's own arrival, which the database stamped.
  const { received } = await asMember(app, s.manager, (c) => one<{ received: Date }>(c, 'select created_at as received from ops.order_request where id = $1', [codes.get('ORD-WAIT1')]));
  const after = (minutes: number) => new Date(received.getTime() + minutes * MIN);
  await setCapability(app, s.owner, 'orders', false);
  await runWatchers(jobs, s.owner.tenantId, today, after(31));
  expect(await findings(jobs, s.owner.tenantId, ORDER_KINDS)).toEqual([]);
  expect(await findings(jobs, s.owner.tenantId)).toEqual([]); // and the shop's other watchers have nothing to say

  await setCapability(app, s.owner, 'orders', true);
  // 29 minutes on, the waiting request is not yet unanswered (the near miss); 31 minutes on, it is.
  await runWatchers(jobs, s.owner.tenantId, today, after(29));
  expect((await findings(jobs, s.owner.tenantId)).map((f) => f.kind)).toEqual(['advance_unapplied', 'order_late']);
  await runWatchers(jobs, s.owner.tenantId, today, after(31));
  const found = await findings(jobs, s.owner.tenantId);
  const shop = s.shopId;
  expect(found.map(({ v, ...f }) => f)).toEqual([
    { kind: 'advance_unapplied', key: `advance_unapplied:${codes.get('ORD-CANC1')}`, status: 'open', shop, severity: 'medium' },
    { kind: 'order_late', key: `order_late:${codes.get('ORD-LATE1')}`, status: 'open', shop, severity: 'low' },
    { kind: 'order_unanswered', key: `order_unanswered:${codes.get('ORD-WAIT1')}`, status: 'open', shop, severity: 'low' },
  ]);
  const [unapplied, late, waiting] = found.map((f) => f.v);
  expect(unapplied).toEqual({ order_id: codes.get('ORD-CANC1'), shop_id: shop, code: 'ORD-CANC1', step: 'cancelled', unapplied: 50_000 });
  expect(late).toEqual({ order_id: codes.get('ORD-LATE1'), shop_id: shop, code: 'ORD-LATE1', kind: 'goods', step: 'confirmed', due_on: plusDays(today, -3), days_late: 3, total: 2000 });
  expect(waiting).toMatchObject({ request_id: codes.get('ORD-WAIT1'), shop_id: shop, code: 'ORD-WAIT1', channel: 'whatsapp', state: 'new', total: null });
});
