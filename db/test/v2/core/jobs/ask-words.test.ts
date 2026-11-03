// ASKWORDS1: an Ask answer's words are kept 30 days. The `ask_words` purge, run by the jobs runner as
// the tick runs it, erases the words of every Ask answer older than that (the text row nulled and stamped, the answer
// row kept with its refs) and keeps a recent answer's, and another kind's (a brief line). Red-proofs:
// test/v2/sabotage/sarvam.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { recordAnswer } from '../../../../../packages/core/src/brief.ts';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Filled, fillTenant, plantProbeCommand, signUp } from '../../gates/fixture.ts';
import { plant } from '../../gates/lib.ts';
import { jobsUrl } from './lib.ts';

let db: TestDb;
let pool: pg.Pool;
let f: Filled;
const answers: Record<'old' | 'recent' | 'oldBrief', string> = {} as never;

const segment = (text: string) => [{ text, refs: [] }];

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  f = await fillTenant(db, await signUp(db, 'ask-words'));
  const app = db.as('munshi_app');
  const member = { tenant_id: f.tenant, actor_id: f.owner };
  answers.old = await tx(app, member, (c) => recordAnswer(c, f.run, 'ask', segment('An old answer.')));
  answers.recent = await tx(app, member, (c) => recordAnswer(c, f.run, 'ask', segment('A recent answer.')));
  answers.oldBrief = await tx(app, member, (c) => recordAnswer(c, f.run, 'brief_line', segment('An old brief line.')));
  await plant(db.admin, `update ai.answer set created_at = now() - interval '31 days' where id = any($1)`, [[answers.old, answers.oldBrief]]);
  await plant(db.admin, `update ai.answer set created_at = now() - interval '29 days' where id = $1`, [answers.recent]);
  pool = createJobsPool(jobsUrl(db), 2);
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

const words = async () =>
  Object.fromEntries(
    (
      await db.admin.query<{ id: string; body: string | null; erased: boolean }>(
        'select a.id::text, t.body, t.erased_at is not null as erased from ai.answer a join ops.message_text t on t.tenant_id = a.tenant_id and t.id = a.text_id where a.id = any($1)',
        [Object.values(answers)],
      )
    ).rows.map((r) => [r.id, { body: r.body, erased: r.erased }]),
  );

it("the purge erases an Ask answer's words after 30 days, keeps a recent one's and a brief line's, and keeps every answer row", async () => {
  const runs = await runDueJobs(pool, new Date(), ['ask_words']);
  expect(runs.filter((r) => r.tenantId === f.tenant).map((r) => [r.job, r.outcome, r.removed])).toEqual([['ask_words', 'ok', { ask_words: 1 }]]);
  expect(await words()).toEqual({
    [answers.old]: { body: null, erased: true },
    [answers.recent]: { body: JSON.stringify(['A recent answer.']), erased: false },
    [answers.oldBrief]: { body: JSON.stringify(['An old brief line.']), erased: false },
  });
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ai.answer where id = any($1)', [Object.values(answers)]);
  expect(rows[0]?.n).toBe(3);
});
