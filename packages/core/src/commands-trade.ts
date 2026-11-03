// Commands for trade: a supplier's bill, stock counts and write-offs, credit, payments and settlements, each with its
// reverse (REV1: one per book, the exact opposite of every row its record wrote, once), and a reorder; then
// the hero chain's evidence writers (a shelf count and a read bill), ops rows that are not books. Helpers from
// commands.ts are used only inside a run, so the value import is safe while commands.ts spreads TRADE_COMMANDS.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import {
  ACCOUNTS,
  at,
  CREDIT_DAYS,
  type CommandResult,
  type Ctx,
  type Def,
  journal,
  keepsStock,
  lockStock,
  methodAccount,
  normalName,
  one,
  parsed,
} from './commands.ts';
import { advanceCreditInput, keepAdvanceAsCredit, orderPaymentInput, recordOrderPayment } from './commands-orders.ts';
import { CoreError } from './errors.ts';
import { mayReadIn } from './read-roles.ts';
import { lineAmount } from './money.ts';
import { type Session, withTx } from './session.ts';
import { addDays, businessDate } from './time.ts';

const id = z.guid();
const minor = z.number().int().safe();
const qtyMilli = z.number().int().positive().safe();
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const tender = z.enum(['cash', 'upi', 'card', 'bank']);
// Money received may also have come through PayPal (D-079: a PayPal payment recorded from its stored notification).
const received = z.enum(['cash', 'upi', 'card', 'bank', 'paypal']);
const reference = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

const purchaseRecord = z.strictObject({
  supplierId: id,
  billNo: z.string().trim().min(1).max(40),
  billDate: day,
  documentId: id.optional(),
  receivedAt: instant.optional(),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli, unitCostMinor: minor.nonnegative(), expiresOn: day.optional() })).min(1).max(200),
});
// expectedQtyMilli: what the books held beside the count (a drafted count cites its on-hand cell for it).
const stockCount = z.strictObject({
  itemId: id,
  countedQtyMilli: z.number().int().nonnegative().safe(),
  expectedQtyMilli: z.number().int().safe().optional(),
  countedAt: instant.optional(),
});
const stockWaste = z.strictObject({ itemId: id, qtyMilli, at: instant.optional() });
const creditRecord = z.strictObject({ customerId: id, amountMinor: minor.positive(), at: instant.optional(), dueOn: day.optional() });
const paymentRecord = z.discriminatedUnion('direction', [
  z.strictObject({
    direction: z.literal('in'),
    customerId: id,
    method: received,
    amountMinor: minor.positive(),
    reference: reference.optional(),
    paidAt: instant.optional(),
  }),
  z.strictObject({
    direction: z.literal('out'),
    supplierId: id,
    method: tender,
    amountMinor: minor.positive(),
    reference: reference.optional(),
    paidAt: instant.optional(),
  }),
]);
const settlementRecord = z.strictObject({
  channel: z.enum(['upi', 'card']),
  businessDate: day,
  amountMinor: minor.positive(),
  reference: reference.optional(),
  receivedOn: day,
});
const reorderPlace = z.strictObject({
  supplierId: id,
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli })).min(1).max(50),
});
// A reversal names its original and a reason code; the row's key to ref.reason_use refuses a code not allowed for the
// reversal use.
const reason = z.string().regex(/^[a-z_]{2,40}$/);
const purchaseReverse = z.strictObject({ purchaseId: id, reason });
const stockReverse = z.strictObject({ moveId: id, reason });
const creditReverse = z.strictObject({ creditId: id, reason });
const paymentReverse = z.strictObject({ paymentId: id, reason });
const settlementReverse = z.strictObject({ settlementId: id, reason });

export type PurchaseInput = z.input<typeof purchaseRecord>;
export type CountInput = z.input<typeof stockCount>;
export type WasteInput = z.input<typeof stockWaste>;
export type CreditInput = z.input<typeof creditRecord>;
export type PaymentInput = z.input<typeof paymentRecord>;
export type SettlementInput = z.input<typeof settlementRecord>;
export type ReorderInput = z.input<typeof reorderPlace>;

