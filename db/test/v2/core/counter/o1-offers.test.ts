// O1: the counter's preview (sale.quote_offers) equals the sale then recorded to the paisa: each line's offer and its
// discount, its loyalty share and its net, the total, the points redeemed and earned; every journal entry balanced with
// the discounts debited to sales_discount. O2: a code that names no offer, or one ended, expired, not yet started, out of
// scope or under its minimum spend, is refused at sale.record, judged at sold_at; a client's total is never read. The
// caps (b_offer_cap): an offer's redemptions stay within max_redemptions and a customer's within per_customer_limit
// (which needs a named customer), a sale is one redemption, and a reversed sale frees its place.
// Red-proofs: test/v2/sabotage/core-counter.ts.
import { type Cell, CoreError, mintSnapshot, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, num, rows, run, SINCE, unbalanced } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let k: Counter;
let salon: Counter;
const ids: Record<string, string> = {};
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  [k, salon] = await Promise.all([counterShop(app, 'O1 Kirana'), counterShop(app, 'O1 Salon', 'salon')]);
  ids.biscuits = await item(app, k, { name: 'Glucose biscuits', priceMinor: 1000, category: 'snacks' });
  ids.chips = await item(app, k, { name: 'Potato chips', priceMinor: 2000, category: 'snacks' });
  ids.soap = await item(app, k, { name: 'Bath soap', priceMinor: 3500, category: 'personal care' });
  ids.oil = await item(app, k, { name: 'Mustard oil 1 l', priceMinor: 18000, category: 'staples' });
  const offer = async (code: string, x: Record<string, unknown>) =>
    (ids[code] = (await run(app, k.owner, 'offer.create', { name: code, code, endsAt: iso(30), startsAt: SINCE, ...x })).offerId as string);
  await offer('SNACK15', { kind: 'percent_off', percentBp: 1500, scope: 'category', category: 'snacks' });
  await offer('SNACK20', { kind: 'percent_off', percentBp: 2000, scope: 'items', itemIds: [ids.chips] });
  await offer('TIEA', { kind: 'percent_off', percentBp: 1000, scope: 'category', category: 'personal care' });
  await offer('TIEB', { kind: 'percent_off', percentBp: 1000, scope: 'category', category: 'personal care' });
  await offer('OFF30', { kind: 'amount_off', amountOffMinor: 3000, scope: 'all', minSpendMinor: 20_000 });
  await offer('BIGOIL', { kind: 'amount_off', amountOffMinor: 100_000, scope: 'items', itemIds: [ids.oil] });
  await offer('ENDED', { kind: 'percent_off', percentBp: 500, scope: 'all' });
  await run(app, k.owner, 'offer.end', { offerId: ids.ENDED, reason: 'not_now' });
  await offer('PAST', { kind: 'percent_off', percentBp: 500, scope: 'all', startsAt: iso(-10), endsAt: iso(-1) });
  await offer('SOON', { kind: 'percent_off', percentBp: 500, scope: 'all', startsAt: iso(1), endsAt: iso(10) });
  await offer('FIVEDAYS', { kind: 'percent_off', percentBp: 500, scope: 'all', startsAt: iso(-5) });
  await offer('CAPTWO', { kind: 'percent_off', percentBp: 500, scope: 'all', maxRedemptions: 2 });
  await offer('ONCE', { kind: 'percent_off', percentBp: 500, scope: 'all', perCustomerLimit: 1 });
  ids.asha = await customer(app, k, 'Asha');
  ids.bina = await customer(app, k, 'Bina');

  ids.haircut = await item(app, salon, { name: 'Haircut', kind: 'service', priceMinor: 45_000, category: 'hair' });
  ids.serum = await item(app, salon, { name: 'Hair serum', priceMinor: 59_900, category: 'retail' });
  ids.client = await customer(app, salon, 'Salon client');
  await run(app, salon.owner, 'loyalty.rule.set', { earnPer100: 100, pointValueMinor: 100, minRedeem: 50, effectiveFrom: SINCE });
  ids.pack = (await run(app, salon.owner, 'package.plan.create', { name: 'Four cuts', priceMinor: 160_000, validityDays: 90, lines: [{ itemId: ids.haircut, sessions: 4 }], effectiveFrom: SINCE })).itemId as string;
  ids.HAIR10 = (await run(app, salon.owner, 'offer.create', { name: 'Hair ten', code: 'HAIR10', kind: 'percent_off', percentBp: 1000, scope: 'all', startsAt: SINCE, endsAt: iso(30) })).offerId as string;
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

