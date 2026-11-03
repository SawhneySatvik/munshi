// SUR-APP (W2-B, core and agent): "Offer it" on an expiry finding drafts a surplus.give to a recipient (simulated); the
// draft writes nothing before approval (SUR-APP1); approval writes the stock row and the listing together, under the
// approver, valued as the finding valued the lot (SUR-APP2); counter staff can neither read surplus, nor propose, nor
// approve a gift, nor list a recipient, and a refused approval leaves the owner's draft waiting (SUR-APP3); two gifts of
// one lot never exceed what is left of it, one held open while the other is approved (SUR-APP5: core's lockStock). A
// small shop: a lot of 10 loaves of bread at ₹30 expiring in 3 days, nothing sold, so all 10 are at risk (₹300).
// Red-proofs: test/v2/sabotage/surplus-app.ts.
import {
  addDays,
  addRecipient,
  askerIn,
  businessDate,
  type CellRef,
  command,
  CoreError,
  decide,
  execute,
  mintSnapshot,
  parseInput,
  proposeDraft,
  resolveRef,
  runCommand,
  runWatchers,
  type Session,
  viewSurplus,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AgentPort } from '../../../../../packages/agent/src/port.ts';
import { draftFix } from '../../../../../packages/agent/src/run.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
let today: string;
let food: string; // the first recipient, by name
let shelter: string;
let finding: string; // the bread lot's expiry finding

type Lot = { itemId: string; lotId: string };

// A lot of `packs` at ₹30, bought today, expiring in 3 days.
async function newLot(name: string, packs: number): Promise<Lot> {
  const itemId = ((await runCommand(app, s.owner, 'item.create', { name, unit: 'pack' })) as { itemId: string }).itemId;
  await runCommand(app, s.manager, 'purchase.record', {
    supplierId: s.supplier,
    billNo: `SUR-${name.length}-${packs}`,
    billDate: today,
    lines: [{ itemId, qtyMilli: packs * 1000, unitCostMinor: 3000, expiresOn: addDays(today, 3) }],
  });
  const [lot] = await rows<{ id: string }>('select id::text from books.purchase_line where item_id = $1', [itemId]);
  return { itemId, lotId: lot?.id as string };
}

const rows = async <R>(sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, params))).rows as R[];
const books = async () =>
  (
    await rows<{ moves: number; listings: number; decisions: number; audit: number }>(
      `select (select count(*)::int from books.stock_move) as moves, (select count(*)::int from ops.surplus_listing) as listings,
              (select count(*)::int from approval.decision) as decisions,
              (select count(*)::int from audit.audit_log where entity in ('books.stock_move', 'ops.surplus_listing')) as audit`,
    )
  )[0] as { moves: number; listings: number; decisions: number; audit: number };
const status = async (draftId: string) => (await rows<{ status: string }>('select status from approval.draft where id = $1', [draftId]))[0]?.status;
const pools = () => ({ app, agent: db.as('munshi_agent') });

// A port with the person's scope (core's askerIn), as the app's port has: a fix whose recipe reads outside it is none.
async function portOf(session: Session): Promise<AgentPort> {
  const runId = await startRun(pools(), session);
  const { port } = agentPort(pools(), session, runId);
  const asker = await withTx(app, { kind: 'member', session }, (c) => askerIn(c));
  return { ...port, scope: async () => ({ reads: asker?.reads ?? new Set(), desks: asker?.desks ?? new Set() }) };
}

// A gift of the item's whole stock on hand (a cell of stock.on_hand), proposed by the owner as the seed proposes one.
async function propose(lot: Lot, recipientId = food): Promise<string> {
  const as = { kind: 'member', session: s.owner } as const;
  const held = await mintSnapshot(app, as, 'stock.on_hand', { item_id: lot.itemId });
  const listed = await mintSnapshot(app, as, 'surplus.recipients', {});
  const row = listed.rows.findIndex((r) => r.id?.kind === 'text' && r.id.txt === recipientId);
  const onHand: CellRef = { snapshotId: held.id, row: 0, col: 'on_hand' };
  const qty = held.rows[0]?.on_hand;
  return proposeDraft(
    app,
    { session: s.owner },
    {
      command: 'surplus.give',
      payload: { lotId: lot.lotId, itemId: lot.itemId, qtyMilli: qty?.kind === 'quantity' ? Number(qty.num) : 0, recipientId },
      basedOn: [onHand, { snapshotId: listed.id, row, col: 'id' }, { snapshotId: listed.id, row, col: 'name' }],
      payloadRefs: { qtyMilli: onHand },
    },
  );
}

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Surplus');
  today = businessDate(new Date(), 'Asia/Kolkata');
  food = await addRecipient(app, s.owner, { name: 'Annapurna Food Bank', kind: 'food_bank', area: 'Sector Four' });
  shelter = await addRecipient(app, s.manager, { name: 'Zeenat Shelter', kind: 'shelter', area: 'Old Town' });
  await newLot('Bread 400 g', 10);
  const run = await runWatchers(db.as('munshi_jobs'), s.owner.tenantId, today);
  finding = run.raised.find((r) => r.kind === 'expiry')?.findingId as string;
  await db.sabotage();
}, 120_000);
afterAll(() => db?.close());

