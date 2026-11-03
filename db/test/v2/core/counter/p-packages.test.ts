// P1–P4 at the counter, through core's commands. P1: sell, redeem every session, and expire a lapsed holding: each
// holding's sessions and value end at zero, and so does its package_liability in the journal, every entry balanced;
// a session's share is the holding's value left ÷ its sessions left, the last taking the rest. P2: two redemptions of
// a holding's last session at once: one commits, the other is refused (MS009). P3: a package line needs a named
// customer. P4: package.expire runs only as an approved draft; a draft goes stale when a redemption lands first; it
// executes only on a lapsed holding, from which no redemption can land. Red-proofs: test/v2/sabotage/core-counter.ts.
import { type CellRef, CoreError, decide, mintSnapshot, proposeDraft, runCommand } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Counter, counterShop, customer, item, rows, run, SINCE, unbalanced } from './counter.ts';

let db: TestDb;
let app: pg.Pool;
let s: Counter;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await counterShop(app, 'P Salon', 'salon');
  ids.haircut = await item(app, s, { name: 'Haircut', kind: 'service', priceMinor: 45_000 });
  ids.facial = await item(app, s, { name: 'Facial', kind: 'service', priceMinor: 80_000 });
  ids.client = await customer(app, s, 'Package client');
  // ₹1,000 for two haircuts and a facial; ₹500 for two haircuts within 30 days.
  ids.trio = (
    await run(app, s.owner, 'package.plan.create', {
      name: 'Cut and glow',
      priceMinor: 100_000,
      validityDays: 90,
      lines: [
        { itemId: ids.haircut, sessions: 2 },
        { itemId: ids.facial, sessions: 1 },
      ],
      effectiveFrom: SINCE,
    })
  ).itemId as string;
  ids.monthly = (
    await run(app, s.owner, 'package.plan.create', { name: 'Monthly cuts', priceMinor: 50_000, validityDays: 30, lines: [{ itemId: ids.haircut, sessions: 2 }], effectiveFrom: SINCE })
  ).itemId as string;
  ids.odd = (
    await run(app, s.owner, 'package.plan.create', { name: 'Odd pair', priceMinor: 33_333, validityDays: 30, lines: [{ itemId: ids.haircut, sessions: 2 }], effectiveFrom: SINCE })
  ).itemId as string;
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

// Sell a holding of `pack` to the client (on credit), dated `soldAt` if given; its holding id.
async function sellPack(pack: string, soldAt?: string): Promise<{ saleId: string; holdingId: string }> {
  const { saleId } = await run(app, s.staff, 'sale.record', {
    shopId: s.shopId,
    customerId: ids.client,
    lines: [{ itemId: pack, qtyMilli: 1000 }],
    payments: [],
    ...(soldAt ? { soldAt } : {}),
  });
  const [h] = await rows(app, s, 'select id::text as id from books.package_holding where sale_id = $1', [saleId]);
  return { saleId: saleId as string, holdingId: h?.id as string };
}
const redeem = (holdingId: string, itemId: string) => run(app, s.staff, 'package.redeem', { holdingId, shopId: s.shopId, itemId });
const left = async (holdingId: string) =>
  (
    await rows(
      app,
      s,
      `select (select value_after::int from books.package_entry where holding_id = $1 order by seq desc limit 1) as value,
              (select coalesce(sum(x.sessions_after), 0)::int from (select distinct on (item_id) sessions_after from books.package_entry
                                                                     where holding_id = $1 and item_id is not null order by item_id, seq desc) x) as sessions`,
      [holdingId],
    )
  )[0];
// The holding's package_liability in the journal: its sale's credit and its entries' moves.
const liability = async (saleId: string, holdingId: string) =>
  (
    await rows(
      app,
      s,
      `select coalesce(sum(l.amount_minor), 0)::int as net from books.journal_line l join books.journal_entry e on e.id = l.entry_id
        where l.account = 'package_liability' and (e.source_id = $1 or e.source_id in (select id from books.package_entry where holding_id = $2))`,
      [saleId, holdingId],
    )
  )[0]?.net;
