// GST1: golden invoices from sale.record against a key worked by hand, and the rule that every sale at a registered
// shop is invoiced in its own transaction (so a backdated one is refused, MS016, which fires only when an invoice row is
// written). An unregistered shop issues none; a composition one a bill of supply with no tax.
//
// THE KEY IS INFERENCE: synthetic data, worked by hand from the rules as decided,
// never by the code under test; a chartered accountant checks these rules before any real invoice. The rules used:
//   - prices include GST; a line's net is its gross less its discounts, and is what the line totals;
//   - taxable = net × 10000 ÷ (10000 + rate), rounded half away from zero; tax = net − taxable; CGST = floor(tax ÷ 2),
//     SGST = tax − CGST;
//   - a bill-level discount (an amount off the bill, a loyalty redemption) is split pro rata by line value: every line
//     but the largest takes discount × line ÷ bill rounded down to the paisa, the largest the rest;
//   - rates (the India pack): general_5 5%, general_18 18%, salon_service 5%, apparel 5% for a piece selling at ₹2,500
//     or less after its discount, 18% above.
// Worked figures (paise):
//   A one rate: dal 16900 @5% → 16900 × 10000 ÷ 10500 = 16095.24 → 16095; tax 805 → 402 + 403.
//   B two rates: dal as A; 2 shampoo 29800 @18% → 29800 ÷ 1.18 = 25254.24 → 25254; tax 4546 → 2273 + 2273.
//   C a line discount (CARE10, 10% on personal care): shampoo 29800 − 2980 = 26820 → 26820 ÷ 1.18 = 22728.81 → 22729;
//     tax 4091 → 2045 + 2046. Dal as A.
//   D a bill discount (FLAT50, ₹50 off): dal takes floor(5000 × 16900 ÷ 46700) = floor(1809.42) = 1809, shampoo (the
//     largest) 5000 − 1809 = 3191. Dal 15091 → 15091 ÷ 1.05 = 14372.38 → 14372; tax 719 → 359 + 360. Shampoo 26609 →
//     26609 ÷ 1.18 = 22550 exactly; tax 4059 → 2029 + 2030.
//   E a loyalty redemption (salon; 120 points at ₹1 = 12000): haircut 45000 takes floor(12000 × 45000 ÷ 104900) =
//     floor(5147.76) = 5147, serum 59900 (the largest) 6853. Haircut 39853 @5% → 37955.24 → 37955; tax 1898 → 949 + 949.
//     Serum 53047 @18% → 44955.08 → 44955; tax 8092 → 4046 + 4046. The earlier haircut that earned the points: 45000 →
//     42857.14 → 42857; tax 2143 → 1071 + 1072.
//   F apparel: kurta 240000 (≤ ₹2,500) @5% → 228571.43 → 228571; tax 11429 → 5714 + 5715. Saree 260000 (above) @18% →
//     220338.98 → 220339; tax 39661 → 19830 + 19831. The saree at 10% off sells at 234000, so @5% → 222857.14 → 222857;
//     tax 11143 → 5571 + 5572. A dupatta at exactly 250000 @5% → 238095.24 → 238095; tax 11905 → 5952 + 5953. Two sarees
//     520000, ₹2,600 a piece, @18% → 440677.97 → 440678; tax 79322 → 39661 + 39661.
//   G composition: dal 16900 on a bill of supply, no tax: taxable 16900.
// Red-proofs: test/v2/sabotage/core-counter.ts.
import { businessDate, CoreError, mintSnapshot } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, num, register, rows, run, unbalanced } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let k: Counter; // a regular kirana
let salon: Counter;
let apparel: Counter;
let comp: Counter; // a composition kirana
let plain: Counter; // an unregistered kirana
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  [k, salon, apparel, comp, plain] = await Promise.all([
    counterShop(app, 'GST1 Kirana'),
    counterShop(app, 'GST1 Salon', 'salon'),
    counterShop(app, 'GST1 Apparel', 'apparel'),
    counterShop(app, 'GST1 Composition'),
    counterShop(app, 'GST1 Unregistered'),
  ]);
  await register(app, k, 'regular', 'KN');
  await register(app, salon, 'regular', 'EL');
  await register(app, apparel, 'regular', 'PB');
  await register(app, comp, 'composition', 'CB');
  ids.dal = await item(app, k, { name: 'Toor dal 1 kg', priceMinor: 16900, category: 'staples', taxClass: 'general_5', hsn: '0713' });
  ids.shampoo = await item(app, k, { name: 'Shampoo 200 ml', priceMinor: 14900, category: 'personal care', taxClass: 'general_18', hsn: '3305' });
  const ends = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await run(app, k.owner, 'offer.create', { name: 'Care week', kind: 'percent_off', percentBp: 1000, scope: 'category', category: 'personal care', code: 'CARE10', endsAt: ends });
  await run(app, k.owner, 'offer.create', { name: 'Fifty off', kind: 'amount_off', amountOffMinor: 5000, scope: 'all', code: 'FLAT50', endsAt: ends });
  ids.haircut = await item(app, salon, { name: 'Haircut', kind: 'service', priceMinor: 45000, taxClass: 'salon_service', hsn: '999721' });
  ids.serum = await item(app, salon, { name: 'Hair serum 100 ml', priceMinor: 59900, taxClass: 'general_18', hsn: '3305' });
  ids.regular = await customer(app, salon, 'Regular client');
  await run(app, salon.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 50 });
  ids.kurta = await item(app, apparel, { name: 'Cotton kurta', priceMinor: 240_000, taxClass: 'apparel', hsn: '6211' });
  ids.saree = await item(app, apparel, { name: 'Silk saree', priceMinor: 260_000, taxClass: 'apparel', hsn: '5007' });
  ids.dupatta = await item(app, apparel, { name: 'Dupatta', priceMinor: 250_000, taxClass: 'apparel', hsn: '6214' });
  await run(app, apparel.owner, 'offer.create', { name: 'Saree week', kind: 'percent_off', percentBp: 1000, scope: 'items', itemIds: [ids.saree], code: 'SAREE10', endsAt: ends });
  ids.compDal = await item(app, comp, { name: 'Toor dal 1 kg', priceMinor: 16900, taxClass: 'general_5', hsn: '0713' });
  ids.plainDal = await item(app, plain, { name: 'Toor dal 1 kg', priceMinor: 16900, taxClass: 'general_5' });
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

