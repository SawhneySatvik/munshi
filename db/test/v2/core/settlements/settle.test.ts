// Settlement reconciliation on a small shop. A statement's rows (the file's own strings) are parsed on the server
// to paise, the net re-derived as gross less fees; the preview shows each line against the books and refuses a
// malformed line by its line number while the rest previews; settlement.import is the owner's or a manager's own
// command, recording each new SETTLED line as one settlement with its audit row and balanced journal entry; the same
// file, or the same UTRs and days in another, records nothing again; ON_HOLD lines are never recorded. Red-proofs:
// test/v2/sabotage/seed-settlements.ts.
import { createHash } from 'node:crypto';
import { addDays, businessDate, CoreError, localTime, previewStatement, recordSale, runCommand, withPage } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
const today = businessDate(new Date(), 'Asia/Kolkata');
const D = [addDays(today, -6), addDays(today, -5), addDays(today, -4)];
const HEADER = 'settlement_date,txn_date,channel,gross_amount,fees,net_amount,utr,status';
// Each day sells tea (₹10 a pack) on UPI: day 0 3 packs, day 1 5, day 2 2 (₹30, ₹50, ₹20).
const UPI = [3000, 5000, 2000];

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Settlements');
  const since = localTime(addDays(today, -30), 0, 'Asia/Kolkata').toISOString();
  const tea = (await runCommand(app, s.owner, 'item.create', { name: 'Tea leaves 250 g', unit: 'pack', effectiveFrom: since })).itemId as string;
  await runCommand(app, s.owner, 'price.set', { itemId: tea, amountMinor: 1000, effectiveFrom: since });
  for (const [i, day] of D.entries()) {
    await recordSale(app, s.staff, {
      shopId: s.shopId,
      soldAt: localTime(day, 600, 'Asia/Kolkata').toISOString(),
      lines: [{ itemId: tea, qtyMilli: UPI[i] as number }], // ₹10 a pack: paise and milli-packs agree
      payments: [{ method: 'upi', amountMinor: UPI[i] as number }],
    });
  }
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const csv = (lines: string[]) => [HEADER, ...lines].join('\n');
const rowsOf = (text: string) => text.split('\n').map((l) => l.split(','));
const statement = (text: string) => ({ sha256: createHash('sha256').update(text).digest('hex'), rows: rowsOf(text) });
const q = async (sql: string, values: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, values))).rows;
const settlements = async () => (await q('select count(*)::int as n from books.settlement'))[0].n as number;
// runCommand refuses a bad input before it opens a transaction, by throwing: both ways are caught.
const refusal = (f: () => Promise<unknown>) => Promise.resolve().then(f).then(() => null, (e: unknown) => e as CoreError);
// Day 0 matched; day 1 ₹5 short (₹45.00, its fee ₹0.50 taken from ₹45.50); day 2 held.
const GOOD = csv([
  `${D[1]},${D[0]},UPI,30.00,0.00,30.00,TESTUTR-1,SETTLED`,
  `${D[2]},${D[1]},UPI,45.50,0.50,45.00,TESTUTR-2,SETTLED`,
  `${D[2]},${D[2]},UPI,20.00,0.00,20.00,TESTUTR-3,ON_HOLD`,
]);

it('SETTLE1 a malformed line is refused with its line number while the rest previews; recording refuses the file', async () => {
  const bad = csv([`${D[1]},${D[0]},UPI,30.00,0.00,30.00,TESTUTR-9,SETTLED`, `${D[2]},${D[1]},UPI,45.505,0.00,45.50,TESTUTR-8,SETTLED`]);
  const p = await withPage(app, s.owner, (c) => previewStatement(c, statement(bad)));
  expect(p.errors).toEqual([{ line: 3, field: 'gross_amount' }]);
  expect(p.lines.map((l) => [l.line, l.verdict, l.netMinor])).toEqual([[2, 'matched', 3000]]);
  const e = await refusal(() => runCommand(app, s.owner, 'settlement.import', statement(bad)));
  expect(e?.code).toBe('invalid');
  expect(e?.fields).toEqual(['line 3: gross_amount']);
  expect(await settlements()).toBe(0);
});

it('SETTLE2 amounts are re-derived on the server: a net that is not gross less fees is refused, and a total the caller adds is refused', async () => {
  const tampered = csv([`${D[2]},${D[1]},UPI,45.50,0.50,55.00,TESTUTR-7,SETTLED`]);
  const p = await withPage(app, s.owner, (c) => previewStatement(c, statement(tampered)));
  expect(p.errors).toEqual([{ line: 2, field: 'net_amount' }]);
  expect(p.lines).toEqual([]);
  expect((await refusal(() => runCommand(app, s.owner, 'settlement.import', statement(tampered))))?.fields).toEqual(['line 2: net_amount']);
  expect((await refusal(() => runCommand(app, s.owner, 'settlement.import', { ...statement(GOOD), total: 999_999 })))?.code).toBe('invalid');
  expect(await settlements()).toBe(0);
});

