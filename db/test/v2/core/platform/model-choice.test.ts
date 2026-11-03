// P-5's core half over the real v2 database: model.choose (the owner alone picks an alias for an agent, from the
// platform's allow-list and only one the running build serves), modelFor's fallback chain (the shop's choice, the
// edition's default, the other allowed aliases; a disabled row drops out; nothing left hides the surface), the next
// run's trace naming the chosen alias, the deployment's AI-call ceiling across shops in allow(), and sandboxes reading AI
// off. The models are a fake transport at the system boundary; the database is never mocked. Red-proofs:
// test/v2/sabotage/paytm-models.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { allow } from '../../../../../packages/core/src/allow.ts';
import { aiStaff, chooseModel, type ModelCatalogue, modelFor } from '../../../../../packages/core/src/models.ts';
import { openSession, type Session, withTx } from '../../../../../packages/core/src/session.ts';
import { modelCatalogue } from '../../../../../packages/ai/src/config.ts';
import type { AgentPort, TraceEvent } from '../../../../../packages/agent/src/port.ts';
import { narrateBrief } from '../../../../../packages/agent/src/run.ts';
import { env, json, noSleep, queueFetch, responsesBody } from '../../../../../packages/agent/test/helpers.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { failure, firstOperator, type Operator, proposeAndApprove } from './fixture.ts';

let db: TestDb;
let app: pg.Pool;
let op: Operator;
let a: Tenant;
let b: Tenant;
let sandbox: Tenant;
let owner: Session;
const cat: ModelCatalogue = modelCatalogue('meta');
const allowModel = (alias: string, role: string, enabled = true) => proposeAndApprove(db, op, { kind: 'model_allow', set: { alias, role, enabled } });
const defaults = (set: Record<string, unknown>) =>
  proposeAndApprove(db, op, { kind: 'default_config', set: { ai_enabled: true, ai_daily_calls: 50, media_daily_calls: 10, sandbox_media_daily_calls_total: 10, ...set } });
const chainOf = (t: Tenant, agent: string, role?: string) => withTx(app, { kind: 'system', tenantId: t.tenant }, (c) => modelFor(c, agent, cat, role));
const session = async (t: Tenant, member: string) => (await openSession(app, t.tenant, member)) as Session;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  op = await firstOperator(db);
  a = await signUp(db, 'models-a');
  b = await signUp(db, 'models-b');
  sandbox = await signUp(db, 'models-sandbox', { sandbox: true });
  owner = await session(a, a.owner);
  await defaults({ deployment_daily_calls: 1000, sandbox_ai_enabled: false });
  // The meta edition's allow-list as the demo seed approves it, plus an alias the platform allows but this build does not
  // know (a Paytm-branch model): it may never be picked or answer here.
  for (const [alias, role] of [['muse-spark', 'router'], ['muse-spark', 'reason'], ['muse-spark', 'narrate'], ['spark-open', 'narrate'], ['gemini-flash', 'reason']] as const) {
    await allowModel(alias, role);
  }
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

it('MODELS1 an alias off the allow-list, or one the running build does not serve in the agent role, is refused', async () => {
  // gemini-flash is enabled for reason on the allow-list (the table's guard admits it), but this build has no binding.
  expect(await failure(chooseModel(app, owner, { agent: 'ask', alias: 'gemini-flash' }, cat))).toMatchObject({ code: 'refused', fields: ['alias'] });
  // spark-open is known and allowed, but only for narrate; Ask's agent role is reason.
  expect(await failure(chooseModel(app, owner, { agent: 'ask', alias: 'spark-open' }, cat))).toMatchObject({ code: 'refused', fields: ['alias'] });
  // sam is known for segment, and on no allow-list row at all.
  expect(await failure(chooseModel(app, owner, { agent: 'shelf', alias: 'sam' }, cat))).toMatchObject({ code: 'refused', fields: ['alias'] });
  expect(await failure(chooseModel(app, owner, { agent: 'nobody', alias: 'muse-spark' }, cat))).toMatchObject({ code: 'invalid', fields: ['agent'] });
  const { rows } = await tx(app, { tenant_id: a.tenant }, (c) => c.query<{ n: number }>('select count(*)::int as n from ops.model_choice'));
  expect(rows[0]?.n).toBe(0);
});

