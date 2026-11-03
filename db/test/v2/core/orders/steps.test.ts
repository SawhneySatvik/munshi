// An order's life after order.confirm (BLUEPRINT §8.12): each step a person's own command under ref.order_flow, with the
// customer's update where its template has one, and ops.order_state always the latest step (ORD2, two taps one step);
// the advance as payment.record naming the order and its way back on a cancel (a refund, or the customer's credit);
// measurements taken through the vault and erased with their contact, never while an order or advance of theirs is
// open (M1); the delivered step inside a sale naming the order (ORD3's core half, wired into sale.record later); and the
// board read. Red-proofs: test/v2/sabotage/core-orders.ts.
import {
  advanceHeld,
  CoreError,
  eraseMeasurements,
  keepAdvanceAsCredit,
  mintSnapshot,
  orderDelivered,
  recordOrderPayment,
  runCommand,
  takeMeasurement,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { appWaiting, failure, type OrderShop, orderShop, SAREE, TEA, teaOrder, within } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let s: OrderShop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await orderShop(app, 'Steps');
  await db.sabotage();
});
afterAll(() => db?.close());

const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const step = (session = s.staff, orderId: string, to: string) => runCommand(app, session, 'order.step', { orderId, step: to });
const unbalanced = () =>
  q(`select entry_id from books.journal_line where tenant_id = $1 group by entry_id, currency having sum(amount_minor) <> 0`, [s.tenantId]);
// The customer's updates of an order, oldest first, with the step each was written under.
const updates = (orderId: string) =>
  q(
    `select st.step, m.template_code, t.body from books.order_step st
       join books.outbound_message m on m.tenant_id = st.tenant_id and m.id = st.message_id
       join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id
      where st.order_id = $1 and m.order_id = $1 order by st.step_no`,
    [orderId],
  );
const offProjection = async () =>
  (
    await q(
      `select count(*)::int as n,
              count(*) filter (where (st.step, st.step_no) is distinct from (l.step, l.step_no)
                                  or st.due_on is distinct from d.due_on or st.trial_on is distinct from d.trial_on)::int as off
         from books.order o
         left join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id
         cross join lateral (select x.step, x.step_no from books.order_step x where x.tenant_id = o.tenant_id and x.order_id = o.id order by x.step_no desc limit 1) l
         cross join lateral (select (select x.due_on from books.order_step x where x.tenant_id = o.tenant_id and x.order_id = o.id and x.due_on is not null order by x.step_no desc limit 1) as due_on,
                                    (select x.trial_on from books.order_step x where x.tenant_id = o.tenant_id and x.order_id = o.id and x.trial_on is not null order by x.step_no desc limit 1) as trial_on) d
        where o.tenant_id = $1 and o.reverses_id is null`,
      [s.tenantId],
    )
  )[0];

