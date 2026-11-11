// Commands for orders. An order enters the books only by order.confirm, a person's own command or an approved draft: in
// one transaction the order, its lines at the books' prices now (or the person's own typed quote, an ops.member_input
// labelled as theirs), the confirmed step with the customer's update, and the request it confirms. Each later status
// change is its own command (order.step, order.reschedule, order.cancel) and writes the customer's update where the
// step's template has one, the way reorder.place writes its message. A line's amount is the counter's line function
// over its cited price; the total is the lines' sum, never stored. Then the writers other commands call inside their
// own transactions (the advance and its way back, the delivered step) and measurements, an ops action. Helpers from
// commands.ts are used only inside a run, so the value import is safe while commands.ts spreads ORDER_COMMANDS.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { refuseParts } from './capabilities.ts';
import { ACCOUNTS, at, type Checks, type CommandResult, type Ctx, type Def, journal, methodAccount, one, parsed } from './commands.ts';
import { CoreError } from './errors.ts';
import { newOrderCode } from './intake.ts';
import { formatMoney, lineAmount } from './money.ts';
import { unappliedAdvance } from './queries-orders.ts';
import { type Cell, readSpan, resolveRef } from './read.ts';
import { type Session, withTx } from './session.ts';
import { businessDate } from './time.ts';

const id = z.guid();
const minor = z.number().int().safe();
const qtyMilli = z.number().int().positive().safe();
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const reason = z.string().regex(/^[a-z_]{2,40}$/); // a ref.reason code of the column's use; its key refuses any other
const ADVANCE = 'customer_advance';

// A line: an item and its quantity, priced by the books.price in effect, or by the quote the person types here
// (quoteMinor: stored as their own ops.member_input). A stitching line may name the measurement it is cut to.
const orderLine = z.strictObject({ itemId: id, qtyMilli, quoteMinor: minor.nonnegative().optional(), measurementId: id.optional() });
// A request's own shop, code and (for a site or widget cart) lines are used; a phone order names its shop and lines.
// The customer is a books row, or a person in the vault (the request's contact) who becomes one.
const orderConfirm = z
  .strictObject({
    requestId: id.optional(),
    shopId: id.optional(),
    customerId: id.optional(),
    contactId: id.optional(),
    kind: z.enum(['goods', 'stitching', 'alteration']).optional(),
    dueOn: day.optional(),
    trialOn: day.optional(),
    lines: z.array(orderLine).min(1).max(50).optional(),
  })
  .refine((i) => (i.customerId === undefined) !== (i.contactId === undefined), { path: ['customerId'] })
  .refine((i) => i.requestId !== undefined || (i.shopId !== undefined && i.lines !== undefined), { path: ['requestId'] });
const orderStep = z.strictObject({ orderId: id, step: z.enum(['packed', 'cutting', 'stitching', 'trial', 'ready', 'out_for_delivery']) });
const orderReschedule = z
  .strictObject({ orderId: id, dueOn: day.optional(), trialOn: day.optional(), reason: reason.optional() })
  .refine((i) => i.dueOn !== undefined || i.trialOn !== undefined, { path: ['dueOn'] });
const orderCancel = z.strictObject({ orderId: id, reason });

export type OrderConfirmInput = z.input<typeof orderConfirm>;

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>, checks?: Checks): Def {
  return { input, run: run as Def['run'], ...(checks ? { checks } : {}) };
}

type Order = { id: string; code: string; kind: string; customer_id: string };

async function orderOf(c: pg.ClientBase, orderId: string, live = true): Promise<Order> {
  const { rows } = await c.query<Order>(
    `select o.id::text as id, o.code, o.kind, o.customer_id::text as customer_id from books.order o
      where o.id = $1 and o.reverses_id is null
        and (not $2::boolean or not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id))`,
    [orderId, live],
  );
  if (!rows[0]) throw new CoreError('not_found');
  return rows[0];
}

