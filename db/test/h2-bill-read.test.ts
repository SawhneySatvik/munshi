// H2: bill reading (MS-8). The vision model (no tools) copies a simulated supplier's bill off a photo, each figure with
// its place on the page; plain code makes the figures whole numbers; core stores them and matches each line's text to
// a catalogue item by exact name or alias (never a model); the figures come back as cells of bill.lines, and the draft
// is a purchase.record whose every number is one of those cells. A line that matched no item never becomes a book line,
// a figure with no place on the page is refused, and a unit price above the last paid is flagged with both cells.
// Expected values come from the drawn bill (bill.svg: GT-1050, three lines) and the shop's own rows.
import { decide, runCommand } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type BillResult, readBill } from '../../packages/agent/src/bill.ts';
import type { BillReadRecord } from '../../packages/agent/src/port.ts';
import { prepare, scripted, type Turn } from '../../packages/agent/test/script.ts';
import { openTestDb, refused, type TestDb, tx } from './db.ts';
import { expectCleanTraces, media, photoRun } from './hero.ts';
import { type Shop, smallShop } from './shop.ts';

const SUITE = 'bill';
const BILL = media('bill.png');
const STAINED = media('bill-stained.png');

let db: TestDb;
beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

// bill.svg's figures on the 0–1000 grid (800 × 1100 pixels; Courier, 12 pixels a character).
const AT = [
  { qty: [620, 315, 650, 333], rate: [728, 315, 788, 333] },
  { qty: [620, 360, 650, 378], rate: [712, 360, 788, 378] },
  { qty: [620, 405, 650, 424], rate: [712, 405, 788, 424] },
];
const LINES = [
  { text: 'Glucose biscuits 70 g', qty: '48', rate: '8.50' },
  { text: 'BUTTER 100G', qty: '12', rate: '62.00' },
  { text: 'Masala oats 40 g', qty: '10', rate: '18.00' },
];
const read = (unplaced = false): Turn => ({
  json: {
    billNo: 'GT-1050',
    billDate: '2026-10-27',
    lines: LINES.map((l, i) => ({ ...l, qtyAt: unplaced && i === 1 ? null : AT[i]?.qty, rateAt: AT[i]?.rate })),
  },
});

// smallShop bought butter at ₹56 a pack; its distributor prints it as "BUTTER 100G", which the owner taught the books.
async function billShop(label: string) {
  const s = await smallShop(db.app, label);
  await runCommand(db.app, s.owner, 'item.alias', { itemId: s.butter, alias: 'BUTTER 100G' });
  return s;
}

async function readIt(s: Shop) {
  const run = await photoRun(db, s);
  const script = scripted(SUITE, [read()]);
  const result = await readBill(BILL, { port: run.port, deps: script.deps, supplierId: s.supplier });
  expect(script.left()).toBe(0);
  expect(result.kind).toBe('read');
  return { run, result: result as Extract<BillResult, { kind: 'read' }> };
}
const rows = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows;