it('ORD2 each step is a person’s own command under ref.order_flow, writing the customer’s update where its template has one; a refused move writes nothing; ops.order_state equals every order’s latest step', async () => {
  const goods = await teaOrder(app, s, { dueOn: '2030-02-01' });
  expect(await step(s.staff, goods, 'packed')).toEqual({ stepId: expect.any(String), messageId: null }); // packed has no template
  const cutting = await step(s.staff, goods, 'cutting').catch((e) => e);
  expect(cutting).toBeInstanceOf(CoreError);
  expect(cutting).toMatchObject({ code: 'invalid', sqlstate: 'MS019' });
  await runCommand(app, s.manager, 'order.reschedule', { orderId: goods, dueOn: '2030-02-03', reason: 'customer_cancelled' });
  await step(s.manager, goods, 'ready');
  await step(s.staff, goods, 'out_for_delivery');
  const stitched = (
    await runCommand(app, s.staff, 'order.confirm', {
      shopId: s.shopId,
      customerId: s.customer,
      kind: 'stitching',
      dueOn: '2030-03-01',
      trialOn: '2030-02-25',
      lines: [{ itemId: s.blouse, qtyMilli: 1000, quoteMinor: 150_000 }],
    })
  ).orderId as string;
  for (const to of ['cutting', 'stitching', 'trial', 'stitching']) await step(s.staff, stitched, to);
  await runCommand(app, s.staff, 'order.reschedule', { orderId: stitched, trialOn: '2030-02-27' });
  const noDate = await failure(() => runCommand(app, s.staff, 'order.reschedule', { orderId: stitched }));
  expect(noDate).toMatchObject({ code: 'invalid', fields: ['dueOn'] });
  // Each update came with its step, from its step's template, composed from the books with no person's name.
  const [{ code }] = await q('select code from books.order where id = $1', [goods]);
  const shop = 'Steps Boutique (synthetic)';
  expect(await updates(goods)).toEqual([
    { step: 'confirmed', template_code: 'order_confirmed', body: `Order ${code} from ${shop} is confirmed: ₹249.99, due on 2030-02-01.` },
    { step: 'rescheduled', template_code: 'order_rescheduled', body: `Order ${code} from ${shop} is now due on 2030-02-03.` },
    { step: 'ready', template_code: 'order_ready', body: `Order ${code} from ${shop} is ready.` },
    { step: 'out_for_delivery', template_code: 'order_out_for_delivery', body: `Order ${code} from ${shop} is out for delivery.` },
  ]);
  expect((await updates(stitched)).map((u) => u.template_code)).toEqual(['order_confirmed', 'order_trial', 'order_rescheduled']);
  expect(await q(`select count(*)::int as n from books.outbound_message where tenant_id = $1 and order_id is not null and recipient_id <> $2`, [s.tenantId, s.customer])).toEqual([{ n: 0 }]);
  expect(await q('select step, step_no, due_on::text as due_on, trial_on::text as trial_on from ops.order_state where order_id = $1', [stitched])).toEqual([
    { step: 'rescheduled', step_no: 6, due_on: '2030-03-01', trial_on: '2030-02-27' },
  ]);
  expect(await offProjection()).toEqual({ n: 2, off: 0 });
  // Every step is its writer's own: audited under the member who tapped it.
  expect(
    await q(
      `select count(*)::int as n, count(*) filter (where a.actor_id is distinct from st.created_by or a.command is null)::int as off
         from books.order_step st left join audit.audit_log a on a.tenant_id = st.tenant_id and a.entity = 'books.order_step' and a.entity_id = st.id
        where st.tenant_id = $1`,
      [s.tenantId],
    ),
  ).toEqual([{ n: 11, off: 0 }]);
});

it('ORD2 two taps at once make one step and one conflict (23505)', async () => {
  const orderId = await teaOrder(app, s);
  // Hold the order's projection row, so the first tap's step goes in and then waits in z_order_state; the second tap's
  // step then races it on the step key.
  const holder = await db.admin.connect();
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;
  try {
    await holder.query('begin');
    await holder.query('select 1 from ops.order_state where order_id = $1 for update', [orderId]);
    first = step(s.staff, orderId, 'packed').then(
      (r) => r,
      (e) => e,
    );
    await appWaiting(db, 1);
    second = step(s.manager, orderId, 'packed').then(
      (r) => r,
      (e) => e,
    );
    await appWaiting(db, 2);
    await holder.query('commit');
  } finally {
    holder.release();
  }
  expect(await first).toEqual({ stepId: expect.any(String), messageId: null });
  const lost = await second;
  expect(lost).toBeInstanceOf(CoreError);
  expect(lost).toMatchObject({ code: 'conflict', sqlstate: '23505' });
  expect(await q(`select count(*)::int as n from books.order_step where order_id = $1 and step = 'packed'`, [orderId])).toEqual([{ n: 1 }]);
  expect(await q('select step, step_no from ops.order_state where order_id = $1', [orderId])).toEqual([{ step: 'packed', step_no: 2 }]);
});