// The customer's update for each step template ref.order_step names, composed here from the books: the shop's name,
// the order's code and, where the step sets them, the total and dates. No person's name.
type Words = { shop: string; code: string; total?: string; dueOn?: string | undefined; trialOn?: string | undefined };
const dated = (w: Words) => [w.dueOn && `due on ${w.dueOn}`, w.trialOn && `trial on ${w.trialOn}`].filter(Boolean).join(', ');
const UPDATES: Record<string, (w: Words) => string> = {
  order_confirmed: (w) => `Order ${w.code} from ${w.shop} is confirmed: ${w.total}${dated(w) ? `, ${dated(w)}` : ''}.`,
  order_trial: (w) => `Order ${w.code} from ${w.shop} is ready for your trial.`,
  order_ready: (w) => `Order ${w.code} from ${w.shop} is ready.`,
  order_out_for_delivery: (w) => `Order ${w.code} from ${w.shop} is out for delivery.`,
  order_delivered: (w) => `Order ${w.code} from ${w.shop} is delivered. Thank you.`,
  order_cancelled: (w) => `Order ${w.code} from ${w.shop} is cancelled.`,
  order_rescheduled: (w) => `Order ${w.code} from ${w.shop} is now ${dated(w)}.`,
};

// The words live in an erasable ops.message_text; the book row keeps its id and sha256, and the database derives its
// delivery (recorded off live). None when the step has no template.
async function customerUpdate(ctx: Ctx, order: Order, step: string, words: Omit<Words, 'shop' | 'code'> = {}): Promise<string | null> {
  const { template } = await one<{ template: string | null }>(ctx.c, 'select template_code as template from ref.order_step where code = $1', [step]);
  if (template === null) return null;
  const compose = UPDATES[template];
  if (!compose) throw new CoreError('internal'); // a template seeded with no text here
  const { rows } = await ctx.c.query<{ id: string; body_sha256: Buffer }>(
    `insert into ops.message_text (tenant_id, body, author) values ($1, $2, 'template') returning id, body_sha256`,
    [ctx.t.tenantId, compose({ shop: ctx.t.name, code: order.code, ...words })],
  );
  const text = rows[0] as { id: string; body_sha256: Buffer };
  const messageId = randomUUID();
  await ctx.c.query(
    `insert into books.outbound_message (tenant_id, id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256, order_id)
     values ($1, $2, 'whatsapp', 'customer', $3, $4, $5, $6, $7)`,
    [ctx.t.tenantId, messageId, order.customer_id, template, text.id, text.body_sha256, order.id],
  );
  return messageId;
}