type Bill = { lines: [string, number][]; offerCodes?: string[]; customerId?: string; redeemPoints?: number };
const input = (s: Counter, b: Bill, payments: unknown[]) => ({
  shopId: s.shopId,
  lines: b.lines.map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })),
  payments,
  ...(b.offerCodes ? { offerCodes: b.offerCodes } : {}),
  ...(b.customerId ? { customerId: b.customerId } : {}),
  ...(b.redeemPoints ? { redeemPoints: b.redeemPoints } : {}),
});
const text = (c: Cell | undefined) => (c?.kind === 'text' ? c.txt : null);

// Quote the bill, record it paying the quoted total in cash, and compare every figure with the books.
async function quoteThenSell(s: Counter, seller: Session, b: Bill) {
  const quote = await mintSnapshot(app, { kind: 'member', session: seller }, 'sale.quote_offers', {
    item_ids: b.lines.map(([i]) => i),
    qty_milli: b.lines.map(([, q]) => q),
    offer_codes: b.offerCodes ?? [],
    customer_id: b.customerId ?? null,
    redeem_points: b.redeemPoints ?? null,
  });
  const total = num(quote.rows[0]?.total) as number;
  const { saleId } = await run(app, seller, 'sale.record', input(s, b, total > 0 ? [{ method: 'cash', amountMinor: total }] : []));
  const lines = await rows(
    app,
    s,
    `select l.line_no, l.gross_minor::int as gross,
            (select d.offer_id::text from books.sale_discount d where d.sale_id = l.sale_id and d.line_no = l.line_no and d.source = 'offer') as offer_id,
            coalesce((select sum(d.amount_minor) from books.sale_discount d where d.sale_id = l.sale_id and d.line_no = l.line_no and d.source = 'offer'), 0)::int as offer_off,
            coalesce((select sum(d.amount_minor) from books.sale_discount d where d.sale_id = l.sale_id and d.line_no = l.line_no and d.source = 'loyalty'), 0)::int as points_off
       from books.sale_line l where l.sale_id = $1 order by l.line_no`,
    [saleId],
  );
  expect(quote.rows.map((r) => [num(r.line_no), num(r.amount), text(r.offer_id), num(r.offer_discount), num(r.points_discount), num(r.net)])).toEqual(
    lines.map((l) => [l.line_no, l.gross, l.offer_id, l.offer_off, l.points_off, (l.gross as number) - (l.offer_off as number) - (l.points_off as number)]),
  );
  const [sale] = await rows(app, s, 'select total_minor::int as total from books.sale where id = $1', [saleId]);
  expect(sale?.total).toBe(total);
  const points = await rows(app, s, 'select kind, points::int as points from books.loyalty_entry where sale_id = $1 order by seq', [saleId]);
  const pointsOf = (kind: string) => Math.abs((points.find((p) => p.kind === kind)?.points as number | undefined) ?? 0);
  expect([num(quote.rows[0]?.points_redeemed), num(quote.rows[0]?.points_earned)]).toEqual([pointsOf('redeemed'), pointsOf('earned')]);
  const [journal] = await rows(
    app,
    s,
    `select sum(l.amount_minor) filter (where l.account = 'sales_discount')::int as discount from books.journal_line l
       join books.journal_entry e on e.id = l.entry_id where e.source_id = $1`,
    [saleId],
  );
  expect(journal?.discount ?? 0).toBe(num(quote.rows[0]?.total_discount));
  return { quote, saleId, lines };
}

