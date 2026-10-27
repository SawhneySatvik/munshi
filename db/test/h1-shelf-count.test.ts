// H1: the shelf count (MS-8). The vision model names the products on the shelf photo against the catalogue, the
// segment model counts one product per request, core stores its raw response tied to its sha256, and the count comes
// back as a cell of count.shelf; plain code compares it with the on-hand cell, and a gap becomes a stock.count draft
// citing both, which changes the books only when the owner approves it. A forged count (a response edited after it was
// hashed, or a count that is not the response's) is refused, and a count draft needs both of its cells. Expected values
// come from the drawing (18 packets of biscuits, 12 packs of butter, 3 jars of honey) and the shop's own rows.
import { createHash } from 'node:crypto';
import { businessDate, decide, mintSnapshot, recordSale, runCommand, withTx } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { countShelf, type ShelfResult } from '../../packages/agent/src/shelf.ts';
import { prepare, scripted, type Turn } from '../../packages/agent/test/script.ts';
import { openTestDb, type TestDb } from './db.ts';
import { expectCleanTraces, media, photoRun, shelfShop } from './hero.ts';

const SUITE = 'shelf';
const SHELF = media('shelf.png');

let db: TestDb;
beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

// The segment model's records for the drawn units (shelf.svg's geometry: 900 × 640 pixels), one box and one mask each.
const record = (k: number, [x1, y1, x2, y2]: number[]) =>
  `${k}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=900;h=640|><|mask;x=${x1};y=${y1};data=${(x2 as number) - (x1 as number) + 1},${(y2 as number) - (y1 as number) + 1},~Q${k}|>`;
const BISCUITS = [92, 292].flatMap((top) => Array.from({ length: 9 }, (_, k) => [36 + k * 94, top, 36 + k * 94 + 77, top + 117]));
const BUTTER = Array.from({ length: 12 }, (_, k) => [30 + k * 52, 540, 30 + k * 52 + 43, 609]);
const sam = (boxes: number[][]) => `<0f>${boxes.map((b, k) => record(k, b)).join(',')}`;

// Butter sorts before biscuits in items.list, so the catalogue shows it as item:1.
const turns = (): Turn[] => [
  {
    json: {
      products: [
        { item: 'item:2', phrase: 'yellow biscuit packet' },
        { item: 'item:1', phrase: 'butter pack' },
        { item: null, phrase: 'honey jar' },
      ],
    },
  },
  { text: sam(BISCUITS) },
  { text: sam(BUTTER) },
];

async function counted(label: string) {
  const s = await shelfShop(db, label);
  const run = await photoRun(db, s);
  const script = scripted(SUITE, turns());
  const result = await countShelf(SHELF, { port: run.port, deps: script.deps });
  expect(script.left()).toBe(0);
  expect(result.kind).toBe('counted');
  return { s, run, result: result as Extract<ShelfResult, { kind: 'counted' }> };
}
const row = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
const onHand = async (item: string) => Number((await db.admin.query('select coalesce(sum(qty_milli), 0) as n from books.stock_move where item_id = $1', [item])).rows[0].n);