it('H2 a bill photo becomes a purchase.record draft whose every number is a bill cell placed on the page, and a price above the last paid is flagged', async () => {
  const s = await billShop('H2');
  const { run, result } = await readIt(s);
  expect(result.lines).toEqual([
    { row: 0, itemId: s.biscuits },
    { row: 1, itemId: s.butter }, // by its alias
    { row: 2, itemId: null }, // not in the catalogue
  ]);
  const cell = (row: number, col: string) => run.port.resolve({ snapshotId: result.snapshotId, row, col });
  expect(await cell(1, 'qty')).toEqual({ kind: 'quantity', num: '12000', unit: 'pack' });
  expect(await cell(1, 'unit_cost')).toEqual({ kind: 'money', num: '6200', currency: 'INR' });
  expect(await cell(0, 'unit_cost')).toEqual({ kind: 'money', num: '850', currency: 'INR' });
  expect(await Promise.all(['qty_x0', 'qty_y0', 'qty_x1', 'qty_y1'].map((c) => cell(1, c)))).toEqual(AT[1]?.qty.map((n) => ({ kind: 'integer', num: String(n) })));
  expect(await Promise.all(['cost_x0', 'cost_y0', 'cost_x1', 'cost_y1'].map((c) => cell(1, c)))).toEqual(AT[1]?.rate.map((n) => ({ kind: 'integer', num: String(n) })));
  expect(await cell(0, 'bill_no')).toEqual({ kind: 'text', txt: 'GT-1050' });

  // Butter went from ₹56 to ₹62: flagged with the bill's cell and the last bill's cell; biscuits held at ₹8.50.
  expect(result.priceRises.map((p) => [p.row, p.itemId])).toEqual([[1, s.butter]]);
  expect(await run.port.resolve(result.priceRises[0]?.lastCost as never)).toEqual({ kind: 'money', num: '5600', currency: 'INR' });

  const [draft] = await rows('select command_type, payload, payload_refs, based_on from approval.draft where id = $1', [result.draftId]);
  const at = (row: number, col: string) => ({ snapshotId: result.snapshotId, row, col });
  expect(draft.command_type).toBe('purchase.record');
  expect(draft.payload).toEqual({
    supplierId: s.supplier,
    billNo: 'GT-1050',
    billDate: '2026-10-27',
    lines: [
      { itemId: s.biscuits, qtyMilli: 48_000, unitCostMinor: 850 },
      { itemId: s.butter, qtyMilli: 12_000, unitCostMinor: 6200 },
    ],
  });
  expect(draft.payload_refs).toEqual({
    'lines[0].qtyMilli': at(0, 'qty'),
    'lines[0].unitCostMinor': at(0, 'unit_cost'),
    'lines[1].qtyMilli': at(1, 'qty'),
    'lines[1].unitCostMinor': at(1, 'unit_cost'),
  });
  expect(draft.based_on).toContainEqual(result.priceRises[0]?.lastCost);

  const before = await rows('select count(*)::int as n from books.purchase where tenant_id = $1', [s.owner.tenantId]);
  const d = await decide(db.app, s.owner, result.draftId as string, 'approved');
  expect(d.status).toBe('executed');
  const bought = await rows(
    `select i.name, pl.qty_milli::int as qty, pl.unit_cost_minor::int as cost from books.purchase p
       join books.purchase_line pl on pl.purchase_id = p.id join books.item i on i.id = pl.item_id
      where p.tenant_id = $1 and p.bill_no = 'GT-1050' order by pl.line_no`,
    [s.owner.tenantId],
  );
  expect(bought).toEqual([
    { name: 'Glucose biscuits 70 g', qty: 48_000, cost: 850 },
    { name: 'Butter 100 g', qty: 12_000, cost: 6200 },
  ]);
  expect((await rows('select count(*)::int as n from books.purchase where tenant_id = $1', [s.owner.tenantId]))[0].n).toBe(before[0].n + 1);
  await expectCleanTraces(db, run.runId, run.events, ['GT-1050', 'BUTTER', 'Masala', 'Glucose', '2026-10-27', ...LINES.map((l) => l.rate)]);
});

it('H2 an unmatched bill line never becomes a book line', async () => {
  const s = await billShop('H2-unmatched');
  const { run, result } = await readIt(s);
  const at = (row: number, col: string) => ({ snapshotId: result.snapshotId, row, col });
  const [draft] = await rows('select payload from approval.draft where id = $1', [result.draftId]);
  expect(draft.payload.lines.map((l: { itemId: string }) => l.itemId)).toEqual([s.biscuits, s.butter]);
  // A draft that books the oats line's figures (10 at ₹18) against a catalogue item is refused: that line has no item.
  const held = await run.port.read('stock.on_hand', { item_id: s.biscuits });
  const forged = await run.port
    .propose({
      command: 'purchase.record',
      payload: { supplierId: s.supplier, billNo: 'GT-1050-B', billDate: '2026-10-27', lines: [{ itemId: s.biscuits, qtyMilli: 10_000, unitCostMinor: 1800 }] },
      basedOn: [at(0, 'bill_no'), { snapshotId: held.snapshotId, row: 0, col: 'on_hand' }],
      payloadRefs: { 'lines[0].qtyMilli': at(2, 'qty'), 'lines[0].unitCostMinor': at(2, 'unit_cost') },
    })
    .catch((e: unknown) => e);
  expect(forged).toMatchObject({ code: 'invalid', fields: ['payloadRefs.lines[0].qtyMilli', 'payloadRefs.lines[0].unitCostMinor'] });
  expect((await decide(db.app, s.owner, result.draftId as string, 'approved')).status).toBe('executed');
  const books = await rows(
    `select count(*)::int as lines, count(*) filter (where pl.qty_milli = 10000)::int as oats from books.purchase_line pl
       join books.purchase p on p.id = pl.purchase_id where p.tenant_id = $1 and p.bill_no like 'GT-1050%'`,
    [s.owner.tenantId],
  );
  expect(books).toEqual([{ lines: 2, oats: 0 }]);
});

