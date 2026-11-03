// ALLOW: core's allow() against the platform config: the demo's sample shops take platform.default_config
// (here AI on, 3 text and 2 media calls a day), a shop's own platform.shop_config wins outright, and no row means off.
// Text roles (router, reason, narrate) share one cap and media roles (vision, segment, voice) another; the deployment's
// switch (MUNSHI_AI, passed in) turns every call off; a refused call is never counted; two calls racing for the last
// unit of a cap cannot both pass (the class lock, shown blocking). Refused, the agent's run abstains with no model call
// and no error. The shared sandbox ceiling is not built (allow.ts says why). Red-proofs: test/v2/sabotage/core-ai.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type AiRole, aiOpen, allow, allowIn } from '../../../../../packages/core/src/allow.ts';
import type { AgentPort } from '../../../../../packages/agent/src/port.ts';
import { ask } from '../../../../../packages/agent/src/run.ts';
import { scripted } from '../../../../../packages/agent/test/script.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { firstOperator, proposeAndApprove } from '../platform/fixture.ts';

let db: TestDb;
let app: pg.Pool;
const t: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', Tenant> = {} as never;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  const op = await firstOperator(db);
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) t[k] = await signUp(db, `allow-${k}-${Date.now().toString(36)}`);
  await proposeAndApprove(db, op, { kind: 'default_config', set: { ai_enabled: true, ai_daily_calls: 3, media_daily_calls: 2, sandbox_media_daily_calls_total: 5, deployment_daily_calls: 1000 } });
  await proposeAndApprove(db, op, { kind: 'shop_config', tenantId: t.b.tenant, set: { ai_enabled: false, ai_daily_calls: 50, media_daily_calls: 50 } });
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const usage = async (x: Tenant) =>
  Object.fromEntries((await tx(app, { tenant_id: x.tenant }, (c) => c.query('select role, calls from ai.usage order by role'))).rows.map((r) => [r.role, r.calls]));
const ask1 = (x: Tenant, role: AiRole, pool = app) => allow(pool, x.tenant, role, 'on');
// What Ask reads to show or hide its box (no call counted).
const open = (x: Tenant, ai: 'on' | 'off' = 'on') => tx(app, { tenant_id: x.tenant }, (c) => aiOpen(c, x.tenant, ai));

it('the text roles share the shop’s daily text cap: three calls pass, the fourth is refused and not counted', async () => {
  expect(await ask1(t.a, 'router')).toEqual({ ok: true });
  expect(await ask1(t.a, 'reason', db.as('munshi_jobs'))).toEqual({ ok: true }); // the brief's jobs role counts the same way
  expect(await ask1(t.a, 'narrate')).toEqual({ ok: true });
  expect(await ask1(t.a, 'reason')).toEqual({ ok: false, reason: 'cap' });
  expect(await ask1(t.a, 'router')).toEqual({ ok: false, reason: 'cap' });
  expect(await usage(t.a)).toEqual({ narrate: 1, reason: 1, router: 1 });
  expect(await open(t.a)).toEqual({ text: false, media: true }); // the text surfaces hide; media calls are still open
});

it('the media roles have their own cap, and spending it leaves the text cap untouched', async () => {
  expect(await ask1(t.c, 'vision')).toEqual({ ok: true });
  expect(await ask1(t.c, 'segment')).toEqual({ ok: true });
  expect(await ask1(t.c, 'voice')).toEqual({ ok: false, reason: 'cap' });
  expect(await ask1(t.c, 'router')).toEqual({ ok: true });
  expect(await usage(t.c)).toEqual({ router: 1, segment: 1, vision: 1 });
});

it('off is off: the shop’s config switched off, or the deployment’s switch, refuses every role and counts nothing', async () => {
  for (const role of ['router', 'reason', 'narrate', 'vision', 'segment', 'voice'] as const) {
    expect(await ask1(t.b, role), role).toEqual({ ok: false, reason: 'off' });
    expect(await allow(app, t.d.tenant, role, 'off'), role).toEqual({ ok: false, reason: 'off' });
  }
  expect(await usage(t.b)).toEqual({});
  expect(await usage(t.d)).toEqual({});
  expect(await open(t.b)).toEqual({ text: false, media: false });
  expect(await open(t.d, 'off')).toEqual({ text: false, media: false });
  expect(await open(t.d)).toEqual({ text: true, media: true });
  expect(await ask1(t.d, 'router')).toEqual({ ok: true }); // the same shop, the deployment's AI on
});

it('two calls racing for the last text call: the second waits on the first and is refused when it commits', async () => {
  expect(await ask1(t.e, 'router')).toEqual({ ok: true });
  expect(await ask1(t.e, 'router')).toEqual({ ok: true });
  const open = async () => {
    const c = await app.connect();
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [t.e.tenant]);
    return c;
  };
  const first = await open();
  const second = await open();
  try {
    expect(await allowIn(first, t.e.tenant, 'reason', 'on')).toEqual({ ok: true });
    const pid = (await second.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
    let settled = false;
    const racing = allowIn(second, t.e.tenant, 'narrate', 'on').finally(() => {
      settled = true;
    });
    let waiting = false;
    for (let i = 0; i < 100 && !waiting && !settled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const { rows } = await db.admin.query("select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid]);
      waiting = rows.length === 1;
    }
    expect(waiting).toBe(true);
    expect(settled).toBe(false);
    await first.query('commit');
    expect(await racing).toEqual({ ok: false, reason: 'cap' });
    await second.query('commit');
  } finally {
    first.release();
    second.release();
  }
  expect(await usage(t.e)).toEqual({ reason: 1, router: 2 });
});

it('refused, an agent run abstains with no model call and no error, and says why in its trace', async () => {
  for (let i = 0; i < 3; i++) expect(await ask1(t.f, 'router')).toEqual({ ok: true });
  const events: { kind: string; label: string }[] = [];
  const unused = () => {
    throw new Error('a refused run reads nothing');
  };
  const port: AgentPort = {
    read: unused,
    resolve: unused,
    propose: unused,
    finding: unused,
    trace: (e) => {
      events.push({ kind: e.kind, label: e.label });
    },
    allow: async (role) => (await allow(app, t.f.tenant, role, 'on')).ok,
  };
  const { deps } = scripted('allow', []); // no model turn: nothing may be asked
  const reply = await ask('What did I sell yesterday?', { port, asOf: '2026-10-27', deps });
  expect(reply).toEqual({ kind: 'abstain', specialist: null, missing: ['model_error'] });
  expect(events).toEqual([
    { kind: 'budget', label: 'ai_off' },
    { kind: 'abstain', label: 'model_error' },
  ]);
  expect(await usage(t.f)).toEqual({ router: 3 });
});
