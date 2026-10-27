// C3: mintSnapshot runs only registered named reads, read-only, and stores their typed cells; the snapshot's actor is
// stamped by the database; a ref resolves to its stored cell in this tenant only, else "Cannot verify".
import { CANNOT_VERIFY, CoreError, formatRef, mintSnapshot, recordSale, renderCell, resolveRef, type Snapshot, withTx } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runReadOnly } from '../../packages/core/src/snapshots.ts';
import { openTestDb, refused, type TestDb, tx } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

let db: TestDb;
let a: Shop;
let b: Shop;
beforeAll(async () => {
  db = await openTestDb();
  a = await smallShop(db.app, 'A');
  b = await smallShop(db.app, 'B');
  await db.sabotage();
});
afterAll(() => db.close());

const member = (s: Shop) => ({ kind: 'member', session: s.owner }) as const;
const snapshots = async (s: Shop) =>
  (await tx(db.app, { tenant: s.owner.tenantId }, (c) => c.query('select count(*)::int as n from snap.snapshot'))).rows[0].n as number;

it('C3 mintSnapshot runs a registered named read and stores its typed cells', async () => {
  const snap = await mintSnapshot(db.app, member(a), 'stock.on_hand', { item_id: a.biscuits });
  expect(snap.rows).toEqual([
    {
      item_id: { kind: 'text', txt: a.biscuits },
      item: { kind: 'text', txt: 'Glucose biscuits 70 g' },
      on_hand: { kind: 'quantity', num: '48000', unit: 'pack' },
    },
  ]);
  const ref = formatRef({ snapshotId: snap.id, row: 0, col: 'on_hand' });
  const cell = await withTx(db.app, member(a), (c) => resolveRef(c, ref));
  expect(cell).toEqual({ kind: 'quantity', num: '48000', unit: 'pack' });
  expect(renderCell(cell)).toBe('48');
});

it('C3 an unregistered name is refused and writes nothing', async () => {
  const before = await snapshots(a);
  for (const name of ['books.sale', '__proto__', 'select 1']) {
    const err = await mintSnapshot(db.app, member(a), name, {}).catch((e: unknown) => e);
    expect(err, name).toBeInstanceOf(CoreError);
    expect(err, name).toMatchObject({ code: 'unknown_query' });
  }
  const bad = await mintSnapshot(db.app, member(a), 'stock.on_hand', { item_id: a.biscuits, extra: 1 }).catch((e: unknown) => e);
  expect(bad).toMatchObject({ code: 'invalid' });
  expect(await snapshots(a)).toBe(before);
});

it('C3 a named read cannot write, even a registered one', async () => {
  const sales = async () => (await tx(db.app, { tenant: a.owner.tenantId }, (c) => c.query('select count(*)::int as n from books.sale'))).rows[0].n;
  const before = await sales();
  const r = await refused(
    withTx(db.app, { kind: 'member', session: a.staff, command: 'sale.record' }, (c) =>
      runReadOnly(c, `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, now(), 1, 'INR') returning id`, [
        a.owner.tenantId,
        a.shopId,
      ]),
    ),
  );
  expect(r.code).toBe('refused');
  expect(await sales()).toBe(before);
});

it("C3 a ref resolves only in its own tenant; anything else is 'Cannot verify'", async () => {
  const snapB = await mintSnapshot(db.app, member(b), 'stock.on_hand', { item_id: b.biscuits });
  const refB = formatRef({ snapshotId: snapB.id, row: 0, col: 'on_hand' });
  const snapA = await mintSnapshot(db.app, member(a), 'stock.on_hand', { item_id: a.biscuits });
  const resolved = await withTx(db.app, member(a), async (c) => ({
    otherTenant: await resolveRef(c, refB),
    noSuchCol: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 0, col: 'price' })),
    noSuchRow: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 1, col: 'on_hand' })),
    malformed: await resolveRef(c, `⟨snap:${snapA.id}·0·on_hand`),
    own: await resolveRef(c, formatRef({ snapshotId: snapA.id, row: 0, col: 'on_hand' })),
  }));
  expect(resolved).toMatchObject({ otherTenant: null, noSuchCol: null, noSuchRow: null, malformed: null });
  expect(resolved.own).not.toBeNull();
  expect(renderCell(resolved.otherTenant)).toBe(CANNOT_VERIFY);
});

it("C3 a snapshot's actor is stamped by the database: the minting member, or none for a system scope", async () => {
  const byMember = await mintSnapshot(db.app, member(a), 'stock.on_hand', { item_id: a.butter });
  const bySystem = await mintSnapshot(db.app, { kind: 'system', tenantId: a.owner.tenantId }, 'stock.on_hand', { item_id: a.butter });
  const forged = await tx(db.app, { tenant: a.owner.tenantId }, (c) =>
    c.query(`insert into snap.snapshot (tenant_id, query_name, actor_id, row_count) values ($1, 'forged', $2, 0) returning actor_id`, [
      a.owner.tenantId,
      a.owner.memberId,
    ]),
  );
  const actors = await tx(db.app, { tenant: a.owner.tenantId }, (c) =>
    c.query('select id::text, actor_id::text from snap.snapshot where id = any($1::uuid[])', [[byMember.id, bySystem.id]]),
  );
  const actor = Object.fromEntries(actors.rows.map((r) => [r.id, r.actor_id]));
  expect(actor[byMember.id]).toBe(a.owner.memberId);
  expect(actor[bySystem.id]).toBeNull();
  expect(forged.rows[0].actor_id).toBeNull(); // a caller-supplied actor is replaced by the (empty) session actor
  // The minted value moves with the books: a sale is visible in the next snapshot, never in the stored one.
  await recordSale(db.app, a.staff, { shopId: a.shopId, lines: [{ itemId: a.butter, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 6200 }] });
  const after = await mintSnapshot(db.app, member(a), 'stock.on_hand', { item_id: a.butter });
  const onHand = (snap: Snapshot) => Number((snap.rows[0] as Record<string, { num: string }>).on_hand?.num);
  expect(onHand(after)).toBe(onHand(byMember) - 1000);
});