// One settlement and its journal entry (bank against the channel's clearing account), as settlement.record writes it and
// settlement.import writes each new line of a statement, with that line's UTR.
export async function writeSettlement(ctx: Ctx, i: z.output<typeof settlementRecord>, utr: string | null = null): Promise<string> {
  const { c, t } = ctx;
  const settlementId = randomUUID();
  await c.query(
    `insert into books.settlement (tenant_id, id, channel, business_date, amount_minor, currency, reference, utr, received_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [t.tenantId, settlementId, i.channel, i.businessDate, i.amountMinor, t.currency, i.reference ?? null, utr, i.receivedOn],
  );
  await journal(ctx, i.receivedOn, 'settlement', ['books.settlement', settlementId], [
    [ACCOUNTS.bank, i.amountMinor],
    [i.channel === 'upi' ? ACCOUNTS.upi : ACCOUNTS.card, -i.amountMinor],
  ]);
  return settlementId;
}

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>, checks?: Def['checks']): Def {
  return { input, run: run as Def['run'], ...(checks ? { checks } : {}) };
}

// A draft of a PayPal payment (method paypal) cites PayPal's stored notice (paypal.event), the office's read (D-082): a
// member who may not read it may neither propose nor approve it. Refused outright, so the draft stays as it was for the
// office (a bad path would mark it stale). Checks run only for a draft: a person's own payment.record is unchanged.
async function paypalReader(c: pg.PoolClient, payload: unknown): Promise<string[]> {
  if ((payload as { method?: unknown }).method === 'paypal' && !(await mayReadIn(c, 'paypal.event'))) throw new CoreError('refused');
  return [];
}

// Each item's name: the latest revision in effect.
const CURRENT_NAMES = `select distinct on (r.item_id) r.item_id::text as id, r.name from books.item_revision r
  where r.effective_from <= now() order by r.item_id, r.effective_from desc, r.created_at desc, r.id desc`;

// The row a reverse undoes. Only a row its own record command wrote (the row's audit entry names the command): the guard
// would admit a sale's stock move, tender or credit here too, and that partial reversal would make the sale's whole one
// fail later. Not a reversal itself, and not reversed yet: the guard's MS013 would say invalid, and a second reversal
// is a conflict. Two at once are serialized on the original's lock, so the second always sees the first's committed
// reversal here (without it, a first committed between this check and the second's insert met the guard's MS013 and
// answered invalid).
type Original = { reverses_id: string | null; created_txid: string; item_id?: string; command: string | null };
async function original(ctx: Ctx, rel: string, rowId: string, field: string, by: string[]): Promise<Original> {
  await ctx.c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.reverse:' || $1 || ':' || $2, 0))`, [ctx.t.tenantId, rowId]);
  const { rows } = await ctx.c.query<Original>(
    `select o.*, a.command from ${rel} o
       left join audit.audit_log a on a.tenant_id = o.tenant_id and a.entity like 'books.%' and a.entity = $2 and a.entity_id = o.id
      where o.id = $1`,
    [rowId, rel],
  );
  const row = rows[0];
  if (!row) throw new CoreError('not_found');
  if (row.reverses_id !== null || !by.includes(row.command ?? '')) throw new CoreError('invalid', { fields: [field] });
  const { rows: done } = await ctx.c.query(`select 1 from ${rel} where reverses_id = $1`, [rowId]);
  if (done.length) throw new CoreError('conflict', { fields: [field] });
  return row;
}

