// REV1 for the sale: sale.reverse writes the exact opposite of every row a sale caused, once, so the sale and its
// reversal net to zero everywhere: the header, its lines and discounts (children of the reversal header), stock, each
// tender, the credit, the customer's points, the package holding's sessions and value, every journal account, and the
// invoice against its credit note. The credit note is numbered in its own series (credit note 1 after tax invoices 1
// and 2), names the original invoice, and its lines name the reversal sale's lines. A second reversal, a reversal of a
// reversal, a manager's reversal and the reversal of a sale whose package has been used are each refused, writing
// nothing. Red-proofs: test/v2/sabotage/core-counter.ts.
import { CoreError, mintSnapshot } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, register, rows, run, SINCE, unbalanced } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let s: Counter;
let plain: Counter;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  [s, plain] = await Promise.all([counterShop(app, 'REV1 Salon', 'salon'), counterShop(app, 'REV1 Kirana')]);
  await register(app, s, 'regular', 'EL');
  ids.haircut = await item(app, s, { name: 'Haircut', kind: 'service', priceMinor: 45_000, taxClass: 'salon_service', hsn: '999721' });
  ids.serum = await item(app, s, { name: 'Hair serum', priceMinor: 59_900, taxClass: 'general_18', hsn: '3305' });
  ids.pack = (
    await run(app, s.owner, 'package.plan.create', {
      name: 'Four cuts',
      priceMinor: 160_000,
      validityDays: 90,
      lines: [{ itemId: ids.haircut, sessions: 4 }],
      taxClass: 'salon_service',
      hsnSac: '999721',
      effectiveFrom: SINCE,
    })
  ).itemId as string;
  await run(app, s.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 50, effectiveFrom: SINCE });
  await run(app, s.owner, 'offer.create', { name: 'Ten off', code: 'TENOFF', kind: 'percent_off', percentBp: 1000, scope: 'all', startsAt: SINCE, endsAt: new Date(Date.now() + 9e8).toISOString() });
  ids.client = await customer(app, s, 'Client');
  ids.biscuits = await item(app, plain, { name: 'Biscuits', priceMinor: 1000 });
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

const sell = (lines: [string, number][], extra: Record<string, unknown>) =>
  run(app, s.staff, 'sale.record', { shopId: s.shopId, customerId: ids.client, lines: lines.map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })), ...extra });
const points = async () => ((await rows(app, s, 'select balance_after::int as b from books.loyalty_entry where customer_id = $1 order by seq desc limit 1', [ids.client]))[0]?.b as number) ?? 0;
// Every row's signed figures, summed over a sale and its reversal: zero in each, everywhere.
async function net(saleId: string, reversalId: string) {
  const both = [saleId, reversalId];
  const one = async (sql: string) => (await rows(app, s, sql, [both]))[0];
  return {
    sale: await one('select sum(total_minor)::int as total from books.sale where id = any($1::uuid[])'),
    lines: await rows(
      app,
      s,
      'select line_no, sum(qty_milli)::int as qty, sum(gross_minor)::int as gross, sum(tax_minor)::int as tax from books.sale_line where sale_id = any($1::uuid[]) group by line_no order by line_no',
      [both],
    ),
    discounts: await rows(
      app,
      s,
      'select line_no, source, sum(amount_minor)::int as amount from books.sale_discount where sale_id = any($1::uuid[]) group by line_no, source order by line_no, source',
      [both],
    ),
    stock: await rows(app, s, 'select item_id::text, sum(qty_milli)::int as qty from books.stock_move where source_id = any($1::uuid[]) group by item_id', [both]),
    payments: await rows(app, s, 'select method, sum(amount_minor)::int as amount from books.payment where sale_id = any($1::uuid[]) group by method order by method', [both]),
    credit: await one('select sum(amount_minor)::int as amount from books.credit_entry where sale_id = any($1::uuid[])'),
    points: await one('select sum(points)::int as points from books.loyalty_entry where sale_id = any($1::uuid[])'),
    packages: await one(
      `select sum(e.sessions)::int as sessions, sum(e.value_minor)::int as value from books.package_entry e
         join books.package_holding h on h.id = e.holding_id where h.sale_id = any($1::uuid[])`,
    ),
    journal: await rows(
      app,
      s,
      `select l.account, sum(l.amount_minor)::int as amount from books.journal_line l join books.journal_entry e on e.id = l.entry_id
        where e.source_id = any($1::uuid[]) group by l.account order by l.account`,
      [both],
    ),
    invoices: await one(
      `select count(*)::int as n, sum(taxable_minor)::int as taxable, sum(cgst_minor)::int as cgst, sum(sgst_minor)::int as sgst, sum(total_minor)::int as total
         from books.invoice where sale_id = any($1::uuid[])`,
    ),
  };
}
const zeros = (r: Record<string, unknown>[], keep: string[]) => r.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, keep.includes(k) ? v : 0])));