type Line = [discount: number, taxable: number, rate: number, cgst: number, sgst: number, total: number];
type Key = { kind: string; taxable: number; cgst: number; sgst: number; total: number; lines: Line[] };

// The sale, paid in cash at the hand-worked total (so a different total is refused), and its invoice as stored.
async function sell(s: Counter, total: number, lines: [string, number][], extra: Record<string, unknown> = {}) {
  const r = await run(app, s.staff, 'sale.record', {
    shopId: s.shopId,
    lines: lines.map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })),
    payments: [{ method: 'cash', amountMinor: total }],
    ...extra,
  });
  const [invoice] = await rows(
    app,
    s,
    `select id::text as id, kind, number, series, taxable_minor::int as taxable, cgst_minor::int as cgst, sgst_minor::int as sgst, total_minor::int as total
       from books.invoice where sale_id = $1`,
    [r.saleId],
  );
  const lineRows = await rows(
    app,
    s,
    `select discount_minor::int as d, taxable_minor::int as t, rate_bp as r, cgst_minor::int as c, sgst_minor::int as g, total_minor::int as x
       from books.invoice_line where invoice_id = $1 order by line_no`,
    [invoice?.id],
  );
  return { r, invoice, lines: lineRows.map((l) => [l.d, l.t, l.r, l.c, l.g, l.x]) };
}
const expectKey = (got: Awaited<ReturnType<typeof sell>>, key: Key) => {
  expect(got.invoice).toMatchObject({ kind: key.kind, taxable: key.taxable, cgst: key.cgst, sgst: key.sgst, total: key.total });
  expect(got.lines).toEqual(key.lines);
  expect(got.r.invoiceId).toBe(got.invoice?.id);
};