it('SUR-APP1 Offer it drafts a surplus.give from the expiry finding: what is at risk of the lot, to the chosen recipient, every number a cell; nothing moves before approval', async () => {
  expect(finding).toEqual(expect.any(String));
  const before = await books();
  const fix = await draftFix(finding, { port: await portOf(s.owner), asOf: today }, { recipientId: shelter });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'surplus.give', payload: { qtyMilli: 10_000, recipientId: shelter } });
  if (fix.kind !== 'proposed') return;
  // The quantity is the finding's own at_risk cell, and the draft cites the recipient's row and the item's stock now.
  const [f] = await rows<{ snapshot_id: string; snapshot_row: number }>('select snapshot_id::text, snapshot_row from ai.finding where id = $1', [finding]);
  expect(fix.payloadRefs).toEqual({ qtyMilli: { snapshotId: f?.snapshot_id, row: f?.snapshot_row, col: 'at_risk' } });
  expect(fix.basedOn.map((r) => r.col)).toEqual(['lot_id', 'item_id', 'item', 'expires_on', 'at_risk', 'id', 'name', 'on_hand']);
  expect(await status(fix.draftId)).toBe('proposed');
  expect(await books()).toEqual(before);
  // A second tap while it waits drafts nothing; turning it down writes nothing either.
  expect(await draftFix(finding, { port: await portOf(s.owner), asOf: today })).toEqual({ kind: 'none', reason: 'open_draft' });
  expect(await decide(app, s.owner, fix.draftId, 'rejected', 'not_now')).toMatchObject({ status: 'rejected' });
  expect(await books()).toEqual({ ...before, decisions: before.decisions + 1 });
  const [moved] = await rows<{ n: number }>("select count(*)::int as n from books.stock_move where kind = 'donated'");
  expect(moved?.n).toBe(0);
});

it("SUR-APP2 approval writes the stock row and the listing together, under the approver (a manager, on the owner's draft), valued as the finding valued the lot", async () => {
  const fix = await draftFix(finding, { port: await portOf(s.owner), asOf: today });
  expect(fix).toMatchObject({ kind: 'proposed', payload: { recipientId: food } }); // no pick: the first listed, by name
  if (fix.kind !== 'proposed') return;
  const done = await decide(app, s.manager, fix.draftId, 'approved');
  expect(done.status).toBe('executed');
  if (done.status !== 'executed') return;
  const [listing] = await rows<Record<string, string>>(
    `select l.id::text, l.lot_id::text, l.item_id::text, l.qty_milli::text, l.recipient_id::text, l.stock_move_id::text, l.value_minor::text, l.currency,
            l.decision_id::text, l.created_by::text, m.qty_milli::text as move_qty, m.kind as move_kind, m.created_by::text as move_by,
            m.decision_id::text as move_decision, m.source_rel, m.source_id::text as move_source
       from ops.surplus_listing l join books.stock_move m on m.tenant_id = l.tenant_id and m.id = l.stock_move_id where l.id = $1`,
    [done.result.listingId],
  );
  const lot = (fix.payload as { lotId: string }).lotId;
  expect(listing).toMatchObject({
    lot_id: lot,
    qty_milli: '10000',
    recipient_id: food,
    stock_move_id: done.result.moveId,
    decision_id: done.decisionId,
    created_by: s.manager.memberId,
    move_qty: '-10000',
    move_kind: 'donated',
    move_by: s.manager.memberId,
    move_decision: done.decisionId,
    source_rel: 'books.purchase_line',
    move_source: lot,
    currency: 'INR',
  });
  // Valued at the lot's cost, as the expiry watcher valued what was at risk: the finding's at_risk_value cell, ₹300.
  const [f] = await rows<{ snapshot_id: string; snapshot_row: number }>('select snapshot_id::text, snapshot_row from ai.finding where id = $1', [finding]);
  const atRisk = await tx(app, { tenant_id: s.owner.tenantId }, (c) =>
    resolveRef(c, { snapshotId: f?.snapshot_id as string, row: f?.snapshot_row as number, col: 'at_risk_value' }),
  );
  expect(atRisk).toEqual({ kind: 'money', num: listing?.value_minor, currency: 'INR' });
  expect(listing?.value_minor).toBe('30000');
  // Each with its audit entry under the approver and the decision, in the decision's transaction.
  const audit = await rows<{ entity: string; actor_id: string; decision_id: string }>(
    `select entity, actor_id::text, decision_id::text from audit.audit_log where entity_id in ($1, $2) order by seq`,
    [listing?.id, listing?.stock_move_id],
  );
  expect(audit).toEqual([
    { entity: 'books.stock_move', actor_id: s.manager.memberId, decision_id: done.decisionId },
    { entity: 'ops.surplus_listing', actor_id: s.manager.memberId, decision_id: done.decisionId },
  ]);
  // The tally now counts it, from the impact read's cells.
  const impact = await withTx(app, { kind: 'member', session: s.owner }, (c) => viewSurplus(c, s.owner));
  expect(impact?.impact.rows).toEqual([
    {
      gifts: { kind: 'integer', num: '1' },
      items: { kind: 'integer', num: '1' },
      value: { kind: 'money', num: '30000', currency: 'INR' },
      other_currency_gifts: { kind: 'integer', num: '0' },
    },
  ]);
  expect(impact?.recipients.rows.map((r) => (r.name?.kind === 'text' ? r.name.txt : ''))).toEqual(['Annapurna Food Bank', 'Zeenat Shelter']);
});

