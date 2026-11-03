// F4 (ops.reservation in 14_sites_public.sql): holds on a piece through packages/core/src/reservations.ts,
// the shop's stock.available read and the holds job. A hold is ops, never a book: every books table holds as many rows
// after each hold path as before, and a sale that names a held piece adds only its own rows. Red-proofs:
// test/v2/sabotage/core-holds.ts.
import { command, execute, mintSnapshot, parseInput, resolveRef, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { askToHold, declineHold, holdPiece, releaseHold, sellHeldPiece } from '../../../../../packages/core/src/reservations.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { MANIFEST, plant, refused } from '../../gates/lib.ts';
import { dayAfter, jobsUrl, sleep } from '../jobs/lib.ts';
import { ask, type Boutique, boutique, RESERVATION_HOURS } from './boutique.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let other: Boutique;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = createJobsPool(jobsUrl(db));
  other = await boutique(app, 'F4-other');
  await db.sabotage();
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});

type Row = { state: string; contact_name: string; contact_phone_e164: string; note: string | null; ip_hash: Buffer | null; held_until: Date | null };
const row = async (id: string) =>
  (
    await db.admin.query<Row & { handled_by: string | null; reason: string | null; held_s: number | null }>(
      `select state, contact_name, contact_phone_e164, note, ip_hash, held_until, handled_by::text as handled_by, reason,
              extract(epoch from held_until - handled_at)::int as held_s
         from ops.reservation where id = $1`,
      [id],
    )
  ).rows[0];
const lapse = (id: string) => plant(db.admin, `update ops.reservation set held_until = now() - interval '1 second' where id = $1`, [id]);

// A sale under sale.record by the counter hand, written as sale.record writes one, naming the reservation and selling
// `item` (none: no sale at all), and then the hold's own move to sold, in one transaction.
async function sellIn(b: Boutique, reservationId: string, item: string | null): Promise<void> {
  await tx(app, { tenant_id: b.tenantId, actor_id: b.staff.memberId, command: 'sale.record' }, async (c) => {
    if (item) {
      const price = (await c.query<{ id: string; amount: string }>('select id::text, amount_minor as amount from books.price where item_id = $1', [item])).rows[0];
      const sale = (
        await c.query<{ id: string }>(
          `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency, reservation_id) values ($1, $2, now(), $3, 'INR', $4) returning id`,
          [b.tenantId, b.shopId, price?.amount, reservationId],
        )
      ).rows[0]?.id;
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
         values ($1, $2, 1, $3, 'good', $4, 1000, $5, $5, 'INR')`,
        [b.tenantId, sale, item, price?.id, price?.amount],
      );
      await c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at) values ($1, $2, -1000, 'sale', 'books.sale', $3, now())`, [
        b.tenantId,
        item,
        sale,
      ]);
    }
    await sellHeldPiece(c, reservationId);
  });
}

// Every books table's rows, counted as the superuser (all tenants, no RLS); the tables are the catalog's, and must be
// exactly the manifest's hand-written list, so a table missing from the count fails here rather than passing unseen.
async function bookCounts(): Promise<Record<string, number>> {
  const { rows } = await db.admin.query<{ rel: string }>(
    `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'books' and c.relkind in ('r', 'p')`,
  );
  const rels = rows.map((r) => r.rel).sort();
  expect(rels).toEqual(Object.keys(MANIFEST.bookTables).sort());
  expect(rels.length).toBeGreaterThan(0);
  const counts: Record<string, number> = {};
  for (const rel of rels) counts[rel] = (await db.admin.query<{ n: number }>(`select count(*)::int as n from ${rel}`)).rows[0]?.n as number;
  return counts;
}

it('the public asks to hold a piece: one requested row with the sample contact on a demo, under no actor; it never moves its ask nor reads who asked', async () => {
  const b = await boutique(app, 'F4-ask');
  const ip = 'ab'.repeat(32);
  const id = await ask(pub, b, b.saree, 1000, ip);
  const stored = await row(id);
  expect(stored).toMatchObject({ state: 'requested', contact_name: 'Sample customer', contact_phone_e164: '+910000000000', note: null, held_until: null, handled_by: null });
  expect(stored?.ip_hash?.toString('hex')).toBe(ip);
  // A piece hold has no token: the public holds no UPDATE on ops.reservation, so it neither releases nor converts one,
  // not even by the piece it can read.
  for (const state of ['released', 'sold', 'held', 'expired']) {
    const r = await refused(tx(pub, { tenant_id: b.tenantId }, (c) => c.query('update ops.reservation set state = $2 where item_id = $1', [b.saree, state])));
    expect(r.code, state).toBe('42501');
  }
  expect((await refused(tx(pub, { tenant_id: b.tenantId }, (c) => c.query('select contact_name from ops.reservation')))).code).toBe('42501');
  expect((await tx(pub, { tenant_id: b.tenantId }, (c) => c.query('select item_id::text as item_id, state from ops.reservation'))).rows).toEqual([
    { item_id: b.saree, state: 'requested' },
  ]);
  // The ask is the public's alone: the app's pool may not insert one.
  const body = { siteId: b.siteId, itemId: b.saree, qtyMilli: 1000, name: 'Asha', phone: '+910000000000', noticeVersion: 'v1', consentVersion: 'v1', ipHash: ip };
  await expect(askToHold(app, b.tenantId, body)).rejects.toMatchObject({ code: 'refused', sqlstate: '42501' });
  // Stale versions and a paused site are the database's refusals; a malformed hash never reaches it.
  await expect(askToHold(pub, b.tenantId, { ...body, consentVersion: 'v0' })).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  await expect(askToHold(pub, b.tenantId, { ...body, ipHash: 'ab' })).rejects.toMatchObject({ code: 'invalid', fields: ['ipHash'] });
  await tx(app, { tenant_id: b.tenantId, actor_id: b.owner.memberId }, (c) => c.query(`update ops.site set intake = 'paused' where id = $1`, [b.siteId]));
  await expect(askToHold(pub, b.tenantId, body)).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS007' });
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ops.reservation where tenant_id = $1', [b.tenantId]);
  expect(rows[0]?.n).toBe(1);
});