it('REV1 a sale’s reversal nets to zero everywhere, and its invoice’s credit note is numbered in its own series', async () => {
  await sell([[ids.haircut as string, 1000]], { payments: [{ method: 'cash', amountMinor: 45_000 }] }); // tax invoice 1; earns 450 points
  const before = await points();
  expect(before).toBe(450);
  const sold = await sell(
    [
      [ids.haircut as string, 1000],
      [ids.serum as string, 2000],
      [ids.pack as string, 1000],
    ],
    {
      offerCodes: ['TENOFF'],
      redeemPoints: 200,
      payments: [
        { method: 'cash', amountMinor: 50_000 },
        { method: 'upi', amountMinor: 30_000 },
      ],
    },
  );
  expect(sold.invoiceId).toEqual(expect.any(String));
  // The package line (₹1,600 at 5%) is owed back as service net of its GST: 160000 × 10000 ÷ 10500 = 152380.95 →
  // 152381, the holding's liability and the journal's package_liability credit alike.
  const [held] = await rows(app, s, 'select liability_minor::int as l from books.package_holding where sale_id = $1', [sold.saleId]);
  const [credited] = await rows(
    app,
    s,
    `select -sum(l.amount_minor)::int as c from books.journal_line l join books.journal_entry e on e.id = l.entry_id
      where e.source_id = $1 and l.account = 'package_liability'`,
    [sold.saleId],
  );
  expect([held?.l, credited?.c]).toEqual([152_381, 152_381]);
  const back = await run(app, s.owner, 'sale.reverse', { saleId: sold.saleId, reason: 'customer_cancelled' });
  expect(back).toEqual({ saleId: expect.any(String), creditNoteId: expect.any(String) });
  const n = await net(sold.saleId as string, back.saleId as string);
  expect(n.sale).toEqual({ total: 0 });
  expect(n.lines).toEqual(zeros(n.lines, ['line_no']));
  expect(n.lines).toHaveLength(3);
  expect(n.discounts).toEqual(zeros(n.discounts, ['line_no', 'source']));
  expect(n.discounts.length).toBeGreaterThanOrEqual(4); // an offer and a loyalty share on each of two lines
  expect(n.stock).toEqual([{ item_id: ids.serum, qty: 0 }]);
  expect(n.payments).toEqual([
    { method: 'cash', amount: 0 },
    { method: 'upi', amount: 0 },
  ]);
  expect(n.credit).toEqual({ amount: 0 });
  expect(n.points).toEqual({ points: 0 });
  expect(n.packages).toEqual({ sessions: 0, value: 0 });
  expect(n.journal).toEqual(zeros(n.journal, ['account']));
  expect(n.journal.map((j) => j.account)).toEqual(
    expect.arrayContaining(['cash', 'upi_clearing', 'receivable', 'sales', 'sales_discount', 'package_liability', 'gst_output_cgst', 'gst_output_sgst']),
  );
  expect(n.invoices).toEqual({ n: 2, taxable: 0, cgst: 0, sgst: 0, total: 0 });
  expect(await points()).toBe(before);

  // The credit note: credit note 1 after tax invoices 1 and 2, naming invoice 2; each line the reversal sale's line,
  // negated figure for figure.
  const notes = await rows(
    app,
    s,
    `select kind, series, number, original_invoice_id::text as orig from books.invoice where sale_id = any($1::uuid[]) order by kind`,
    [[sold.saleId, back.saleId]],
  );
  expect(notes).toEqual([
    { kind: 'credit_note', series: 'EL', number: 1, orig: sold.invoiceId },
    { kind: 'tax_invoice', series: 'EL', number: 2, orig: null },
  ]);
  const paired = await rows(
    app,
    s,
    `select o.line_no, o.taxable_minor + c.taxable_minor as taxable, o.cgst_minor + c.cgst_minor as cgst, o.sgst_minor + c.sgst_minor as sgst,
            o.discount_minor + c.discount_minor as discount, o.total_minor + c.total_minor as total, r.sale_id::text as names
       from books.invoice_line o
       join books.invoice_line c on c.invoice_id = $2 and c.line_no = o.line_no
       join books.sale_line r on r.id = c.sale_line_id
      where o.invoice_id = $1 order by o.line_no`,
    [sold.invoiceId, back.creditNoteId],
  );
  expect(paired).toHaveLength(3);
  for (const p of paired) expect(p).toMatchObject({ taxable: '0', cgst: '0', sgst: '0', discount: '0', total: '0', names: back.saleId });
  const shown = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'invoice.detail', { invoice_id: back.creditNoteId });
  expect(shown.rows[0]).toMatchObject({ kind: { txt: 'credit_note' }, original_invoice_id: { txt: sold.invoiceId }, number: { num: '1' } });
  expect(await unbalanced(app, s)).toEqual([]);
});

