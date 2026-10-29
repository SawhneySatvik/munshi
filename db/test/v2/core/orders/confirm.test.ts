// order.confirm end to end (BLUEPRINT §8.12): ORD1's order half (each line's unit price is its books.price row in
// effect or the person's own typed quote, labelled as theirs; every line amount recomputes from stored ids with the
// counter's rounding), the first step and the customer's update in the order's transaction, and ORD4 (an AI-drafted
// order's quantities are spans the database re-parsed; a free digit, a quantity cited from anything else, and a typed
// quote in a draft are refused; the approval writes the order under the approver). Red-proofs:
// test/v2/sabotage/core-orders.ts.
import { createHash } from 'node:crypto';
import { CoreError, type CellRef, decide, intakeWhatsapp, mintSnapshot, proposeDraft, runCommand, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { asPublic, inbound, ORDER_CODE, type OrderShop, orderShop, SAREE, TEA } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let s: OrderShop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await orderShop(app, 'Confirm');
  await db.sabotage();
});
afterAll(() => db?.close());

const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const member = (session = s.owner) => ({ kind: 'member', session }) as const;

it('ORD1 order.confirm prices each line by the books.price in effect or the taker’s own typed quote, labelled as theirs; every order line recomputes from stored ids; the confirmed step and the customer’s update come with it', async () => {
  const r = await runCommand(app, s.staff, 'order.confirm', {
    shopId: s.shopId,
    customerId: s.customer,
    kind: 'stitching',
    dueOn: '2030-01-10',
    trialOn: '2030-01-07',
    lines: [
      { itemId: s.tea, qtyMilli: 1500 },
      { itemId: s.blouse, qtyMilli: 1000, quoteMinor: 180_000 },
    ],
  });
  expect(r).toEqual({ orderId: expect.any(String), stepId: expect.any(String), messageId: expect.any(String), customerId: s.customer });
  const [order] = await q('select code, kind, request_id, created_by, currency from books.order where id = $1', [r.orderId]);
  expect(order).toEqual({ code: expect.stringMatching(ORDER_CODE), kind: 'stitching', request_id: null, created_by: s.staff.memberId, currency: 'INR' });
  // The price in effect (₹249.99 since yesterday, not the day before's ₹200), the typed quote as typed, and the counter's
  // rounding: 1.5 × ₹249.99 = ₹374.985 → ₹374.99.
  const lines = await q(
    `select l.line_no, l.unit_price_minor::int as unit, l.gross_minor::int as gross, l.price_id is not null as priced, i.member_id as typed_by, i.path
       from books.order_line l left join ops.member_input i on i.tenant_id = l.tenant_id and i.id = l.quote_input_id where l.order_id = $1 order by l.line_no`,
    [r.orderId],
  );
  expect(lines).toEqual([
    { line_no: 1, unit: TEA, gross: 37_499, priced: true, typed_by: null, path: null },
    { line_no: 2, unit: 180_000, gross: 180_000, priced: false, typed_by: s.staff.memberId, path: 'lines[1].quoteMinor' },
  ]);
  // Every order line of the shop, recomputed from the rows its ids name, with the counter's rounding written out here.
  const all = await q(
    `select count(*)::int as n,
            count(*) filter (where l.unit_price_minor is distinct from coalesce(p.amount_minor, i.num)
                                or l.gross_minor is distinct from (l.qty_milli * l.unit_price_minor + 500) / 1000
                                or (i.id is not null and i.member_id is distinct from l.created_by))::int as off
       from books.order_line l
       left join books.price p on p.tenant_id = l.tenant_id and p.id = l.price_id
       left join ops.member_input i on i.tenant_id = l.tenant_id and i.id = l.quote_input_id
      where l.tenant_id = $1 and l.reverses_id is null`,
    [s.tenantId],
  );
  expect(all).toEqual([{ n: 2, off: 0 }]);
  // The card's cells: the quote labelled with its typist's member id (the screen names them), the total the lines' sum.
  const card = await mintSnapshot(app, member(), 'order.lines', { order_id: r.orderId });
  expect(card.rows.map((row) => [row.priced_by, row.quoted_by, row.amount, row.total, row.advance])).toEqual([
    [{ kind: 'text', txt: 'price' }, { kind: 'null' }, { kind: 'money', num: '37499', currency: 'INR' }, { kind: 'money', num: '217499', currency: 'INR' }, { kind: 'money', num: '0', currency: 'INR' }],
    [
      { kind: 'text', txt: 'quote' },
      { kind: 'text', txt: s.staff.memberId },
      { kind: 'money', num: '180000', currency: 'INR' },
      { kind: 'money', num: '217499', currency: 'INR' },
      { kind: 'money', num: '0', currency: 'INR' },
    ],
  ]);
  expect(JSON.stringify(card.rows)).not.toContain('Asha');
  // The first step and the customer's update, written under the same command.
  const [step] = await q('select step_no, step, due_on::text as due_on, trial_on::text as trial_on, message_id, created_by from books.order_step where order_id = $1', [r.orderId]);
  expect(step).toEqual({ step_no: 1, step: 'confirmed', due_on: '2030-01-10', trial_on: '2030-01-07', message_id: r.messageId, created_by: s.staff.memberId });
  const [m] = await q(
    `select m.recipient_kind, m.recipient_id, m.template_code, m.order_id, t.body, t.author, d.mode from books.outbound_message m
       join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id join ops.delivery d on d.tenant_id = m.tenant_id and d.message_id = m.id
      where m.id = $1`,
    [r.messageId],
  );
  expect(m).toEqual({
    recipient_kind: 'customer',
    recipient_id: s.customer,
    template_code: 'order_confirmed',
    order_id: r.orderId,
    body: `Order ${order.code} from Confirm Boutique (synthetic) is confirmed: ₹2,174.99, due on 2030-01-10, trial on 2030-01-07.`,
    author: 'template',
    mode: 'recorded',
  });
  // A line with no price in effect and no quote is refused, and nothing is written.
  const unpriced = await runCommand(app, s.staff, 'order.confirm', { shopId: s.shopId, customerId: s.customer, lines: [{ itemId: s.blouse, qtyMilli: 1000 }] }).catch((e) => e);
  expect(unpriced).toBeInstanceOf(CoreError);
  expect(unpriced).toMatchObject({ code: 'invalid', fields: ['lines.0.itemId'] });
  expect(await q('select count(*)::int as n from books.order where tenant_id = $1', [s.tenantId])).toEqual([{ n: 1 }]);
});

