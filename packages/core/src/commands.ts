// The commands that write the books. Each has an input schema and a body that writes its rows; the body runs either as
// a person's direct command (runCommand: munshi.command set, the guard checks the member's authority) or inside decide()
// under an approved decision. Amounts are re-derived here from the books (prices, costs, on-hand) — a caller's total is
// never taken. Each command's tables are its rows in ops.command_table; the guard refuses any other.
// At the end, the hero chain's evidence writers: a shelf count and a read bill, ops rows that are not books.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { GRID_COMMANDS } from './commands-grid.ts';
import { MESSAGING_COMMANDS } from './commands-messaging.ts';
import { PACKAGE_COMMANDS } from './commands-packages.ts';
import { PEOPLE_COMMANDS } from './commands-people.ts';
import { CoreError } from './errors.ts';
import { lineAmount } from './money.ts';
import type { CellRef } from './read.ts';
import { type Session, withTx } from './session.ts';
import { addDays, businessDate } from './time.ts';

// Chart of accounts (journal_line.account). Debits positive, credits negative.
export const ACCOUNTS = {
  cash: 'cash',
  upi: 'upi_clearing',
  card: 'card_clearing',
  bank: 'bank',
  receivable: 'receivable',
  payable: 'payable',
  inventory: 'inventory',
  sales: 'sales',
  openingEquity: 'opening_equity',
} as const;

const CREDIT_DAYS = 30; // udhaar is due this many days after it is given

type Tenant = { tenantId: string; currency: string; timeZone: string; name: string };
export type Ctx = { c: pg.PoolClient; t: Tenant };
// What a command returns: the ids of the rows it wrote (null for a row it had no need to write), never a number. A
// number to show is minted as a snapshot cell from the books; a total in a result would be a number with no cell behind
// it. The type refuses a number at compile time and execute() refuses one at run time.
export type CommandResult = Readonly<Record<string, string | null>>;
// checks: a draft's own rules, beyond the generic ones in approvals.ts. It returns the payload paths that are bad; at
// proposal any bad path refuses the draft, and at approval any makes it stale. draftOnly: the command runs only as an
// approved draft's execution; runCommand refuses it, so a direct call cannot skip its checks (the database enforces it
// too, 0018).
export type Checks = (c: pg.PoolClient, payload: unknown, refs: Record<string, CellRef>, basedOn: CellRef[]) => Promise<string[]>;
export type Def = { input: z.ZodType; run: (ctx: Ctx, input: never) => Promise<CommandResult>; checks?: Checks; draftOnly?: true };

const id = z.guid();
const minor = z.number().int().safe();
const qtyMilli = z.number().int().positive().safe();
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const name = z.string().trim().min(1).max(120);
const tender = z.enum(['cash', 'upi', 'card', 'bank']);

const at = (s: string | undefined) => (s ? new Date(s) : new Date());
const methodAccount = (m: z.infer<typeof tender>) => (m === 'cash' ? ACCOUNTS.cash : m === 'upi' ? ACCOUNTS.upi : m === 'card' ? ACCOUNTS.card : ACCOUNTS.bank);

async function one<T>(c: pg.PoolClient, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await c.query(sql, values);
  if (!rows[0]) throw new CoreError('not_found');
  return rows[0] as T;
}

// A balanced entry: lines with a zero amount are dropped (journal_line refuses them), equal accounts merged.
async function journal(ctx: Ctx, entryDate: string, memo: string, source: [string, string], lines: [string, number][]) {
  const merged = new Map<string, number>();
  for (const [account, amount] of lines) merged.set(account, (merged.get(account) ?? 0) + amount);
  const kept = [...merged].filter(([, a]) => a !== 0);
  if (kept.length === 0) return undefined;
  const entryId = randomUUID();
  await ctx.c.query(
    `insert into books.journal_entry (tenant_id, id, entry_date, memo, source_table, source_id) values ($1, $2, $3, $4, $5, $6)`,
    [ctx.t.tenantId, entryId, entryDate, memo, source[0], source[1]],
  );
  await ctx.c.query(
    `insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency)
     select $1, $2, l.account, l.amount, $3 from unnest($4::text[], $5::bigint[]) as l(account, amount)`,
    [ctx.t.tenantId, entryId, ctx.t.currency, kept.map((l) => l[0]), kept.map((l) => l[1])],
  );
  return entryId;
}