it('ADV1 an advance is payment.record naming the order, against customer_advance; order.cancel takes a reason and writes no money; what is held goes back as a refund or stays as the customer’s credit, never more than is held', async () => {
  const orderId = (
    await runCommand(app, s.staff, 'order.confirm', { shopId: s.shopId, customerId: s.customer, lines: [{ itemId: s.saree, qtyMilli: 1000 }] })
  ).orderId as string;
  const pay = (session = s.staff, input: Record<string, unknown>) => within(app, session, 'payment.record', recordOrderPayment as never, { orderId, ...input });
  const { paymentId: advance } = (await pay(s.staff, { direction: 'in', method: 'upi', amountMinor: 50_000 })) as { paymentId: string };
  const entry = (source: string) =>
    q(
      `select l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id
        where e.source_id = $1 order by l.account`,
      [source],
    );
  expect(await entry(advance)).toEqual([
    { account: 'customer_advance', amount: -50_000 },
    { account: 'upi_clearing', amount: 50_000 },
  ]);
  expect(await q('select direction, customer_id, order_id, created_by from books.payment where id = $1', [advance])).toEqual([
    { direction: 'in', customer_id: s.customer, order_id: orderId, created_by: s.staff.memberId },
  ]);
  expect(await q('select count(*)::int as n from books.credit_entry where payment_id = $1', [advance])).toEqual([{ n: 0 }]); // not udhaar
  const card = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'order.lines', { order_id: orderId });
  expect(card.rows[0]?.advance).toEqual({ kind: 'money', num: '50000', currency: 'INR' });
  // A cancel is an owner's or a manager's, with a reason of the cancel use; it releases the promise and moves no money.
  expect(await failure(() => runCommand(app, s.manager, 'order.cancel', { orderId }))).toMatchObject({ code: 'invalid', fields: ['reason'] });
  expect(await runCommand(app, s.staff, 'order.cancel', { orderId, reason: 'customer_cancelled' }).catch((e) => e)).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect(await runCommand(app, s.manager, 'order.cancel', { orderId, reason: 'not_now' }).catch((e) => e)).toMatchObject({ code: 'invalid', sqlstate: '23503' });
  const cancelled = await runCommand(app, s.manager, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  expect((await updates(orderId)).map((u) => u.template_code)).toEqual(['order_confirmed', 'order_cancelled']);
  expect(await q('select count(*)::int as n from books.journal_entry where source_id = $1', [cancelled.stepId])).toEqual([{ n: 0 }]);
  // No advance after the end; no refund beyond what is held.
  expect(await pay(s.staff, { direction: 'in', method: 'cash', amountMinor: 100 }).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['orderId'] });
  expect(await pay(s.owner, { direction: 'out', method: 'upi', amountMinor: 50_001 }).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['amountMinor'] });
  const { paymentId: refund } = (await pay(s.owner, { direction: 'out', method: 'upi', amountMinor: 20_000 })) as { paymentId: string };
  expect(await entry(refund)).toEqual([
    { account: 'customer_advance', amount: 20_000 },
    { account: 'upi_clearing', amount: -20_000 },
  ]);
  const keep = (amountMinor: number) => within(app, s.owner, 'credit.record', keepAdvanceAsCredit as never, { paymentId: advance, amountMinor });
  expect(await keep(30_001).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['amountMinor'] });
  const { creditId } = (await keep(30_000)) as { creditId: string };
  expect(await q('select customer_id, amount_minor::int as amount, payment_id from books.credit_entry where id = $1', [creditId])).toEqual([
    { customer_id: s.customer, amount: -30_000, payment_id: advance },
  ]);
  expect(await entry(creditId)).toEqual([
    { account: 'customer_advance', amount: 30_000 },
    { account: 'receivable', amount: -30_000 },
  ]);
  expect(await withTx(app, { kind: 'member', session: s.owner }, (c) => advanceHeld(c, orderId))).toBe(0);
  expect(await q(`select coalesce(sum(amount_minor), 0)::int as held from books.journal_line where tenant_id = $1 and account = 'customer_advance'`, [s.tenantId])).toEqual([{ held: 0 }]);
  expect(await unbalanced()).toEqual([]);
});