it('REV1 a sale reverses once: a second reversal, a reversal of a reversal and a manager’s reversal are refused and write nothing', async () => {
  const sold = await sell([[ids.serum as string, 1000]], { payments: [{ method: 'card', amountMinor: 59_900 }] });
  const count = async () => (await rows(app, s, 'select count(*)::int as n from books.sale'))[0]?.n;
  expect(await run(app, s.manager, 'sale.reverse', { saleId: sold.saleId, reason: 'duplicate' }).catch((e: unknown) => e)).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  const back = await run(app, s.owner, 'sale.reverse', { saleId: sold.saleId, reason: 'duplicate' });
  const n = await count();
  const again = await run(app, s.owner, 'sale.reverse', { saleId: sold.saleId, reason: 'duplicate' }).catch((e: unknown) => e);
  expect(again).toBeInstanceOf(CoreError);
  expect(again).toMatchObject({ code: 'invalid', sqlstate: 'MS013' });
  expect(await run(app, s.owner, 'sale.reverse', { saleId: back.saleId, reason: 'duplicate' }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', sqlstate: 'MS013' });
  expect(await count()).toBe(n);
});

it('REV1 a sale whose package has been redeemed from stands: its reversal is refused (MS009) and writes nothing', async () => {
  const sold = await sell([[ids.pack as string, 1000]], { payments: [] });
  const [h] = await rows(app, s, 'select id::text as id from books.package_holding where sale_id = $1', [sold.saleId]);
  await run(app, s.staff, 'package.redeem', { holdingId: h?.id, shopId: s.shopId, itemId: ids.haircut });
  const count = async () => (await rows(app, s, 'select (select count(*) from books.sale)::int as sales, (select count(*) from books.invoice)::int as invoices'))[0];
  const before = await count();
  expect(await run(app, s.owner, 'sale.reverse', { saleId: sold.saleId, reason: 'customer_cancelled' }).catch((e: unknown) => e)).toMatchObject({
    code: 'invalid',
    sqlstate: 'MS009',
  });
  expect(await count()).toEqual(before);
});

it('REV1 an unregistered shop’s sale reverses with no credit note: stock back, tenders back, journal zero', async () => {
  const sold = await run(app, plain.staff, 'sale.record', { shopId: plain.shopId, lines: [{ itemId: ids.biscuits, qtyMilli: 4000 }], payments: [{ method: 'cash', amountMinor: 4000 }] });
  const back = await run(app, plain.owner, 'sale.reverse', { saleId: sold.saleId, reason: 'entered_in_error' });
  expect(back).toEqual({ saleId: expect.any(String) });
  const sums = await rows(
    app,
    plain,
    `select (select sum(qty_milli)::int from books.stock_move where source_id = any($1::uuid[])) as stock,
            (select sum(amount_minor)::int from books.payment where sale_id = any($1::uuid[])) as paid,
            (select count(*)::int from (select l.account from books.journal_line l join books.journal_entry e on e.id = l.entry_id
                                        where e.source_id = any($1::uuid[]) group by l.account having sum(l.amount_minor) <> 0) x) as accounts_off`,
    [[sold.saleId, back.saleId]],
  );
  expect(sums).toEqual([{ stock: 0, paid: 0, accounts_off: 0 }]);
});
