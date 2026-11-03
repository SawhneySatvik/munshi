// 25_surplus.sql and b_stock_kind (15), W2-B: SURPLUS1 (nothing moves before approval), SURPLUS2 (approval writes the
// stock row and the listing together, under the approver, valued at the lot's cost, each with its audit entry), SURPLUS3
// (neither alone: no donated stock row without its listing, no listing without its stock row, surplus.give writes
// nothing else, a decision gives once), SURPLUS4 (staff can neither approve nor execute a gift), SURPLUS5 (another shop
// neither reads nor writes), SURPLUS6 (the impact read: gifts not reversed, at cost, per shop), SURPLUS7 (recipients:
// simulated, an owner's or a manager's, append-only), SURPLUS8 (a gift's lot: live, with an expiry, at most what is left
// of it, valued in its own currency) and SURPLUS9 (a donated row only from its listing's trigger: no other trigger chain,
// no forged marker). Red-proofs: test/v2/sabotage/surplus.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { mintDisplay, signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

type Shop = Tenant & { snapshot: string; recipient: string; item: string; lot: string; smallLot: string };

let db: TestDb;
let app: pg.Pool;
let a: Shop;
let b: Shop;
let c: Shop; // SURPLUS8's lots
let d: Shop; // a shop that buys in USD
let e: Shop; // SURPLUS6's second shop

const one = async (c: pg.ClientBase, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;

// A shop with a simulated recipient and one lot near its expiry: 2 packs at 23.33 a pack (and a second, smaller lot,
// 0.3 packs, the same day), bought in `currency` (the shop's own is INR).
async function shop(slug: string, currency = 'INR'): Promise<Shop> {
  const t = await signUp(db, slug);
  const cmd = <T>(command: string, fn: (c: pg.PoolClient) => Promise<T>) => tx(app, { tenant_id: t.tenant, actor_id: t.owner, command }, fn);
  const snapshot = await mintDisplay(db, t, t.owner);
  const recipient = await tx(app, { tenant_id: t.tenant, actor_id: t.owner }, (c) =>
    one(c, `insert into ops.surplus_recipient (tenant_id, name, kind, area) values ($1, 'Annapurna Food Bank (simulated)', 'food_bank', 'Sector 4') returning id`, [
      t.tenant,
    ]),
  );
  const item = await cmd('item.create', async (c) => {
    const id = await one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'good', 'pack') returning id`, [t.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values ($1, $2, 'Bread 400 g', now())`, [t.tenant, id]);
    return id;
  });
  const supplier = await cmd('supplier.create', (c) => one(c, 'insert into books.supplier (tenant_id, is_simulated) values ($1, true) returning id', [t.tenant]));
  const [lot, smallLot] = await cmd('purchase.record', async (c) => {
    const p = await one(
      c,
      `insert into books.purchase (tenant_id, supplier_id, bill_no, bill_date, total_minor, currency) values ($1, $2, 'B-1', current_date, 5366, $3) returning id`,
      [t.tenant, supplier, currency],
    );
    const line = (n: number, qty: number) =>
      one(
        c,
        `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on)
         values ($1, $2, $3, $4, $5, 2333, $6, current_date + 3) returning id`,
        [t.tenant, p, n, item, qty, currency],
      );
    const lots = [await line(1, 2000), await line(2, 300)];
    await c.query(
      `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at) values ($1, $2, 2300, 'purchase', 'books.purchase', $3, current_date + 3, now())`,
      [t.tenant, item, p],
    );
    return lots;
  });
  return { ...t, snapshot, recipient, item, lot: lot as string, smallLot: smallLot as string };
}

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  a = await shop('surplus-a');
  b = await shop('surplus-b');
  c = await shop('surplus-c');
  d = await shop('surplus-d', 'USD');
  e = await shop('surplus-e');
  await db.sabotage();
});
afterAll(() => db?.close());

