// MS-22a: the draft hooks. A command's `checks` hook runs at proposal (a bad path refuses the draft) and again at approval
// (a bad path makes it stale); a money draft naming a holdingId must cite a package.balance cell; a rejection's reason is
// a code and lands in the decision row as that code. The registries are patched in place for the test and restored.
import { COMMANDS, type Checks, decide, mintSnapshot, proposeDraft, type Session } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { smallShop } from '../shop.ts';

import * as queries from '../../../../../packages/core/src/queries.ts';

type Def = typeof COMMANDS extends ReadonlyMap<string, infer D> ? D : never;
const commands = COMMANDS as Map<string, Def>;
const named = queries.QUERIES as Map<string, (typeof queries.QUERIES) extends ReadonlyMap<string, infer Q> ? Q : never>;

let db: TestDb;
let app: pg.Pool;
let bad: string[] = [];
const saved = { waste: commands.get('stock.waste') as Def, credit: commands.get('credit.record') as Def };

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  await db.sabotage();
  const anything = { safeParse: (data: unknown) => ({ success: true, data }) } as never; // a schema that takes any input
  const checks: Checks = async () => bad;
  commands.set('stock.waste', { ...saved.waste, checks });
  // credit.record writes a journal line, so a draft of it must cite today's books; the patched input names a holding.
  commands.set('credit.record', { ...saved.credit, input: anything, run: async () => ({}) });
  named.set('package.balance', {
    params: anything,
    order: ['holding_id'],
    key: ['holding_id'],
    columns: { holding_id: { kind: 'text' }, value_left: { kind: 'money', currency: 'currency' } },
    sql: `select $1::uuid::text as holding_id, 100::bigint as value_left, 'INR'::text as currency`,
  });
}, 120_000);
afterAll(async () => {
  commands.set('stock.waste', saved.waste);
  commands.set('credit.record', saved.credit);
  named.delete('package.balance');
  await db.close();
});

// The owner's run (ai.run stamps the owner as started_by); its reads are minted as the owner.
const runOf = async (owner: Session) =>
  tx(app, { tenant_id: owner.tenantId, actor_id: owner.memberId }, async (c) =>
    (await c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'stock') returning id`, [owner.tenantId])).rows[0].id as string,
  );

it('MS-22a a bad path from checks is refused at proposal and stale at approval', async () => {
  const s = await smallShop(app, 'MS22a-checks');
  const runId = await runOf(s.owner);
  const system = { kind: 'member', session: s.owner } as const;
  const onHand = await mintSnapshot(app, system, 'stock.on_hand', { item_id: s.biscuits }, runId);
  const ref = { snapshotId: onHand.id, row: 0, col: 'on_hand' };
  const propose = () =>
    proposeDraft(app, { session: s.owner, runId }, { command: 'stock.waste', payload: { itemId: s.biscuits, qtyMilli: 48_000 }, basedOn: [ref], payloadRefs: { qtyMilli: ref } }).catch((e: unknown) => e);

  bad = ['qtyMilli'];
  expect(await propose()).toMatchObject({ code: 'invalid', fields: ['qtyMilli'] });

  bad = [];
  const draftId = await propose();
  expect(draftId).toEqual(expect.any(String));
  bad = ['qtyMilli']; // what held at proposal no longer does
  const decision = await decide(app, s.owner, draftId as string, 'approved');
  expect(decision).toMatchObject({ status: 'stale' });
  expect((decision as { changed: string[] }).changed.length).toBe(1);
  expect((await db.admin.query('select status from approval.draft where id = $1', [draftId])).rows[0].status).toBe('stale');
  const waste = await db.admin.query(`select count(*)::int as n from books.stock_move where kind = 'waste' and item_id = $1`, [s.biscuits]);
  expect(waste.rows[0].n).toBe(0); // nothing executed

  bad = [];
  const ok = await propose();
  expect((await decide(app, s.owner, ok as string, 'approved')).status).toBe('executed');
});

it('MS-22a a money draft naming a holdingId needs a package.balance cell', async () => {
  const s = await smallShop(app, 'MS22a-holding');
  const runId = await runOf(s.owner);
  const system = { kind: 'member', session: s.owner } as const;
  const holdingId = crypto.randomUUID();
  const onHand = await mintSnapshot(app, system, 'stock.on_hand', { item_id: s.biscuits }, runId);
  const unrelated = { snapshotId: onHand.id, row: 0, col: 'on_hand' };
  const propose = (basedOn: (typeof unrelated)[]) =>
    proposeDraft(app, { session: s.owner, runId }, { command: 'credit.record', payload: { holdingId }, basedOn }).catch((e: unknown) => e);
  expect(await propose([unrelated])).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  // A package.balance cell of ANOTHER holding does not count either.
  const other = await mintSnapshot(app, system, 'package.balance', { holding_id: crypto.randomUUID() }, runId);
  expect(await propose([{ snapshotId: other.id, row: 0, col: 'value_left' }])).toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  const balance = await mintSnapshot(app, system, 'package.balance', { holding_id: holdingId }, runId);
  expect(await propose([{ snapshotId: balance.id, row: 0, col: 'value_left' }])).toEqual(expect.any(String));
});

it('MS-22a a rejection stores its reason code, and free words are refused before anything is written', async () => {
  const s = await smallShop(app, 'MS22a-reason');
  const runId = await runOf(s.owner);
  const system = { kind: 'member', session: s.owner } as const;
  const onHand = await mintSnapshot(app, system, 'stock.on_hand', { item_id: s.biscuits }, runId);
  const ref = { snapshotId: onHand.id, row: 0, col: 'on_hand' };
  bad = [];
  const real = await proposeDraft(app, { session: s.owner, runId }, { command: 'stock.waste', payload: { itemId: s.biscuits, qtyMilli: 48_000 }, basedOn: [ref], payloadRefs: { qtyMilli: ref } });
  expect(await decide(app, s.owner, real, 'rejected', 'enough stock' as never).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', fields: ['reason'] });
  expect((await db.admin.query('select status from approval.draft where id = $1', [real])).rows[0].status).toBe('proposed');
  expect((await decide(app, s.owner, real, 'rejected', 'not_now')).status).toBe('rejected');
  expect((await db.admin.query('select reason from approval.decision where draft_id = $1', [real])).rows[0].reason).toBe('not_now');
  const audit = await db.admin.query(`select payload from audit.audit_log where entity_id = $1 and action = 'draft.rejected'`, [real]);
  expect(audit.rows[0].payload).toEqual({ reason: 'not_now' });
});
