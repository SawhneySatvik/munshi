// C3: mintSnapshot runs only registered named reads, read-only, and stores their typed cells as one snap.snapshot row
// (the cells as JSON, checked, hashed and counted by the database); the snapshot's actor is stamped by
// the database; a ref resolves to its stored cell in this tenant only, else "Cannot verify"; a member's display read
// reuses the snapshot of identical rows for a day; every snapshot answers its row count at ⟨snap:ID·0·_count⟩.
// Red-proofs: test/v2/sabotage/core-snapshots.ts.
import { CANNOT_VERIFY, CoreError, formatRef, mintSnapshot, recordSale, renderCell, resolveRef, runCommand, type Snapshot, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { recheck, runReadOnly } from '../../../../../packages/core/src/snapshots.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { refused } from '../../gates/lib.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let a: Shop;
let b: Shop;
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  a = await smallShop(app, 'A');
  b = await smallShop(app, 'B');
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const member = (s: Shop) => ({ kind: 'member', session: s.owner }) as const;
const snapshots = async (s: Shop) =>
  (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query('select count(*)::int as n from snap.snapshot'))).rows[0].n as number;
// A run of the owner's, as an agent run starts one: its reads are evidence snapshots.
const ownerRun = (s: Shop) =>
  tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'ask') returning id`, [s.owner.tenantId]);
    return rows[0]?.id as string;
  });

it('mintSnapshot runs a registered named read and stores its typed cells', async () => {
  const snap = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.biscuits });
  expect(snap.rows).toEqual([
    {
      item_id: { kind: 'text', txt: a.biscuits },
      item: { kind: 'text', txt: 'Glucose biscuits 70 g' },
      on_hand: { kind: 'quantity', num: '48000', unit: 'pack' },
    },
  ]);
  const ref = formatRef({ snapshotId: snap.id, row: 0, col: 'on_hand' });
  const cell = await withTx(app, member(a), (c) => resolveRef(c, ref));
  expect(cell).toEqual({ kind: 'quantity', num: '48000', unit: 'pack' });
  expect(renderCell(cell)).toBe('48 packs'); // a quantity renders with its unit
  // As stored: one row, its columns and cells as JSON, the hashes and the row count the database's own.
  const { rows: stored } = await db.admin.query(
    `select purpose, columns, rows, row_count, rows_sha256 = sha256(convert_to(rows::text, 'UTF8')) as rows_hashed,
            params_sha256 = sha256(convert_to(params::text, 'UTF8')) as params_hashed, params
       from snap.snapshot where id = $1`,
    [snap.id],
  );
  expect(stored).toEqual([
    {
      purpose: 'display',
      columns: [
        { n: 'item_id', k: 'text' },
        { n: 'item', k: 'text' },
        { n: 'on_hand', k: 'qty' },
      ],
      rows: [[{ k: 'text', t: a.biscuits }, { k: 'text', t: 'Glucose biscuits 70 g' }, { k: 'qty', n: '48000', u: 'pack' }]],
      row_count: 1,
      rows_hashed: true,
      params_hashed: true,
      params: { item_id: a.biscuits },
    },
  ]);
});

it('an unregistered name is refused and writes nothing', async () => {
  const before = await snapshots(a);
  for (const name of ['books.sale', '__proto__', 'select 1']) {
    const err = await mintSnapshot(app, member(a), name, {}).catch((e: unknown) => e);
    expect(err, name).toBeInstanceOf(CoreError);
    expect(err, name).toMatchObject({ code: 'unknown_query' });
  }
  const bad = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.biscuits, extra: 1 }).catch((e: unknown) => e);
  expect(bad).toMatchObject({ code: 'invalid' });
  expect(await snapshots(a)).toBe(before);
});

it('a named read cannot write, even a registered one', async () => {
  const sales = async () => (await tx(app, { tenant_id: a.owner.tenantId }, (c) => c.query('select count(*)::int as n from books.sale'))).rows[0].n;
  const before = await sales();
  const r = await refused(
    withTx(app, { kind: 'member', session: a.staff, command: 'sale.record' }, (c) =>
      runReadOnly(c, `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, now(), 1, 'INR') returning id`, [
        a.owner.tenantId,
        a.shopId,
      ]),
    ),
  );
  expect(r.code).toBe('refused');
  expect(await sales()).toBe(before);
});

it("a ref resolves only in its own tenant; anything else is 'Cannot verify'", async () => {
  const snapB = await mintSnapshot(app, { kind: 'member', session: b.owner }, 'stock.on_hand', { item_id: b.biscuits });
  const refB = formatRef({ snapshotId: snapB.id, row: 0, col: 'on_hand' });
  const snapA = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.biscuits });
  const resolved = await withTx(app, member(a), async (c) => ({
    otherTenant: await resolveRef(c, refB),
    noSuchCol: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 0, col: 'price' })),
    noSuchRow: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 1, col: 'on_hand' })),
    negativeRow: await resolveRef(c, { snapshotId: snapA.id, row: -1, col: 'on_hand' }), // jsonb's `-> -1` is the last row
    malformed: await resolveRef(c, `⟨snap:${snapA.id}·0·on_hand`),
    own: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 0, col: 'on_hand' })),
  }));
  expect(resolved).toMatchObject({ otherTenant: null, noSuchCol: null, noSuchRow: null, negativeRow: null, malformed: null });
  expect(resolved.own).not.toBeNull();
  expect(renderCell(resolved.otherTenant)).toBe(CANNOT_VERIFY);
});

it("a snapshot's actor is stamped by the database: the minting member, or none for a system scope", async () => {
  const byMember = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.butter });
  // A system scope mints on the jobs pool (a watcher's read): the database admits no actor there.
  const bySystem = await mintSnapshot(db.as('munshi_jobs'), { kind: 'system', tenantId: a.owner.tenantId }, 'stock.on_hand', { item_id: a.butter });
  const forged = await tx(app, { tenant_id: a.owner.tenantId, actor_id: a.staff.memberId }, (c) =>
    c.query(
      `insert into snap.snapshot (tenant_id, query_name, purpose, columns, rows, actor_id, params_sha256, rows_sha256, row_count)
       values ($1, 'forged', 'display', '[{"n": "x", "k": "int"}]', '[]', $2, '\\x00', '\\x00', 0) returning actor_id`,
      [a.owner.tenantId, a.owner.memberId],
    ),
  );
  const actors = await tx(app, { tenant_id: a.owner.tenantId }, (c) =>
    c.query('select id::text, actor_id::text, purpose from snap.snapshot where id = any($1::uuid[])', [[byMember.id, bySystem.id]]),
  );
  const row = Object.fromEntries(actors.rows.map((r) => [r.id, r]));
  expect(row[byMember.id]).toMatchObject({ actor_id: a.owner.memberId, purpose: 'display' });
  expect(row[bySystem.id]).toMatchObject({ actor_id: null, purpose: 'watch' });
  expect(forged.rows[0].actor_id).toBe(a.staff.memberId); // a caller-supplied actor is replaced by the transaction's
  // The minted value moves with the books: a sale is visible in the next snapshot, never in the stored one.
  await recordSale(app, a.staff, { shopId: a.shopId, lines: [{ itemId: a.butter, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 6200 }] });
  const after = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.butter });
  const onHand = (snap: Snapshot) => Number((snap.rows[0] as Record<string, { num: string }>).on_hand?.num);
  expect(onHand(after)).toBe(onHand(byMember) - 1000);
});

it("a member's display read of identical rows reuses the day's snapshot, an agent run's never does, and a change in the books mints anew", async () => {
  const read = (session = a.owner, runId?: string) => mintSnapshot(app, { kind: 'member', session }, 'stock.on_hand', { item_id: a.biscuits }, runId);
  const first = await read();
  const before = await snapshots(a);
  const again = await read(a.staff); // another member of the shop, the same rows
  expect(again.id).toBe(first.id);
  expect(again.rows).toEqual(first.rows);
  expect(await snapshots(a)).toBe(before);
  // Another shop's identical read is its own (RLS keeps the lookup in the tenant).
  expect((await mintSnapshot(app, { kind: 'member', session: b.owner }, 'stock.on_hand', { item_id: b.biscuits })).id).not.toBe(first.id);
  // An agent run's reads always insert, each its own evidence.
  const runId = await ownerRun(a);
  const [e1, e2] = [await read(a.owner, runId), await read(a.owner, runId)];
  expect(new Set([first.id, e1.id, e2.id]).size).toBe(3);
  // Older than a day, a snapshot is no longer reused (so a reused one is at least six days from any purge).
  const aged = await db.admin.connect();
  try {
    await aged.query('begin');
    await aged.query('set local session_replication_role = replica'); // past snap_check, which refuses any update
    await aged.query(`update snap.snapshot set created_at = now() - interval '25 hours' where id = $1`, [first.id]);
    await aged.query('commit');
  } finally {
    aged.release();
  }
  const fresh = await read();
  expect(fresh.id).not.toBe(first.id);
  expect(fresh.rows).toEqual(first.rows);
  expect((await read(a.staff)).id).toBe(fresh.id);
  // The books change: a new snapshot, then reused in turn.
  await recordSale(app, a.staff, { shopId: a.shopId, lines: [{ itemId: a.biscuits, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1000 }] });
  const moved = await read();
  const held = (snap: Snapshot) => Number((snap.rows[0] as Record<string, { num: string }>).on_hand?.num);
  expect(moved.id).not.toBe(fresh.id);
  expect(held(moved)).toBe(held(fresh) - 1000);
  expect((await read()).id).toBe(moved.id);
});

it('every snapshot answers its row count at ⟨snap:ID·0·_count⟩, 0 for an empty read, and a cited count holds only while the read returns as many rows', async () => {
  const one = await mintSnapshot(app, member(a), 'stock.on_hand', { item_id: a.biscuits });
  const none = await mintSnapshot(app, member(a), 'bill.lines_for', { purchase_id: a.customer }); // no bill has that id
  const bought = await mintSnapshot(app, member(a), 'purchases.last_prices', {});
  expect([one.rows.length, none.rows.length, bought.rows.length]).toEqual([1, 0, 2]);
  const count = (snapshotId: string, row = 0) => formatRef({ snapshotId, row, col: '_count' });
  const resolved = await withTx(app, member(a), async (c) => ({
    one: await resolveRef(c, count(one.id)),
    none: await resolveRef(c, count(none.id)),
    bought: await resolveRef(c, count(bought.id)),
    notRowZero: await resolveRef(c, count(one.id, 1)),
    otherTenant: await resolveRef(c, count((await mintSnapshot(app, { kind: 'member', session: b.owner }, 'purchases.last_prices', {})).id)),
  }));
  expect(resolved).toEqual({
    one: { kind: 'integer', num: '1' },
    none: { kind: 'integer', num: '0' },
    bought: { kind: 'integer', num: '2' },
    notRowZero: null,
    otherTenant: null,
  });
  expect(renderCell(resolved.none)).toBe('0'); // "no lines": a figure with a source
  // Re-checked as a draft's evidence is: unchanged while the read returns 2 rows; changed once a third item is bought.
  const cited = { snapshotId: bought.id, row: 0, col: '_count' };
  expect(await withTx(app, member(a), (c) => recheck(c, [cited]))).toEqual([]);
  const sugar = ((await runCommand(app, a.owner, 'item.create', { name: 'Loose sugar', unit: 'kg' })) as { itemId: string }).itemId;
  await runCommand(app, a.manager, 'purchase.record', {
    supplierId: a.supplier,
    billNo: 'GT-C3',
    billDate: new Date().toISOString().slice(0, 10),
    lines: [{ itemId: sugar, qtyMilli: 1000, unitCostMinor: 4000 }],
  });
  expect(await withTx(app, member(a), (c) => recheck(c, [cited]))).toEqual([formatRef(cited)]);
});