// The journal entries a row caused, each reversed line by line under an entry dated today that names the reversal row.
async function reverseJournal(ctx: Ctx, rel: string, originalId: string, reversalId: string, why: string) {
  const { c, t } = ctx;
  const { rows } = await c.query<{ id: string; memo_code: string }>('select id, memo_code from books.journal_entry where source_rel = $1 and source_id = $2', [
    rel,
    originalId,
  ]);
  for (const e of rows) {
    const entryId = randomUUID();
    await c.query(
      `insert into books.journal_entry (tenant_id, id, entry_date, memo_code, source_rel, source_id, reverses_id, reason) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [t.tenantId, entryId, businessDate(new Date(), t.timeZone), e.memo_code, rel, reversalId, e.id, why],
    );
    await c.query(
      `insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency, reverses_id, reason)
       select tenant_id, $1, account, -amount_minor, currency, id, $2 from books.journal_line where entry_id = $3`,
      [entryId, why, e.id],
    );
  }
}

export const TRADE_COMMANDS: [string, Def][] = [
  [
    // A supplier's bill: the purchase, its lines (with expiry), stock in, and the journal (inventory against payable).
    'purchase.record',
    def(purchaseRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const receivedAt = at(i.receivedAt);
      const total = i.lines.reduce((a, l) => a + lineAmount(l.qtyMilli, l.unitCostMinor), 0);
      const purchaseId = randomUUID();
      await c.query(
        `insert into books.purchase (tenant_id, id, supplier_id, bill_no, bill_date, document_id, total_minor, currency)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.tenantId, purchaseId, i.supplierId, i.billNo, i.billDate, i.documentId ?? null, total, t.currency],
      );
      const cols = {
        n: i.lines.map((_, n) => n + 1),
        item: i.lines.map((l) => l.itemId),
        qty: i.lines.map((l) => l.qtyMilli),
        cost: i.lines.map((l) => l.unitCostMinor),
        exp: i.lines.map((l) => l.expiresOn ?? null),
      };
      await c.query(
        `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on)
         select $1, $2, l.n, l.item, l.qty, l.cost, $3, l.exp
           from unnest($4::int[], $5::uuid[], $6::bigint[], $7::bigint[], $8::date[]) as l(n, item, qty, cost, exp)`,
        [t.tenantId, purchaseId, t.currency, cols.n, cols.item, cols.qty, cols.cost, cols.exp],
      );
      await c.query(
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at)
         select $1, l.item, l.qty, 'purchase', 'books.purchase', $2, l.exp, $3 from unnest($4::uuid[], $5::bigint[], $6::date[]) as l(item, qty, exp)`,
        [t.tenantId, purchaseId, receivedAt, cols.item, cols.qty, cols.exp],
      );
      await journal(ctx, i.billDate, 'purchase', ['books.purchase', purchaseId], [
        [ACCOUNTS.inventory, total],
        [ACCOUNTS.payable, -total],
      ]);
      return { purchaseId };
    }),
  ],
  [
    // A bill entered in error: the purchase, each of its lines under the reversal, the stock it brought in and its
    // journal, each negated from the stored rows. A reversal is dated when it is made; the original keeps its day.
    'purchase.reverse',
    def(purchaseReverse, async (ctx, i) => {
      const { c } = ctx;
      await original(ctx, 'books.purchase', i.purchaseId, 'purchaseId', ['purchase.record']);
      const reversalId = randomUUID();
      await c.query(
        `insert into books.purchase (tenant_id, id, supplier_id, bill_no, bill_date, document_id, bill_read_id, total_minor, currency, reverses_id, reason)
         select tenant_id, $1, supplier_id, bill_no, bill_date, document_id, bill_read_id, -total_minor, currency, id, $2 from books.purchase where id = $3`,
        [reversalId, i.reason, i.purchaseId],
      );
      await c.query(
        `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on, bill_line_id, reverses_id, reason)
         select tenant_id, $1, line_no, item_id, -qty_milli, unit_cost_minor, currency, expires_on, bill_line_id, id, $2
           from books.purchase_line where purchase_id = $3`,
        [reversalId, i.reason, i.purchaseId],
      );
      await c.query(
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at, reverses_id, reason)
         select tenant_id, item_id, -qty_milli, kind, source_rel, $1, expires_on, $2, id, $3
           from books.stock_move where source_rel = 'books.purchase' and source_id = $4`,
        [reversalId, new Date(), i.reason, i.purchaseId],
      );
      await reverseJournal(ctx, 'books.purchase', i.purchaseId, reversalId, i.reason);
      return { reversalId };
    }),
  ],
  [
    // A shelf count: the books' on-hand at that moment is re-derived, and the difference written as one adjustment. A
    // count that states what the books held executes only while they still hold it.
    'stock.count',
    def(stockCount, async (ctx, i) => {
      const { c, t } = ctx;
      const countedAt = at(i.countedAt);
      await lockStock(ctx, i.itemId);
      const { expected } = await one<{ expected: string }>(
        c,
        'select coalesce(sum(qty_milli), 0) as expected from books.stock_move where item_id = $1 and at <= $2',
        [i.itemId, countedAt],
      );
      if (i.expectedQtyMilli !== undefined && i.expectedQtyMilli !== Number(expected)) throw new CoreError('conflict', { fields: ['expectedQtyMilli'] });
      const delta = i.countedQtyMilli - Number(expected);
      let moveId: string | undefined;
      if (delta !== 0) {
        moveId = randomUUID();
        await c.query(`insert into books.stock_move (tenant_id, id, item_id, qty_milli, kind, at) values ($1, $2, $3, $4, 'count_adjust', $5)`, [
          t.tenantId,
          moveId,
          i.itemId,
          delta,
          countedAt,
        ]);
      }
      // Only a count in the past can: the moves after it are added to what was counted.
      if (delta < 0) await keepsStock(ctx, i.itemId, 'countedQtyMilli');
      return { moveId: moveId ?? null };
    }),
  ],
  [
    'stock.waste',
    def(stockWaste, async (ctx, i) => {
      const { c, t } = ctx;
      await lockStock(ctx, i.itemId);
      const moveId = randomUUID();
      await c.query(`insert into books.stock_move (tenant_id, id, item_id, qty_milli, kind, at) values ($1, $2, $3, $4, 'waste', $5)`, [
        t.tenantId,
        moveId,
        i.itemId,
        -i.qtyMilli,
        at(i.at),
      ]);
      await keepsStock(ctx, i.itemId, 'qtyMilli');
      return { moveId };
    }),
  ],
  [
    // A count adjustment or a write-off entered in error, negated under the item's stock lock like the command it undoes.
    // It always runs, even where it takes on-hand below zero: a reversal that could be refused would leave the error in.
    'stock.reverse',
    def(stockReverse, async (ctx, i) => {
      const move = await original(ctx, 'books.stock_move', i.moveId, 'moveId', ['stock.count', 'stock.waste']);
      await lockStock(ctx, move.item_id as string);
      const reversalId = randomUUID();
      await ctx.c.query(
        `insert into books.stock_move (tenant_id, id, item_id, qty_milli, kind, expires_on, at, reverses_id, reason)
         select tenant_id, $1, item_id, -qty_milli, kind, expires_on, $2, id, $3 from books.stock_move where id = $4`,
        [reversalId, new Date(), i.reason, i.moveId],
      );
      return { reversalId };
    }),
  ],
  [
    // Credit given outside a counter sale (the paper khata's opening balance): receivable against opening equity.
    'credit.record',
    // Or an order's advance kept as the customer's credit, when the input names the advance payment (§8.12).
    def(z.union([creditRecord, advanceCreditInput]), async (ctx, i) => {
      if ('paymentId' in i) return keepAdvanceAsCredit(ctx, i);
      const { c, t } = ctx;
      const when = at(i.at);
      const date = businessDate(when, t.timeZone);
      const creditId = randomUUID();
      await c.query(
        `insert into books.credit_entry (tenant_id, id, customer_id, amount_minor, currency, due_on, at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [t.tenantId, creditId, i.customerId, i.amountMinor, t.currency, i.dueOn ?? addDays(date, CREDIT_DAYS), when],
      );
      await journal(ctx, date, 'credit_given', ['books.credit_entry', creditId], [
        [ACCOUNTS.receivable, i.amountMinor],
        [ACCOUNTS.openingEquity, -i.amountMinor],
      ]);
      return { creditId };
    }),
  ],
  [
    'credit.reverse',
    def(creditReverse, async (ctx, i) => {
      await original(ctx, 'books.credit_entry', i.creditId, 'creditId', ['credit.record']);
      const reversalId = randomUUID();
      await ctx.c.query(
        `insert into books.credit_entry (tenant_id, id, customer_id, amount_minor, currency, payment_id, due_on, at, reverses_id, reason)
         select tenant_id, $1, customer_id, -amount_minor, currency, payment_id, due_on, $2, id, $3 from books.credit_entry where id = $4`,
        [reversalId, new Date(), i.reason, i.creditId],
      );
      await reverseJournal(ctx, 'books.credit_entry', i.creditId, reversalId, i.reason);
      return { reversalId };
    }),
  ],
  [
    // A payment as recorded (never processed): a customer repaying credit, or the shop paying a supplier. The amount is
    // positive; the direction carries its meaning (R4 N6).
    'payment.record',
    // Or an order's advance in, or its refund out, when the input names the order (§8.12). A draft of it runs
    // paypalReader's check.
    def(z.union([paymentRecord, orderPaymentInput]), async (ctx, i) => {
      if ('orderId' in i) return recordOrderPayment(ctx, i);
      const { c, t } = ctx;
      const paidAt = at(i.paidAt);
      const date = businessDate(paidAt, t.timeZone);
      const paymentId = randomUUID();
      const party = i.direction === 'in' ? i.customerId : i.supplierId;
      await c.query(
        `insert into books.payment (tenant_id, id, direction, method, amount_minor, currency, customer_id, supplier_id, reference, paid_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          t.tenantId,
          paymentId,
          i.direction,
          i.method,
          i.amountMinor,
          t.currency,
          i.direction === 'in' ? party : null,
          i.direction === 'out' ? party : null,
          i.reference ?? null,
          paidAt,
        ],
      );
      if (i.direction === 'in') {
        await c.query(
          `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, payment_id, at) values ($1, $2, $3, $4, $5, $6)`,
          [t.tenantId, party, -i.amountMinor, t.currency, paymentId, paidAt],
        );
      }
      const toward = i.direction === 'in' ? ACCOUNTS.receivable : ACCOUNTS.payable;
      const sign = i.direction === 'in' ? 1 : -1;
      await journal(ctx, date, i.direction === 'in' ? 'credit_repaid' : 'supplier_paid', ['books.payment', paymentId], [
        [methodAccount(i.method), sign * i.amountMinor],
        [toward, -sign * i.amountMinor],
      ]);
      return { paymentId };
    }, paypalReader),
  ],
  [
    // A repayment or a supplier payment recorded in error: the payment, the credit it repaid and its journal. A sale's
    // tender is the sale's to reverse; a wage or an advance its own command's.
    'payment.reverse',
    def(paymentReverse, async (ctx, i) => {
      const { c } = ctx;
      const paid = await original(ctx, 'books.payment', i.paymentId, 'paymentId', ['payment.record']);
      const now = new Date();
      const reversalId = randomUUID();
      await c.query(
        `insert into books.payment (tenant_id, id, direction, method, amount_minor, currency, customer_id, supplier_id, staff_id, purchase_id, order_id, reference,
                                    paid_at, reverses_id, reason)
         select tenant_id, $1, direction, method, -amount_minor, currency, customer_id, supplier_id, staff_id, purchase_id, order_id, reference, $2, id, $3
           from books.payment where id = $4`,
        [reversalId, now, i.reason, i.paymentId],
      );
      // Only the credit the payment's own transaction wrote: a later entry naming it (an order's advance kept as credit)
      // is credit.record's, and reverses with credit.reverse.
      await c.query(
        `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, payment_id, due_on, at, reverses_id, reason)
         select tenant_id, customer_id, -amount_minor, currency, $1, due_on, $2, id, $3
           from books.credit_entry where payment_id = $4 and created_txid = $5`,
        [reversalId, now, i.reason, i.paymentId, paid.created_txid],
      );
      await reverseJournal(ctx, 'books.payment', i.paymentId, reversalId, i.reason);
      return { reversalId };
    }),
  ],
  [
    // The provider's payout for a business day's UPI or card takings, as recorded: bank against the clearing account.
    'settlement.record',
    def(settlementRecord, async (ctx, i) => ({ settlementId: await writeSettlement(ctx, i) })),
  ],
  [
    // A payout recorded in error: received_on is the day it is reversed, and the day's settlement may be recorded again.
    'settlement.reverse',
    def(settlementReverse, async (ctx, i) => {
      await original(ctx, 'books.settlement', i.settlementId, 'settlementId', ['settlement.record', 'settlement.import']);
      const reversalId = randomUUID();
      await ctx.c.query(
        `insert into books.settlement (tenant_id, id, channel, business_date, amount_minor, currency, reference, received_on, reverses_id, reason)
         select tenant_id, $1, channel, business_date, -amount_minor, currency, reference, $2, id, $3 from books.settlement where id = $4`,
        [reversalId, businessDate(new Date(), ctx.t.timeZone), i.reason, i.settlementId],
      );
      await reverseJournal(ctx, 'books.settlement', i.settlementId, reversalId, i.reason);
      return { reversalId };
    }),
  ],
  [
    // A reorder goes out as a message to the (simulated) supplier, its text composed here from the books. The words
    // live in an erasable ops.message_text; the book row keeps only its id and sha256 (b_outbound_derive checks both),
    // and the database derives the message's delivery (recorded: a simulated supplier is never sent anything real).
    'reorder.place',
    def(reorderPlace, async (ctx, i) => {
      const { c, t } = ctx;
      await one(c, 'select 1 from books.supplier where id = $1', [i.supplierId]);
      const { rows } = await c.query<{ id: string; name: string; unit: string }>(
        `select n.id, n.name, it.unit from (${CURRENT_NAMES}) n join books.item it on it.id = n.id::uuid where n.id = any($1::text[])`,
        [i.lines.map((l) => l.itemId)],
      );
      const items = new Map(rows.map((r) => [r.id, r]));
      const lines = i.lines.map((l) => {
        const it = items.get(l.itemId);
        if (!it) throw new CoreError('not_found');
        const n = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(l.qtyMilli / 1000);
        return `${it.unit === 'piece' || it.unit === 'pack' ? n : `${n} ${it.unit}`} × ${it.name}`;
      });
      const body = `Reorder from ${t.name}: ${lines.join('; ')}.`;
      const { rows: text } = await c.query<{ id: string; body_sha256: Buffer }>(
        `insert into ops.message_text (tenant_id, body, author) values ($1, $2, 'template') returning id, body_sha256`,
        [t.tenantId, body],
      );
      const { id: textId, body_sha256: sha } = text[0] as { id: string; body_sha256: Buffer };
      const messageId = randomUUID();
      await c.query(
        `insert into books.outbound_message (tenant_id, id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256)
         values ($1, $2, $3, 'supplier', $4, 'reorder', $5, $6)`,
        [t.tenantId, messageId, i.channel, i.supplierId, textId, sha],
      );
      return { messageId, textId };
    }),
  ],
];

