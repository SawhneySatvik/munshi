// The simulated payments feed (payments-feed.ts) through the existing settlement road: "fetch from the feed" yields a
// statement in our own format; previewing it writes nothing; only a person's settlement.import records it (owner or
// manager; counter staff are refused), once. The feed is labelled simulated and is deterministic: the same books give the
// same statement byte for byte, so fetching again never records twice. Expected rows are worked out here by hand.
import { addDays, businessDate, CoreError, fetchFeedStatement, localTime, previewStatement, recordSale, runCommand, SIMULATED_FEED_LABEL, simulatedFeed, withPage } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
const TZ = 'Asia/Kolkata';
const today = businessDate(new Date(), TZ);
const D = (n: number) => addDays(today, -n);

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Feed');
  const since = localTime(D(30), 0, TZ).toISOString();
  const tea = (await runCommand(app, s.owner, 'item.create', { name: 'Tea leaves 250 g', unit: 'pack', effectiveFrom: since })).itemId as string;
  await runCommand(app, s.owner, 'price.set', { itemId: tea, amountMinor: 1000, effectiveFrom: since });
  await runCommand(app, s.manager, 'purchase.record', {
    supplierId: s.supplier,
    billNo: 'GT-FEED',
    billDate: D(30),
    receivedAt: localTime(D(30), 540, TZ).toISOString(),
    lines: [{ itemId: tea, qtyMilli: 100_000, unitCostMinor: 800, expiresOn: '2028-01-31' }],
  });
  const sell = (day: string, packs: number, method: 'upi' | 'card') =>
    recordSale(app, s.staff, {
      shopId: s.shopId,
      soldAt: localTime(day, 600, TZ).toISOString(),
      lines: [{ itemId: tea, qtyMilli: packs * 1000 }],
      payments: [{ method, amountMinor: packs * 1000 }],
    });
  await sell(D(6), 3, 'upi'); // ₹30.00
  await sell(D(5), 5, 'upi'); // ₹50.00
  await sell(D(4), 10, 'card'); // ₹100.00: the simulator takes a 1.5% fee, ₹1.50
  await sell(D(1), 2, 'upi'); // ₹20.00, yesterday: held
  await db.sabotage();
}, 180_000);
afterAll(() => db.close());

const q = async (sql: string) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql))).rows;
const fetched = () => withPage(app, s.manager, (c) => fetchFeedStatement(c, s.manager));
const refusal = (f: () => Promise<unknown>) => Promise.resolve().then(f).then(() => null, (e: unknown) => e as CoreError);

it('the feed is labelled simulated, and its statement is each unpaid day announced in our own format', async () => {
  const f = await fetched();
  expect([f.label, f.simulated]).toEqual([SIMULATED_FEED_LABEL, true]);
  expect(f.label).toMatch(/^Simulated payments feed/);
  const ymd = (d: string) => d.replaceAll('-', '');
  expect(f.statement.rows).toEqual([
    ['settlement_date', 'txn_date', 'channel', 'gross_amount', 'fees', 'net_amount', 'utr', 'status'],
    [D(5), D(6), 'UPI', '30.00', '0.00', '30.00', `SIMFEED-UPI-${ymd(D(6))}`, 'SETTLED'],
    [D(4), D(5), 'UPI', '50.00', '0.00', '50.00', `SIMFEED-UPI-${ymd(D(5))}`, 'SETTLED'],
    [D(3), D(4), 'CARD', '100.00', '1.50', '98.50', `SIMFEED-CARD-${ymd(D(4))}`, 'SETTLED'],
    [D(0), D(1), 'UPI', '20.00', '0.00', '20.00', `SIMFEED-UPI-${ymd(D(1))}`, 'ON_HOLD'],
  ]);
  expect((await fetched()).statement).toEqual(f.statement); // deterministic: the same sha256, so a repeat records nothing
});

it('fetching and previewing write nothing: the verdicts are the books against the feed, the held line is never recordable', async () => {
  const { statement } = await fetched();
  const p = await withPage(app, s.manager, (c) => previewStatement(c, statement));
  expect(p.errors).toEqual([]);
  expect(p.lines.map((l) => [l.channel, l.status, l.verdict])).toEqual([
    ['upi', 'SETTLED', 'matched'],
    ['upi', 'SETTLED', 'matched'],
    ['card', 'SETTLED', 'short'], // the fee came off the payout
    ['upi', 'ON_HOLD', 'matched'],
  ]);
  expect((await q('select count(*)::int as n from books.settlement'))[0]?.n).toBe(0);
  expect((await q('select count(*)::int as n from ops.import_file'))[0]?.n).toBe(0);
});

it('only a person records it: counter staff are refused; a manager records the three settled lines once, under their name', async () => {
  const { statement } = await fetched();
  const e = await refusal(() => runCommand(app, s.staff, 'settlement.import', statement));
  expect(e).toBeInstanceOf(CoreError);
  expect((await q('select count(*)::int as n from books.settlement'))[0]?.n).toBe(0);

  await runCommand(app, s.manager, 'settlement.import', statement);
  const rows = await q('select business_date::text as day, channel, amount_minor::int as amount, utr, created_by::text as by from books.settlement order by business_date');
  expect(rows.map((r) => [r.day, r.channel, r.amount, r.by])).toEqual([
    [D(6), 'upi', 3000, s.manager.memberId],
    [D(5), 'upi', 5000, s.manager.memberId],
    [D(4), 'card', 9850, s.manager.memberId],
  ]);
  expect((await q("select count(*)::int as n from audit.audit_log where command = 'settlement.import' and entity = 'books.settlement'"))[0]?.n).toBe(3);

  // The books now hold those days: the next fetch announces only what is still unpaid (the held day), and recording it writes nothing.
  const again = await fetched();
  expect(again.statement.rows.slice(1).map((r) => r[7])).toEqual(['ON_HOLD']);
  await runCommand(app, s.manager, 'settlement.import', again.statement);
  expect((await q('select count(*)::int as n from books.settlement'))[0]?.n).toBe(3);
});

it('the port holds nothing of the books: a batch is a day, a channel, gross, fees, a reference, and held or not', async () => {
  const batches = await simulatedFeed.batches({
    from: '2026-10-01',
    to: '2026-10-05',
    receipts: [
      { businessDate: '2026-10-05', channel: 'upi', receiptsMinor: 9900 },
      { businessDate: '2026-10-02', channel: 'card', receiptsMinor: 100 },
      { businessDate: '2026-09-30', channel: 'upi', receiptsMinor: 5000 }, // outside the range
      { businessDate: '2026-10-03', channel: 'upi', receiptsMinor: 0 }, // nothing taken
    ],
  });
  expect(batches).toEqual([
    { payoutOn: '2026-10-03', businessDate: '2026-10-02', channel: 'card', grossMinor: 100, feesMinor: 2, reference: 'SIMFEED-CARD-20261002', held: false }, // 1.5% of ₹1.00 rounds to 2 paise
    { payoutOn: '2026-10-06', businessDate: '2026-10-05', channel: 'upi', grossMinor: 9900, feesMinor: 0, reference: 'SIMFEED-UPI-20261005', held: true },
  ]);
});