it('H1 a shelf photo is counted one product at a time; a gap becomes a stock.count draft citing the count and the books, executed only when the owner approves', async () => {
  const { s, run, result } = await counted('H1');
  expect(result.unrecognised).toEqual(['honey jar']);
  expect(result.uncounted).toEqual([]);
  expect(result.counts.map((c) => [c.itemId, c.gap])).toEqual([
    [s.biscuits, true],
    [s.butter, false],
  ]);
  const [biscuits, butter] = result.counts;
  if (!biscuits || !butter) return;
  // The counted number is a cell: 18 packets drawn, 18 records stored, hashed as they arrived.
  expect(await run.port.resolve(biscuits.counted)).toEqual({ kind: 'quantity', num: '18000', unit: 'pack' });
  expect(await run.port.resolve(biscuits.onHand)).toEqual({ kind: 'quantity', num: '24000', unit: 'pack' });
  expect(await run.port.resolve(butter.counted)).toEqual({ kind: 'quantity', num: '12000', unit: 'pack' });
  expect(butter.draftId).toBeNull(); // 12 on the shelf, 12 in the books
  const stored = await row('select raw, raw_sha256, matches, photo_sha256, run_id from ops.shelf_count where id = $1', [biscuits.countId]);
  expect(stored).toMatchObject({ raw: sam(BISCUITS), raw_sha256: sha(sam(BISCUITS)), matches: 18, photo_sha256: sha(SHELF), run_id: run.runId });

  // The draft: the counted number and the books' number, each mapped to its own cell.
  const draft = await row('select command_type, payload, payload_refs, status from approval.draft where id = $1', [biscuits.draftId]);
  expect(draft).toMatchObject({
    command_type: 'stock.count',
    payload: { itemId: s.biscuits, countedQtyMilli: 18_000, expectedQtyMilli: 24_000 },
    payload_refs: { countedQtyMilli: biscuits.counted, expectedQtyMilli: biscuits.onHand },
    status: 'proposed',
  });
  expect(await onHand(s.biscuits)).toBe(24_000); // proposed, not applied
  const d = await decide(db.app, s.owner, biscuits.draftId as string, 'approved');
  expect(d.status).toBe('executed');
  expect(await onHand(s.biscuits)).toBe(18_000);
  const audit = await withTx(db.app, { kind: 'member', session: s.owner }, async (c) => ({
    broken: (await c.query('select audit.verify_chain($1) as b', [s.owner.tenantId])).rows[0].b,
    adjust: (await c.query(`select actor_id from audit.audit_log where entity = 'books.stock_move' and decision_id = $1`, [d.status === 'executed' ? d.decisionId : null])).rows,
  }));
  expect(audit).toEqual({ broken: null, adjust: [{ actor_id: s.owner.memberId }] });
  await expectCleanTraces(db, run.runId, run.events, ['yellow biscuit packet', 'butter pack', 'honey jar', 'Glucose', 'Butter', 'item:']);
});

