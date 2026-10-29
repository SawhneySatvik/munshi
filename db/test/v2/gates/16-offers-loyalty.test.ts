// 16_offers_loyalty.sql: b_offer_cap (an offer's caps under its lock, a sale one redemption, a reversed one freed),
// b_offer_by_person (never an AI draft) and an offer's shape, L1 (the last points redeemed twice at once: one commits,
// the other MS009), L2 (a forged seq or balance is overwritten), TOT1's discount half (a total is its lines' gross less
// its discounts), a discount's shape, and REV1 for discounts. Red-proofs: test/v2/sabotage/offers-packages-gst.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  f = await fillTenant(db, await signUp(db, 'offer-shop'));
  await db.sabotage();
});
afterAll(() => db?.close());

const run = <T>(actor: string, command: string | undefined, fn: (c: pg.PoolClient) => Promise<T>) =>
  tx(app, command ? { tenant_id: f.tenant, actor_id: actor, command } : { tenant_id: f.tenant, actor_id: actor }, fn);
const one = async (c: pg.PoolClient, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const newCustomer = () => run(f.owner, 'customer.create', (c) => one(c, 'insert into books.customer (tenant_id) values ($1) returning id', [f.tenant]));
const header = (c: pg.PoolClient, customer: string | null, total: number) =>
  one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, $4, 'INR') returning id`, [
    f.tenant,
    f.shop,
    customer,
    total,
  ]);
const line = (c: pg.PoolClient, sale: string, n: number) =>
  c.query(
    `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
     values ($1, $2, $3, $4, 'good', $5, 1000, 25000, 25000, 'INR')`,
    [f.tenant, sale, n, f.good, f.goodPrice],
  );
const discount = (c: pg.PoolClient, sale: string, cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return c.query(
    `insert into books.sale_discount (tenant_id, sale_id, ${keys.join(', ')}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')})`,
    [f.tenant, sale, ...Object.values(cols)],
  );
};
// The reversal of a sale and of its lines and discounts, under the reversal header (REV1).
const reverse = (sale: string, withDiscounts = true) =>
  run(f.owner, 'sale.reverse', async (c) => {
    const r = await one(
      c,
      `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency, reverses_id, reason)
       select tenant_id, shop_id, now(), customer_id, -total_minor, currency, id, 'returned_goods' from books.sale where id = $1 returning id`,
      [sale],
    );
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, tax_class, tax_rate_bp,
                                    tax_minor, currency, reverses_id, reason)
       select tenant_id, $2, line_no, item_id, item_kind, price_id, -qty_milli, unit_price_minor, -gross_minor, tax_class, tax_rate_bp, -tax_minor, currency, id,
              'returned_goods' from books.sale_line where sale_id = $1`,
      [sale, r],
    );
    if (withDiscounts) {
      await c.query(
        `insert into books.sale_discount (tenant_id, sale_id, line_no, source, offer_id, discount_reason, amount_minor, currency, reverses_id, reason)
         select tenant_id, $2, line_no, source, offer_id, discount_reason, -amount_minor, currency, id, 'returned_goods' from books.sale_discount where sale_id = $1`,
        [sale, r],
      );
    }
  });

it('b_offer_cap an offer’s live redemptions stay within max_redemptions, a customer’s within per_customer_limit (which needs a named customer); a sale is one redemption; a reversed one frees its place', async () => {
  const offer = await run(f.owner, 'offer.create', (c) =>
    one(
      c,
      `insert into books.offer (tenant_id, name, kind, percent_bp, scope, max_redemptions, per_customer_limit, starts_at, ends_at)
       values ($1, 'Two only', 'percent_off', 1000, 'all', 2, 1, now() - interval '1 day', now() + interval '1 day') returning id`,
      [f.tenant],
    ),
  );
  const sell = (customer: string | null, lines = 1) =>
    run(f.staff, 'sale.record', async (c) => {
      const s = await header(c, customer, lines * 22500);
      for (let n = 1; n <= lines; n++) {
        await line(c, s, n);
        await discount(c, s, { line_no: n, source: 'offer', offer_id: offer, amount_minor: 2500, currency: 'INR' });
      }
      return s;
    });
  const [b, c] = [await newCustomer(), await newCustomer()];
  await sell(f.customer, 2); // two discounted lines, one redemption
  const again = await refused(sell(f.customer));
  expect([again.code, again.message]).toEqual(['MS009', 'discount refused: this customer has redeemed the offer 1 times, its limit']);
  const anonymous = await refused(sell(null));
  expect([anonymous.code, anonymous.message]).toEqual(['MS009', 'discount refused: an offer with a per-customer limit needs a named customer']);
  const second = await sell(b);
  const full = await refused(sell(c));
  expect([full.code, full.message]).toEqual(['MS009', 'discount refused: the offer has been redeemed 2 times, its limit']);
  await reverse(second);
  await sell(c);
  const { rows } = await db.admin.query(
    `select count(distinct d.sale_id)::int as live from books.sale_discount d
      where d.offer_id = $1 and d.reverses_id is null and not exists (select 1 from books.sale_discount r where r.reverses_id = d.id)`,
    [offer],
  );
  expect(rows).toEqual([{ live: 2 }]);
});

it('b_offer_by_person an offer is a person’s own command or a person’s draft, never an AI run’s; it holds its kind’s amount and only it; item offers alone have items; it ends once', async () => {
  const offerFrom = (source: 'member' | 'run') =>
    tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
      one(
        c,
        `insert into approval.draft (tenant_id, command, payload, based_on, source, run_id, created_txid) values ($1, 'offer.create', '{}', $2, $3, $4, 0) returning id`,
        [f.tenant, JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]), source, source === 'run' ? f.run : null],
      ),
    ).then((draft) =>
      tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
        const d = await one(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`, [
          f.tenant,
          draft,
          f.owner,
        ]);
        await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
        return one(
          c,
          `insert into books.offer (tenant_id, name, kind, percent_bp, scope, starts_at, ends_at) values ($1, 'Drafted', 'percent_off', 500, 'all', now(), now() + interval '1 day') returning id`,
          [f.tenant],
        );
      }),
    );
  const ai = await refused(offerFrom('run'));
  expect([ai.code, ai.message]).toEqual(['MS001', 'offer refused: an offer is a person\'s own, never an AI draft']);
  await offerFrom('member');
  const shape = (cols: string, vals: string) =>
    run(f.owner, 'offer.create', (c) =>
      one(c, `insert into books.offer (tenant_id, name, ${cols}, starts_at, ends_at) values ($1, 'Shape', ${vals}, now(), now() + interval '1 day') returning id`, [f.tenant]),
    );
  for (const [cols, vals] of [
    ['kind, percent_bp, amount_off_minor, currency, scope', `'percent_off', 500, 100, 'INR', 'all'`], // two amounts
    ['kind, amount_off_minor, scope', `'amount_off', 100, 'all'`], // an amount with no currency
    ['kind, percent_bp, scope', `'percent_off', 500, 'category'`], // a category scope naming none
  ]) {
    expect((await refused(shape(cols as string, vals as string))).code, vals).toBe('23514');
  }
  const all = await shape('kind, percent_bp, scope', `'percent_off', 500, 'all'`);
  const items = await refused(run(f.owner, 'offer.create', async (c) => {
    const o = await one(c, `insert into books.offer (tenant_id, name, kind, percent_bp, scope, starts_at, ends_at) values ($1, 'All', 'percent_off', 500, 'all', now(), now() + interval '1 day') returning id`, [f.tenant]);
    await c.query('insert into books.offer_item (tenant_id, offer_id, item_id) values ($1, $2, $3)', [f.tenant, o, f.good]);
  }));
  expect(items.code).toBe('23503');
  const end = () => run(f.owner, 'offer.end', (c) => c.query(`insert into books.offer_end (tenant_id, offer_id, ended_at, reason) values ($1, $2, now(), 'not_now')`, [f.tenant, all]));
  await end();
  expect((await refused(end())).code).toBe('23505');
  const badReason = await refused(run(f.owner, 'offer.end', (c) => c.query(`insert into books.offer_end (tenant_id, offer_id, ended_at, reason) values ($1, $2, now(), 'damaged')`, [f.tenant, f.offer])));
  expect(badReason.code).toBe('23503'); // a discount code, not a decision code
});

