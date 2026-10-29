// JR1 for the GST summary: gst.summary's month (by rate, read from the invoice lines, credit notes netting) equals the
// journal's sums for the month, computed here from raw journal lines: CGST and SGST are the output-tax accounts, the
// taxable value is what the sales' entries credited to sales and package_liability less what they debited to
// sales_discount. The sales cover two rates, a line offer, a loyalty redemption, a package line and a reversal.
// Red-proofs: test/v2/sabotage/core-counter.ts.
import { businessDate, mintSnapshot } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, num, register, rows, run, SINCE } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let s: Counter;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await counterShop(app, 'JR1 Salon', 'salon');
  await register(app, s, 'regular', 'JR');
  ids.haircut = await item(app, s, { name: 'Haircut', kind: 'service', priceMinor: 45_000, taxClass: 'salon_service' });
  ids.serum = await item(app, s, { name: 'Hair serum', priceMinor: 59_900, taxClass: 'general_18' });
  ids.pack = (
    await run(app, s.owner, 'package.plan.create', {
      name: 'Four cuts',
      priceMinor: 160_000,
      validityDays: 90,
      lines: [{ itemId: ids.haircut, sessions: 4 }],
      taxClass: 'salon_service',
      effectiveFrom: SINCE,
    })
  ).itemId as string;
  await run(app, s.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 50, effectiveFrom: SINCE });
  await run(app, s.owner, 'offer.create', { name: 'Serum week', code: 'SERUM15', kind: 'percent_off', percentBp: 1500, scope: 'items', itemIds: [ids.serum], endsAt: new Date(Date.now() + 9e8).toISOString() });
  ids.client = await customer(app, s, 'Client');
  const sell = (lines: [string, number][], extra: Record<string, unknown> = {}) =>
    run(app, s.staff, 'sale.record', { shopId: s.shopId, customerId: ids.client, lines: lines.map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })), payments: [], ...extra });
  await sell([[ids.haircut as string, 1000]]);
  await sell([
    [ids.haircut as string, 1000],
    [ids.serum as string, 3000],
  ]);
  await sell([[ids.serum as string, 2000]], { offerCodes: ['SERUM15'] });
  await sell(
    [
      [ids.haircut as string, 1000],
      [ids.serum as string, 1000],
      [ids.pack as string, 1000],
    ],
    { redeemPoints: 300 },
  );
  const gone = await sell([[ids.serum as string, 1000]]);
  await run(app, s.owner, 'sale.reverse', { saleId: gone.saleId, reason: 'returned_goods' });
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

it('JR1 the GST summary equals the journal’s sums for the month, computed from raw lines', async () => {
  const month = businessDate(new Date(), 'Asia/Kolkata').slice(0, 7);
  const summary = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'gst.summary', { month });
  const total = (col: string) => summary.rows.reduce((a, r) => a + (num(r[col]) as number), 0);
  const shown = { taxable: total('taxable'), cgst: total('cgst'), sgst: total('sgst'), total: total('total') };

  const lines = await rows(
    app,
    s,
    `select l.account, l.amount_minor::int as amount, e.source_rel from books.journal_line l join books.journal_entry e on e.id = l.entry_id
      where to_char(e.entry_date, 'YYYY-MM') = $1`,
    [month],
  );
  const sum = (pick: (l: Record<string, unknown>) => boolean) => lines.filter(pick).reduce((a, l) => a + (l.amount as number), 0);
  const cgst = -sum((l) => l.account === 'gst_output_cgst');
  const sgst = -sum((l) => l.account === 'gst_output_sgst');
  const taxable = -sum((l) => l.source_rel === 'books.sale' && ['sales', 'sales_discount', 'package_liability'].includes(l.account as string));
  expect(shown).toEqual({ taxable, cgst, sgst, total: taxable + cgst + sgst });
  expect(cgst).toBeGreaterThan(0);
  // Two rates, and the reversed sale's credit note netted inside the 18% row.
  expect(summary.rows.map((r) => num(r.rate_bp))).toEqual([500, 1800]);
  const [notes] = await rows(app, s, `select count(*)::int as n from books.invoice where kind = 'credit_note'`);
  expect(notes).toEqual({ n: 1 });
});
