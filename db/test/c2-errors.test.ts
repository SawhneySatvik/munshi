// C2 (ruling (d)): every Postgres error leaves core as a CoreError — a code and a fixed message — before it can reach a
// caller. Raw errors carry row values (a unique violation's DETAIL names the key's values); a mapped one carries none.
import { CoreError, recordPurchase } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

let db: TestDb;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  s = await smallShop(db.app, 'C2');
  await db.sabotage();
});
afterAll(() => db.close());

const BILL = 'BILL-ROWVALUE-4242';
const bill = () =>
  recordPurchase(db.app, s.manager, {
    supplierId: s.supplier,
    billNo: BILL,
    billDate: '2026-10-25',
    lines: [{ itemId: s.butter, qtyMilli: 1000, unitCostMinor: 5600 }],
  });
const failure = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a failure, but it succeeded');
};
// Every way a caller might print or serialise the error.
const shown = (e: Error) => [e.message, String(e), e.stack ?? '', JSON.stringify(e), JSON.stringify(Object.entries(e)), String((e as { cause?: unknown }).cause ?? '')].join('\n');

it('C2 a database error reaches the caller as a code, never with row values', async () => {
  await bill();
  const err = await failure(bill()); // the same bill again: purchase_bill is unique
  expect(err).toBeInstanceOf(CoreError);
  expect(err).toMatchObject({ code: 'conflict', sqlstate: '23505', constraint: 'purchase_bill', message: 'That record already exists or changed at the same time.' });
  expect((err as { cause?: unknown }).cause).toBeUndefined();
  const text = shown(err);
  for (const value of [BILL, s.supplier, s.owner.tenantId, s.manager.memberId]) expect(text, 'a row value leaked').not.toContain(value);
  expect(text).not.toMatch(/Key \(|already exists\.|DETAIL/);
  console.log(`C2 the planted unique violation reached the caller as ${(err as CoreError).code}/${(err as CoreError).sqlstate}, with no row value`);
});

it('C2 a refusal by the book guard reaches the caller as refused, without the database text', async () => {
  const err = await failure(
    recordPurchase(db.app, s.staff, {
      supplierId: s.supplier,
      billNo: 'GT-STAFF',
      billDate: '2026-10-25',
      lines: [{ itemId: s.butter, qtyMilli: 1000, unitCostMinor: 5600 }],
    }),
  );
  expect(err).toMatchObject({ code: 'refused', sqlstate: 'MS001', message: 'Not allowed.' });
  expect(shown(err)).not.toMatch(/book write refused|purchase\.record/);
});