async function race(fn: (c: pg.PoolClient) => Promise<unknown>, command: string, actor = f.staff): Promise<string> {
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', $3, true)`, [
        f.tenant,
        actor,
        command,
      ]);
    }
    await fn(c1);
    let settled = false;
    const second = fn(c2).then(
      () => 'recorded',
      (e: { code: string }) => e.code,
    );
    void second.finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(settled, 'the second writer waits for the first').toBe(false);
    await c1.query('commit');
    const outcome = await second;
    await c2.query(outcome === 'recorded' ? 'commit' : 'rollback');
    return outcome;
  } finally {
    c1.release();
    c2.release();
  }
}

it('L1 two sales redeeming a customer’s last points at once: one commits and the other is refused (MS009); no balance goes below zero', async () => {
  const customer = await newCustomer();
  await run(f.staff, 'sale.record', async (c) => {
    const s = await header(c, customer, 25000);
    await line(c, s, 1);
    await c.query(`insert into books.loyalty_entry (tenant_id, customer_id, kind, points, seq, balance_after, sale_id, at) values ($1, $2, 'earned', 50, 0, 0, $3, now())`, [
      f.tenant,
      customer,
      s,
    ]);
  });
  const redeemAll = async (c: pg.PoolClient) => {
    const s = await header(c, customer, 20000);
    await line(c, s, 1);
    const e = await one(c, `insert into books.loyalty_entry (tenant_id, customer_id, kind, points, seq, balance_after, sale_id, at) values ($1, $2, 'redeemed', -50, 0, 0, $3, now()) returning id`, [
      f.tenant,
      customer,
      s,
    ]);
    await discount(c, s, { source: 'loyalty', loyalty_entry_id: e, amount_minor: 5000, currency: 'INR' });
  };
  expect(await race(redeemAll, 'sale.record')).toBe('MS009');
  const { rows } = await db.admin.query(`select kind, points::int, balance_after::int from books.loyalty_entry where customer_id = $1 order by seq`, [customer]);
  expect(rows).toEqual([
    { kind: 'earned', points: 50, balance_after: 50 },
    { kind: 'redeemed', points: -50, balance_after: 0 },
  ]);
});