// A stock-reducing command may not take the books below zero: checked at execution, after the move,
// over every move of the item. The per-item lock is taken before the books are read, so two write-offs of the same item
// cannot both pass on the same on-hand. Counter sales do not take it: a shop may sell what it has not yet entered.
async function lockStock(ctx: Ctx, itemId: string) {
  await ctx.c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.stock:' || $1 || ':' || $2, 0))`, [ctx.t.tenantId, itemId]);
}

async function keepsStock(ctx: Ctx, itemId: string, field: string) {
  const { held } = await one<{ held: string }>(ctx.c, 'select coalesce(sum(qty_milli), 0) as held from books.stock_move where item_id = $1', [itemId]);
  if (Number(held) < 0) throw new CoreError('invalid', { fields: [field] });
}

async function itemNames(ctx: Ctx, ids: string[]) {
  const { rows } = await ctx.c.query<{ id: string; name: string; unit: string }>(
    'select id::text as id, name, unit from books.item where id = any($1::uuid[])',
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const i of ids) if (!byId.has(i)) throw new CoreError('not_found');
  return byId;
}

// ---- catalogue -------------------------------------------------------------------------------------------------

const itemCreate = z.strictObject({
  name,
  unit: z.enum(['piece', 'pack', 'kg', 'g', 'l', 'ml']),
  barcode: z.string().trim().min(1).max(64).optional(),
  category: z.string().trim().min(1).max(60).optional(),
});
const itemAlias = z.strictObject({ itemId: id, alias: name });
const priceSet = z.strictObject({ itemId: id, amountMinor: minor.nonnegative(), effectiveFrom: instant.optional() });
const supplierCreate = z.strictObject({ name, phone: z.string().max(20).optional() }); // every supplier is simulated (default)

// ---- the counter, purchasing, stock, credit -----------------------------------------------------------------------

const saleRecord = z.strictObject({
  shopId: id,
  soldAt: instant.optional(),
  customerId: id.optional(),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli })).min(1).max(100),
  payments: z.array(z.strictObject({ method: z.enum(['cash', 'upi', 'card']), amountMinor: minor.positive() })).max(3),
});
const purchaseRecord = z.strictObject({
  supplierId: id,
  billNo: z.string().trim().min(1).max(64),
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
    method: tender,
    amountMinor: minor.positive(),
    reference: z.string().max(64).optional(),
    paidAt: instant.optional(),
  }),
  z.strictObject({
    direction: z.literal('out'),
    supplierId: id,
    method: tender,
    amountMinor: minor.positive(),
    reference: z.string().max(64).optional(),
    paidAt: instant.optional(),
  }),
]);
const settlementRecord = z.strictObject({
  channel: z.enum(['upi', 'card']),
  businessDate: day,
  amountMinor: minor.positive(),
  reference: z.string().max(64).optional(),
  receivedOn: day,
});
const reorderPlace = z.strictObject({
  supplierId: id,
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli })).min(1).max(50),
});

export type SaleInput = z.input<typeof saleRecord>;
export type PurchaseInput = z.input<typeof purchaseRecord>;
export type PaymentInput = z.input<typeof paymentRecord>;

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