it('golden invoices at one rate, at two rates, with a line discount and with a bill discount split pro rata by line value', async () => {
  const a = await sell(k, 16900, [[ids.dal as string, 1000]]);
  expectKey(a, { kind: 'tax_invoice', taxable: 16095, cgst: 402, sgst: 403, total: 16900, lines: [[0, 16095, 500, 402, 403, 16900]] });
  const bill: [string, number][] = [
    [ids.dal as string, 1000],
    [ids.shampoo as string, 2000],
  ];
  const b = await sell(k, 46700, bill);
  expectKey(b, {
    kind: 'tax_invoice',
    taxable: 41349,
    cgst: 2675,
    sgst: 2676,
    total: 46700,
    lines: [
      [0, 16095, 500, 402, 403, 16900],
      [0, 25254, 1800, 2273, 2273, 29800],
    ],
  });
  const c = await sell(k, 43720, bill, { offerCodes: ['CARE10'] });
  expectKey(c, {
    kind: 'tax_invoice',
    taxable: 38824,
    cgst: 2447,
    sgst: 2449,
    total: 43720,
    lines: [
      [0, 16095, 500, 402, 403, 16900],
      [2980, 22729, 1800, 2045, 2046, 26820],
    ],
  });
  const d = await sell(k, 41700, bill, { offerCodes: ['FLAT50'] });
  expectKey(d, {
    kind: 'tax_invoice',
    taxable: 36922,
    cgst: 2388,
    sgst: 2390,
    total: 41700,
    lines: [
      [1809, 14372, 500, 359, 360, 15091],
      [3191, 22550, 1800, 2029, 2030, 26609],
    ],
  });
  // One series, numbered 1..4 in the order sold.
  expect([a, b, c, d].map((x) => [x.invoice?.series, x.invoice?.number])).toEqual([
    ['KN', 1],
    ['KN', 2],
    ['KN', 3],
    ['KN', 4],
  ]);
  // Output GST in the journal is the invoices' (CGST and SGST credited), every entry balanced.
  const [gst] = await rows(
    app,
    k,
    `select -sum(amount_minor) filter (where account = 'gst_output_cgst')::int as cgst, -sum(amount_minor) filter (where account = 'gst_output_sgst')::int as sgst
       from books.journal_line`,
  );
  expect(gst).toEqual({ cgst: 402 + 2675 + 2447 + 2388, sgst: 403 + 2676 + 2449 + 2390 });
  expect(await unbalanced(app, k)).toEqual([]);
});

it('golden invoices: a salon service at 5%, and a loyalty redemption split pro rata by line value and taxed on each line’s net', async () => {
  const first = await sell(salon, 45000, [[ids.haircut as string, 1000]], { customerId: ids.regular });
  expectKey(first, { kind: 'tax_invoice', taxable: 42857, cgst: 1071, sgst: 1072, total: 45000, lines: [[0, 42857, 500, 1071, 1072, 45000]] });
  const e = await sell(
    salon,
    92900,
    [
      [ids.haircut as string, 1000],
      [ids.serum as string, 1000],
    ],
    { customerId: ids.regular, redeemPoints: 120 },
  );
  expectKey(e, {
    kind: 'tax_invoice',
    taxable: 82910,
    cgst: 4995,
    sgst: 4995,
    total: 92900,
    lines: [
      [5147, 37955, 500, 949, 949, 39853],
      [6853, 44955, 1800, 4046, 4046, 53047],
    ],
  });
  // The redemption's discounts name its loyalty entry, one per line.
  const discounts = await rows(app, salon, 'select line_no, source, amount_minor::int as amount from books.sale_discount where sale_id = $1 order by line_no', [e.r.saleId]);
  expect(discounts).toEqual([
    { line_no: 1, source: 'loyalty', amount: 5147 },
    { line_no: 2, source: 'loyalty', amount: 6853 },
  ]);
});

it('golden invoices: apparel at 5% up to ₹2,500 a piece and 18% above, judged on the discounted price of the piece', async () => {
  const f1 = await sell(apparel, 500_000, [
    [ids.kurta as string, 1000],
    [ids.saree as string, 1000],
  ]);
  expectKey(f1, {
    kind: 'tax_invoice',
    taxable: 448_910,
    cgst: 25_544,
    sgst: 25_546,
    total: 500_000,
    lines: [
      [0, 228_571, 500, 5714, 5715, 240_000],
      [0, 220_339, 1800, 19_830, 19_831, 260_000],
    ],
  });
  const f2 = await sell(apparel, 234_000, [[ids.saree as string, 1000]], { offerCodes: ['SAREE10'] });
  expectKey(f2, { kind: 'tax_invoice', taxable: 222_857, cgst: 5571, sgst: 5572, total: 234_000, lines: [[26_000, 222_857, 500, 5571, 5572, 234_000]] });
  const f3 = await sell(apparel, 250_000, [[ids.dupatta as string, 1000]]);
  expectKey(f3, { kind: 'tax_invoice', taxable: 238_095, cgst: 5952, sgst: 5953, total: 250_000, lines: [[0, 238_095, 500, 5952, 5953, 250_000]] });
  const f4 = await sell(apparel, 520_000, [[ids.saree as string, 2000]]);
  expectKey(f4, { kind: 'tax_invoice', taxable: 440_678, cgst: 39_661, sgst: 39_661, total: 520_000, lines: [[0, 440_678, 1800, 39_661, 39_661, 520_000]] });
});