// ---- the hero chain's evidence ------------------------------------------------------------------------------
// Not books: ops rows a photo run stores, each turned into cells only by a named read (count.shelf, bill.lines in
// queries-count.ts). The tables hold the rules: a count whose response was edited after it was hashed, or that is not
// the response's number of matches, is refused; so is a bill figure with no place on the page.

// A photo run's evidence is stored as the member whose run it is: evidence_guard admits it from an active member only.
export type PhotoRun = { session: Session; runId: string };

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const model = z.string().regex(/^[A-Za-z0-9._:/-]{1,80}$/);
const shelfCount = z.strictObject({
  itemId: id,
  photoSha256: sha256,
  phrase: z.string().trim().min(1).max(200),
  model,
  raw: z.string().max(20_000),
  rawSha256: sha256,
  matches: z.number().int().nonnegative(),
});
// A place the vision model could not give is passed on as null and stored as no place, which the table refuses
// (bill_line_placed).
const place = z.array(z.number().int()).length(4).nullable();
const billRead = z.strictObject({
  supplierId: id,
  photoSha256: sha256,
  model,
  billNo: z.string().trim().min(1).max(40).nullable(),
  billDate: day.nullable(),
  lines: z
    .array(z.strictObject({ text: z.string().trim().min(1).max(200), qtyMilli, qtyAt: place, unitCostMinor: minor.nonnegative(), unitCostAt: place }))
    .min(1)
    .max(200),
});

