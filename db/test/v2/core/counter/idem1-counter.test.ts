// IDEM1 at the counter: at a GST-registered shop, a double tap (the same idempotency key, twice at once) records one
// sale with one invoice, both taps answer with its ids, and the next sale's invoice takes the next number: no number
// is spent on the tap that replayed. Red-proofs: test/v2/sabotage/core-counter.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, item, register, rows, run } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let s: Counter;
let dal: string;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await counterShop(app, 'IDEM1 Kirana');
  await register(app, s, 'regular', 'ID');
  dal = await item(app, s, { name: 'Toor dal 1 kg', priceMinor: 16_900, taxClass: 'general_5' });
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

it('IDEM1 a double tap at a registered counter records one sale and one invoice, and spends no invoice number', async () => {
  const sale = { shopId: s.shopId, lines: [{ itemId: dal, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 16_900 }] };
  const [a, b] = await Promise.all([1, 2].map(() => run(app, s.staff, 'sale.record', sale, 'counter-tap-gst-0001')));
  expect(a).toEqual({ saleId: expect.any(String), invoiceId: expect.any(String) });
  expect(b).toEqual(a);
  const next = await run(app, s.staff, 'sale.record', sale, 'counter-tap-gst-0002');
  const invoices = await rows(app, s, 'select sale_id::text as sale, number from books.invoice order by number');
  expect(invoices).toEqual([
    { sale: a?.saleId, number: 1 },
    { sale: next.saleId, number: 2 },
  ]);
  expect(await rows(app, s, 'select count(*)::int as n from books.sale')).toEqual([{ n: 2 }]);
});