it('M1 a measurement is taken through the vault and an order line keeps its id; the contact’s erasure is held while the order is open or its advance unapplied, then erases the measurement and every value with it', async () => {
  const person = (await runCommand(app, s.owner, 'customer.create', { name: 'Meera (synthetic)', phone: '+919811100022' })) as { customerId: string; contactId: string };
  const measurementId = await takeMeasurement(app, s.staff, { contactId: person.contactId, note: 'Loose fit', values: { chest: 900, waist: 780 } });
  expect(await q('select taken_by, note from ops.measurement where id = $1', [measurementId])).toEqual([{ taken_by: s.staff.memberId, note: 'Loose fit' }]);
  const values = () => mintSnapshot(app, { kind: 'member', session: s.owner }, 'measurement.values', { measurement_id: measurementId });
  expect((await values()).rows.map((r) => [r.point, r.mm])).toEqual([
    [{ kind: 'text', txt: 'chest' }, { kind: 'integer', num: '900' }],
    [{ kind: 'text', txt: 'waist' }, { kind: 'integer', num: '780' }],
  ]);
  const orderId = (
    await runCommand(app, s.staff, 'order.confirm', {
      shopId: s.shopId,
      customerId: person.customerId,
      kind: 'stitching',
      trialOn: '2030-04-01',
      lines: [{ itemId: s.blouse, qtyMilli: 1000, quoteMinor: 120_000, measurementId }],
    })
  ).orderId as string;
  await within(app, s.staff, 'payment.record', recordOrderPayment as never, { orderId, direction: 'in', method: 'cash', amountMinor: 40_000 });
  // The owner's erasure: the contact's row, then its measurements, in one transaction.
  const erase = () =>
    withTx(app, { kind: 'member', session: s.owner }, async (c) => {
      await c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [
        person.contactId,
        s.owner.memberId,
      ]);
      return eraseMeasurements(c, person.contactId);
    });
  const hold = { code: 'refused', sqlstate: 'MS007' };
  expect(await erase().catch((e) => e), 'an open order').toMatchObject(hold);
  await runCommand(app, s.owner, 'order.cancel', { orderId, reason: 'customer_cancelled' });
  expect(await erase().catch((e) => e), 'an unapplied advance on a cancelled order').toMatchObject(hold);
  await within(app, s.owner, 'payment.record', recordOrderPayment as never, { orderId, direction: 'out', method: 'cash', amountMinor: 40_000 });
  expect(await erase()).toBe(1);
  expect(await q('select note, erased_at is not null as erased from ops.measurement where id = $1', [measurementId])).toEqual([{ note: null, erased: true }]);
  expect(await q('select count(*)::int as n from ops.measurement_value where measurement_id = $1 and (mm is not null or erased_at is null)', [measurementId])).toEqual([{ n: 0 }]);
  expect(await q('select measurement_id from books.order_line where order_id = $1', [orderId])).toEqual([{ measurement_id: measurementId }]);
  expect((await values()).rows.map((r) => r.mm)).toEqual([{ kind: 'null' }, { kind: 'null' }]);
});