const COUNTABLE = ['pack', 'piece'];
const bytes = (hex: string) => Buffer.from(hex, 'hex');

// One catalogue item counted on a shelf photo: the segment model's raw response, its sha256 and its number of matches.
export async function recordShelfCount(pool: pg.Pool, by: PhotoRun, input: z.input<typeof shelfCount>): Promise<string> {
  const i = parsed(shelfCount, input);
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const { unit } = await one<{ unit: string }>(c, 'select unit from books.item where id = $1', [i.itemId]);
    if (!COUNTABLE.includes(unit)) throw new CoreError('invalid', { fields: ['itemId'] }); // loose goods are weighed, not counted
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.shelf_count (tenant_id, run_id, item_id, photo_sha256, phrase, model, raw, raw_sha256, matches)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [by.session.tenantId, by.runId, i.itemId, bytes(i.photoSha256), i.phrase, i.model, i.raw, bytes(i.rawSha256), i.matches],
    );
    return (rows[0] as { id: string }).id;
  });
}

// A supplier's bill as read: each line's text is matched here, by plain code, to the one catalogue item whose current
// name or an alias it spells (normalName); none, or more than one, leaves the line unmatched. No model chooses the item.
export async function recordBillRead(pool: pg.Pool, by: PhotoRun, input: z.input<typeof billRead>): Promise<string> {
  const i = parsed(billRead, input);
  return withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    const { rows: names } = await c.query<{ id: string; name: string }>(
      `select id, name from (${CURRENT_NAMES}) n union all select item_id::text, alias from books.item_alias`,
    );
    const spelled = new Map<string, Set<string>>();
    for (const n of names) spelled.set(normalName(n.name), (spelled.get(normalName(n.name)) ?? new Set()).add(n.id));
    const match = (text: string) => {
      const ids = [...(spelled.get(normalName(text)) ?? [])];
      return ids.length === 1 ? ids[0] : null;
    };
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.bill_read (tenant_id, run_id, supplier_id, photo_sha256, model, bill_no, bill_date)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [by.session.tenantId, by.runId, i.supplierId, bytes(i.photoSha256), i.model, i.billNo, i.billDate],
    );
    const billId = (rows[0] as { id: string }).id;
    for (const [n, l] of i.lines.entries()) {
      await c.query(
        `insert into ops.bill_line (tenant_id, bill_read_id, line_no, item_text, item_id, qty_milli, unit_cost_minor, qty_box, cost_box)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [by.session.tenantId, billId, n + 1, l.text, match(l.text), l.qtyMilli, l.unitCostMinor, l.qtyAt ?? [], l.unitCostAt ?? []],
      );
    }
    return billId;
  });
}
