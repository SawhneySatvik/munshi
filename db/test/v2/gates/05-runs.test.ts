// 05_runs.sql (and ai.usage from 07): A1's database part (a run ends once and stays tainted; usage only rises), PII2's
// trace part (ids and labels only, never text) and RET1's message-text part (an Ask answer's text purged 30 days after
// the answer; its hash outlives it). Red-proofs: test/v2/sabotage/runs.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { signUp, type Tenant } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let app: pg.Pool;
let jobs: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  t = await signUp(db, 'runs-shop');
  await db.sabotage();
});
afterAll(() => db?.close());

const member = (actor = t.owner) => ({ tenant_id: t.tenant, actor_id: actor });
const newRun = () =>
  tx(app, member(), async (c) => (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'counter') returning id`, [t.tenant])).rows[0]?.id as string);
const setRun = (id: string, set: string) => tx(app, member(), (c) => c.query(`update ai.run set ${set} where id = $1`, [id]));

it('A1 a run ends once, at now(); a tainted run stays tainted; model calls only rise; an ended run never changes', async () => {
  const run = await newRun();
  await setRun(run, 'tainted = true, model_calls = 2');
  expect((await refused(setRun(run, 'tainted = false'))).code).toBe('MS010');
  expect((await refused(setRun(run, 'model_calls = 1'))).code).toBe('MS010');
  expect((await refused(setRun(run, `ended_at = now() - interval '1 hour', outcome = 'answered'`))).code).toBe('MS010');
  await setRun(run, `ended_at = now(), outcome = 'answered'`);
  expect((await refused(setRun(run, 'model_calls = 3'))).code).toBe('MS010');
  const born = await refused(
    tx(app, member(), (c) => c.query(`insert into ai.run (tenant_id, trigger, desk, tainted) values ($1, 'question', 'counter', true)`, [t.tenant])),
  );
  expect(born.code).toBe('MS010');
});

it('PII2 a trace holds ids and labels only: free text in a label, an id that is not a uuid, or more than 16 ids is refused', async () => {
  const run = await newRun();
  let seq = 0;
  const trace = (label: string, ids: unknown) =>
    tx(app, member(), (c) =>
      c.query(`insert into ai.trace (tenant_id, run_id, seq, kind, label, ids) values ($1, $2, $3, 'read', $4, $5)`, [t.tenant, run, ++seq, label, JSON.stringify(ids)]),
    );
  for (const [label, ids] of [
    ['Asha owes 4500', []],
    ['credit.overdue', ['+919811000001']],
    ['credit.overdue', [{ name: 'Asha' }]],
    ['credit.overdue', Array.from({ length: 17 }, () => randomUUID())],
  ] as const) {
    expect((await refused(trace(label, ids))).code, label).toBe('23514');
  }
  await trace('credit.overdue', Array.from({ length: 16 }, () => randomUUID()));
});

it('RET1 an Ask answer text is purged 30 days after the answer, not a day sooner; its hash outlives it; the purge erases no other text', async () => {
  const text = async (body: string, kind?: string) =>
    tx(app, member(), async (c) => {
      const tx1 = await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'member', '\\x00') returning id`, [
        t.tenant,
        body,
      ]);
      const id = tx1.rows[0]?.id as string;
      if (kind) {
        const run = await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'counter') returning id`, [t.tenant]);
        const a = await c.query<{ id: string }>(`insert into ai.answer (tenant_id, run_id, kind, text_id, verdict) values ($1, $2, $3, $4, 'answered') returning id`, [
          t.tenant,
          run.rows[0]?.id,
          kind,
          id,
        ]);
        return { id, answer: a.rows[0]?.id as string };
      }
      return { id, answer: '' };
    });
  const purge = (id: string) => tx(jobs, { tenant_id: t.tenant }, (c) => c.query(`update ops.message_text set body = null, erased_at = now() where id = $1`, [id]));
  const young = await text('Who owes the most?', 'ask');
  const old = await text('Who owes the most this month?', 'ask');
  const brief = await text('Today: tea sold well', 'brief_line');
  const plain = await text('Your order is ready');
  await plant(db.admin, `update ai.answer set created_at = now() - interval '29 days' where id = $1`, [young.answer]);
  await plant(db.admin, `update ai.answer set created_at = now() - interval '31 days' where id = any($1)`, [[old.answer, brief.answer]]);
  expect((await refused(purge(young.id))).code).toBe('MS007');
  expect((await refused(purge(brief.id))).code).toBe('MS007');
  expect((await refused(purge(plain.id))).code).toBe('MS007');
  await purge(old.id);
  const { rows } = await db.admin.query(`select body, body_sha256 = sha256(convert_to('Who owes the most this month?', 'UTF8')) as kept from ops.message_text where id = $1`, [
    old.id,
  ]);
  expect(rows).toEqual([{ body: null, kept: true }]);
  // A person's erasure of a text is an active owner's (a contact's erasure), never a manager's.
  const erase = (actor: string) => tx(app, member(actor), (c) => c.query(`update ops.message_text set body = null, erased_at = now() where id = $1`, [plain.id]));
  expect((await refused(erase(t.manager))).code).toBe('MS007');
  await erase(t.owner);
});

it('A1 a usage count only rises', async () => {
  const set = (calls: number) =>
    tx(app, member(), (c) =>
      c.query(
        `insert into ai.usage (tenant_id, day, role, calls) values ($1, current_date, 'vision', $2)
         on conflict (tenant_id, day, role) do update set calls = excluded.calls`,
        [t.tenant, calls],
      ),
    );
  await set(3);
  await set(4);
  expect((await refused(set(2))).code).toBe('MS010');
});