it('ORD4 an AI-drafted order’s quantities are spans the database re-parsed, each cited beside its item; a free digit, a quantity from another message or item, and a typed quote in a draft are refused; the approval writes the order as the approver', async () => {
  const text = 'Please send 2 Assam tea 250 g and 3 Cotton saree';
  const message = await inbound(db, s.tenantId, 'text', text);
  const { requestId, code } = await asPublic(db, s.tenantId, (c) => intakeWhatsapp(c, { shopId: s.shopId, inboundMessageId: message }));
  // The staff member's tap starts a run; its spans are re-parsed by the database as they are stored (extract_span).
  const run = await withTx(app, member(s.staff), async (c) => {
    const id = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'inbox', 'orders') returning id`, [s.tenantId])).rows[0]?.id as string;
    const span = (phrase: string) => {
      const start = text.indexOf(phrase);
      return [start, start + phrase.length, createHash('sha256').update(phrase).digest()] as const;
    };
    const extract = (field: string, phrase: string, num: number | null, item: string | null) =>
      c.query(
        `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, item_id, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [s.tenantId, message, id, field, num, item, ...span(phrase), num === null ? 'words' : 'digits'],
      );
    await extract('quantity', '2', 2000, null);
    await extract('item', 'Assam tea 250 g', null, s.tea);
    await extract('quantity', '3', 3000, null);
    await extract('item', 'Cotton saree', null, s.saree);
    return id;
  });
  const misread = await withTx(app, member(s.staff), (c) =>
    c.query(`insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, 'quantity', 5000, 12, 13, $4, 'digits')`, [
      s.tenantId,
      message,
      run,
      createHash('sha256').update('2').digest(),
    ]),
  ).catch((e) => e);
  expect(misread).toMatchObject({ code: 'refused', sqlstate: 'MS006' }); // "2" is not 5
  const read = await mintSnapshot(app, member(s.staff), 'order.extracts', { message_id: message, run_id: run }, run);
  expect(read.rows.map((r) => [r.item_id, r.qty])).toEqual([
    [{ kind: 'text', txt: s.tea }, { kind: 'quantity', num: '2000', unit: 'pack' }],
    [{ kind: 'text', txt: s.saree }, { kind: 'quantity', num: '3000', unit: 'piece' }],
  ]);
  const cell = (snapshotId: string, row: number, col = 'qty'): CellRef => ({ snapshotId, row, col });
  const payload = (lines: unknown[]) => ({ requestId, customerId: s.customer, lines });
  const lines = [
    { itemId: s.tea, qtyMilli: 2000 },
    { itemId: s.saree, qtyMilli: 3000 },
  ];
  const propose = (p: unknown, payloadRefs: Record<string, CellRef>) =>
    proposeDraft(app, { session: s.staff, runId: run }, { command: 'order.confirm', payload: p, basedOn: [cell(read.id, 0)], payloadRefs });
  // A free digit: a quantity with no cell behind it.
  expect(await propose(payload(lines), {}).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['payloadRefs.lines[0].qtyMilli', 'payloadRefs.lines[1].qtyMilli'] });
  // The right number from the wrong place: another message's span of the same figure, and a span beside another item.
  const elsewhere = await inbound(db, s.tenantId, 'text', 'Need 2 more');
  const otherRead = await withTx(app, member(s.staff), async (c) => {
    await c.query(
      `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, 'quantity', 2000, 5, 6, $4, 'digits')`,
      [s.tenantId, elsewhere, run, createHash('sha256').update('2').digest()],
    );
    await c.query(
      `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, item_id, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, 'item', $4, 7, 11, $5, 'words')`,
      [s.tenantId, elsewhere, run, s.tea, createHash('sha256').update('more').digest()],
    );
  }).then(() => mintSnapshot(app, member(s.staff), 'order.extracts', { message_id: elsewhere, run_id: run }, run));
  expect(await propose(payload(lines), { 'lines[0].qtyMilli': cell(otherRead.id, 0), 'lines[1].qtyMilli': cell(read.id, 1) }).catch((e) => e)).toMatchObject({
    code: 'invalid',
    fields: ['lines[0].qtyMilli'],
  });
  const swapped = [
    { itemId: s.saree, qtyMilli: 2000 },
    { itemId: s.saree, qtyMilli: 3000 },
  ];
  expect(await propose(payload(swapped), { 'lines[0].qtyMilli': cell(read.id, 0), 'lines[1].qtyMilli': cell(read.id, 1) }).catch((e) => e)).toMatchObject({
    code: 'invalid',
    fields: ['lines[0].qtyMilli'],
  });
  // A typed quote in a draft, even one a cell holds: the approver would carry a number nobody typed.
  const quote = await mintSnapshot(app, member(s.staff), 'sale.quote', { item_ids: [s.tea], qty_milli: [1000] }, run);
  const quoted = [{ ...lines[0], quoteMinor: TEA }, lines[1]];
  expect(
    await propose(payload(quoted), { 'lines[0].qtyMilli': cell(read.id, 0), 'lines[0].quoteMinor': cell(quote.id, 0, 'unit_price'), 'lines[1].qtyMilli': cell(read.id, 1) }).catch((e) => e),
  ).toMatchObject({ code: 'invalid', fields: ['lines[0].quoteMinor'] });
  expect(await q('select count(*)::int as n from approval.draft where tenant_id = $1', [s.tenantId])).toEqual([{ n: 0 }]);
  // The spans, cited beside their items: proposed, then approved by the owner, who is the order's writer.
  const draftId = await propose(payload(lines), { 'lines[0].qtyMilli': cell(read.id, 0), 'lines[1].qtyMilli': cell(read.id, 1) });
  const decision = await decide(app, s.owner, draftId, 'approved');
  if (decision.status !== 'executed') throw new Error(`the approval was ${decision.status}`);
  const orderId = decision.result.orderId as string;
  const [order] = await q('select code, request_id, created_by, decision_id from books.order where id = $1', [orderId]);
  expect(order).toEqual({ code, request_id: requestId, created_by: s.owner.memberId, decision_id: decision.decisionId });
  expect(await q('select line_no, qty_milli::int as qty, unit_price_minor::int as unit from books.order_line where order_id = $1 order by line_no', [orderId])).toEqual([
    { line_no: 1, qty: 2000, unit: TEA },
    { line_no: 2, qty: 3000, unit: SAREE },
  ]);
  expect(await q('select state, handled_by from ops.order_request where id = $1', [requestId])).toEqual([{ state: 'confirmed', handled_by: s.owner.memberId }]);
  // The request no longer takes a second order.
  expect(await tx(app, { tenant_id: s.tenantId }, (c) => c.query('select count(*)::int as n from books.order where request_id = $1', [requestId])).then((r) => r.rows)).toEqual([{ n: 1 }]);
});

