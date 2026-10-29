// Commands for the counter sale. Its helpers from commands.ts are used only inside run(), so the value import (while
// commands.ts spreads SALE_COMMANDS and is still being evaluated) is safe.
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
    // A counter sale at the prices in effect when sold: sale, lines (each naming the price row it was sold at), stock out
    // for goods, tenders, the unpaid rest as the customer's credit, and the journal (tenders + receivable = sales).
    'sale.record',
    def(saleRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const soldAt = at(i.soldAt);
      const ids = [...new Set(i.lines.map((l) => l.itemId))];
      const { rows: prices } = await c.query<{ item_id: string; kind: string; price_id: string; amount_minor: string; currency: string }>(
        `select distinct on (p.item_id) p.item_id::text as item_id, it.kind, p.id::text as price_id, p.amount_minor, p.currency
           from books.price p join books.item it on it.tenant_id = p.tenant_id and it.id = p.item_id
          where p.item_id = any($1::uuid[]) and p.effective_from <= $2
          order by p.item_id, p.effective_from desc, p.created_at desc, p.id desc`,
        [ids, soldAt],
      );
      const price = new Map(prices.filter((p) => p.currency === t.currency).map((p) => [p.item_id, p]));
      const priced = i.lines.map((l) => {
        const p = price.get(l.itemId);
        if (p === undefined) throw new CoreError('invalid', { fields: ['lines.itemId'] }); // no price in effect
        return { ...l, kind: p.kind, priceId: p.price_id, unit: Number(p.amount_minor), gross: lineAmount(l.qtyMilli, Number(p.amount_minor)) };
      });
      const total = priced.reduce((a, l) => a + l.gross, 0);
      const paid = i.payments.reduce((a, p) => a + p.amountMinor, 0);
      const credit = total - paid;
      if (credit < 0) throw new CoreError('invalid', { fields: ['payments'] });
      if (credit > 0 && !i.customerId) throw new CoreError('invalid', { fields: ['customerId'] });

      const saleId = randomUUID();
      await c.query(
        'insert into books.sale (tenant_id, id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, $3, $4, $5, $6, $7)',
        [t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total, t.currency],
      );
      const col = <K extends keyof (typeof priced)[number]>(k: K) => priced.map((l) => l[k]);
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
         select $1, $2, l.n, l.item, l.kind, l.price, l.qty, l.unit, l.gross, $3
           from unnest($4::int[], $5::uuid[], $6::text[], $7::uuid[], $8::bigint[], $9::bigint[], $10::bigint[]) as l(n, item, kind, price, qty, unit, gross)`,
        [t.tenantId, saleId, t.currency, priced.map((_, n) => n + 1), col('itemId'), col('kind'), col('priceId'), col('qtyMilli'), col('unit'), col('gross')],
      );
      const goods = priced.filter((l) => l.kind === 'good');
      if (goods.length) {
        await c.query(
          `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at)
           select $1, l.item, -l.qty, 'sale', 'books.sale', $2, $3 from unnest($4::uuid[], $5::bigint[]) as l(item, qty)`,
          [t.tenantId, saleId, soldAt, goods.map((l) => l.itemId), goods.map((l) => l.qtyMilli)],
        );
      }
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
      await journal(ctx, date, 'sale', ['books.sale', saleId], [
        ...i.payments.map((p): [string, number] => [methodAccount(p.method), p.amountMinor]),
        [ACCOUNTS.receivable, credit],
        [ACCOUNTS.sales, -total],
      ]);
      return { saleId };
    }),
  ],
];