// b_order_flow numbers the step (latest + 1, so two taps race on the unique key), judges the move and its command.
async function addStep(ctx: Ctx, order: Order, step: string, cols: { dueOn?: string | undefined; trialOn?: string | undefined; reason?: string | undefined; messageId: string | null }) {
  const stepId = randomUUID();
  await ctx.c.query(
    `insert into books.order_step (tenant_id, id, order_id, step, due_on, trial_on, message_id, reason, at) values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [ctx.t.tenantId, stepId, order.id, step, cols.dueOn ?? null, cols.trialOn ?? null, cols.messageId, cols.reason ?? null],
  );
  return stepId;
}

// A phone order's code: one no live order or request holds (the status page finds an order by its code).
async function freshCode(c: pg.ClientBase): Promise<string> {
  for (;;) {
    const code = newOrderCode();
    const { rows } = await c.query('select 1 from books.order where code = $1 union all select 1 from ops.order_request where code = $1', [code]);
    if (rows.length === 0) return code;
  }
}

// A drafted order (the AI's, from a message request) carries no number of its own. Each line's quantity must cite
// the quantity cell of the order.extracts read over that request's message, on the row whose item is the line's item,
// and core re-reads that span from the message (readSpan): the database re-parses a digit span as it is stored, but
// takes a span in words on trust. A draft carries no typed quote (the approver types their own), and its basedOn cites,
// for each line, the items.price cell of its item, equal to the price in effect: approval re-checks that cell, so a
// price set between proposal and approval makes the draft stale instead of promising a price nobody saw. Run
// at proposal and again at approval.
// The extract's span, read again from its live message, is a whole count of `qtyMilli` thousandths.
async function readsAs(c: pg.PoolClient, extract: Cell | null, qtyMilli: number): Promise<boolean> {
  if (extract?.kind !== 'text') return false;
  const { rows } = await c.query<{ source: string; span_start: number; span_end: number; num: string }>(
    `select coalesce(i.transcript, i.text) as source, e.span_start, e.span_end, e.num from ops.inbound_extract e
       join ops.inbound_message i on i.tenant_id = e.tenant_id and i.id = e.message_id
      where e.id = $1 and e.field = 'quantity' and i.erased_at is null`,
    [extract.txt],
  );
  const x = rows[0];
  if (!x?.source) return false;
  const read = readSpan(x.source, { start: x.span_start, end: x.span_end }, { field: 'quantity' });
  return read.ok && read.field === 'quantity' && read.count * 1000 === Number(x.num) && Number(x.num) === qtyMilli;
}

const draftedLines: Checks = async (c, payload, refs, basedOn) => {
  const p = payload as z.output<typeof orderConfirm>;
  if (p.requestId === undefined) return ['requestId'];
  const { rows } = await c.query<{ message_id: string | null }>('select inbound_message_id::text as message_id from ops.order_request where id = $1', [p.requestId]);
  const message = rows[0]?.message_id;
  if (!message) return ['requestId'];
  if (!p.lines) return ['lines'];
  const bad: string[] = [];
  const priced = new Map<string, Cell>();
  for (const ref of basedOn.filter((r) => r.col === 'price')) {
    const { rows: snap } = await c.query<{ query_name: string }>('select query_name from snap.snapshot where id = $1', [ref.snapshotId]);
    const item = snap[0]?.query_name === 'items.price' ? await resolveRef(c, { ...ref, col: 'item_id' }) : null;
    const cell = await resolveRef(c, ref);
    if (item?.kind === 'text' && cell) priced.set(item.txt, cell);
  }
  const { rows: now } = await c.query<{ item_id: string; amount_minor: string }>(
    `select distinct on (p.item_id) p.item_id::text as item_id, p.amount_minor from books.price p
      where p.item_id = any($1::uuid[]) and p.effective_from <= now() and p.currency = (select currency from ops.tenant)
      order by p.item_id, p.effective_from desc, p.created_at desc, p.id desc`,
    [p.lines.map((l) => l.itemId)],
  );
  const current = new Map(now.map((r) => [r.item_id, r.amount_minor]));
  for (const [n, l] of p.lines.entries()) {
    const cited = priced.get(l.itemId);
    if (cited?.kind !== 'money' || cited.num !== current.get(l.itemId)) bad.push(`lines[${n}].price`);
    if (l.quoteMinor !== undefined) bad.push(`lines[${n}].quoteMinor`);
    const ref = refs[`lines[${n}].qtyMilli`];
    const snap = ref
      ? (await c.query<{ query_name: string; params: { message_id?: string } }>('select query_name, params from snap.snapshot where id = $1', [ref.snapshotId])).rows[0]
      : undefined;
    const item = ref ? await resolveRef(c, { ...ref, col: 'item_id' }) : null;
    if (snap?.query_name !== 'order.extracts' || snap.params.message_id !== message || ref?.col !== 'qty' || item?.kind !== 'text' || item.txt !== l.itemId) {
      bad.push(`lines[${n}].qtyMilli`);
    } else if (!(await readsAs(c, await resolveRef(c, { ...ref, col: 'extract_id' }), l.qtyMilli))) {
      bad.push(`lines[${n}].qtyMilli`);
    }
  }
  return bad;
};

type Priced = { n: number; item: string; kind: string; priceId: string | null; quoteId: string | null; qty: number; unit: number; gross: number; m: string | null };
type Request = { id: string; shop_id: string; code: string; kind: string; state: string; lines: { itemId: string; qtyMilli: number }[] | null };

export const ORDER_COMMANDS: [string, Def][] = [
  [
    'order.confirm',
    def(
      orderConfirm,
      async (ctx, i) => {
        const { c, t } = ctx;
        // Locked, so a second confirmation waits and then finds it handled.
        const request = i.requestId
          ? await one<Request>(c, 'select id::text as id, shop_id::text as shop_id, code, kind, state, lines from ops.order_request where id = $1 for update', [
              i.requestId,
            ])
          : undefined;
        if (request && request.state !== 'new' && request.state !== 'drafted') throw new CoreError('conflict', { fields: ['requestId'] });
        if (request?.lines && i.lines) throw new CoreError('invalid', { fields: ['lines'] }); // a cart's lines are its stored ones
        const lines: z.output<typeof orderLine>[] = request?.lines ?? i.lines ?? [];
        if (lines.length === 0) throw new CoreError('invalid', { fields: ['lines'] });
        const shopId = request ? request.shop_id : i.shopId;
        const kind = i.kind ?? request?.kind ?? 'goods';
        // Stitching and alteration are a part of orders with a capability of their own; a goods order needs orders
        // alone, which the base check after the body holds.
        if (kind !== 'goods') await refuseParts(c, ['stitching']);

        let customerId = i.customerId;
        if (customerId === undefined) {
          customerId = randomUUID();
          await c.query('insert into books.customer (tenant_id, id) values ($1, $2)', [t.tenantId, customerId]);
          await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [
            t.tenantId,
            customerId,
            i.contactId,
          ]);
        }

        // The price each line is promised at: the books.price in effect now, in the shop's currency (as the counter
        // quotes it), or the person's own typed quote.
        const ids = [...new Set(lines.map((l) => l.itemId))];
        const { rows: items } = await c.query<{ id: string; kind: string }>('select id::text as id, kind from books.item where id = any($1::uuid[])', [ids]);
        const { rows: prices } = await c.query<{ item_id: string; id: string; amount_minor: string }>(
          `select distinct on (p.item_id) p.item_id::text as item_id, p.id::text as id, p.amount_minor from books.price p
            where p.item_id = any($1::uuid[]) and p.effective_from <= now() and p.currency = $2
            order by p.item_id, p.effective_from desc, p.created_at desc, p.id desc`,
          [ids, t.currency],
        );
        const itemKind = new Map(items.map((r) => [r.id, r.kind]));
        const price = new Map(prices.map((p) => [p.item_id, p]));
        const priced: Priced[] = [];
        for (const [n, l] of lines.entries()) {
          const k = itemKind.get(l.itemId);
          if (k === undefined) throw new CoreError('invalid', { fields: [`lines.${n}.itemId`] });
          let priceId: string | null = null;
          let quoteId: string | null = null;
          let unit: number;
          if (l.quoteMinor !== undefined) {
            // The member and transaction are stamped by input_guard: the quote is the acting person's own.
            const { rows } = await c.query<{ id: string }>(
              `insert into ops.member_input (tenant_id, path, kind, num, currency) values ($1, $2, 'money', $3, $4) returning id`,
              [t.tenantId, `lines[${n}].quoteMinor`, l.quoteMinor, t.currency],
            );
            quoteId = (rows[0] as { id: string }).id;
            unit = l.quoteMinor;
          } else {
            const p = price.get(l.itemId);
            if (p === undefined) throw new CoreError('invalid', { fields: [`lines.${n}.itemId`] }); // no price in effect: quote it
            priceId = p.id;
            unit = Number(p.amount_minor);
          }
          priced.push({ n: n + 1, item: l.itemId, kind: k, priceId, quoteId, qty: l.qtyMilli, unit, gross: lineAmount(l.qtyMilli, unit), m: l.measurementId ?? null });
        }

        const order: Order = { id: randomUUID(), code: request?.code ?? (await freshCode(c)), kind, customer_id: customerId };
        await c.query('insert into books.order (tenant_id, id, shop_id, request_id, customer_id, kind, code, currency) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
          t.tenantId,
          order.id,
          shopId,
          request?.id ?? null,
          customerId,
          kind,
          order.code,
          t.currency,
        ]);
        const col = <K extends keyof (typeof priced)[number]>(k: K) => priced.map((l) => l[k]);
        await c.query(
          `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, quote_input_id, qty_milli, unit_price_minor, gross_minor, currency, measurement_id)
           select $1, $2, l.n, l.item, l.kind, l.price, l.quote, l.qty, l.unit, l.gross, $3, l.m
             from unnest($4::int[], $5::uuid[], $6::text[], $7::uuid[], $8::uuid[], $9::bigint[], $10::bigint[], $11::bigint[], $12::uuid[])
                  as l(n, item, kind, price, quote, qty, unit, gross, m)`,
          [t.tenantId, order.id, t.currency, col('n'), col('item'), col('kind'), col('priceId'), col('quoteId'), col('qty'), col('unit'), col('gross'), col('m')],
        );
        const total = formatMoney({ minor: priced.reduce((a, l) => a + l.gross, 0), currency: t.currency });
        const messageId = await customerUpdate(ctx, order, 'confirmed', { total, dueOn: i.dueOn, trialOn: i.trialOn });
        const stepId = await addStep(ctx, order, 'confirmed', { dueOn: i.dueOn, trialOn: i.trialOn, messageId });
        // Last: order_request_flow admits confirmed only beside the order naming the request, written in this transaction.
        if (request) await c.query(`update ops.order_request set state = 'confirmed' where id = $1`, [request.id]);
        return { orderId: order.id, stepId, messageId, customerId };
      },
      draftedLines,
    ),
  ],
  [
    'order.step',
    def(orderStep, async (ctx, i) => {
      const order = await orderOf(ctx.c, i.orderId);
      const messageId = await customerUpdate(ctx, order, i.step);
      return { stepId: await addStep(ctx, order, i.step, { messageId }), messageId };
    }),
  ],
  [
    'order.reschedule',
    def(orderReschedule, async (ctx, i) => {
      const order = await orderOf(ctx.c, i.orderId);
      const messageId = await customerUpdate(ctx, order, 'rescheduled', { dueOn: i.dueOn, trialOn: i.trialOn });
      return { stepId: await addStep(ctx, order, 'rescheduled', { dueOn: i.dueOn, trialOn: i.trialOn, reason: i.reason, messageId }), messageId };
    }),
  ],
  [
    // A cancellation releases the promise; any advance goes back through payment.record (a refund naming the order) or
    // stays as the customer's credit (credit.record naming the advance payment): order.cancel writes no money.
    'order.cancel',
    def(orderCancel, async (ctx, i) => {
      const order = await orderOf(ctx.c, i.orderId);
      const messageId = await customerUpdate(ctx, order, 'cancelled');
      return { stepId: await addStep(ctx, order, 'cancelled', { reason: i.reason, messageId }), messageId };
    }),
  ],
];

// ---- writers other commands call inside their own transactions ------------------------------------------------
// The advance and its way back. payment.record and credit.record live in commands-trade.ts: each calls one of these
// when its input names an order, and the guard admits the rows under that command.

// An advance may also have come through PayPal (recorded from PayPal's stored notification); a refund never goes back
// through it.
const tender = z.enum(['cash', 'upi', 'card', 'bank', 'paypal']);
export const orderPaymentInput = z
  .strictObject({
    orderId: id,
    direction: z.enum(['in', 'out']),
    method: tender,
    amountMinor: minor.positive(),
    reference: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    paidAt: instant.optional(),
  })
  .refine((i) => i.method !== 'paypal' || i.direction === 'in', { path: ['method'] });
export const advanceCreditInput = z.strictObject({ paymentId: id, amountMinor: minor.positive(), at: instant.optional() });
export type OrderPaymentInput = z.input<typeof orderPaymentInput>;
export type AdvanceCreditInput = z.input<typeof advanceCreditInput>;

// Two refunds of one advance cannot both pass the balance check, nor a refund and the delivery sale applying it.
export async function lockAdvance(ctx: Ctx, orderId: string) {
  await ctx.c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.advance:' || $1 || ':' || $2, 0))`, [ctx.t.tenantId, orderId]);
}