it('MODELS2 a manager or staff member choosing a model is refused, and writes nothing', async () => {
  for (const member of [a.manager, a.staff]) {
    expect(await failure(chooseModel(app, await session(a, member), { agent: 'brief', alias: 'muse-spark' }, cat))).toMatchObject({ code: 'refused', fields: ['member'] });
  }
  const { rows } = await tx(app, { tenant_id: a.tenant }, (c) => c.query<{ n: number }>('select count(*)::int as n from ops.model_choice'));
  expect(rows[0]?.n).toBe(0);
});

it('MODELS3 an allow-list row without an approved change is refused (the platform guard)', async () => {
  await expect(
    tx(db.as('munshi_platform'), { operator_id: op.operatorId }, (c) => c.query(`insert into platform.model_allow (alias, role, enabled, change_id) values ('muse-spark', 'vision', true, gen_random_uuid())`)),
  ).rejects.toThrow(/platform refused|violates foreign key/);
  await expect(tx(app, { tenant_id: a.tenant }, (c) => c.query(`insert into platform.model_allow (alias, role, enabled, change_id) values ('muse-spark', 'vision', true, gen_random_uuid())`))).rejects.toThrow(/permission denied/);
});

// One brief run as the app's port gives it: the models from core's modelFor; the finding, reads and drafts stubbed (no
// figure is shown here; the trace and the transport are what is under test).
async function briefRun(t: Tenant, fetch: typeof globalThis.fetch) {
  const events: TraceEvent[] = [];
  const port: AgentPort = {
    async read() {
      throw new Error('no reads');
    },
    async resolve() {
      return null;
    },
    async propose() {
      throw new Error('no drafts');
    },
    async finding(id) {
      return { id, kind: 'shrinkage', snapshotId: id, row: 0, cells: {}, status: 'open', current: true, openDraft: false };
    },
    trace(e) {
      events.push(e);
    },
    allow: async (role) => (await allow(app, t.tenant, role, 'on')).ok,
    models: (agent, role) => withTx(app, { kind: 'system', tenantId: t.tenant }, (c) => modelFor(c, agent, cat, role)),
  };
  const reply = await narrateBrief([crypto.randomUUID()], { port, asOf: '2026-10-31', deps: { env, fetch, mode: 'live', sleep: noSleep } });
  return { reply, models: events.filter((e) => e.kind === 'model').map((e) => e.label) };
}
const SEGMENTS = '{"segments":[]}';
const meta = () => json(200, responsesBody({ output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: SEGMENTS, annotations: [] }] }] }));
const baseten = () =>
  json(200, { id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: SEGMENTS } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

it("MODELS4 after the owner's pick, the next run's trace shows the chosen alias, and the call goes to its binding", async () => {
  expect(await chainOf(a, 'brief')).toEqual(['spark-open', 'muse-spark']); // the edition's default first
  const before = queueFetch(baseten());
  expect((await briefRun(a, before.f)).models).toEqual(['narrate,spark-open']);
  expect(new URL(before.calls[0]?.url ?? '').host).toBe('inference.baseten.co');

  const key = `models-${crypto.randomUUID()}`;
  const first = await chooseModel(app, owner, { agent: 'brief', alias: 'muse-spark' }, cat, key);
  expect(await chooseModel(app, owner, { agent: 'brief', alias: 'muse-spark' }, cat, key)).toEqual(first); // a replay writes nothing
  const audit = await tx(app, { tenant_id: a.tenant }, (c) =>
    c.query<{ n: number }>("select count(*)::int as n from audit.audit_log where action = 'model.choose' and entity_id = $1", [first.choiceId]),
  );
  expect(audit.rows[0]?.n).toBe(1);
  expect(await chainOf(a, 'brief')).toEqual(['muse-spark', 'spark-open']);
  expect(await chainOf(b, 'brief')).toEqual(['spark-open', 'muse-spark']); // another shop's choice is its own

  const after = queueFetch(meta());
  expect((await briefRun(a, after.f)).models).toEqual(['narrate,muse-spark']);
  expect(new URL(after.calls[0]?.url ?? '').host).toBe('api.meta.ai');

  const staff = await withTx(app, { kind: 'system', tenantId: a.tenant }, (c) => aiStaff(c, cat));
  expect(staff.find((r) => r.agent === 'brief')).toMatchObject({ role: 'narrate', chosen: 'muse-spark', current: 'muse-spark', defaultAlias: 'spark-open', allowed: ['muse-spark', 'spark-open'] });
  expect(staff.map((r) => r.agent)).toHaveLength(11);
});

it("MODELS6 a pick applies to the agent's own role only: the run's other calls keep the edition's default", async () => {
  // Ask's own role is reason; muse-spark is also allowed for narrate, where the edition's default is spark-open.
  await chooseModel(app, owner, { agent: 'ask', alias: 'muse-spark' }, cat);
  expect(await chainOf(a, 'ask')).toEqual(['muse-spark']);
  expect(await chainOf(a, 'ask', 'narrate')).toEqual(['spark-open', 'muse-spark']);
  expect(await chainOf(a, 'ask', 'router')).toEqual(['muse-spark']);
});

it('MODELS5 a disabled allow-list row drops the choice for the default; with the default off too, the surface hides', async () => {
  await allowModel('muse-spark', 'narrate', false);
  expect(await chainOf(a, 'brief')).toEqual(['spark-open']);
  const fallen = queueFetch(baseten());
  expect((await briefRun(a, fallen.f)).models).toEqual(['narrate,spark-open']);

  await allowModel('spark-open', 'narrate', false);
  expect(await chainOf(a, 'brief')).toEqual([]);
  const hidden = queueFetch();
  const run = await briefRun(a, hidden.f);
  expect(run.reply).toMatchObject({ kind: 'abstain', missing: ['model_error'] }); // the brief keeps its template lines
  expect(hidden.calls).toHaveLength(0);
  // A choice of a disabled alias is refused now, and "Default" with the default off too.
  expect(await failure(chooseModel(app, owner, { agent: 'brief', alias: 'muse-spark' }, cat))).toMatchObject({ code: 'refused', fields: ['alias'] });
  expect(await failure(chooseModel(app, owner, { agent: 'brief', alias: null }, cat))).toMatchObject({ code: 'refused', fields: ['alias'] });
  // Ask's reason call still has muse-spark: an alias is enabled per role.
  expect(await chainOf(a, 'ask')).toEqual(['muse-spark']);
});

it('AICAP2 with the deployment ceiling at 3, the fourth call across two shops is refused and counted nowhere', async () => {
  const { rows } = await db.admin.query<{ calls: number }>('select coalesce(sum(calls), 0)::int as calls from platform.ai_usage_total');
  await defaults({ deployment_daily_calls: (rows[0]?.calls ?? 0) + 3, sandbox_ai_enabled: false });
  const usage = async (t: Tenant) => (await tx(app, { tenant_id: t.tenant }, (c) => c.query<{ n: number }>('select coalesce(sum(calls), 0)::int as n from ai.usage'))).rows[0]?.n;
  const [ua, ub] = [await usage(a), await usage(b)];
  const got = [];
  for (const t of [a, b, a, b]) got.push(await allow(app, t.tenant, 'reason', 'on'));
  expect(got).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: false, reason: 'cap' }]);
  expect([await usage(a), await usage(b)]).toEqual([(ua ?? 0) + 2, (ub ?? 0) + 1]);
});

it('SANDBOXAI1 a sandbox reads AI off unless the default config turns sandbox AI on', async () => {
  await defaults({ deployment_daily_calls: 1000, sandbox_ai_enabled: false });
  expect(await allow(app, sandbox.tenant, 'reason', 'on')).toEqual({ ok: false, reason: 'off' });
  expect(await allow(app, a.tenant, 'reason', 'on')).toEqual({ ok: true });
  await defaults({ deployment_daily_calls: 1000, sandbox_ai_enabled: true });
  expect(await allow(app, sandbox.tenant, 'reason', 'on')).toEqual({ ok: true });
});
