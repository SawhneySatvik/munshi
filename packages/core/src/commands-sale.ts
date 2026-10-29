// Commands for the counter sale. Moved unchanged out of commands.ts. Its helpers are used only inside run(), so the
// value import from commands.ts (which spreads SALE_COMMANDS while it is still being evaluated) is safe.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCOUNTS, at, CREDIT_DAYS, type CommandResult, type Ctx, type Def, journal, methodAccount } from './commands.ts';
import { CoreError } from './errors.ts';
import { lineAmount } from './money.ts';
import { addDays, businessDate } from './time.ts';

const id = z.guid();
const minor = z.number().int().safe();
const qtyMilli = z.number().int().positive().safe();
const instant = z.iso.datetime({ offset: true });

const saleRecord = z.strictObject({
  shopId: id,
  soldAt: instant.optional(),
  customerId: id.optional(),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli })).min(1).max(100),
  payments: z.array(z.strictObject({ method: z.enum(['cash', 'upi', 'card']), amountMinor: minor.positive() })).max(3),
});
export type SaleInput = z.input<typeof saleRecord>;

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

export const SALE_COMMANDS: [string, Def][] = [
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
];