export async function advanceHeld(c: pg.PoolClient, orderId: string): Promise<number> {
  const { held } = await one<{ held: string }>(c, `select ${unappliedAdvance('o')} as held from books.order o where o.id = $1`, [orderId]);
  return Number(held);
}

// payment.record naming an order (recorded, never processed): in, an advance on an open order, the method's account
// against customer_advance; out, a refund of what is still held. Neither touches the customer's udhaar.
export async function recordOrderPayment(ctx: Ctx, input: OrderPaymentInput): Promise<CommandResult> {
  const i = parsed(orderPaymentInput, input);
  const { c, t } = ctx;
  const order = await orderOf(c, i.orderId, i.direction === 'in');
  await lockAdvance(ctx, order.id);
  if (i.direction === 'in') {
    const { open } = await one<{ open: boolean }>(
      c,
      'select not r.terminal as open from ops.order_state st join ref.order_step r on r.code = st.step where st.order_id = $1',
      [order.id],
    );
    if (!open) throw new CoreError('invalid', { fields: ['orderId'] });
  } else if (i.amountMinor > (await advanceHeld(c, order.id))) {
    throw new CoreError('invalid', { fields: ['amountMinor'] });
  }
  const paidAt = at(i.paidAt);
  const paymentId = randomUUID();
  await c.query(
    `insert into books.payment (tenant_id, id, direction, method, amount_minor, currency, customer_id, order_id, reference, paid_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [t.tenantId, paymentId, i.direction, i.method, i.amountMinor, t.currency, order.customer_id, order.id, i.reference ?? null, paidAt],
  );
  const sign = i.direction === 'in' ? 1 : -1;
  await journal(ctx, businessDate(paidAt, t.timeZone), i.direction === 'in' ? 'order_advance' : 'order_refund', ['books.payment', paymentId], [
    [methodAccount(i.method), sign * i.amountMinor],
    [ADVANCE, -sign * i.amountMinor],
  ]);
  return { paymentId };
}

// credit.record naming an advance payment: what is still held becomes the customer's credit, a negative credit entry
// (in their favour) against customer_advance.
export async function keepAdvanceAsCredit(ctx: Ctx, input: AdvanceCreditInput): Promise<CommandResult> {
  const i = parsed(advanceCreditInput, input);
  const { c, t } = ctx;
  const { order_id } = await one<{ order_id: string }>(
    c,
    `select order_id::text as order_id from books.payment where id = $1 and direction = 'in' and order_id is not null and reverses_id is null`,
    [i.paymentId],
  );
  const order = await orderOf(c, order_id, false);
  await lockAdvance(ctx, order.id);
  if (i.amountMinor > (await advanceHeld(c, order.id))) throw new CoreError('invalid', { fields: ['amountMinor'] });
  const when = at(i.at);
  const creditId = randomUUID();
  await c.query('insert into books.credit_entry (tenant_id, id, customer_id, amount_minor, currency, payment_id, at) values ($1, $2, $3, $4, $5, $6, $7)', [
    t.tenantId,
    creditId,
    order.customer_id,
    -i.amountMinor,
    t.currency,
    i.paymentId,
    when,
  ]);
  await journal(ctx, businessDate(when, t.timeZone), 'advance_kept', ['books.credit_entry', creditId], [
    [ADVANCE, i.amountMinor],
    [ACCOUNTS.receivable, -i.amountMinor],
  ]);
  return { creditId };
}

// The order's side of its delivery, for sale.record to call once its sale naming the order and that sale's lines are
// written (commands-sale.ts): the sale has exactly the order's lines (each naming its order line, with its item,
// quantity and promised unit price), then the customer's update and the delivered step, in the sale's transaction.
export async function orderDelivered(c: pg.PoolClient, orderId: string): Promise<{ stepId: string; messageId: string | null }> {
  const { rows } = await c.query<{ tenant_id: string; currency: string; time_zone: string; name: string }>(
    'select tenant_id::text as tenant_id, currency, time_zone, name from ops.tenant',
  );
  const t = rows[0];
  if (!t || rows.length !== 1) throw new CoreError('not_found');
  const ctx: Ctx = { c, t: { tenantId: t.tenant_id, currency: t.currency, timeZone: t.time_zone, name: t.name } };
  const order = await orderOf(c, orderId);
  const { off } = await one<{ off: number }>(
    c,
    `select count(*)::int as off
       from (select sl.order_line_id, sl.item_id, sl.qty_milli, sl.unit_price_minor from books.sale_line sl
               join books.sale s on s.tenant_id = sl.tenant_id and s.id = sl.sale_id
              where s.order_id = $1 and s.reverses_id is null and s.created_txid = txid_current()) sl
       full join (select id, item_id, qty_milli, unit_price_minor from books.order_line where order_id = $1 and reverses_id is null) ol
         on ol.id = sl.order_line_id and ol.item_id = sl.item_id and ol.qty_milli = sl.qty_milli and ol.unit_price_minor = sl.unit_price_minor
      where sl.order_line_id is null or ol.id is null`,
    [orderId],
  );
  if (off !== 0) throw new CoreError('invalid', { fields: ['lines'] });
  const messageId = await customerUpdate(ctx, order, 'delivered');
  return { stepId: await addStep(ctx, order, 'delivered', { messageId }), messageId };
}

// ---- measurements: body data about a person, on the vault side (an ops action, not a command) -------------------

const measurementTake = z.strictObject({
  contactId: id,
  note: z.string().trim().min(1).max(200).optional(),
  values: z.record(z.string().regex(/^[a-z_]{2,40}$/), z.number().int().min(1).max(3000)).refine((v) => Object.keys(v).length > 0),
});
export type MeasurementInput = z.input<typeof measurementTake>;

// Any active member takes one (the database stamps the taker); every value in the same transaction.
export async function takeMeasurement(pool: pg.Pool, session: Session, input: MeasurementInput): Promise<string> {
  const i = parsed(measurementTake, input);
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const measurementId = randomUUID();
    await c.query('insert into ops.measurement (tenant_id, id, contact_id, note) values ($1, $2, $3, $4)', [session.tenantId, measurementId, i.contactId, i.note ?? null]);
    const points = Object.entries(i.values);
    await c.query(
      `insert into ops.measurement_value (tenant_id, measurement_id, point, mm) select $1, $2, v.point, v.mm from unnest($3::text[], $4::int[]) as v(point, mm)`,
      [session.tenantId, measurementId, points.map((p) => p[0]), points.map((p) => p[1])],
    );
    return measurementId;
  });
}

// For the contact's erasure to call in its own transaction, after the contact's row: its measurements' notes, then
// every value. Returns how many measurements it erased.
export async function eraseMeasurements(c: pg.ClientBase, contactId: string): Promise<number> {
  const m = await c.query('update ops.measurement set note = null, erased_at = now() where contact_id = $1 and erased_at is null', [contactId]);
  await c.query(
    `update ops.measurement_value v set mm = null, erased_at = now() from ops.measurement m
      where m.tenant_id = v.tenant_id and m.id = v.measurement_id and m.contact_id = $1 and v.erased_at is null`,
    [contactId],
  );
  return m.rowCount ?? 0;
}
