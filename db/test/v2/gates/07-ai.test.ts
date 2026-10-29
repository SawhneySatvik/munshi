// 07_ai.sql: C5's database part (the finding lifecycle: one open per key, the 30-day rest of a dismissed key, final
// states, snooze and wake, a cited row and a money impact) and J2's finding, answer and brief parts (a re-see with the
// same cells keeps its snapshot and adds no pin; changed cells move forward and pin; pin_release frees only a moved
// finding's old pin). Red-proofs: test/v2/sabotage/ai.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, plantProbeCommand, rowsOf, signUp, type Tenant } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let app: pg.Pool;
let jobs: pg.Pool;
let run: string;

const asJobs = () => ({ tenant_id: t.tenant });
const asOwner = () => ({ tenant_id: t.tenant, actor_id: t.owner });

const watch = (amount: string) =>
  tx(jobs, asJobs(), async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'watch.shrinkage', '{}', 'watch', $2, $3, '\\x00', '\\x00', 0) returning id`,
      [t.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf(amount))],
    );
    return r.rows[0]?.id as string;
  });
const raise = (key: string, snapshot: string, extra: { row?: number; impact?: string } = {}) =>
  tx(jobs, asJobs(), async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into ai.finding (tenant_id, shop_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id)
       values ($1, $2, 'stock', 'shrinkage', $3, 'high', $4, $5, '\\x00', $6, $7, $7) returning id`,
      [t.tenant, t.shop, key, snapshot, extra.row ?? 0, extra.impact ?? 'amount', run],
    );
    return r.rows[0]?.id as string;
  });
const asApp = (sql: string, params: unknown[]) => tx(app, asOwner(), (c) => c.query(sql, params));
const asJobsQ = (sql: string, params: unknown[]) => tx(jobs, asJobs(), (c) => c.query(sql, params));
const events = async (finding: string) =>
  (await db.admin.query<{ kind: string }>('select kind from ai.finding_event where finding_id = $1 order by at, id', [finding])).rows.map((r) => r.kind);
const pins = async (holder: string) =>
  (await db.admin.query<{ snapshot_id: string }>('select snapshot_id from snap.pin where holder_id = $1 order by snapshot_id', [holder])).rows.map(
    (r) => r.snapshot_id,
  );

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  t = await signUp(db, 'ai-shop');
  run = (await tx(jobs, asJobs(), (c) => c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [t.tenant])))
    .rows[0]?.id as string;
  await db.sabotage();
});
afterAll(() => db?.close());

it('C5 one open finding per key; a key dismissed in the last 30 days is not raised again; dismissed and resolved are final', async () => {
  const s = await watch('100');
  const f = await raise('key:one', s);
  expect((await refused(raise('key:one', s))).code).toBe('23505');
  expect((await refused(asApp(`update ai.finding set status = 'dismissed', close_reason = 'wrong_figure' where id = $1`, [f]))).code).toBe('23503');
  await asApp(`update ai.finding set status = 'dismissed', close_reason = 'not_relevant' where id = $1`, [f]);
  expect((await refused(raise('key:one', s))).code).toBe('MS012');
  expect((await refused(asApp(`update ai.finding set status = 'snoozed', snoozed_until = now() + interval '1 day' where id = $1`, [f]))).code).toBe('MS012');
  expect((await refused(asJobsQ(`update ai.finding set status = 'resolved' where id = $1`, [f]))).code).toBe('MS012');
  await plant(db.admin, `update ai.finding set closed_at = now() - interval '31 days' where id = $1`, [f]);
  const again = await raise('key:one', s);
  await asJobsQ(`update ai.finding set status = 'resolved' where id = $1`, [again]);
  expect((await refused(asJobsQ(`update ai.finding set status = 'open' where id = $1`, [again]))).code).toBe('MS012');
  expect(await events(again)).toEqual(['raised', 'resolved']);
});

it('C5 a member snoozes into the future; a watcher run wakes it only at snoozed_until and resolves it; each change is an event', async () => {
  const f = await raise('key:two', await watch('200'));
  expect((await refused(asApp(`update ai.finding set status = 'snoozed', snoozed_until = now() - interval '1 minute' where id = $1`, [f]))).code).toBe('MS012');
  await asApp(`update ai.finding set status = 'snoozed', snoozed_until = now() + interval '1 day' where id = $1`, [f]);
  const wake = () => asJobsQ(`update ai.finding set status = 'open' where id = $1`, [f]);
  expect((await refused(wake())).code).toBe('MS012');
  await plant(db.admin, `update ai.finding set snoozed_until = now() - interval '1 minute' where id = $1`, [f]);
  await wake();
  expect((await db.admin.query('select snoozed_until from ai.finding where id = $1', [f])).rows).toEqual([{ snoozed_until: null }]);
  await asJobsQ(`update ai.finding set status = 'resolved' where id = $1`, [f]);
  expect(await events(f)).toEqual(['raised', 'snoozed', 'woke', 'resolved']);
});

it('C5 a finding cites a row its snapshot has, and its impact is a money cell there', async () => {
  const s = await watch('300');
  expect((await refused(raise('key:three', s, { row: 1 }))).code).toBe('MS006');
  expect((await refused(raise('key:three', s, { impact: 'item' }))).code).toBe('MS006');
  const f = await raise('key:three', s);
  const { rows } = await db.admin.query(
    `select f.row_sha256 = sha256(convert_to((s.rows -> 0)::text, 'UTF8')) as ok from ai.finding f join snap.snapshot s on s.id = f.snapshot_id where f.id = $1`,
    [f],
  );
  expect(rows).toEqual([{ ok: true }]);
});