const balanceRef = async (holdingId: string): Promise<CellRef> => {
  const snap = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'package.balance', { holding_id: holdingId });
  return { snapshotId: snap.id, row: 0, col: 'value_left' };
};
const proposeExpiry = async (holdingId: string) =>
  proposeDraft(app, { session: s.owner }, { command: 'package.expire', payload: { holdingId }, basedOn: [await balanceRef(holdingId)] });

it('P1 sell and redeem every session: shares of the value left ÷ the sessions left, the last the rest; the liability nets to zero', async () => {
  const { saleId, holdingId } = await sellPack(ids.trio as string);
  expect(await left(holdingId)).toEqual({ value: 100_000, sessions: 3 });
  expect(await liability(saleId, holdingId)).toBe(-100_000);
  // 100000 ÷ 3 = 33333; 66667 ÷ 2 = 33333; the last session 33334.
  for (const [itemId, share] of [
    [ids.haircut, 33_333],
    [ids.facial, 33_333],
    [ids.haircut, 33_334],
  ] as const) {
    const { entryId } = await redeem(holdingId, itemId as string);
    const [moved] = await rows(app, s, `select amount_minor::int as a from books.journal_line l join books.journal_entry e on e.id = l.entry_id where e.source_id = $1 and l.account = 'sales'`, [
      entryId,
    ]);
    expect(moved?.a).toBe(-share);
  }
  expect(await left(holdingId)).toEqual({ value: 0, sessions: 0 });
  expect(await liability(saleId, holdingId)).toBe(0);
  // Nothing is left to redeem.
  expect(await redeem(holdingId, ids.haircut as string).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  expect(await unbalanced(app, s)).toEqual([]);
});

it('P1 expire a lapsed holding by an approved draft: what is left moves to breakage, and the liability nets to zero', async () => {
  // Sold 40 days ago for 30 days: lapsed 10 days ago. A session is no longer redeemed (b_package_tally).
  const { saleId, holdingId } = await sellPack(ids.monthly as string, new Date(Date.now() - 40 * 86_400_000).toISOString());
  expect(await redeem(holdingId, ids.haircut as string).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  const draft = await proposeExpiry(holdingId);
  const d = await decide(app, s.owner, draft, 'approved');
  expect(d.status).toBe('executed');
  expect(await left(holdingId)).toEqual({ value: 0, sessions: 0 });
  expect(await liability(saleId, holdingId)).toBe(0);
  const [breakage] = await rows(app, s, `select -sum(amount_minor)::int as b from books.journal_line where account = 'package_breakage'`);
  expect(breakage).toEqual({ b: 50_000 });
  const [entry] = await rows(app, s, `select kind, created_by::text as by, decision_id is not null as approved from books.package_entry where holding_id = $1 and kind = 'expired'`, [
    holdingId,
  ]);
  expect(entry).toEqual({ kind: 'expired', by: s.owner.memberId, approved: true });
  expect(await unbalanced(app, s)).toEqual([]);
});

it('P2 at the counter: two package.redeem calls for a holding’s last session at once commit one and refuse the other (MS009)', async () => {
  const { holdingId } = await sellPack(ids.monthly as string);
  await redeem(holdingId, ids.haircut as string);
  const both = await Promise.all(
    [1, 2].map(() =>
      redeem(holdingId, ids.haircut as string).then(
        () => 'ok',
        (e: unknown) => e,
      ),
    ),
  );
  expect(both.filter((r) => r === 'ok')).toHaveLength(1);
  expect(both.find((r) => r !== 'ok')).toMatchObject({ code: 'invalid', sqlstate: 'MS009' });
  expect(await left(holdingId)).toEqual({ value: 0, sessions: 0 });
});

it('P2 two redemptions at once never price a session off the same balance: the last session takes the rest', async () => {
  const { holdingId } = await sellPack(ids.odd as string);
  // Hold the holding's locks (the chain lock first, as everyone takes them) and let both redemptions go only once both
  // wait on an advisory lock: with core's lock they wait before reading the balance, without it after reading it.
  const blocker = await db.admin.connect();
  await blocker.query('begin');
  await blocker.query('select pg_advisory_xact_lock(1, hashtext($1::uuid::text))', [s.tenant]);
  await blocker.query('select pg_advisory_xact_lock(4, hashtext($1::uuid::text || $2::uuid::text))', [s.tenant, holdingId]);
  const both = Promise.all([1, 2].map(() => redeem(holdingId, ids.haircut as string)));
  const waiting = async () =>
    (
      await db.admin.query(`select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock' and wait_event = 'advisory'`, [
        db.name,
      ])
    ).rows[0].n as number;
  for (let i = 0; i < 500 && (await waiting()) < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await waiting()).toBe(2);
  await blocker.query('commit');
  blocker.release();
  await both;
  // 33333 ÷ 2 = 16666, then the last session the remaining 16667: nothing left.
  expect(await left(holdingId)).toEqual({ value: 0, sessions: 0 });
});

it('P3 a package line needs a named customer, and sells one holding of its plan', async () => {
  const before = (await rows(app, s, 'select count(*)::int as n from books.sale'))[0]?.n;
  const walkIn = await run(app, s.staff, 'sale.record', { shopId: s.shopId, lines: [{ itemId: ids.monthly, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 50_000 }] }).catch(
    (e: unknown) => e,
  );
  expect(walkIn).toBeInstanceOf(CoreError);
  expect(walkIn).toMatchObject({ code: 'invalid', fields: ['customerId'] });
  const two = await run(app, s.staff, 'sale.record', { shopId: s.shopId, customerId: ids.client, lines: [{ itemId: ids.monthly, qtyMilli: 2000 }], payments: [] }).catch(
    (e: unknown) => e,
  );
  expect(two).toMatchObject({ code: 'invalid', fields: ['lines.0.qtyMilli'] });
  expect((await rows(app, s, 'select count(*)::int as n from books.sale'))[0]?.n).toBe(before);
  const { saleId, holdingId } = await sellPack(ids.monthly as string);
  const [h] = await rows(app, s, 'select customer_id::text as c, liability_minor::int as l, expires_on - starts_on as days from books.package_holding where id = $1', [holdingId]);
  expect(h).toEqual({ c: ids.client, l: 50_000, days: 30 });
  const [stock] = await rows(app, s, 'select count(*)::int as n from books.stock_move where source_id = $1', [saleId]);
  expect(stock).toEqual({ n: 0 });
  const holdings = await mintSnapshot(app, { kind: 'member', session: s.manager }, 'package.holdings', { customer_id: ids.client }); // the office's (D-082)
  const mine = holdings.rows.find((r) => r.holding_id?.kind === 'text' && r.holding_id.txt === holdingId);
  expect(mine).toMatchObject({ package: { txt: 'Monthly cuts' }, sessions_left: { num: '2' }, value_left: { num: '50000' }, customer_id: { txt: ids.client } });
});

it('P4 package.expire runs only as an approved draft, and goes stale when a redemption lands first', async () => {
  const { holdingId } = await sellPack(ids.monthly as string);
  const direct = await runCommand(app, s.owner, 'package.expire', { holdingId }).catch((e: unknown) => e);
  expect(direct).toMatchObject({ code: 'refused', fields: ['command'] });
  const draft = await proposeExpiry(holdingId);
  await redeem(holdingId, ids.haircut as string);
  const d = await decide(app, s.owner, draft, 'approved');
  expect(d.status).toBe('stale');
  expect(await left(holdingId)).toEqual({ value: 25_000, sessions: 1 });
  // A draft for a holding still running, with nothing changed since, is refused at execution: it has not lapsed.
  const again = await proposeExpiry(holdingId);
  expect(await decide(app, s.owner, again, 'approved').catch((e: unknown) => e)).toMatchObject({ code: 'invalid', fields: ['holdingId'] });
  expect(await left(holdingId)).toEqual({ value: 25_000, sessions: 1 });
});
