// 17_packages.sql, the database parts of P1–P4: P1 (sell, redeem, expire: the holding's sessions and value net to zero,
// the liability nets to zero in the journal, every entry balances), P2 (the last session redeemed twice at once: one
// commits, the other MS009), P3 (a holding is the sale's named customer's; a plan is a package item, a value plan has
// no lines), P4 (each entry kind is its command's: an expiry only under an approved package.expire, a sale only in its
// holding's sale; a draft going stale when a redemption lands first is core's approval re-check, C4).
// Red-proofs: test/v2/sabotage/offers-packages-gst.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  f = await fillTenant(db, await signUp(db, 'package-shop', { type: 'salon' }));
  await db.sabotage();
});
afterAll(() => db?.close());

const run = <T>(actor: string, command: string | undefined, fn: (c: pg.PoolClient) => Promise<T>) =>
  tx(app, command ? { tenant_id: f.tenant, actor_id: actor, command } : { tenant_id: f.tenant, actor_id: actor }, fn);
const one = async (c: pg.PoolClient, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const journal = async (c: pg.PoolClient, memo: string, lines: [string, number][], source: [string, string]) => {
  const e = await one(c, `insert into books.journal_entry (tenant_id, entry_date, memo_code, source_rel, source_id) values ($1, current_date, $2, $3, $4) returning id`, [
    f.tenant,
    memo,
    ...source,
  ]);
  for (const [account, amount] of lines) {
    await c.query(`insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values ($1, $2, $3, $4, 'INR')`, [f.tenant, e, account, amount]);
  }
};
const entry = (c: pg.PoolClient, holding: string, kind: string, sessions: number, value: number) =>
  one(
    c,
    `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, seq, value_after, at)
     values ($1, $2, $3, $4, $5, $6, $7, 'INR', 0, 0, now()) returning id`,
    [f.tenant, holding, f.shop, f.service, kind, sessions, value],
  );
const redeem = (holding: string, actor = f.staff) =>
  run(actor, 'package.redeem', async (c) => {
    const e = await entry(c, holding, 'redeemed', -1, -10000);
    await journal(c, 'package_redeemed', [['package_liability', 10000], ['sales', -10000]], ['books.package_entry', e]);
  });

// A three-session plan, and a holding of it sold to `customer` (the sale, its line, the holding, the sold entry, the journal).
async function sellPack(customer: string | null = f.customer): Promise<{ sale: string; holding: string }> {
  const { pack, price, plan } = await run(f.owner, 'package.plan.create', async (c) => {
    const pack = await one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'package', 'piece') returning id`, [f.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values ($1, $2, 'Three cuts', now())`, [f.tenant, pack]);
    const price = await one(c, `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 30000, 'INR', now()) returning id`, [
      f.tenant,
      pack,
    ]);
    const plan = await one(c, `insert into books.package_plan (tenant_id, item_id, kind, validity_days) values ($1, $2, 'sessions', 30) returning id`, [f.tenant, pack]);
    await c.query(`insert into books.package_plan_line (tenant_id, plan_id, line_no, item_id, sessions) values ($1, $2, 1, $3, 3)`, [f.tenant, plan, f.service]);
    return { pack, price, plan };
  });
  return run(f.staff, 'sale.record', async (c) => {
    const sale = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 30000, 'INR') returning id`, [
      f.tenant,
      f.shop,
      customer,
    ]);
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
       values ($1, $2, 1, $3, 'package', $4, 1000, 30000, 30000, 'INR')`,
      [f.tenant, sale, pack, price],
    );
    const holding = await one(
      c,
      `insert into books.package_holding (tenant_id, customer_id, plan_id, sale_id, starts_on, expires_on, liability_minor, currency)
       values ($1, $2, $3, $4, current_date, current_date + 30, 30000, 'INR') returning id`,
      [f.tenant, customer ?? f.customer, plan, sale],
    );
    await entry(c, holding, 'sold', 3, 30000);
    await journal(c, 'sale', [['cash', 30000], ['package_liability', -30000]], ['books.sale', sale]);
    return { sale, holding };
  });
}