it('J2 a finding re-seen with the same cells keeps its snapshot and adds no pin or event; changed cells move it forward, pin and write seen; never back', async () => {
  const s1 = await watch('400');
  const f = await raise('key:four', s1);
  const run2 = (await tx(jobs, asJobs(), (c) => c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [t.tenant])))
    .rows[0]?.id as string;
  const resee = (snapshot: string) => asJobsQ(`update ai.finding set snapshot_id = $2, last_run_id = $3 where id = $1`, [f, snapshot, run2]);
  const same = await watch('400');
  await resee(same);
  const after = (await db.admin.query('select snapshot_id, last_run_id from ai.finding where id = $1', [f])).rows[0];
  expect(after).toEqual({ snapshot_id: s1, last_run_id: run2 });
  expect(await pins(f)).toEqual([s1]);
  expect(await events(f)).toEqual(['raised']);
  const changed = await watch('450');
  await resee(changed);
  expect(await pins(f)).toEqual([s1, changed].sort());
  expect(await events(f)).toEqual(['raised', 'seen']);
  expect((await refused(resee(s1))).code).toBe('MS012');
});

it("J2 the jobs role releases only a finding's pin on a snapshot it no longer names; draft, answer and brief pins stay", async () => {
  const s1 = await watch('500');
  const f = await raise('key:five', s1);
  await tx(app, asOwner(), async (c) => {
    const ref = JSON.stringify([{ snapshotId: s1, row: 0, col: 'amount' }]);
    await c.query(`insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', 0)`, [
      t.tenant,
      ref,
    ]);
    const r = await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'counter') returning id`, [t.tenant]);
    await c.query(`insert into ai.answer (tenant_id, run_id, kind, refs, verdict) values ($1, $2, 'ask', $3, 'abstained')`, [t.tenant, r.rows[0]?.id, `[${ref}]`]);
  });
  await tx(jobs, asJobs(), (c) =>
    c.query(`insert into ai.brief (tenant_id, shop_id, business_date, run_id, ranked_snapshot_id) values ($1, $2, current_date, $3, $4)`, [t.tenant, t.shop, run, s1]),
  );
  const s2 = await watch('550');
  await asJobsQ(`update ai.finding set snapshot_id = $2 where id = $1`, [f, s2]);
  // Every finding pin on a snapshot its finding no longer names (this finding's and the moved one's above), nothing else.
  const moved = await db.admin.query<{ holder_id: string; snapshot_id: string }>(
    `select p.holder_id, p.snapshot_id from snap.pin p join ai.finding f on f.tenant_id = p.tenant_id and f.id = p.holder_id
      where p.holder = 'finding' and f.snapshot_id <> p.snapshot_id order by 1, 2`,
  );
  expect(moved.rows).toContainEqual({ holder_id: f, snapshot_id: s1 });
  const released = await tx(jobs, asJobs(), (c) =>
    c.query<{ holder: string; holder_id: string; snapshot_id: string }>('delete from snap.pin returning holder, holder_id, snapshot_id'),
  );
  expect(released.rows.every((r) => r.holder === 'finding')).toBe(true);
  const key = (r: { holder_id: string; snapshot_id: string }) => `${r.holder_id}/${r.snapshot_id}`;
  expect(released.rows.map(key).sort()).toEqual(moved.rows.map(key).sort());
  const left = (await db.admin.query<{ holder: string }>(`select holder from snap.pin where snapshot_id = $1 order by holder`, [s1])).rows.map((r) => r.holder);
  expect(left).toEqual(['answer', 'brief', 'draft']);
});

it('J2 an answer pins every snapshot its refs cite, refs carry ids and columns only; one brief per shop a day', async () => {
  const s = await watch('600');
  const answer = (refs: unknown) =>
    tx(app, asOwner(), async (c) => {
      const r = await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'counter') returning id`, [t.tenant]);
      const a = await c.query<{ id: string }>(`insert into ai.answer (tenant_id, run_id, kind, refs, verdict) values ($1, $2, 'ask', $3, 'abstained') returning id`, [
        t.tenant,
        r.rows[0]?.id,
        JSON.stringify(refs),
      ]);
      return a.rows[0]?.id as string;
    });
  for (const refs of [[{ snapshotId: s, row: 0, col: 'amount' }], [[{ snapshotId: s, row: 0, col: 'amount', words: 'Tea sold 4' }]], [[{ snapshotId: 'x', row: 0, col: 'a' }]]]) {
    expect((await refused(answer(refs))).code, JSON.stringify(refs)).toBe('MS006');
  }
  const a = await answer([[{ snapshotId: s, row: 0, col: 'amount' }], [{ snapshotId: s, row: 0, col: '_count' }]]);
  expect(await pins(a)).toEqual([s]);
  const brief = () =>
    tx(jobs, asJobs(), (c) =>
      c.query(`insert into ai.brief (tenant_id, shop_id, business_date, run_id, ranked_snapshot_id) values ($1, $2, '2026-10-30', $3, $4)`, [t.tenant, t.shop, run, s]),
    );
  await brief();
  expect((await refused(brief())).code).toBe('23505');
});