it('ORD3 orderDelivered, inside a sale naming the order with exactly its lines, writes the delivered step and the customer’s update; a sale short of a line, or no sale, is refused', async () => {
  const orderId = (
    await runCommand(app, s.staff, 'order.confirm', {
      shopId: s.shopId,
      customerId: s.customer,
      lines: [
        { itemId: s.tea, qtyMilli: 2000 },
        { itemId: s.saree, qtyMilli: 1000 },
      ],
    })
  ).orderId as string;
  await step(s.staff, orderId, 'ready');
  const lines = await q('select id, item_id, item_kind, qty_milli, unit_price_minor, gross_minor from books.order_line where order_id = $1 order by line_no', [orderId]);
  expect(lines.map((l) => Number(l.gross_minor))).toEqual([2 * TEA, SAREE]);
  // A scratch sale.record, written the way the SQL takes a sale naming an order: its lines priced by the order's lines.
  const sale = (take: typeof lines) =>
    withTx(app, { kind: 'member', session: s.staff, command: 'sale.record' }, async (c) => {
      const total = take.reduce((a, l) => a + Number(l.gross_minor), 0);
      const saleId = (
        await c.query<{ id: string }>(
          `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency, order_id) values ($1, $2, now(), $3, $4, 'INR', $5) returning id`,
          [s.tenantId, s.shopId, s.customer, total, orderId],
        )
      ).rows[0]?.id;
      for (const [n, l] of take.entries()) {
        await c.query(
          `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, order_line_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'INR')`,
          [s.tenantId, saleId, n + 1, l.item_id, l.item_kind, l.id, l.qty_milli, l.unit_price_minor, l.gross_minor],
        );
      }
      return orderDelivered(c, orderId);
    });
  expect(await sale(lines.slice(0, 1)).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['lines'] });
  const alone = await withTx(app, { kind: 'member', session: s.staff, command: 'sale.record' }, (c) => orderDelivered(c, orderId)).catch((e) => e);
  expect(alone).toMatchObject({ code: 'invalid', fields: ['lines'] });
  expect(await q('select count(*)::int as n from books.sale where order_id = $1', [orderId])).toEqual([{ n: 0 }]);
  const delivered = await sale(lines);
  expect(delivered).toEqual({ stepId: expect.any(String), messageId: expect.any(String) });
  expect(await q('select step, step_no from ops.order_state where order_id = $1', [orderId])).toEqual([{ step: 'delivered', step_no: 3 }]);
  expect((await updates(orderId)).map((u) => u.template_code)).toEqual(['order_confirmed', 'order_ready', 'order_delivered']);
  expect(await step(s.staff, orderId, 'ready').catch((e) => e)).toMatchObject({ code: 'invalid', sqlstate: 'MS019' }); // nothing after the end
});

it('BOARD the board lists every live order at an open step from ops.order_state, as cells with no person’s name; a delivered, cancelled or voided order is off it', async () => {
  const open = await teaOrder(app, s, { dueOn: '2030-05-01' });
  const voided = await teaOrder(app, s);
  await withTx(app, { kind: 'member', session: s.owner, command: 'order.reverse' }, async (c) => {
    const r = (
      await c.query<{ id: string }>(
        `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency, reverses_id, reason)
         select tenant_id, shop_id, customer_id, kind, code, currency, id, 'entered_in_error' from books.order where id = $1 returning id`,
        [voided],
      )
    ).rows[0]?.id;
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency, reverses_id, reason)
       select tenant_id, $2, line_no, item_id, item_kind, price_id, -qty_milli, unit_price_minor, -gross_minor, currency, id, 'entered_in_error' from books.order_line where order_id = $1`,
      [voided, r],
    );
  });
  const steps = (await q('select code from ref.order_step where not terminal order by code')).map((r) => r.code as string);
  const board = await mintSnapshot(app, { kind: 'member', session: s.manager }, 'order.board', { steps }); // the board is the office's (D-082)
  const listed = board.rows.map((r) => (r.order_id as { txt: string }).txt);
  const { rows: want } = await db.admin.query<{ id: string }>(
    `select o.id::text as id from books.order o join ops.order_state st on st.tenant_id = o.tenant_id and st.order_id = o.id join ref.order_step r on r.code = st.step
      where o.tenant_id = $1 and o.reverses_id is null and not r.terminal
        and not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id)`,
    [s.tenantId],
  );
  expect(want.length).toBeGreaterThan(0);
  expect([...listed].sort()).toEqual(want.map((r) => r.id).sort());
  expect(listed).toContain(open);
  expect(listed).not.toContain(voided);
  const row = board.rows.find((r) => (r.order_id as { txt: string }).txt === open);
  expect(row).toEqual({
    step: { kind: 'text', txt: 'confirmed' },
    order_id: { kind: 'text', txt: open },
    code: { kind: 'text', txt: expect.stringMatching(/^ORD-/) },
    kind: { kind: 'text', txt: 'goods' },
    due_on: { kind: 'date', day: '2030-05-01' },
    trial_on: { kind: 'null' },
    customer_id: { kind: 'text', txt: s.customer },
  });
  expect(JSON.stringify(board.rows)).not.toMatch(/Asha|Meera/);
});