it("SUR-APP3 counter staff can neither read surplus, propose, approve nor list a recipient; their refused approval leaves the owner's draft waiting", async () => {
  const staff = s.staff;
  const lot = await newLot('Buns pack of 6', 4);
  const draftId = await propose(lot);
  const before = await books();
  // Not offered: their scope has no surplus read, so the recipe drafts nothing (and reads nothing).
  await runWatchers(db.as('munshi_jobs'), s.owner.tenantId, today);
  const [buns] = await rows<{ id: string }>(
    `select f.id::text from ai.finding f where f.kind = 'expiry' and f.status = 'open' order by f.created_at desc limit 1`,
  );
  expect(await draftFix(buns?.id as string, { port: await portOf(staff), asOf: today })).toEqual({ kind: 'none', reason: 'no_fix' });
  // The reads are the office's: refused for them (D-082), and the surplus page is null (a 404).
  const refusedRead = await mintSnapshot(app, { kind: 'member', session: staff }, 'surplus.recipients', {}).catch((e: unknown) => e);
  expect(refusedRead).toMatchObject({ code: 'not_for_role' });
  expect(await mintSnapshot(app, { kind: 'member', session: staff }, 'surplus.impact', {}).catch((e: unknown) => e)).toMatchObject({ code: 'not_for_role' });
  expect(await withTx(app, { kind: 'member', session: staff }, (c) => viewSurplus(c, staff))).toBeNull();
  // Proposing directly, with the owner's own cells: refused by core before any draft is stored.
  const held = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'stock.on_hand', { item_id: lot.itemId });
  const onHand: CellRef = { snapshotId: held.id, row: 0, col: 'on_hand' };
  const proposed = await proposeDraft(
    app,
    { session: staff },
    { command: 'surplus.give', payload: { ...lot, qtyMilli: 4000, recipientId: food }, basedOn: [onHand], payloadRefs: { qtyMilli: onHand } },
  ).catch((e: unknown) => e);
  expect(proposed).toBeInstanceOf(CoreError);
  expect(proposed).toMatchObject({ code: 'refused' });
  // Approving the owner's draft: refused, and the draft still waits for someone allowed (not stale, not decided).
  expect(await decide(app, staff, draftId, 'approved').catch((e: unknown) => e)).toMatchObject({ code: 'refused' });
  expect(await status(draftId)).toBe('proposed');
  // Listing a recipient: refused.
  expect(await addRecipient(app, staff, { name: 'Staff pick', kind: 'other', area: 'Here' }).catch((e: unknown) => e)).toMatchObject({ code: 'refused' });
  expect(await books()).toEqual(before);
  // The owner still can.
  expect((await decide(app, s.owner, draftId, 'approved')).status).toBe('executed');
});