it('H2 a bill number with no page position is refused', async () => {
  const s = await billShop('H2-unplaced');
  const run = await photoRun(db, s);
  // The stained copy: the model reads line 2's quantity but cannot place it, so nothing of the bill is stored.
  const script = scripted(SUITE, [read(true)]);
  expect(await readBill(STAINED, { port: run.port, deps: script.deps, supplierId: s.supplier })).toEqual({ kind: 'refused', why: 'unplaced' });
  expect(script.left()).toBe(0);
  expect(await rows('select 1 from ops.bill_read where run_id = $1', [run.runId])).toEqual([]);
  // Whoever stores a bill, the table refuses a figure with no place, or a place off the page's grid.
  const bill = (qtyAt: BillReadRecord['lines'][number]['qtyAt']): BillReadRecord => ({
    supplierId: s.supplier,
    photoSha256: 'd'.repeat(64),
    model: 'vision-model',
    billNo: 'GT-1051',
    billDate: '2026-10-27',
    lines: [{ text: 'Glucose biscuits 70 g', qtyMilli: 48_000, qtyAt, unitCostMinor: 850, unitCostAt: [728, 315, 788, 333] }],
  });
  const PLACED = { code: 'invalid', sqlstate: '23514', constraint: 'bill_line_placed' };
  expect(await run.port.recordBill(bill(null)).catch((e: unknown) => e)).toMatchObject(PLACED);
  expect(await run.port.recordBill(bill([620, 315, 650, 1333])).catch((e: unknown) => e)).toMatchObject(PLACED);
  expect(await run.port.recordBill(bill([650, 315, 620, 333])).catch((e: unknown) => e)).toMatchObject(PLACED);
  expect(await run.port.recordBill(bill([620, 315, 650, 333]))).toEqual(expect.any(String));
});

it("H2 a bill's lines are accepted only in the transaction that read it", async () => {
  const s = await billShop('H2-late');
  const { result } = await readIt(s);
  const late = await refused(
    tx(db.app, { tenant: s.owner.tenantId }, (c) =>
      c.query(
        `insert into ops.bill_line (tenant_id, bill_read_id, line_no, item_text, item_id, qty_milli, unit_cost_minor, qty_box, cost_box)
         values ($1, $2, 4, 'Glucose biscuits 70 g', $3, 99000, 100, '{1,1,2,2}', '{3,3,4,4}')`,
        [s.owner.tenantId, result.billId, s.biscuits],
      ),
    ),
  );
  expect(late).toEqual({ code: 'MS006', message: 'bill line refused: its bill was not read in this transaction' });
});

it("H2 a line's text is matched by plain code: one item's exact name or alias, else none", async () => {
  const s = await smallShop(db.app, 'H2-match');
  // An alias that spells another item's name makes that spelling ambiguous: it matches neither.
  await runCommand(db.app, s.owner, 'item.alias', { itemId: s.butter, alias: '  Glucose   BISCUITS 70 g ' });
  await runCommand(db.app, s.owner, 'item.alias', { itemId: s.butter, alias: 'Makhan 100 g' });
  const { port } = await photoRun(db, s);
  const texts = ['glucose biscuits 70 g', 'Butter  100 g', 'MAKHAN 100 G', 'Butter 100g', 'Butter'];
  const billId = await port.recordBill({
    supplierId: s.supplier,
    photoSha256: 'e'.repeat(64),
    model: 'vision-model',
    billNo: 'GT-1052',
    billDate: '2026-10-27',
    lines: texts.map((text) => ({ text, qtyMilli: 1000, qtyAt: [1, 1, 2, 2], unitCostMinor: 100, unitCostAt: [3, 3, 4, 4] })),
  });
  const matched = await rows('select item_id from ops.bill_line where bill_read_id = $1 order by line_no', [billId]);
  expect(matched.map((m) => m.item_id)).toEqual([null, s.butter, s.butter, null, null]);
});