type Gift = { lot?: string; qty?: number; recipient?: string };
const payloadOf = (s: Shop, g: Gift = {}) => ({ lotId: g.lot ?? s.lot, qtyMilli: g.qty ?? 500, recipientId: g.recipient ?? s.recipient });
// A surplus.give draft, proposed in its own transaction (a decision is never made in the draft's).
const propose = (s: Shop, g: Gift = {}, by = s.owner) =>
  tx(app, { tenant_id: s.tenant, actor_id: by }, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'surplus.give', $2, $3, 'member', 0) returning id`, [
      s.tenant,
      JSON.stringify(payloadOf(s, g)),
      JSON.stringify([{ snapshotId: s.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
const decide = (c: pg.ClientBase, s: Shop, draft: string, by: string, verdict = 'approved') =>
  one(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, reason, created_txid) values ($1, $2, $3, $4, $5, 0) returning id`, [
    s.tenant,
    draft,
    verdict,
    by,
    verdict === 'approved' ? null : 'not_now',
  ]);
const LISTING = `insert into ops.surplus_listing (tenant_id, lot_id, qty_milli, recipient_id) values ($1, $2, $3, $4)
                 returning id, item_id, qty_milli, stock_move_id, value_minor, currency, decision_id, created_by`;
type Listing = { id: string; item_id: string; qty_milli: string; stock_move_id: string; value_minor: string; currency: string; decision_id: string; created_by: string };
const list = (c: pg.ClientBase, s: Shop, g: Gift = {}) => c.query<Listing>(LISTING, [s.tenant, g.lot ?? s.lot, g.qty ?? 500, g.recipient ?? s.recipient]);
// The approver's own request: decide, then execute the gift, in one transaction.
const approveAndGive = (s: Shop, draft: string, by = s.owner, g: Gift = {}) =>
  tx(app, { tenant_id: s.tenant, actor_id: by }, async (c) => {
    const d = await decide(c, s, draft, by);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
    return (await list(c, s, g)).rows[0] as Listing;
  });
const counts = async (s: Shop) =>
  (
    await db.admin.query<{ moves: number; listings: number }>(
      `select (select count(*)::int from books.stock_move where tenant_id = $1 and kind = 'donated') as moves,
              (select count(*)::int from ops.surplus_listing where tenant_id = $1) as listings`,
      [s.tenant],
    )
  ).rows[0] as { moves: number; listings: number };

