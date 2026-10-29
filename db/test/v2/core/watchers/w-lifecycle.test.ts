// LIFE: the finding lifecycle (BLUEPRINT §7.4) on one planted situation, a customer's udhaar past due. Raised; seen
// again with the same cells it keeps its snapshot and writes no event; seen the next morning with changed cells it moves
// (pinned, a `seen` event); cleared by the customer's repayment it resolves in the next watcher run, with no actor;
// recurring it is raised again as a new finding; dismissed (a member, a dismiss code) its key rests 30 days — still at
// 29, raised at 31 (the dismissal is aged by a superuser fixture: closed_at is stamped by the database and a dismissed
// finding is final); snoozed it is still seen, and the run after its snooze ends wakes it (snoozed_until aged likewise).
// Red-proofs: test/v2/sabotage/core-ai.ts.
import { addDays, businessDate, dismissFinding, localTime, recordPayment, recordSale, runCommand, runWatchers, snoozeFinding } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';
import { age as ageFinding, findings } from './plant.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let today: string;
let rice: string;

const KEY = () => `overdue_credit:${s.customer}`;
const credit = (rupees: number) =>
  recordSale(app, s.staff, {
    shopId: s.shopId,
    soldAt: localTime(addDays(today, -40), 600, 'Asia/Kolkata').toISOString(),
    customerId: s.customer,
    lines: [{ itemId: rice, qtyMilli: (rupees / 150) * 1000 }],
    payments: [],
  });
const rows = async (sql: string, values: unknown[] = []) => (await db.admin.query(sql, values)).rows;
const ofKey = () => rows('select id::text, status, snapshot_id::text, last_run_id::text from ai.finding where tenant_id = $1 and dedupe_key = $2 order by created_at', [s.owner.tenantId, KEY()]);
const events = (id: string) => rows('select kind, run_id::text, member_id::text, reason from ai.finding_event where finding_id = $1 order by at, id', [id]);
const age = (id: string, col: 'closed_at' | 'snoozed_until', days: number) => ageFinding(db.admin, id, col, days);

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Life');
  today = businessDate(new Date(), 'Asia/Kolkata');
  rice = ((await runCommand(app, s.owner, 'item.create', { name: 'Rice bag 5 kg', unit: 'pack' })) as { itemId: string }).itemId;
  await runCommand(app, s.owner, 'price.set', { itemId: rice, amountMinor: 15_000, effectiveFrom: localTime(addDays(today, -100), 0, 'Asia/Kolkata').toISOString() });
  await credit(300); // ₹300 given 40 days ago, due 10 days ago
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

it('LIFE raised once; re-seen with the same cells it keeps its snapshot and writes no event; with changed cells it moves and writes seen', async () => {
  const first = await runWatchers(jobs, s.owner.tenantId, today);
  expect(first.raised.map((r) => r.dedupeKey)).toEqual([KEY()]);
  const [raised] = await ofKey();
  const again = await runWatchers(jobs, s.owner.tenantId, today);
  expect(again.raised).toEqual([]);
  expect(await ofKey()).toEqual([{ ...raised, last_run_id: again.runId }]);
  expect((await events(raised.id)).map((e) => e.kind)).toEqual(['raised']);
  // The next morning days_overdue is one more: new cells, so the finding moves to that run's snapshot, pinned.
  const next = await runWatchers(jobs, s.owner.tenantId, addDays(today, 1));
  const [moved] = await ofKey();
  expect(moved.status).toBe('open');
  expect(moved.snapshot_id).not.toBe(raised.snapshot_id);
  expect((await events(raised.id)).map((e) => [e.kind, e.run_id])).toEqual([
    ['raised', first.runId],
    ['seen', next.runId],
  ]);
  expect(await rows("select 1 from snap.pin where holder = 'finding' and holder_id = $1 and snapshot_id = $2", [raised.id, moved.snapshot_id])).toHaveLength(1);
});

it('LIFE cleared, the next run of its kind resolves it with no actor; recurring, it is raised again as a new finding', async () => {
  await runWatchers(jobs, s.owner.tenantId, today);
  const [open] = await ofKey();
  expect(open.status).toBe('open');
  await recordPayment(app, s.staff, { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: 30_000 });
  const cleared = await runWatchers(jobs, s.owner.tenantId, today);
  expect(cleared.resolved).toEqual([open.id]);
  const [resolved] = await ofKey();
  expect(resolved.status).toBe('resolved');
  expect((await events(open.id)).at(-1)).toEqual({ kind: 'resolved', run_id: cleared.runId, member_id: null, reason: null });
  expect((await runWatchers(jobs, s.owner.tenantId, today)).resolved).toEqual([]); // resolved is final: nothing more to do
  await credit(150);
  const back = await runWatchers(jobs, s.owner.tenantId, today);
  expect(back.raised.map((r) => r.dedupeKey)).toEqual([KEY()]);
  const all = await ofKey();
  expect(all.map((f) => f.status)).toEqual(['resolved', 'open']);
  expect(all[1]?.id).not.toBe(open.id);
});

it('LIFE dismissed, its key rests 30 days: not raised at 29, raised again at 31', async () => {
  await runWatchers(jobs, s.owner.tenantId, today);
  const live = (await ofKey()).filter((f) => f.status === 'open');
  expect(live).toHaveLength(1);
  const id = (live[0] as { id: string }).id;
  await dismissFinding(app, s.owner, id, 'already_handled');
  expect((await events(id)).at(-1)).toEqual({ kind: 'dismissed', run_id: null, member_id: s.owner.memberId, reason: 'already_handled' });
  expect((await runWatchers(jobs, s.owner.tenantId, today)).raised).toEqual([]);
  await age(id, 'closed_at', 29);
  expect((await runWatchers(jobs, s.owner.tenantId, today)).raised).toEqual([]);
  await age(id, 'closed_at', 2);
  const raised = await runWatchers(jobs, s.owner.tenantId, today);
  expect(raised.raised.map((r) => r.dedupeKey)).toEqual([KEY()]);
  expect((await ofKey()).at(-1)?.status).toBe('open');
  expect(await findings(jobs, s.owner.tenantId, "status = 'dismissed'")).toHaveLength(1);
});

it('LIFE snoozed, it is still seen and stays snoozed; the run after its snooze ends wakes it', async () => {
  await runWatchers(jobs, s.owner.tenantId, today);
  const id = ((await ofKey()).find((f) => f.status === 'open') as { id: string }).id;
  await snoozeFinding(app, s.owner, id, 1);
  const seen = await runWatchers(jobs, s.owner.tenantId, today);
  expect((await ofKey()).find((f) => f.id === id)).toMatchObject({ status: 'snoozed', last_run_id: seen.runId });
  await age(id, 'snoozed_until', 2);
  await runWatchers(jobs, s.owner.tenantId, today);
  expect((await ofKey()).find((f) => f.id === id)?.status).toBe('open');
  expect((await events(id)).map((e) => e.kind).slice(-2)).toEqual(['snoozed', 'woke']);
});