it("H1 a forged count is refused: a response edited after it was hashed, or a count that is not the response's", async () => {
  const s = await shelfShop(db, 'H1-forged');
  const { port } = await photoRun(db, s);
  const raw = sam(BISCUITS);
  const count = { itemId: s.biscuits, photoSha256: sha(SHELF), phrase: 'yellow biscuit packet', model: 'sam-3.1', raw, rawSha256: sha(raw), matches: 18 };
  const edited = `${raw},${record(18, [36, 480, 113, 597])}`; // one more packet, written in after the hash was taken
  expect(await port.recordCount({ ...count, raw: edited }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', sqlstate: '23514', constraint: 'shelf_count_hashed' });
  expect(await port.recordCount({ ...count, raw: edited, matches: 19 }).catch((e: unknown) => e)).toMatchObject({ constraint: 'shelf_count_hashed' });
  expect(await port.recordCount({ ...count, matches: 24 }).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', sqlstate: '23514', constraint: 'shelf_count_matches' });
  // The owner of the tables editing a stored count is held to the same checks.
  const id = await port.recordCount(count);
  const tamper = (set: string) => db.admin.query(`update ops.shelf_count set ${set} where id = $1`, [id]).catch((e: { constraint?: string }) => e.constraint);
  expect(await tamper(`raw = raw || ',' || $$${record(18, [36, 480, 113, 597])}$$`)).toBe('shelf_count_hashed');
  expect(await tamper('matches = 24')).toBe('shelf_count_matches');
  const read = await mintSnapshot(db.app, { kind: 'system', tenantId: s.owner.tenantId }, 'count.shelf', { count_id: id });
  expect(read.rows[0]?.counted).toEqual({ kind: 'quantity', num: '18000', unit: 'pack' });
});

it('H1 the count draft needs both cells: the count of that item from count.shelf, and its on-hand', async () => {
  const { s, run, result } = await counted('H1-cells');
  const [biscuits, butter] = result.counts;
  if (!biscuits || !butter) return;
  const propose = (payload: Record<string, unknown>, payloadRefs: Record<string, unknown>) =>
    run.port
      .propose({ command: 'stock.count', payload: { itemId: s.biscuits, ...payload }, basedOn: [biscuits.counted, biscuits.onHand], payloadRefs: payloadRefs as never })
      .catch((e: unknown) => e);
  const refused = (path: string) => ({ code: 'invalid', fields: [`payloadRefs.${path}`] });
  // Without the books' figure beside the count.
  expect(await propose({ countedQtyMilli: 18_000 }, { countedQtyMilli: biscuits.counted })).toMatchObject(refused('expectedQtyMilli'));
  // A number equal to a count, but read from the books, not from a count.
  const butterHeld = await run.port.read('stock.on_hand', { item_id: s.butter });
  const held = { snapshotId: butterHeld.snapshotId, row: 0, col: 'on_hand' };
  expect(await propose({ countedQtyMilli: 12_000, expectedQtyMilli: 24_000 }, { countedQtyMilli: held, expectedQtyMilli: biscuits.onHand })).toMatchObject(
    refused('countedQtyMilli'),
  );
  // A count of another item (butter's 12) drafted for biscuits.
  expect(await propose({ countedQtyMilli: 12_000, expectedQtyMilli: 24_000 }, { countedQtyMilli: butter.counted, expectedQtyMilli: biscuits.onHand })).toMatchObject(
    refused('countedQtyMilli'),
  );
  // A count the books already hold (a watcher's shrinkage row of butter, counted at the counter), not a photo's.
  await runCommand(db.app, s.owner, 'stock.count', { itemId: s.butter, countedQtyMilli: 5000 });
  const shrinkage = await run.port.read('watch.shrinkage', { as_of: businessDate(new Date(), 'Asia/Kolkata') });
  const row = shrinkage.rows.findIndex((r) => r.item_id?.kind === 'text' && r.item_id.txt === s.butter);
  expect(shrinkage.rows[row]?.counted).toEqual({ kind: 'quantity', num: '5000', unit: 'pack' });
  const butterNow = await run.port.read('stock.on_hand', { item_id: s.butter });
  expect(
    await run.port
      .propose({
        command: 'stock.count',
        payload: { itemId: s.butter, countedQtyMilli: 5000, expectedQtyMilli: 5000 },
        basedOn: [{ snapshotId: butterNow.snapshotId, row: 0, col: 'on_hand' }],
        payloadRefs: { countedQtyMilli: { snapshotId: shrinkage.snapshotId, row, col: 'counted' }, expectedQtyMilli: { snapshotId: butterNow.snapshotId, row: 0, col: 'on_hand' } },
      })
      .catch((e: unknown) => e),
  ).toMatchObject(refused('countedQtyMilli'));
  // The flow's own draft has both, and executes only while both still hold: a sale after it makes it stale.
  await recordSale(db.app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1000 }] });
  expect(await decide(db.app, s.owner, biscuits.draftId as string, 'approved')).toMatchObject({ status: 'stale' });
  // And a count that states what the books held executes only if they still hold it, whoever runs it.
  const stale = await runCommand(db.app, s.owner, 'stock.count', { itemId: s.biscuits, countedQtyMilli: 18_000, expectedQtyMilli: 24_000 }).catch((e: unknown) => e);
  expect(stale).toMatchObject({ code: 'conflict', fields: ['expectedQtyMilli'] });
  expect(await onHand(s.biscuits)).toBe(23_000);
});

it('H1 only a still photo is sent: anything else is refused before any model is asked', async () => {
  const s = await shelfShop(db, 'H1-still');
  const run = await photoRun(db, s);
  const gif = new TextEncoder().encode('GIF89a not a still the shop took');
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  for (const bytes of [gif, mp4]) {
    expect(await countShelf(bytes, { port: run.port, deps: scripted(SUITE, []).deps })).toEqual({ kind: 'refused', why: 'not_a_still' });
  }
  expect(run.events.map((e) => e.label)).toEqual(['not_a_still', 'not_a_still']);
});