it('SURPLUS1 nothing moves before approval: a proposed or rejected gift writes nothing, and no listing is taken without an approved decision of this transaction', async () => {
  const before = await counts(a);
  const draft = await propose(a);
  expect(await counts(a), 'a proposed draft').toEqual(before);
  const ctx = { tenant_id: a.tenant, actor_id: a.owner };
  // No decision; the draft-only command named directly; a decision of an earlier transaction; a rejection.
  expect((await refused(tx(app, ctx, (c) => list(c, a)))).code, 'no decision').toBe('MS001');
  expect((await refused(tx(app, { ...ctx, command: 'surplus.give' }, (c) => list(c, a)))).code, 'a direct surplus.give').toBe('MS001');
  const earlier = await tx(app, ctx, (c) => decide(c, a, draft, a.owner));
  expect((await refused(tx(app, { ...ctx, decision_id: earlier }, (c) => list(c, a)))).code, "an earlier transaction's decision").toBe('MS001');
  // A rejection made in this same transaction.
  const rejected = await propose(a);
  const underRejection = tx(app, ctx, async (c) => {
    const no = await decide(c, a, rejected, a.owner, 'rejected');
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [no]);
    return list(c, a);
  });
  expect((await refused(underRejection)).code, 'a rejection').toBe('MS001');
  // An approved decision on another command does not admit a gift.
  const other = await tx(app, ctx, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'campaign.send', $2, $3, 'member', 0) returning id`, [
      a.tenant,
      JSON.stringify(payloadOf(a)),
      JSON.stringify([{ snapshotId: a.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  expect((await refused(approveAndGive(a, other))).code, 'a campaign.send decision').toBe('MS001');
  expect(await counts(a)).toEqual(before);
});

it("SURPLUS2 approval writes the stock row and the listing together, under the approver, valued at the lot's cost, each with its audit entry", async () => {
  const before = await counts(a);
  const draft = await propose(a, { qty: 1500 });
  const g = await approveAndGive(a, draft, a.manager, { qty: 1500 });
  // 1500 thousandths of a pack at 2333 paise is 3499.5: (1500 × 2333 + 500) / 1000 = 3500, rounded half up as watch.expiry.
  expect(g).toMatchObject({ item_id: a.item, qty_milli: '1500', value_minor: '3500', currency: 'INR', created_by: a.manager });
  expect(await counts(a)).toEqual({ moves: before.moves + 1, listings: before.listings + 1 });
  const { rows: move } = await db.admin.query(
    `select m.item_id, m.qty_milli::int, m.kind, m.source_rel, m.source_id, m.expires_on = current_date + 3 as lot_expiry, m.decision_id,
            m.created_by, m.reverses_id
       from books.stock_move m where m.id = $1`,
    [g.stock_move_id],
  );
  expect(move).toEqual([
    {
      item_id: a.item,
      qty_milli: -1500,
      kind: 'donated',
      source_rel: 'books.purchase_line',
      source_id: a.lot,
      lot_expiry: true,
      decision_id: g.decision_id,
      created_by: a.manager,
      reverses_id: null,
    },
  ]);
  const { rows: decision } = await db.admin.query('select decided_by from approval.decision where id = $1', [g.decision_id]);
  expect(decision).toEqual([{ decided_by: a.manager }]);
  const { rows: audit } = await db.admin.query(
    `select entity, command, actor_id, decision_id, row_digest is not null as digest from audit.audit_log
      where tenant_id = $1 and entity_id in ($2, $3) order by entity`,
    [a.tenant, g.stock_move_id, g.id],
  );
  expect(audit).toEqual([
    { entity: 'books.stock_move', command: 'surplus.give', actor_id: a.manager, decision_id: g.decision_id, digest: true },
    { entity: 'ops.surplus_listing', command: 'surplus.give', actor_id: a.manager, decision_id: g.decision_id, digest: false },
  ]);
  // Values a caller sends for the stamped columns are not taken.
  const draft2 = await propose(a, { qty: 100 });
  const forged = await tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
    const d = await decide(c, a, draft2, a.owner);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
    return (
      await c.query<Listing>(
        `insert into ops.surplus_listing (tenant_id, lot_id, qty_milli, recipient_id, item_id, stock_move_id, value_minor, currency, decision_id, created_by, created_at)
         values ($1, $2, 100, $3, $2, $2, 999999, 'USD', $2, $4, '2020-01-01') returning value_minor, currency, created_by, item_id, (created_at > now() - interval '1 minute') as fresh`,
        [a.tenant, a.lot, a.recipient, a.manager],
      )
    ).rows[0];
  });
  expect(forged).toEqual({ value_minor: '233', currency: 'INR', created_by: a.owner, item_id: a.item, fresh: true });
});

it('SURPLUS3 neither alone: no donated stock row without its listing, none by any other command, surplus.give writes nothing else, and the gift is exactly the approved one', async () => {
  const before = await counts(a);
  const ctx = { tenant_id: a.tenant, actor_id: a.owner };
  const move = (kind: string, qty: number) => (c: pg.ClientBase) =>
    c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, at) values ($1, $2, $3, $4, now())`, [a.tenant, a.item, qty, kind]);
  const underApproval = async <T>(fn: (c: pg.PoolClient) => Promise<T>, g: Gift = {}) => {
    const draft = await propose(a, g);
    return tx(app, ctx, async (c) => {
      const d = await decide(c, a, draft, a.owner);
      await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
      return fn(c);
    });
  };
  expect((await refused(underApproval(move('donated', -500)))).code, 'a donated row written directly, under an approved gift').toBe('MS001');
  expect((await refused(underApproval(move('waste', -500)))).code, 'surplus.give writing waste').toBe('MS001');
  expect((await refused(tx(app, { tenant_id: a.tenant, actor_id: a.staff, command: 'stock.waste' }, move('donated', -500)))).code, 'stock.waste writing donated').toBe('MS001');
  expect((await refused(tx(app, { ...ctx, command: 'stock.count' }, move('donated', -500)))).code, 'stock.count writing donated').toBe('MS001');
  // The listing is exactly the approved payload; a lot of the shop, live, at least as large as the gift.
  expect((await refused(underApproval((c) => list(c, a, { qty: 400 }), { qty: 500 }))).code, 'another quantity').toBe('MS001');
  expect((await refused(underApproval((c) => list(c, a, { lot: a.smallLot }), {}))).code, 'another lot').toBe('MS001');
  expect((await refused(underApproval((c) => list(c, a, { lot: a.smallLot, qty: 301 }), { lot: a.smallLot, qty: 301 }))).code, 'more than the lot').toBe('MS001');
  // A decision gives once, whatever the statement: a second listing; the same insert repeated with `on conflict do
  // nothing` (the unique decision index would skip the row, but not the stock row its trigger wrote first); one
  // multi-row insert of the gift twice.
  const twice = (sql: string) => async (c: pg.ClientBase) => {
    await list(c, a, { qty: 50 });
    return c.query(sql, [a.tenant, a.lot, 50, a.recipient]);
  };
  const BARE = 'insert into ops.surplus_listing (tenant_id, lot_id, qty_milli, recipient_id) values ($1, $2, $3, $4)';
  expect((await refused(underApproval(twice(BARE), { qty: 50 }))).code, 'a second listing').toBe('MS001');
  expect((await refused(underApproval(twice(`${BARE} on conflict do nothing`), { qty: 50 }))).code, 'the insert repeated, on conflict do nothing').toBe('MS001');
  const multi = (c: pg.ClientBase) => c.query(`${BARE}, ($1, $2, $3, $4) on conflict do nothing`, [a.tenant, a.lot, 50, a.recipient]);
  expect((await refused(underApproval(multi, { qty: 50 }))).code, 'one multi-row insert').toBe('MS001');
  // A listing whose own row fails (another shop's recipient) takes its stock row with it, even when the transaction goes on.
  await underApproval(async (c) => {
    await c.query('savepoint gift');
    expect((await refused(list(c, a, { recipient: b.recipient, qty: 50 }))).code, "another shop's recipient").toBe('23503');
    await c.query('rollback to savepoint gift');
  }, { recipient: b.recipient, qty: 50 });
  expect(await counts(a)).toEqual(before);
});