it("an active member holds a piece until the site's reservation hours run out, declines an ask with a decline reason, and releases a hold; a final one never moves", async () => {
  const b = await boutique(app, 'F4-moves');
  const a = await ask(pub, b, b.kurta);
  await holdPiece(app, b.staff, a);
  expect(await row(a)).toMatchObject({ state: 'held', handled_by: b.staff.memberId, held_s: RESERVATION_HOURS * 3600 });
  await releaseHold(app, b.manager, a);
  expect(await row(a)).toMatchObject({ state: 'released', handled_by: b.manager.memberId });
  // A move is made only from the state it names: a second release, or a hold of a released piece, is a conflict.
  const moved = { code: 'conflict', fields: ['reservationId'] };
  await expect(releaseHold(app, b.owner, a)).rejects.toMatchObject(moved);
  await expect(holdPiece(app, b.owner, a)).rejects.toMatchObject(moved);

  const d = await ask(pub, b, b.kurta);
  await expect(declineHold(app, b.staff, d, 'wrong_figure')).rejects.toMatchObject({ code: 'invalid', sqlstate: '23503' }); // a reversal reason
  await declineHold(app, b.staff, d, 'not_now');
  expect(await row(d)).toMatchObject({ state: 'declined', reason: 'not_now', handled_by: b.staff.memberId });

  // An ask is not released, a hold is not declined, and another tenant's member finds neither.
  const e = await ask(pub, b, b.kurta);
  await expect(releaseHold(app, b.staff, e)).rejects.toMatchObject(moved);
  await holdPiece(app, b.staff, e);
  await expect(declineHold(app, b.staff, e, 'not_now')).rejects.toMatchObject(moved);
  await expect(declineHold(app, b.staff, d, 'other')).rejects.toMatchObject(moved); // a declined ask keeps its reason
  expect((await row(d))?.reason).toBe('not_now');
  await expect(releaseHold(app, other.owner, e)).rejects.toMatchObject({ code: 'not_found' });
  await expect(holdPiece(app, other.owner, d)).rejects.toMatchObject({ code: 'not_found' });
  expect((await row(e))?.state).toBe('held');
});

it('a member holds no more than is available, on hand minus live holds: refused as a conflict; a lapsed or released hold frees its piece', async () => {
  const b = await boutique(app, 'F4-limit');
  // One saree on hand.
  const first = await ask(pub, b, b.saree);
  const second = await ask(pub, b, b.saree);
  await holdPiece(app, b.staff, first);
  await expect(holdPiece(app, b.staff, second)).rejects.toMatchObject({ code: 'conflict', fields: ['qtyMilli'] });
  expect((await row(second))?.state).toBe('requested'); // the refused move rolled back
  await lapse(first); // past held_until, still stored as held until the jobs runner expires it
  await holdPiece(app, b.staff, second);
  // Three kurtas on hand.
  const two = await ask(pub, b, b.kurta, 2000);
  const twoMore = await ask(pub, b, b.kurta, 2000);
  const last = await ask(pub, b, b.kurta, 1000);
  await holdPiece(app, b.manager, two);
  await expect(holdPiece(app, b.manager, twoMore)).rejects.toMatchObject({ code: 'conflict', fields: ['qtyMilli'] });
  await holdPiece(app, b.manager, last);
  await releaseHold(app, b.manager, two);
  await holdPiece(app, b.manager, twoMore);
  expect((await row(twoMore))?.state).toBe('held');
});