// package.expire is draft-only: proposed, then approved by the owner a transaction later and written under the decision.
async function expire(holding: string, sessions: number, value: number): Promise<void> {
  const draft = await run(f.owner, undefined, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'package.expire', '{}', $2, 'member', 0) returning id`, [
      f.tenant,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  await run(f.owner, undefined, async (c) => {
    const d = await one(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`, [
      f.tenant,
      draft,
      f.owner,
    ]);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
    const e = await entry(c, holding, 'expired', sessions, value);
    await journal(c, 'package_expired', [['package_liability', -value], ['package_breakage', value]], ['books.package_entry', e]);
  });
}

it('P1 sell, redeem, expire: the holding’s sessions and value net to zero, and so does its liability in the journal, every entry balanced', async () => {
  const { sale, holding } = await sellPack();
  await redeem(holding);
  await redeem(holding, f.manager);
  await expire(holding, -1, -10000);
  const { rows } = await db.admin.query(
    `select kind, seq::int, sessions_after, value_after::int from books.package_entry where holding_id = $1 order by seq`,
    [holding],
  );
  expect(rows).toEqual([
    { kind: 'sold', seq: 1, sessions_after: 3, value_after: 30000 },
    { kind: 'redeemed', seq: 2, sessions_after: 2, value_after: 20000 },
    { kind: 'redeemed', seq: 3, sessions_after: 1, value_after: 10000 },
    { kind: 'expired', seq: 4, sessions_after: 0, value_after: 0 },
  ]);
  const liability = await db.admin.query(
    `select coalesce(sum(l.amount_minor), 0)::int as net, count(distinct e.id)::int as entries from books.journal_line l
       join books.journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      where l.account = 'package_liability'
        and (e.source_id = $1 or e.source_id in (select id from books.package_entry where holding_id = $2))`,
    [sale, holding],
  );
  expect(liability.rows).toEqual([{ net: 0, entries: 4 }]);
  const over = await refused(redeem(holding));
  expect([over.code, over.message]).toEqual(['MS009', 'package refused: the holding would have -10000 left in value and -1 sessions']);
});

async function race(fn: (c: pg.PoolClient) => Promise<unknown>, command: string): Promise<string> {
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', $3, true)`, [
        f.tenant,
        f.staff,
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

it('P2 two redemptions of a holding’s last session at once: one commits and the other is refused (MS009)', async () => {
  const { holding } = await sellPack();
  await redeem(holding);
  await redeem(holding);
  // The entry is each transaction's first book row, so the holding's lock (behind the chain lock) is what orders them.
  const last = async (c: pg.PoolClient) => {
    const e = await entry(c, holding, 'redeemed', -1, -10000);
    await journal(c, 'package_redeemed', [['package_liability', 10000], ['sales', -10000]], ['books.package_entry', e]);
  };
  expect(await race(last, 'package.redeem')).toBe('MS009');
  const { rows } = await db.admin.query(`select count(*)::int as n, min(sessions_after) as left from books.package_entry where holding_id = $1 and kind = 'redeemed'`, [
    holding,
  ]);
  expect(rows).toEqual([{ n: 3, left: 0 }]);
});

it('P3 a holding is its sale’s named customer’s; a plan is a package item, and only a sessions plan has lines', async () => {
  const plan = f.plan;
  const holdingOn = (customer: string | null, holder: string) =>
    run(f.staff, 'sale.record', async (c) => {
      const sale = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 0, 'INR') returning id`, [
        f.tenant,
        f.shop,
        customer,
      ]);
      await c.query(
        `insert into books.package_holding (tenant_id, customer_id, plan_id, sale_id, starts_on, expires_on, liability_minor, currency)
         values ($1, $2, $3, $4, current_date, current_date + 30, 0, 'INR')`,
        [f.tenant, holder, plan, sale],
      );
    });
  const other = await run(f.owner, 'customer.create', (c) => one(c, 'insert into books.customer (tenant_id) values ($1) returning id', [f.tenant]));
  expect((await refused(holdingOn(null, f.customer))).code, 'an anonymous sale').toBe('23503');
  expect((await refused(holdingOn(f.customer, other))).code, 'another customer').toBe('23503');
  await holdingOn(f.customer, f.customer);
  const valuePlanLine = await refused(
    run(f.owner, 'package.plan.create', async (c) => {
      const pack = await one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'package', 'piece') returning id`, [f.tenant]);
      const p = await one(c, `insert into books.package_plan (tenant_id, item_id, kind, value_minor, currency, validity_days) values ($1, $2, 'value', 50000, 'INR', 365) returning id`, [
        f.tenant,
        pack,
      ]);
      await c.query(`insert into books.package_plan_line (tenant_id, plan_id, line_no, item_id, sessions) values ($1, $2, 1, $3, 2)`, [f.tenant, p, f.service]);
    }),
  );
  expect(valuePlanLine.code).toBe('23503');
  const goodPlan = await refused(
    run(f.owner, 'package.plan.create', (c) =>
      c.query(`insert into books.package_plan (tenant_id, item_id, kind, validity_days) values ($1, $2, 'sessions', 30)`, [f.tenant, f.good]),
    ),
  );
  expect(goodPlan.code).toBe('23503');
});