it('SURPLUS4 staff can neither approve a gift nor execute one', async () => {
  const before = await counts(a);
  const draft = await propose(a);
  expect((await refused(approveAndGive(a, draft, a.staff))).code, 'staff deciding').toBe('MS002');
  // Staff executing an owner's decision of the same transaction: the decision is not the acting member's.
  const r = await refused(
    tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
      const d = await decide(c, a, draft, a.owner);
      await c.query(`select set_config('munshi.decision_id', $1, true), set_config('munshi.actor_id', $2, true)`, [d, a.staff]);
      return list(c, a);
    }),
  );
  expect(r.code, 'staff executing').toBe('MS001');
  expect(await counts(a)).toEqual(before);
});

it("SURPLUS5 another shop neither reads nor writes a shop's recipients and listings", async () => {
  await approveAndGive(a, await propose(a, { qty: 200 }), a.owner, { qty: 200 });
  const underB = { tenant_id: b.tenant, actor_id: b.owner };
  for (const rel of ['ops.surplus_recipient', 'ops.surplus_listing']) {
    const { rows } = await tx(app, underB, (c) => c.query(`select count(*)::int as n from ${rel} where tenant_id = $1`, [a.tenant]));
    expect(rows, rel).toEqual([{ n: 0 }]);
  }
  // B's approved gift naming A's lot (not a lot B can see), or A's recipient (no such key in B), is refused; so is a
  // listing row for A under B's context (no decision of A's in this transaction).
  for (const [g, code] of [
    [{ lot: a.lot }, 'MS001'],
    [{ recipient: a.recipient }, '23503'],
  ] as const) {
    const draft = await propose(b, g);
    expect((await refused(approveAndGive(b, draft, b.owner, g))).code, JSON.stringify(g)).toBe(code);
  }
  const forA = await propose(b);
  const r = await refused(
    tx(app, underB, async (c) => {
      const d = await decide(c, b, forA, b.owner);
      await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
      return c.query(LISTING, [a.tenant, a.lot, 500, a.recipient]);
    }),
  );
  expect(r.code, "a row for A's tenant under B").toBe('MS001');
  const recipientForA = tx(app, underB, (c) => c.query(`insert into ops.surplus_recipient (tenant_id, name, kind, area) values ($1, 'X', 'other', 'Y')`, [a.tenant]));
  expect((await refused(recipientForA)).code, "a recipient for A's tenant under B").toBe('MS007');
});