it('L2 a forged seq or balance is overwritten: each entry follows the customer’s last, its balance the running sum', async () => {
  const customer = await newCustomer();
  const earn = (points: number) =>
    run(f.staff, 'sale.record', async (c) => {
      const s = await header(c, customer, 25000);
      await line(c, s, 1);
      await c.query(`insert into books.loyalty_entry (tenant_id, customer_id, kind, points, seq, balance_after, sale_id, at) values ($1, $2, 'earned', $3, 999, 999999, $4, now())`, [
        f.tenant,
        customer,
        points,
        s,
      ]);
    });
  await earn(30);
  await earn(12);
  const { rows } = await db.admin.query(`select seq::int, balance_after::int from books.loyalty_entry where customer_id = $1 order by seq`, [customer]);
  expect(rows).toEqual([
    { seq: 1, balance_after: 30 },
    { seq: 2, balance_after: 42 },
  ]);
});

it('TOT1 a sale’s total is its lines’ gross less its discounts, checked at commit', async () => {
  const sell = (total: number) =>
    run(f.staff, 'sale.record', async (c) => {
      const s = await header(c, f.customer, total);
      await line(c, s, 1);
      await discount(c, s, { line_no: 1, source: 'manual', discount_reason: 'damaged', amount_minor: 3000, currency: 'INR' });
    });
  const r = await refused(sell(25000));
  expect([r.code, r.message]).toEqual(['MS004', 'sale refused: its total is not its lines\' gross less its discounts']);
  await sell(22000);
});

it('a discount names exactly its source’s row: a manual one a discount reason, a loyalty one its own sale’s redemption; on a line of its sale; positive unless a reversal', async () => {
  const other = await run(f.staff, 'sale.record', async (c) => {
    const s = await header(c, f.customer, 25000);
    await line(c, s, 1);
    return one(c, `insert into books.loyalty_entry (tenant_id, customer_id, kind, points, seq, balance_after, sale_id, at) values ($1, $2, 'earned', 5, 0, 0, $3, now()) returning id`, [
      f.tenant,
      f.customer,
      s,
    ]);
  });
  const sell = (cols: Record<string, unknown>) =>
    run(f.staff, 'sale.record', async (c) => {
      const s = await header(c, f.customer, 25000 - Number(cols.amount_minor));
      await line(c, s, 1);
      await discount(c, s, { currency: 'INR', ...cols });
    });
  const cases: [string, Record<string, unknown>, string][] = [
    ['a manual discount with no reason', { line_no: 1, source: 'manual', amount_minor: 100 }, '23514'],
    ['a manual discount with a reason of another use', { line_no: 1, source: 'manual', discount_reason: 'not_now', amount_minor: 100 }, '23503'],
    ['a loyalty discount naming another sale’s entry', { source: 'loyalty', loyalty_entry_id: other, amount_minor: 100 }, '23503'],
    ['a discount on a line the sale lacks', { line_no: 9, source: 'manual', discount_reason: 'damaged', amount_minor: 100 }, '23503'],
    ['a negative discount that reverses nothing', { line_no: 1, source: 'manual', discount_reason: 'damaged', amount_minor: -100 }, '23514'],
    ['an offer discount naming no offer', { line_no: 1, source: 'offer', amount_minor: 100 }, '23514'],
  ];
  for (const [what, cols, code] of cases) expect((await refused(sell(cols))).code, what).toBe(code);
  await sell({ source: 'manual', discount_reason: 'damaged', amount_minor: 100 });
});

it('REV1 a sale’s reversal reverses its discounts under the reversal header, or fails at commit', async () => {
  const sale = await run(f.staff, 'sale.record', async (c) => {
    const s = await header(c, f.customer, 24000);
    await line(c, s, 1);
    await discount(c, s, { line_no: 1, source: 'manual', discount_reason: 'damaged', amount_minor: 1000, currency: 'INR' });
    return s;
  });
  const r = await refused(reverse(sale, false));
  expect([r.code, r.message]).toEqual(['MS013', 'reversal refused: 1 row(s) of books.sale_discount under the original are not reversed']);
  await reverse(sale);
});