it('P4 each entry kind is its command’s: an expiry only under an approved package.expire, a redemption only by package.redeem, a sale only in its holding’s sale', async () => {
  const { holding } = await sellPack();
  const direct = await refused(run(f.owner, 'package.expire', (c) => entry(c, holding, 'expired', -3, -30000)));
  expect([direct.code, direct.message]).toEqual(['MS001', 'book write refused: the acting member may not run package.expire directly']);
  const byRedeem = await refused(run(f.owner, 'package.redeem', (c) => entry(c, holding, 'expired', -3, -30000)));
  expect([byRedeem.code, byRedeem.message]).toEqual(['MS001', 'package refused: expired entries are written by package.expire, not package.redeem']);
  const bySale = await refused(run(f.owner, 'sale.record', (c) => entry(c, holding, 'redeemed', -1, -10000)));
  expect([bySale.code, bySale.message]).toEqual(['MS001', 'package refused: redeemed entries are written by package.redeem, not sale.record']);
  const lateSold = await refused(run(f.owner, 'sale.record', (c) => entry(c, holding, 'sold', 1, 10000)));
  expect([lateSold.code, lateSold.message]).toEqual(['MS006', 'package refused: a holding is sold only in its sale\'s transaction']);
  await expire(holding, -3, -30000);
  const { rows } = await db.admin.query(`select kind, decision_id is not null as decided from books.package_entry where holding_id = $1 order by seq`, [holding]);
  expect(rows).toEqual([
    { kind: 'sold', decided: false },
    { kind: 'expired', decided: true },
  ]);
});

it('P4 a session is redeemed only until its holding’s expires_on, in the shop’s zone; after it the holding is for package.expire', async () => {
  const { holding } = await sellPack();
  await plant(db.admin, `update books.package_holding set starts_on = (now() at time zone 'Asia/Kolkata')::date - 30, expires_on = (now() at time zone 'Asia/Kolkata')::date where id = $1`, [holding]);
  await redeem(holding); // the last day still counts
  await plant(db.admin, `update books.package_holding set starts_on = (now() at time zone 'Asia/Kolkata')::date - 30, expires_on = (now() at time zone 'Asia/Kolkata')::date - 1 where id = $1`, [holding]);
  const r = await refused(redeem(holding));
  expect([r.code, r.message]).toEqual(['MS009', 'package refused: the holding has expired; it is redeemed only until its expires_on']);
  await expire(holding, -2, -20000);
});
