// L1 at the counter: two sales redeeming a customer's last points at once, through sale.record, commit one and refuse
// the other (MS009); no balance goes below zero. Around it, the loyalty rules as sale.record applies them (BLUEPRINT
// §8.3): a named customer earns floor(net × earn_per_100 ÷ 10000) points on what the bill came to, the latest rule in
// effect wins, a redemption needs a named customer, at least the rule's minimum and no more value than the bill after
// offers, and the balance shown (loyalty.balance) is the database's, never a client's. Red-proofs:
// test/v2/sabotage/core-counter.ts.
import { CoreError, mintSnapshot } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, rows, run, SINCE } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let s: Counter;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await counterShop(app, 'L1 Salon', 'salon');
  ids.haircut = await item(app, s, { name: 'Haircut', kind: 'service', priceMinor: 45_000 });
  ids.serum = await item(app, s, { name: 'Hair serum', priceMinor: 59_900 });
  ids.meera = await customer(app, s, 'Meera');
  ids.nina = await customer(app, s, 'Nina');
  ids.lata = await customer(app, s, 'Lata');
  // One point per rupee spent, worth ₹1 each, from 50 points.
  await run(app, s.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 50, effectiveFrom: SINCE });
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

const sell = (lines: [string, number][], extra: Record<string, unknown>) =>
  run(app, s.staff, 'sale.record', { shopId: s.shopId, lines: lines.map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })), payments: [], ...extra });
const balance = async (customerId: string) =>
  ((await rows(app, s, 'select balance_after::int as b from books.loyalty_entry where customer_id = $1 order by seq desc limit 1', [customerId]))[0]?.b as number) ?? 0;

it('L1 points are earned on the bill’s net and redeemed against it: hand-worked balances, and loyalty.balance shows the database’s', async () => {
  await sell([[ids.haircut as string, 1000]], { customerId: ids.meera }); // 45000 → floor(45000 × 100 ÷ 10000) = 450
  expect(await balance(ids.meera as string)).toBe(450);
  // ₹100 of points off a ₹599 serum: the bill comes to 49900, which earns 499; 450 − 100 + 499 = 849.
  const { saleId } = await sell([[ids.serum as string, 1000]], { customerId: ids.meera, redeemPoints: 100 });
  const entries = await rows(app, s, 'select kind, points::int as points, balance_after::int as after from books.loyalty_entry where sale_id = $1 order by seq', [saleId]);
  expect(entries).toEqual([
    { kind: 'redeemed', points: -100, after: 350 },
    { kind: 'earned', points: 499, after: 849 },
  ]);
  const [total] = await rows(app, s, 'select total_minor::int as t from books.sale where id = $1', [saleId]);
  expect(total).toEqual({ t: 49_900 });
  const shown = await mintSnapshot(app, { kind: 'member', session: s.staff }, 'loyalty.balance', { customer_id: ids.meera });
  expect(shown.rows[0]).toMatchObject({ points: { num: '849' }, value: { num: '84900' }, min_redeem: { num: '50' } });
});

it('L1 at the counter: two sale.record calls redeeming a customer’s last points at once commit one and refuse the other (MS009); no balance goes below zero', async () => {
  // Lata's points as Meera's above: 450, then 450 − 100 + 499 = 849.
  await sell([[ids.haircut as string, 1000]], { customerId: ids.lata });
  await sell([[ids.serum as string, 1000]], { customerId: ids.lata, redeemPoints: 100 });
  const last = await balance(ids.lata as string);
  expect(last).toBe(849);
  // Each bill (two serums, 119800) can take all 849 points (84900).
  const both = await Promise.all(
    [1, 2].map(() =>
      sell([[ids.serum as string, 2000]], { customerId: ids.lata, redeemPoints: last }).then(
        () => 'ok',
        (e: unknown) => e,
      ),
    ),
  );
  expect(both.filter((r) => r === 'ok')).toHaveLength(1);
  const refused = both.find((r) => r !== 'ok');
  expect(refused).toBeInstanceOf(CoreError);
  expect(refused).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  // The one that committed earned floor((119800 − 84900) × 100 ÷ 10000) = 349 after spending all 849.
  expect(await balance(ids.lata as string)).toBe(349);
  const [low] = await rows(app, s, 'select min(balance_after)::int as low from books.loyalty_entry');
  expect(low?.low).toBeGreaterThanOrEqual(0);
});

it('L1 a redemption needs a named customer, the rule’s minimum and no more value than the bill after offers; the latest rule wins', async () => {
  const before = (await rows(app, s, 'select count(*)::int as n from books.sale'))[0]?.n;
  expect(await sell([[ids.serum as string, 1000]], { redeemPoints: 60 }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', fields: ['customerId'] });
  expect(await sell([[ids.serum as string, 1000]], { customerId: ids.meera, redeemPoints: 49 }).catch((e: unknown) => e)).toMatchObject({
    code: 'invalid',
    fields: ['redeemPoints'],
  });
  // 349 points are ₹349, more than a ₹100 bill: refused, not trimmed.
  const tea = await item(app, s, { name: 'Herbal tea', priceMinor: 10_000 });
  expect(await sell([[tea, 1000]], { customerId: ids.meera, redeemPoints: 349 }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', fields: ['redeemPoints'] });
  expect((await rows(app, s, 'select count(*)::int as n from books.sale'))[0]?.n).toBe(before);
  // A later rule wins: two points per rupee from now.
  await run(app, s.owner, 'loyalty.rule.set', { earnPer100: 200, pointValueMinor: 100, minRedeem: 50 });
  await sell([[tea, 1000]], { customerId: ids.nina });
  expect(await balance(ids.nina as string)).toBe(200);
});