it('ORD4 a quantity span in words, which the database stores on trust, is read again by core: a draft citing one misread is refused, one read right is proposed', async () => {
  const text = 'Send two Cotton saree';
  const message = await inbound(db, s.tenantId, 'text', text);
  const { requestId } = await asPublic(db, s.tenantId, (c) => intakeWhatsapp(c, { shopId: s.shopId, inboundMessageId: message }));
  // One run's reading: "two" stored as `num`, and the item beside it.
  const reading = async (num: number) => {
    const run = await withTx(app, member(s.staff), async (c) => {
      const id = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'inbox', 'orders') returning id`, [s.tenantId])).rows[0]?.id as string;
      for (const [field, phrase, n, item] of [
        ['quantity', 'two', num, null],
        ['item', 'Cotton saree', null, s.saree],
      ] as const) {
        const start = text.indexOf(phrase);
        await c.query(
          `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, item_id, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'words')`,
          [s.tenantId, message, id, field, n, item, start, start + phrase.length, createHash('sha256').update(phrase).digest()],
        );
      }
      return id;
    });
    return { run, read: await mintSnapshot(app, member(s.staff), 'order.extracts', { message_id: message, run_id: run }, run) };
  };
  const propose = (r: { run: string; read: { id: string } }, qtyMilli: number) => {
    const ref = { snapshotId: r.read.id, row: 0, col: 'qty' };
    return proposeDraft(
      app,
      { session: s.staff, runId: r.run },
      { command: 'order.confirm', payload: { requestId, customerId: s.customer, lines: [{ itemId: s.saree, qtyMilli }] }, basedOn: [ref], payloadRefs: { 'lines[0].qtyMilli': ref } },
    );
  };
  const misread = await reading(5000);
  expect(misread.read.rows[0]?.qty).toEqual({ kind: 'quantity', num: '5000', unit: 'piece' }); // the database took it
  expect(await propose(misread, 5000).catch((e) => e)).toMatchObject({ code: 'invalid', fields: ['lines[0].qtyMilli'] });
  expect(await propose(await reading(2000), 2000)).toEqual(expect.any(String));
});