it('a composition shop issues a bill of supply with no tax; an unregistered shop issues no invoice', async () => {
  const g = await sell(comp, 16900, [[ids.compDal as string, 1000]]);
  expectKey(g, { kind: 'bill_of_supply', taxable: 16900, cgst: 0, sgst: 0, total: 16900, lines: [[0, 16900, 0, 0, 0, 16900]] });
  expect(g.invoice?.series).toBe('CB');
  const [journal] = await rows(app, comp, `select count(*)::int as n from books.journal_line where account like 'gst_output_%'`);
  expect(journal).toEqual({ n: 0 });
  const none = await run(app, plain.staff, 'sale.record', { shopId: plain.shopId, lines: [{ itemId: ids.plainDal, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 16900 }] });
  expect(none).toEqual({ saleId: expect.any(String) });
  expect(await rows(app, plain, 'select 1 from books.invoice')).toEqual([]);
});

it('every sale at a registered shop is invoiced in its own transaction: a backdated one is refused (MS016) and writes nothing', async () => {
  const count = async () => (await rows(app, k, 'select (select count(*) from books.sale)::int as sales, (select count(*) from books.invoice)::int as invoices'))[0];
  const now = await sell(k, 16900, [[ids.dal as string, 1000]]);
  expect(now.invoice?.kind).toBe('tax_invoice');
  const before = await count();
  const backdated = await run(app, k.staff, 'sale.record', {
    shopId: k.shopId,
    soldAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    lines: [{ itemId: ids.dal, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amountMinor: 16900 }],
  }).catch((e: unknown) => e);
  expect(backdated).toBeInstanceOf(CoreError);
  expect(backdated).toMatchObject({ code: 'invalid', sqlstate: 'MS016' });
  expect(await count()).toEqual(before);
  // At this shop every sale so far has exactly one invoice.
  const [cover] = await rows(app, k, 'select count(*)::int as sales, count(i.id)::int as invoiced from books.sale s left join books.invoice i on i.sale_id = s.id');
  expect(cover?.sales).toBeGreaterThan(0);
  expect(cover?.invoiced).toBe(cover?.sales);
});

it('an item with no tax class, at a registered shop, is refused, never guessed', async () => {
  const bare = await item(app, k, { name: 'Unclassed item', priceMinor: 1000 });
  const err = await run(app, k.staff, 'sale.record', { shopId: k.shopId, lines: [{ itemId: bare, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1000 }] }).catch(
    (e: unknown) => e,
  );
  expect(err).toMatchObject({ code: 'invalid', fields: ['lines.0.itemId'] });
});

it('invoice.detail shows every printed figure as a cell of the stored invoice; invoices.list lists it in its month', async () => {
  const d = await sell(k, 41700, [[ids.dal as string, 1000], [ids.shampoo as string, 2000]], { offerCodes: ['FLAT50'] });
  const snap = await mintSnapshot(app, { kind: 'member', session: k.owner }, 'invoice.detail', { invoice_id: d.invoice?.id });
  expect(snap.rows.map((r) => [num(r.discount), num(r.taxable), num(r.rate_bp), num(r.cgst), num(r.sgst), num(r.line_total)])).toEqual([
    [1809, 14372, 500, 359, 360, 15091],
    [3191, 22550, 1800, 2029, 2030, 26609],
  ]);
  expect(snap.rows[0]).toMatchObject({
    kind: { txt: 'tax_invoice' },
    series: { txt: 'KN' },
    number: { num: String(d.invoice?.number) },
    seller_gstin: { txt: '07AAAAA1111A1Z1' },
    place_of_supply: { txt: '07' },
    invoice_total: { num: '41700', currency: 'INR' },
    description: { txt: 'Toor dal 1 kg' },
    hsn_sac: { txt: '0713' },
  });
  // Issued just now: this month in the shop's zone.
  const month = businessDate(new Date(), 'Asia/Kolkata').slice(0, 7);
  const list = await mintSnapshot(app, { kind: 'member', session: k.owner }, 'invoices.list', { shop_id: k.shopId, month });
  const listed = list.rows.find((r) => r.invoice_id?.kind === 'text' && r.invoice_id.txt === d.invoice?.id);
  expect(listed).toMatchObject({ kind: { txt: 'tax_invoice' }, taxable: { num: '36922' }, cgst: { num: '2388' }, sgst: { num: '2390' }, total: { num: '41700' } });
});