// Each area's commands live in its own file, so a lane edits only its own.
export const COMMANDS: ReadonlyMap<string, Def> = new Map<string, Def>([
  ...PEOPLE_COMMANDS,
  ...PACKAGE_COMMANDS,
  ...MESSAGING_COMMANDS,
  ...GRID_COMMANDS,
  [
    'item.create',
    def(itemCreate, async ({ c, t }, i) => {
      const itemId = randomUUID();
      await c.query('insert into books.item (tenant_id, id, name, unit, barcode, category) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        itemId,
        i.name,
        i.unit,
        i.barcode ?? null,
        i.category ?? null,
      ]);
      return { itemId };
    }),
  ],
  [
    // Another spelling of an item (a supplier's bill line), stored normalised so a bill's text matches it exactly.
    'item.alias',
    def(itemAlias, async ({ c, t }, i) => {
      const aliasId = randomUUID();
      await c.query('insert into books.item_alias (tenant_id, id, item_id, alias) values ($1, $2, $3, $4)', [t.tenantId, aliasId, i.itemId, normalName(i.alias)]);
      return { aliasId };
    }),
  ],
  [
    'price.set',
    def(priceSet, async ({ c, t }, i) => {
      const priceId = randomUUID();
      await c.query('insert into books.price (tenant_id, id, item_id, amount_minor, currency, effective_from) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        priceId,
        i.itemId,
        i.amountMinor,
        t.currency,
        at(i.effectiveFrom),
      ]);
      return { priceId };
    }),
  ],
  [
    'supplier.create',
    def(supplierCreate, async ({ c, t }, i) => {
      const supplierId = randomUUID();
      await c.query('insert into books.supplier (tenant_id, id, name, phone) values ($1, $2, $3, $4)', [t.tenantId, supplierId, i.name, i.phone ?? null]);
      return { supplierId };
    }),
  ],
  [
    // A counter sale at the prices in effect when sold: sale, lines, stock out, tenders, the unpaid rest as the
    // customer's credit, and the journal (tenders + receivable = sales).
    'sale.record',
    def(saleRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const soldAt = at(i.soldAt);
      const ids = [...new Set(i.lines.map((l) => l.itemId))];
      const { rows: prices } = await c.query<{ item_id: string; amount_minor: string; currency: string }>(
        `select distinct on (item_id) item_id::text as item_id, amount_minor, currency from books.price
          where item_id = any($1::uuid[]) and effective_from <= $2 order by item_id, effective_from desc, created_at desc`,
        [ids, soldAt],
      );
      const price = new Map(prices.filter((p) => p.currency === t.currency).map((p) => [p.item_id, Number(p.amount_minor)]));
      const unit = i.lines.map((l) => {
        const p = price.get(l.itemId);
        if (p === undefined) throw new CoreError('invalid', { fields: ['lines.itemId'] }); // no price in effect
        return p;
      });
      const amounts = i.lines.map((l, n) => lineAmount(l.qtyMilli, unit[n] as number));
      const total = amounts.reduce((a, b) => a + b, 0);
      const paid = i.payments.reduce((a, p) => a + p.amountMinor, 0);
      const credit = total - paid;
      if (credit < 0) throw new CoreError('invalid', { fields: ['payments'] });
      if (credit > 0 && !i.customerId) throw new CoreError('invalid', { fields: ['customerId'] });

      const saleId = randomUUID();
      await c.query(
        'insert into books.sale (tenant_id, id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, $3, $4, $5, $6, $7)',
        [t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total, t.currency],
      );
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, qty_milli, unit_price_minor, currency)
         select $1, $2, l.n, l.item, l.qty, l.price, $3 from unnest($4::int[], $5::uuid[], $6::bigint[], $7::bigint[]) as l(n, item, qty, price)`,
        [t.tenantId, saleId, t.currency, i.lines.map((_, n) => n + 1), i.lines.map((l) => l.itemId), i.lines.map((l) => l.qtyMilli), unit],
      );
      await c.query(
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_table, source_id, at)
         select $1, l.item, -l.qty, 'sale', 'books.sale', $2, $3 from unnest($4::uuid[], $5::bigint[]) as l(item, qty)`,
        [t.tenantId, saleId, soldAt, i.lines.map((l) => l.itemId), i.lines.map((l) => l.qtyMilli)],
      );
      for (const p of i.payments) {
        await c.query(
          `insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at)
           values ($1, 'in', $2, $3, $4, $5, $6, $7)`,
          [t.tenantId, p.method, p.amountMinor, t.currency, i.customerId ?? null, saleId, soldAt],
        );
      }
      const date = businessDate(soldAt, t.timeZone);
      if (credit > 0) {
        await c.query(
          `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, due_on, at) values ($1, $2, $3, $4, $5, $6, $7)`,
          [t.tenantId, i.customerId, credit, t.currency, saleId, addDays(date, CREDIT_DAYS), soldAt],
        );
      }
      await journal(ctx, date, 'Counter sale', ['books.sale', saleId], [
        ...i.payments.map((p): [string, number] => [methodAccount(p.method), p.amountMinor]),
        [ACCOUNTS.receivable, credit],
        [ACCOUNTS.sales, -total],
      ]);
      return { saleId };
    }),
  ],
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
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_table, source_id, expires_on, at)
         select $1, l.item, l.qty, 'purchase', 'books.purchase', $2, l.exp, $3 from unnest($4::uuid[], $5::bigint[], $6::date[]) as l(item, qty, exp)`,
        [t.tenantId, purchaseId, receivedAt, cols.item, cols.qty, cols.exp],
      );
      await journal(ctx, i.billDate, `Bill ${i.billNo}`, ['books.purchase', purchaseId], [
        [ACCOUNTS.inventory, total],
        [ACCOUNTS.payable, -total],
      ]);
      return { purchaseId };
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
    // Credit given outside a counter sale (the paper khata's opening balance): receivable against opening equity.
    'credit.record',
    def(creditRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const when = at(i.at);
      const date = businessDate(when, t.timeZone);
      const creditId = randomUUID();
      await c.query(
        `insert into books.credit_entry (tenant_id, id, customer_id, amount_minor, currency, due_on, at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [t.tenantId, creditId, i.customerId, i.amountMinor, t.currency, i.dueOn ?? addDays(date, CREDIT_DAYS), when],
      );
      await journal(ctx, date, 'Credit entry', ['books.credit_entry', creditId], [
        [ACCOUNTS.receivable, i.amountMinor],
        [ACCOUNTS.openingEquity, -i.amountMinor],
      ]);
      return { creditId };
    }),
  ],
  [
    // A payment as recorded (never processed): a customer repaying credit, or the shop paying a supplier.
    'payment.record',
    def(paymentRecord, async (ctx, i) => {
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
      await journal(ctx, date, i.direction === 'in' ? 'Credit repaid' : 'Supplier paid', ['books.payment', paymentId], [
        [methodAccount(i.method), sign * i.amountMinor],
        [toward, -sign * i.amountMinor],
      ]);
      return { paymentId };
    }),
  ],
  [
    // The provider's payout for a business day's UPI or card takings, as recorded: bank against the clearing account.
    'settlement.record',
    def(settlementRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const settlementId = randomUUID();
      await c.query(
        `insert into books.settlement (tenant_id, id, channel, business_date, amount_minor, currency, reference, received_on)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.tenantId, settlementId, i.channel, i.businessDate, i.amountMinor, t.currency, i.reference ?? null, i.receivedOn],
      );
      await journal(ctx, i.receivedOn, `${i.channel.toUpperCase()} settlement`, ['books.settlement', settlementId], [
        [ACCOUNTS.bank, i.amountMinor],
        [i.channel === 'upi' ? ACCOUNTS.upi : ACCOUNTS.card, -i.amountMinor],
      ]);
      return { settlementId };
    }),
  ],
  [
    // A reorder goes out as a message to the (simulated) supplier, its text composed here from the books.
    'reorder.place',
    def(reorderPlace, async (ctx, i) => {
      const { c, t } = ctx;
      await one(c, 'select 1 from books.supplier where id = $1', [i.supplierId]);
      const items = await itemNames(ctx, i.lines.map((l) => l.itemId));
      const lines = i.lines.map((l) => {
        const it = items.get(l.itemId) as { name: string; unit: string };
        const n = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(l.qtyMilli / 1000);
        return `${it.unit === 'piece' || it.unit === 'pack' ? n : `${n} ${it.unit}`} × ${it.name}`;
      });
      const body = `Reorder from ${t.name}: ${lines.join('; ')}.`;
      const messageId = randomUUID();
      await c.query(
        `insert into books.outbound_message (tenant_id, id, channel, recipient_kind, recipient_id, body) values ($1, $2, $3, 'supplier', $4, $5)`,
        [t.tenantId, messageId, i.channel, i.supplierId, body],
      );
      return { messageId };
    }),
  ],
]);

function parsed<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

export function command(name: string): Def {
  const d = COMMANDS.get(name);
  if (!d) throw new CoreError('invalid', { fields: ['command'] });
  return d;
}

export function parseInput(d: Def, input: unknown): unknown {
  return parsed(d.input, input);
}

// Runs a parsed input in the current transaction (whose context already admits the command's rows).
export async function execute(c: pg.PoolClient, d: Def, input: unknown): Promise<CommandResult> {
  const { rows } = await c.query<{ tenant_id: string; currency: string; time_zone: string; name: string }>(
    'select tenant_id::text as tenant_id, currency, time_zone, name from ops.tenant',
  );
  const t = rows[0];
  if (!t || rows.length !== 1) throw new CoreError('not_found');
  const result = await d.run({ c, t: { tenantId: t.tenant_id, currency: t.currency, timeZone: t.time_zone, name: t.name } }, input as never);
  if (Object.values(result).some((v) => v !== null && typeof v !== 'string')) throw new CoreError('internal'); // ids only
  return result;
}

// A person's own direct command: the guard admits the rows only if the member's role holds the command.
export function runCommand(pool: pg.Pool, session: Session, name: string, input: unknown): Promise<CommandResult> {
  const d = command(name);
  if (d.draftOnly) return Promise.reject(new CoreError('refused', { fields: ['command'] }));
  const parsed = parseInput(d, input);
  return withTx(pool, { kind: 'member', session, command: name }, (c) => execute(c, d, parsed));
}

export const recordSale = (pool: pg.Pool, session: Session, input: SaleInput) => runCommand(pool, session, 'sale.record', input);
export const recordPurchase = (pool: pg.Pool, session: Session, input: PurchaseInput) => runCommand(pool, session, 'purchase.record', input);
export const countStock = (pool: pg.Pool, session: Session, input: z.input<typeof stockCount>) => runCommand(pool, session, 'stock.count', input);
export const recordWaste = (pool: pg.Pool, session: Session, input: z.input<typeof stockWaste>) => runCommand(pool, session, 'stock.waste', input);
export const recordCredit = (pool: pg.Pool, session: Session, input: z.input<typeof creditRecord>) => runCommand(pool, session, 'credit.record', input);
export const recordPayment = (pool: pg.Pool, session: Session, input: PaymentInput) => runCommand(pool, session, 'payment.record', input);
export const recordSettlement = (pool: pg.Pool, session: Session, input: z.input<typeof settlementRecord>) =>
  runCommand(pool, session, 'settlement.record', input);
export const placeReorder = (pool: pg.Pool, session: Session, input: z.input<typeof reorderPlace>) => runCommand(pool, session, 'reorder.place', input);

// ---- the hero chain's evidence ------------------------------------------------------------------------------
// Not books: ops rows a photo run stores (a system scope, no actor), each turned into cells only by a named read
// (count.shelf, bill.lines in queries-count.ts). The tables hold the rules: a count whose response was edited after it
// was hashed, or that is not the response's number of matches, is refused; so is a bill figure with no place on the page.

// One spelling rule for the catalogue and a bill's text: NFKC, trimmed, inner whitespace collapsed, lower case.
export const normalName = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export type PhotoRun = { tenantId: string; runId: string };

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const model = z.string().min(1).max(80);
const shelfCount = z.strictObject({
  itemId: id,
  photoSha256: sha256,
  phrase: z.string().trim().min(1).max(120),
  model,
  raw: z.string().max(4_000_000),
  rawSha256: sha256,
  matches: z.number().int().nonnegative(),
});
// A place the vision model could not give is passed on as null, and the table refuses it (bill_line_placed).
const place = z.array(z.number().int()).length(4).nullable();
const billRead = z.strictObject({
  supplierId: id,
  photoSha256: sha256,
  model,
  billNo: z.string().trim().min(1).max(64).nullable(),
  billDate: day.nullable(),
  lines: z
    .array(z.strictObject({ text: z.string().trim().min(1).max(200), qtyMilli, qtyAt: place, unitCostMinor: minor.nonnegative(), unitCostAt: place }))
    .min(1)
    .max(200),
});

const COUNTABLE = ['pack', 'piece'];

// One catalogue item counted on a shelf photo: the segment model's raw response, its sha256 and its number of matches.
export function recordShelfCount(pool: pg.Pool, by: PhotoRun, input: z.input<typeof shelfCount>): Promise<string> {
  const i = parsed(shelfCount, input);
  return withTx(pool, { kind: 'system', tenantId: by.tenantId }, async (c) => {
    const { unit } = await one<{ unit: string }>(c, 'select unit from books.item where id = $1', [i.itemId]);
    if (!COUNTABLE.includes(unit)) throw new CoreError('invalid', { fields: ['itemId'] }); // loose goods are weighed, not counted
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.shelf_count (tenant_id, run_id, item_id, photo_sha256, phrase, model, raw, raw_sha256, matches)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [by.tenantId, by.runId, i.itemId, i.photoSha256, i.phrase, i.model, i.raw, i.rawSha256, i.matches],
    );
    return (rows[0] as { id: string }).id;
  });
}

// A supplier's bill as read: each line's text is matched here, by plain code, to the one catalogue item whose name or
// alias it spells (normalName); none, or more than one, leaves the line unmatched. No model chooses the item.
export function recordBillRead(pool: pg.Pool, by: PhotoRun, input: z.input<typeof billRead>): Promise<string> {
  const i = parsed(billRead, input);
  return withTx(pool, { kind: 'system', tenantId: by.tenantId }, async (c) => {
    const { rows: names } = await c.query<{ id: string; name: string }>(
      `select id::text as id, name from books.item union all select item_id::text, alias from books.item_alias`,
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
      [by.tenantId, by.runId, i.supplierId, i.photoSha256, i.model, i.billNo, i.billDate],
    );
    const billId = (rows[0] as { id: string }).id;
    for (const [n, l] of i.lines.entries()) {
      await c.query(
        `insert into ops.bill_line (tenant_id, bill_read_id, line_no, item_text, item_id, qty_milli, unit_cost_minor, qty_box, cost_box)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [by.tenantId, billId, n + 1, l.text, match(l.text), l.qtyMilli, l.unitCostMinor, l.qtyAt, l.unitCostAt],
      );
    }
    return billId;
  });
}