it('a hold waits for a write-off of the same piece in flight, then finds nothing left and is refused', async () => {
  const b = await boutique(app, 'F4-race');
  const a = await ask(pub, b, b.saree);
  // The one saree written off, executed and held open before its commit...
  const first = await app.connect();
  try {
    await first.query('begin');
    await first.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'stock.waste', true)`, [
      b.tenantId,
      b.staff.memberId,
    ]);
    const waste = command('stock.waste');
    await execute(first, waste, parseInput(waste, { itemId: b.saree, qtyMilli: 1000 }));
    // ...while the hold starts: it must wait on the item's lock, not read the books from before the write-off.
    let settled = false;
    const held = holdPiece(app, b.manager, a)
      .catch((err: unknown) => err)
      .finally(() => {
        settled = true;
      });
    let waiting = false;
    for (let i = 0; i < 400 && !settled && !waiting; i++) {
      const { rows } = await db.admin.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where datname = $1 and usename = 'munshi_app' and wait_event_type = 'Lock' and wait_event = 'advisory'`,
        [db.name],
      );
      waiting = (rows[0]?.n ?? 0) > 0;
      if (!waiting) await sleep(25);
    }
    expect(settled).toBe(false);
    expect(waiting).toBe(true);
    await first.query('commit');
    expect(await held).toMatchObject({ code: 'conflict', fields: ['qtyMilli'] });
  } finally {
    first.release();
  }
  expect((await row(a))?.state).toBe('requested');
});

const quantity = (num: number) => ({ kind: 'quantity', num: String(num), unit: 'piece' });
const text = (txt: string) => ({ kind: 'text', txt });

it("the shop reads a held piece's availability as cells: on hand, held by live holds, how many holds, and available, from stock.available", async () => {
  const b = await boutique(app, 'F4-read');
  await holdPiece(app, b.staff, await ask(pub, b, b.kurta, 2000));
  await ask(pub, b, b.kurta, 1000); // an ask holds nothing back
  const lapsed = await ask(pub, b, b.saree);
  await holdPiece(app, b.staff, lapsed);
  await lapse(lapsed); // a lapsed hold is free
  const snap = await mintSnapshot(app, { kind: 'member', session: b.staff }, 'stock.available', {});
  expect(snap.rows).toEqual([
    { item_id: text(b.kurta), item: text('Cotton kurta'), on_hand: quantity(3000), held: quantity(2000), holds: { kind: 'integer', num: '1' }, available: quantity(1000) },
    { item_id: text(b.saree), item: text('Silk saree, peacock blue'), on_hand: quantity(1000), held: quantity(0), holds: { kind: 'integer', num: '0' }, available: quantity(1000) },
  ]);
  // Each figure is the stored snapshot's cell: it resolves through its ref to the same value.
  await tx(app, { tenant_id: b.tenantId, actor_id: b.staff.memberId }, async (c) => {
    for (const col of ['on_hand', 'held', 'holds', 'available']) {
      expect(await resolveRef(c, { snapshotId: snap.id, row: 0, col }), col).toEqual(snap.rows[0]?.[col]);
    }
  });
});

it('a sale naming a held piece marks it sold in its own transaction; with no such sale, a sale of another item, or once it is no longer held, it is refused', async () => {
  const b = await boutique(app, 'F4-sell');
  const a = await ask(pub, b, b.saree);
  await holdPiece(app, b.staff, a);
  expect((await refused(sellIn(b, a, null))).code).toBe('MS007');
  expect((await refused(sellIn(b, a, b.kurta))).code).toBe('MS007');
  expect((await row(a))?.state).toBe('held');
  await sellIn(b, a, b.saree);
  expect(await row(a)).toMatchObject({ state: 'sold', handled_by: b.staff.memberId });
  await expect(sellIn(b, a, b.saree)).rejects.toMatchObject({ code: 'conflict', fields: ['reservationId'] });
  const asked = await ask(pub, b, b.kurta);
  await expect(sellIn(b, asked, b.kurta)).rejects.toMatchObject({ code: 'conflict', fields: ['reservationId'] }); // asked, never held
});

it('a hold changes no book: every books table holds as many rows after asking, holding, declining, releasing, a refused conversion and expiring as before; a conversion adds only its sale', async () => {
  const b: Boutique = await boutique(app, 'F4-books');
  const by: Session = b.manager;
  const before = await bookCounts();
  const [saree, k1, k2, k3] = [await ask(pub, b, b.saree), await ask(pub, b, b.kurta), await ask(pub, b, b.kurta), await ask(pub, b, b.kurta)] as const;
  await holdPiece(app, by, saree);
  await holdPiece(app, by, k1);
  await holdPiece(app, by, k2);
  await declineHold(app, by, k3, 'not_now');
  await releaseHold(app, by, k1);
  expect((await refused(sellIn(b, k2, null))).code).toBe('MS007');
  await lapse(k2);
  const runs = await runDueJobs(jobs, dayAfter(1), ['holds']);
  expect(runs.filter((r) => r.tenantId === b.tenantId).map((r) => [r.outcome, r.removed])).toEqual([['ok', { reservations: 1, slot_holds: 0 }]]);
  expect(await Promise.all([saree, k1, k2, k3].map(async (id) => (await row(id))?.state))).toEqual(['held', 'released', 'expired', 'declined']);
  expect(await bookCounts()).toEqual(before);

  await sellIn(b, saree, b.saree);
  const after = await bookCounts();
  const grown = Object.fromEntries(Object.entries(after).flatMap(([rel, n]) => (n === before[rel] ? [] : [[rel, n - (before[rel] ?? 0)]])));
  expect(grown).toEqual({ 'books.sale': 1, 'books.sale_line': 1, 'books.stock_move': 1 });
  expect((await row(saree))?.state).toBe('sold');
});