it('O1 the quote equals the recorded sale to the paisa: best percentage per line, an amount-off split over the rest, a tie, a cap at the gross', async () => {
  // Hand-worked: biscuits 3000 at 15% = 450; chips 4000 at the better 20% = 800; soap 3500 and oil 36000 share ₹30 off
  // by D-053: soap floor(3000 × 3500 ÷ 39500) = 265, oil (the largest) 2735. Total 46500 − 4250 = 42250.
  const one = await quoteThenSell(k, k.staff, {
    lines: [
      [ids.biscuits as string, 3000],
      [ids.chips as string, 2000],
      [ids.soap as string, 1000],
      [ids.oil as string, 2000],
    ],
    offerCodes: ['SNACK15', 'SNACK20', 'OFF30'],
  });
  expect(one.lines.map((l) => [l.offer_id, l.offer_off])).toEqual([
    [ids.SNACK15, 450],
    [ids.SNACK20, 800],
    [ids.OFF30, 265],
    [ids.OFF30, 2735],
  ]);
  expect(num(one.quote.rows[0]?.total)).toBe(42_250);
  // Two 10% offers on one line: the lower offer id takes it.
  const tie = await quoteThenSell(k, k.staff, { lines: [[ids.soap as string, 2000]], offerCodes: ['TIEA', 'TIEB'] });
  expect(tie.lines.map((l) => [l.offer_id, l.offer_off])).toEqual([[[ids.TIEA, ids.TIEB].sort()[0], 700]]);
  // An amount-off larger than its lines gives no more than their gross: a bill of ₹0, paid with nothing.
  const capped = await quoteThenSell(k, k.staff, { lines: [[ids.oil as string, 1000]], offerCodes: ['BIGOIL'] });
  expect(num(capped.quote.rows[0]?.total)).toBe(0);
  expect(await unbalanced(app, k)).toEqual([]);
});

it('O1 the quote equals the recorded sale with an offer, a loyalty redemption split by D-053, earned points and a package line that takes neither', async () => {
  // Points first: a haircut earns 450.
  await quoteThenSell(salon, salon.staff, { lines: [[ids.haircut as string, 1000]], customerId: ids.client as string });
  const bill = await quoteThenSell(salon, salon.staff, {
    lines: [
      [ids.haircut as string, 1000],
      [ids.serum as string, 1000],
      [ids.pack as string, 1000],
    ],
    offerCodes: ['HAIR10'],
    customerId: ids.client as string,
    redeemPoints: 200,
  });
  // Hand-worked: haircut 45000 − 4500 = 40500, serum 59900 − 5990 = 53910; ₹200 of points split: haircut
  // floor(20000 × 40500 ÷ 94410) = 8579, serum 11421; the package line 160000 takes nothing.
  expect(bill.lines.map((l) => [l.offer_off, l.points_off])).toEqual([
    [4500, 8579],
    [5990, 11_421],
    [0, 0],
  ]);
  expect(num(bill.quote.rows[0]?.points_earned)).toBe(Math.floor(((45_000 + 59_900 + 160_000 - 4500 - 5990 - 20_000) * 100) / 10_000));
  expect(await unbalanced(app, salon)).toEqual([]);
});

it('O2 a code naming no offer, or one ended, expired, not yet started, out of scope or under its minimum spend, is refused, and nothing is written', async () => {
  const sales = async () => (await rows(app, k, 'select count(*)::int as n from books.sale'))[0]?.n;
  const before = await sales();
  const tryCode = (code: string, lines: [string, number][] = [[ids.oil as string, 1000]]) =>
    run(app, k.staff, 'sale.record', input(k, { lines, offerCodes: [code], customerId: ids.asha as string }, [])).catch((e: unknown) => e);
  for (const code of ['NOPE1234', 'ENDED', 'PAST', 'SOON', 'SNACK20']) {
    const err = await tryCode(code);
    expect(err, code).toBeInstanceOf(CoreError);
    expect(err, code).toMatchObject({ code: 'invalid', fields: ['offerCodes'] });
  }
  // ₹30 off needs ₹200 on the bill: ₹100 of biscuits is not enough.
  expect(await tryCode('OFF30', [[ids.biscuits as string, 10_000]])).toMatchObject({ code: 'invalid', fields: ['offerCodes'] });
  // A client's total is not an input.
  const total = await run(app, k.staff, 'sale.record', { ...input(k, { lines: [[ids.oil as string, 1000]] }, []), totalMinor: 1 }).catch((e: unknown) => e);
  expect(total).toMatchObject({ code: 'invalid' });
  expect(await sales()).toBe(before);
});