it('SETTLE3 only an owner or a manager imports; counter staff are refused and nothing is written', async () => {
  const e = await refusal(() => runCommand(app, s.staff, 'settlement.import', statement(GOOD)));
  expect(e).toBeInstanceOf(CoreError);
  expect(await settlements()).toBe(0);
  expect((await q('select count(*)::int as n from ops.import_file'))[0].n).toBe(0);
});

it('SETTLE4 the preview shows each line against the books; recording writes each new SETTLED line once, with one audit row and a balanced journal entry each', async () => {
  const p = await withPage(app, s.manager, (c) => previewStatement(c, statement(GOOD)));
  expect(p.errors).toEqual([]);
  expect(p.lines.map((l) => [l.line, l.status, l.verdict, l.netMinor])).toEqual([
    [2, 'SETTLED', 'matched', 3000],
    [3, 'SETTLED', 'short', 4500],
    [4, 'ON_HOLD', 'matched', 2000],
  ]);
  const cells = p.lines.map((l) => p.reconcile?.rows[l.row as number]?.receipts);
  expect(cells.map((c) => (c?.kind === 'money' ? Number(c.num) : null))).toEqual(UPI);

  const { importId } = await runCommand(app, s.manager, 'settlement.import', statement(GOOD));
  const rows = await q(
    `select s.id::text, s.business_date::text as day, s.amount_minor::int as amount, s.utr, s.received_on::text as received_on, s.created_by::text as by
       from books.settlement s order by s.business_date`,
  );
  expect(rows).toEqual([
    { id: rows[0]?.id, day: D[0], amount: 3000, utr: 'TESTUTR-1', received_on: D[1], by: s.manager.memberId },
    { id: rows[1]?.id, day: D[1], amount: 4500, utr: 'TESTUTR-2', received_on: D[2], by: s.manager.memberId },
  ]);
  const [file] = await q('select id::text, rows, imported_by::text as by from ops.import_file');
  expect(file).toEqual({ id: importId, rows: 3, by: s.manager.memberId });
  const audit = await q("select entity_id::text as id from audit.audit_log where entity = 'books.settlement' and command = 'settlement.import' order by entity_id");
  expect(audit.map((a) => a.id).sort()).toEqual(rows.map((r) => r.id).sort());
  const journal = await q(
    `select e.source_id::text as id, sum(l.amount_minor)::int as net, count(*)::int as lines,
            sum(l.amount_minor) filter (where l.account = 'bank')::int as bank, sum(l.amount_minor) filter (where l.account = 'upi_clearing')::int as upi
       from books.journal_entry e join books.journal_line l on l.tenant_id = e.tenant_id and l.entry_id = e.id
      where e.source_rel = 'books.settlement' group by e.source_id order by bank`,
  );
  expect(journal).toEqual([
    { id: rows[0]?.id, net: 0, lines: 2, bank: 3000, upi: -3000 },
    { id: rows[1]?.id, net: 0, lines: 2, bank: 4500, upi: -4500 },
  ]);
  // The day's reconcile now reads from the books: day 1 is short by ₹5.
  const after = await withPage(app, s.owner, (c) => previewStatement(c, statement(GOOD)));
  expect(after.alreadyImported).toBe(true);
  expect(after.lines.map((l) => l.verdict)).toEqual(['already_recorded', 'already_recorded', 'matched']);
  const day1 = after.reconcile?.rows[after.lines[1]?.row as number];
  expect([day1?.difference, day1?.verdict]).toEqual([{ kind: 'money', num: '500', currency: 'INR' }, { kind: 'text', txt: 'short' }]);
});

it('SETTLE5 the import is idempotent: the same file records 0, and another file with the same UTRs and days records 0', async () => {
  const first = await runCommand(app, s.owner, 'settlement.import', statement(GOOD)); // SETTLE4's import, or this one
  const before = await settlements();
  expect(before).toBe(2);
  const again = await runCommand(app, s.owner, 'settlement.import', statement(GOOD));
  expect(again.importId).toBe(first.importId);
  expect(await settlements()).toBe(before);
  expect((await q('select id::text from ops.import_file')).map((r) => r.id)).toEqual([again.importId]);
  const reworded = statement(`${GOOD}\n`); // one byte more: another file, the same lines
  await runCommand(app, s.owner, 'settlement.import', reworded);
  expect(await settlements()).toBe(before);
  expect((await q('select count(*)::int as n from ops.import_file'))[0].n).toBe(2);
});