it('SURPLUS6 the impact read counts the shop’s gifts not reversed, valued at cost, in its currency, for this shop only', async () => {
  const impact = (s: Shop, from?: string) =>
    tx(app, { tenant_id: s.tenant, actor_id: s.owner }, async (c) =>
      (await c.query(`select * from ops.surplus_impact(coalesce($1::timestamptz, '-infinity'))`, [from ?? null])).rows,
    );
  const g1 = await approveAndGive(b, await propose(b, { qty: 1000 }), b.owner, { qty: 1000 });
  await approveAndGive(b, await propose(b, { lot: b.smallLot, qty: 300 }), b.owner, { lot: b.smallLot, qty: 300 });
  // 1000 at 2333 → 2333; 300 at 2333 → (699900 + 500) / 1000 = 700.
  expect(await impact(b)).toEqual([{ gifts: 2, items: 1, value_minor: '3033', currency: 'INR', other_currency_gifts: 0 }]);
  // A gift corrected by stock.reverse came back: it counts for nothing. surplus.give itself reverses nothing, and no other
  // command corrects a gift.
  const reverse = (command: string) =>
    tx(app, { tenant_id: b.tenant, actor_id: b.owner, command }, (c) =>
      c.query(
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, expires_on, at, reverses_id, reason)
         select tenant_id, item_id, -qty_milli, kind, expires_on, now(), id, 'entered_in_error' from books.stock_move where id = $1`,
        [g1.stock_move_id],
      ),
    );
  expect((await refused(reverse('stock.waste'))).code, 'stock.waste correcting a gift').toBe('MS001');
  await reverse('stock.reverse');
  expect(await impact(b)).toEqual([{ gifts: 1, items: 1, value_minor: '700', currency: 'INR', other_currency_gifts: 0 }]);
  // The window, and another shop's own tally, from its own gift: 1500 at 2333 → 3500, none of b's.
  expect(await impact(b, '2999-01-01')).toEqual([{ gifts: 0, items: 0, value_minor: '0', currency: 'INR', other_currency_gifts: 0 }]);
  expect(await impact(e)).toEqual([{ gifts: 0, items: 0, value_minor: '0', currency: 'INR', other_currency_gifts: 0 }]);
  await approveAndGive(e, await propose(e, { qty: 1500 }), e.owner, { qty: 1500 });
  expect(await impact(e)).toEqual([{ gifts: 1, items: 1, value_minor: '3500', currency: 'INR', other_currency_gifts: 0 }]);
  expect(await impact(b)).toEqual([{ gifts: 1, items: 1, value_minor: '700', currency: 'INR', other_currency_gifts: 0 }]);
  // The jobs role (a brief, a watcher) reads the same tally; no shop in context: no row.
  const asJobs = await tx(db.as('munshi_jobs'), { tenant_id: b.tenant }, (c) => c.query('select gifts, value_minor from ops.surplus_impact()'));
  expect(asJobs.rows).toEqual([{ gifts: 1, value_minor: '700' }]);
  expect((await tx(app, {}, (c) => c.query('select * from ops.surplus_impact()'))).rows).toEqual([]);
});

it('SURPLUS7 a recipient is simulated, listed by an active owner or manager, and never changed', async () => {
  const add = (actor: string, extra = '') =>
    tx(app, { tenant_id: a.tenant, actor_id: actor }, (c) =>
      c.query(`insert into ops.surplus_recipient (tenant_id, name, kind, area${extra ? ', simulated' : ''}) values ($1, $2, 'shelter', 'Old town'${extra}) returning simulated, created_by`, [
        a.tenant,
        `Shelter ${actor.slice(0, 8)}${extra ? ' real' : ''}`,
      ]),
    );
  expect((await refused(add(a.staff))).code, 'staff').toBe('MS007');
  expect((await add(a.manager)).rows).toEqual([{ simulated: true, created_by: a.manager }]);
  expect((await refused(add(a.owner, ', false'))).code, 'a recipient not simulated').toBe('23514');
  for (const sql of ['update ops.surplus_recipient set simulated = false', 'delete from ops.surplus_recipient', 'update ops.surplus_listing set value_minor = 0', 'delete from ops.surplus_listing']) {
    expect((await refused(tx(app, { tenant_id: a.tenant, actor_id: a.owner }, (c) => c.query(sql)))).code, sql).toBe('42501');
  }
});

it("SURPLUS8 a gift's lot is live and has an expiry, the gift is at most what is left of it, and its value is in the lot's currency", async () => {
  const before = await counts(c);
  // What is left, as watch.expiry reads it: c's 2000 lot has 2300 on hand less the 300 lot of the same day after it, so
  // 2000; a gift of 1500 leaves 500, and a second gift of 1500 is refused.
  await approveAndGive(c, await propose(c, { qty: 1500 }), c.owner, { qty: 1500 });
  expect((await refused(approveAndGive(c, await propose(c, { qty: 1500 }), c.owner, { qty: 1500 }))).code, 'a second 1500 from the 2000 lot').toBe('MS001');
  expect((await approveAndGive(c, await propose(c, { qty: 500 }), c.owner, { qty: 500 })).qty_milli).toBe('500');
  expect(await counts(c)).toEqual({ moves: before.moves + 2, listings: before.listings + 2 });
  // A lot with no expiry, and a lot of a reversed purchase, are no gift's (the reversed one expires last, so what would be
  // left of it is not nothing).
  const cmd = <T>(command: string, fn: (q: pg.PoolClient) => Promise<T>) => tx(app, { tenant_id: c.tenant, actor_id: c.owner, command }, fn);
  const supplier = await cmd('supplier.create', (q) => one(q, 'insert into books.supplier (tenant_id, is_simulated) values ($1, true) returning id', [c.tenant]));
  const bill = (no: string, expires: string) =>
    cmd('purchase.record', async (q) => {
      const p = await one(
        q,
        `insert into books.purchase (tenant_id, supplier_id, bill_no, bill_date, total_minor, currency) values ($1, $2, $3, current_date, 2333, 'INR') returning id`,
        [c.tenant, supplier, no],
      );
      const line = await one(
        q,
        `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on)
         values ($1, $2, 1, $3, 1000, 2333, 'INR', ${expires}) returning id`,
        [c.tenant, p, c.item],
      );
      return { p, line };
    });
  const noExpiry = await bill('B-2', 'null');
  expect((await refused(approveAndGive(c, await propose(c, { lot: noExpiry.line, qty: 100 }), c.owner, { lot: noExpiry.line, qty: 100 }))).code, 'no expiry').toBe('MS001');
  const reversed = await bill('B-3', 'current_date + 10');
  await cmd('purchase.reverse', async (q) => {
    const r = await one(
      q,
      `insert into books.purchase (tenant_id, supplier_id, bill_no, bill_date, total_minor, currency, reverses_id, reason)
       values ($1, $2, 'B-3', current_date, -2333, 'INR', $3, 'entered_in_error') returning id`,
      [c.tenant, supplier, reversed.p],
    );
    await q.query(
      `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on, reverses_id, reason)
       values ($1, $2, 1, $3, -1000, 2333, 'INR', current_date + 10, $4, 'entered_in_error')`,
      [c.tenant, r, c.item, reversed.line],
    );
  });
  expect((await refused(approveAndGive(c, await propose(c, { lot: reversed.line, qty: 100 }), c.owner, { lot: reversed.line, qty: 100 }))).code, 'a reversed lot').toBe(
    'MS001',
  );
  // A lot bought in USD gives a gift valued in USD, which the shop's INR tally counts apart.
  const usd = await approveAndGive(d, await propose(d, { qty: 1000 }), d.owner, { qty: 1000 });
  expect(usd).toMatchObject({ value_minor: '2333', currency: 'USD' });
  const { rows } = await tx(app, { tenant_id: d.tenant, actor_id: d.owner }, (q) => q.query('select * from ops.surplus_impact()'));
  expect(rows).toEqual([{ gifts: 0, items: 0, value_minor: '0', currency: 'INR', other_currency_gifts: 1 }]);
});

it('SURPLUS9 a donated row comes only from its listing: not from another trigger chain, nor directly with a forged marker', async () => {
  const before = await counts(a);
  const draft = await propose(a, { qty: 10 });
  const underDecision = (fn: (q: pg.PoolClient) => Promise<unknown>) =>
    tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (q) => {
      const dec = await decide(q, a, draft, a.owner);
      await q.query(`select set_config('munshi.decision_id', $1, true)`, [dec]);
      return fn(q);
    });
  const DONATED = `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at)
                   values ($1, $2, -10, 'donated', 'books.purchase_line', $3, now())`;
  // Directly, at trigger depth 1, with the marker forged.
  const forged = underDecision(async (q) => {
    await q.query(`select set_config('munshi.surplus_move', gen_random_uuid()::text, true)`);
    return q.query(DONATED, [a.tenant, a.item, a.lot]);
  });
  expect((await refused(forged)).code, 'a forged marker').toBe('MS001');
  // From another trigger chain (depth 2, no marker): a probe trigger on the recipients writes a donated row.
  await db.admin.query(`create function ops.probe_donate() returns trigger language plpgsql as $$
    begin
      insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at)
      values (new.tenant_id, current_setting('munshi.probe_item')::uuid, -10, 'donated', 'books.purchase_line', current_setting('munshi.probe_lot')::uuid, now());
      return null;
    end $$;
    create trigger probe_donate after insert on ops.surplus_recipient for each row execute function ops.probe_donate();`);
  try {
    const chain = underDecision(async (q) => {
      await q.query(`select set_config('munshi.probe_item', $1, true), set_config('munshi.probe_lot', $2, true)`, [a.item, a.lot]);
      return q.query(`insert into ops.surplus_recipient (tenant_id, name, kind, area) values ($1, 'Probe shelter (simulated)', 'shelter', 'Probe')`, [a.tenant]);
    });
    expect((await refused(chain)).code, 'another trigger chain').toBe('MS001');
  } finally {
    await db.admin.query('drop trigger probe_donate on ops.surplus_recipient; drop function ops.probe_donate();');
  }
  expect(await counts(a)).toEqual(before);
});