it('O2 an offer is judged at sold_at: a sale dated before it started is refused, one dated after is accepted', async () => {
  const at = (days: number) =>
    run(app, k.staff, 'sale.record', { ...input(k, { lines: [[ids.oil as string, 1000]], offerCodes: ['FIVEDAYS'], customerId: ids.asha as string }, []), soldAt: iso(days) }).catch(
      (e: unknown) => e,
    );
  expect(await at(-10)).toMatchObject({ code: 'invalid', fields: ['offerCodes'] });
  const ok = (await at(-2)) as { saleId: string };
  const [d] = await rows(app, k, 'select offer_id::text as offer_id, amount_minor::int as amount from books.sale_discount where sale_id = $1', [ok.saleId]);
  expect(d).toEqual({ offer_id: ids.FIVEDAYS, amount: 900 });
});

it('codes and caps: max_redemptions counts sales, not lines; a per-customer limit needs a named customer; a reversed sale frees its place (b_offer_cap)', async () => {
  const sell = (code: string, customerId?: string) =>
    run(
      app,
      k.staff,
      'sale.record',
      input(
        k,
        {
          lines: [
            [ids.biscuits as string, 1000],
            [ids.chips as string, 1000],
          ],
          offerCodes: [code],
          ...(customerId ? { customerId } : {}),
        },
        [{ method: 'cash', amountMinor: 2850 }],
      ),
    ).catch((e: unknown) => e);
  // Each sale discounts two lines and is one redemption: two sales use the cap of 2.
  const first = (await sell('CAPTWO')) as { saleId: string };
  expect(first).toEqual({ saleId: expect.any(String) });
  expect(await sell('CAPTWO')).toEqual({ saleId: expect.any(String) });
  const third = await sell('CAPTWO');
  expect(third).toBeInstanceOf(CoreError);
  expect(third).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  await run(app, k.owner, 'sale.reverse', { saleId: first.saleId, reason: 'customer_cancelled' });
  expect(await sell('CAPTWO')).toEqual({ saleId: expect.any(String) });

  expect(await sell('ONCE', ids.asha)).toEqual({ saleId: expect.any(String) });
  expect(await sell('ONCE', ids.asha)).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  expect(await sell('ONCE')).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  expect(await sell('ONCE', ids.bina)).toEqual({ saleId: expect.any(String) });
  const [o] = await rows(
    app,
    k,
    `select count(distinct d.sale_id)::int as n from books.sale_discount d where d.offer_id = $1 and d.reverses_id is null
        and not exists (select 1 from books.sale_discount r where r.reverses_id = d.id)`,
    [ids.CAPTWO],
  );
  expect(o).toEqual({ n: 2 });
  const detail = await mintSnapshot(app, { kind: 'member', session: k.owner }, 'offer.detail', { offer_id: ids.CAPTWO });
  expect(detail.rows[0]).toMatchObject({ redemptions: { num: '2' }, max_redemptions: { num: '2' }, in_effect: { num: '1' }, percent_bp: { num: '500' } });
});

it('offers are the owner’s own: a manager cannot create or end one, and an offer holds its kind’s amount and only it', async () => {
  const base = { name: 'Manager offer', kind: 'percent_off', percentBp: 1000, scope: 'all', endsAt: iso(5) };
  expect(await run(app, k.manager, 'offer.create', base).catch((e: unknown) => e)).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect(await run(app, k.manager, 'offer.end', { offerId: ids.SNACK15, reason: 'not_now' }).catch((e: unknown) => e)).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect(await run(app, k.owner, 'offer.create', { ...base, amountOffMinor: 500 }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid' });
  expect(await run(app, k.owner, 'offer.create', { ...base, scope: 'items' }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid' });
  // An offer ends once.
  expect(await run(app, k.owner, 'offer.end', { offerId: ids.ENDED, reason: 'other' }).catch((e: unknown) => e)).toMatchObject({ code: 'conflict' });
  const list = await mintSnapshot(app, { kind: 'member', session: k.owner }, 'offers.list', {});
  const shown = (code: string) => list.rows.find((r) => r.code?.kind === 'text' && r.code.txt === code);
  expect(shown('ENDED')).toMatchObject({ in_effect: { num: '0' }, ended_at: { kind: 'timestamp' } });
  expect(shown('SOON')).toMatchObject({ in_effect: { num: '0' }, ended_at: { kind: 'null' } });
  expect(shown('OFF30')).toMatchObject({ in_effect: { num: '1' }, amount_off: { num: '3000', currency: 'INR' }, min_spend: { num: '20000' } });
});