it('SUR-APP5 two gifts of one lot never exceed what is left: one held open, the other waits on the stock lock, then is refused; approved again, it is stale', async () => {
  const lot = await newLot('Rusk 200 g', 6); // 6 packs: either gift of all 6 fits alone, never both
  const first = await propose(lot);
  const second = await propose(lot, shelter);
  // The first gift is decided and executed, and held open before its commit (as decide holds it).
  const held = await app.connect();
  try {
    await held.query('begin');
    await held.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [s.owner.tenantId, s.owner.memberId]);
    const { rows: d } = await held.query<{ id: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id::text`,
      [s.owner.tenantId, first, s.owner.memberId],
    );
    await held.query(`select set_config('munshi.decision_id', $1, true)`, [d[0]?.id]);
    const give = command('surplus.give');
    const [draft] = (await held.query<{ payload: unknown }>('select payload from approval.draft where id = $1', [first])).rows;
    await execute(held, give, parseInput(give, draft?.payload));
    // ...while the second is approved: it waits for the first's stock lock, then finds nothing left of the lot.
    let settled = false;
    const racing = decide(app, s.manager, second, 'approved')
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    await held.query('commit');
    expect(await racing).toMatchObject({ code: 'conflict', fields: ['qtyMilli'] });
  } finally {
    held.release();
  }
  const given = await rows<{ qty: string; gifts: number }>(
    `select coalesce(-sum(m.qty_milli), 0)::text as qty, count(*)::int as gifts from books.stock_move m where m.kind = 'donated' and m.source_id = $1`,
    [lot.lotId],
  );
  expect(given).toEqual([{ qty: '6000', gifts: 1 }]);
  expect(await status(second)).toBe('proposed');
  // Approved again, its stock cell no longer holds: stale, and still nothing more is given.
  expect(await decide(app, s.manager, second, 'approved')).toMatchObject({ status: 'stale' });
  expect((await rows<{ n: number }>("select count(*)::int as n from books.stock_move where kind = 'donated' and source_id = $1", [lot.lotId]))[0]?.n).toBe(1);
});

it("SUR-APP7 a gift's cited rows are its own: naming one recipient while giving to another, or one lot's item while giving another's, is refused at proposal and stale at approval", async () => {
  const lot = await newLot('Pav pack of 8', 3);
  const other = await newLot('Khari 200 g', 3);
  const as = { kind: 'member', session: s.owner } as const;
  const held = await mintSnapshot(app, as, 'stock.on_hand', { item_id: lot.itemId });
  const elsewhere = await mintSnapshot(app, as, 'surplus.lot', { lot_id: other.lotId });
  const listed = await mintSnapshot(app, as, 'surplus.recipients', {});
  const rowOf = (id: string) => listed.rows.findIndex((r) => r.id?.kind === 'text' && r.id.txt === id);
  const onHand: CellRef = { snapshotId: held.id, row: 0, col: 'on_hand' };
  const payload = { lotId: lot.lotId, itemId: lot.itemId, qtyMilli: 3000, recipientId: food };
  const own: CellRef[] = [onHand, { snapshotId: listed.id, row: rowOf(food), col: 'id' }, { snapshotId: listed.id, row: rowOf(food), col: 'name' }];
  // The shelter's name beside the food bank's id; another lot's item name; no name at all.
  const shelterName: CellRef = { snapshotId: listed.id, row: rowOf(shelter), col: 'name' };
  const otherItem: CellRef = { snapshotId: elsewhere.id, row: 0, col: 'item' };
  const cases: [string, CellRef[], string][] = [
    ['recipient', [...own, shelterName], 'recipientId'],
    ['item', [...own, otherItem], 'lotId'],
    ['no name', own.slice(0, 2), 'recipientId'],
  ];
  const before = await books();
  for (const [what, basedOn, field] of cases) {
    const refused = await proposeDraft(app, { session: s.owner }, { command: 'surplus.give', payload, basedOn, payloadRefs: { qtyMilli: onHand } }).catch((e: unknown) => e);
    expect(refused, what).toMatchObject({ code: 'invalid', fields: [field] });
  }
  // The same draft stored without core's proposal (as the app role can): its approval finds it stale and gives nothing.
  const forged = await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, async (c) =>
    (
      await c.query<{ id: string }>(
        `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, created_txid)
         values ($1, 'surplus.give', $2, $3, $4, 'member', 0) returning id::text`,
        [s.owner.tenantId, JSON.stringify(payload), JSON.stringify([...own, shelterName]), JSON.stringify({ qtyMilli: onHand })],
      )
    ).rows[0]?.id as string,
  );
  expect(await decide(app, s.owner, forged, 'approved')).toMatchObject({ status: 'stale' });
  expect(await books()).toEqual(before);
  // Its own rows: proposed and given.
  const fine = await proposeDraft(app, { session: s.owner }, { command: 'surplus.give', payload, basedOn: own, payloadRefs: { qtyMilli: onHand } });
  expect((await decide(app, s.owner, fine, 'approved')).status).toBe('executed');
});
