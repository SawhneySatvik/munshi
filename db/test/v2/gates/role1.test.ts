// ROLE1 for the tables of files 03–09 (BLUEPRINT §2.3): an actor shape is admitted only as munshi_app, a no-actor shape
// only as munshi_jobs, a public shape only as munshi_public; a jobs or public session that sets munshi.actor_id is
// refused. Each shape is tried as the roles it does not belong to (a missing grant, 42501, counts as refused too), and
// then once as its own role. Red-proofs: test/v2/sabotage/role.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, type Filled, fillTenant, plantProbeCommand, rowsOf, sha, signUp } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let f: Filled;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  f = await fillTenant(db, await signUp(db, 'role-shop'));
  // Rows old enough for the purges to admit, so each own-role case can succeed.
  await plant(db.admin, `update ops.contact set created_at = now() - interval '2 years' where id = $1`, [f.contact]);
  await plant(db.admin, `update ops.document set purge_after = now() - interval '1 day' where id = $1`, [f.document]);
  await db.sabotage();
});
afterAll(() => db?.close());

type Shape = { name: string; sql: string; params: () => unknown[]; own: string; ownActor: boolean; wrong: [string, boolean, string][] };

// [role, sets an actor, expected refusal]
const SHAPES: Shape[] = [
  {
    name: 'a person adds a contact',
    sql: `insert into ops.contact (tenant_id, name) values ($1, 'Walk-in')`,
    params: () => [f.tenant],
    own: 'munshi_app',
    ownActor: true,
    wrong: [['munshi_app', false, 'MS007'], ['munshi_jobs', true, '42501'], ['munshi_public', false, '42501']],
  },
  {
    name: 'the purge erases a contact',
    sql: `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where tenant_id = $1 and id = $2`,
    params: () => [f.tenant, f.contact],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_jobs', true, 'MS018']],
  },
  {
    name: 'the purge erases a document',
    sql: `update ops.document set storage_key = null, erased_at = now() where tenant_id = $1 and id = $2`,
    params: () => [f.tenant, f.document],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_jobs', true, 'MS018']],
  },
  {
    name: 'the public stores an inbound voice note',
    sql: `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'voice', 'inbound', $2, $3, 'audio/ogg', 900)`,
    params: () => [f.tenant, `t-${f.tenant}/voice/${randomUUID()}.ogg`, sha(randomUUID())],
    own: 'munshi_public',
    ownActor: false,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_app', true, 'MS018'], ['munshi_public', true, 'MS018'], ['munshi_jobs', false, '42501']],
  },
  {
    name: 'a reset link is used on the public route',
    sql: `update ops.reset_grant set used_at = now() where tenant_id = $1 and id = $2`,
    params: () => [f.tenant, f.resetGrant],
    own: 'munshi_public',
    ownActor: false,
    wrong: [['munshi_public', true, 'MS018'], ['munshi_app', true, '42501'], ['munshi_jobs', false, '42501']],
  },
  {
    name: 'a member mints a display snapshot',
    sql: `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count) values ($1, 'sale.day', '{}', 'display', $2, $3, '\\x00', '\\x00', 0)`,
    params: () => [f.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('10'))],
    own: 'munshi_app',
    ownActor: true,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_jobs', true, 'MS018'], ['munshi_jobs', false, 'MS018'], ['munshi_public', false, '42501']],
  },
  {
    name: 'a watcher run mints a watch snapshot',
    sql: `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count) values ($1, 'watch.stock', '{}', 'watch', $2, $3, '\\x00', '\\x00', 0)`,
    params: () => [f.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('11'))],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', true, 'MS018']],
  },
  {
    name: 'a watcher run raises a finding',
    sql: `insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id)
          values ($1, 'stock', 'shrinkage', $2, 'low', $3, 0, '\\x00', 'amount', $4, $4)`,
    params: () => [f.tenant, `role:${randomUUID()}`, f.watchSnapshot, f.jobsRun],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', true, '42501']],
  },
  {
    name: 'a member snoozes a finding',
    sql: `update ai.finding set status = 'snoozed', snoozed_until = now() + interval '1 day' where tenant_id = $1 and id = $2`,
    params: () => [f.tenant, f.finding],
    own: 'munshi_app',
    ownActor: true,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_jobs', true, '42501']],
  },
  {
    name: 'a run starts',
    sql: `insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock')`,
    params: () => [f.tenant],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', false, 'MS018'], ['munshi_public', false, '42501']],
  },
  {
    name: 'a run writes its answer',
    sql: `insert into ai.answer (tenant_id, run_id, kind, verdict) values ($1, $2, 'brief_line', 'abstained')`,
    params: () => [f.tenant, f.jobsRun],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', false, 'MS018']],
  },
  {
    name: 'a template text is written',
    sql: `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, 'Your order is ready', 'template', '\\x00')`,
    params: () => [f.tenant],
    own: 'munshi_jobs',
    ownActor: false,
    wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', false, 'MS018']],
  },
  {
    name: 'a member opens a session',
    sql: `insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, 'demo', now() + interval '1 hour')`,
    params: () => [f.tenant, f.owner],
    own: 'munshi_app',
    ownActor: true,
    wrong: [['munshi_app', false, 'MS018']],
  },
  {
    name: 'the owner switches a capability',
    sql: `insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'stock', true)`,
    params: () => [f.tenant],
    own: 'munshi_app',
    ownActor: true,
    wrong: [['munshi_app', false, 'MS018'], ['munshi_jobs', true, '42501']],
  },
];

it('ROLE1 every role-shaped transition of files 03–09 is refused for every role it does not belong to, and for a jobs or public session that names an actor', async () => {
  let refusals = 0;
  for (const s of SHAPES) {
    for (const [role, actor, code] of s.wrong) {
      const ctx = actor ? { tenant_id: f.tenant, actor_id: f.owner } : { tenant_id: f.tenant };
      const r = await refused(tx(db.as(role), ctx, (c) => c.query(s.sql, s.params())));
      expect(r.code, `${s.name}, as ${role}${actor ? ' with an actor' : ''}: ${r.message}`).toBe(code);
      refusals++;
    }
  }
  const expected = SHAPES.reduce((n, s) => n + s.wrong.length, 0);
  console.log(`ROLE1 ${refusals} wrong-role attempts refused over ${SHAPES.length} shapes`);
  expect(refusals).toBe(expected);
  expect(SHAPES.filter((s) => s.wrong.some(([role, actor]) => role !== 'munshi_app' && actor)).length).toBeGreaterThan(8);
});

it('ROLE1 each shape is admitted for its own role', async () => {
  for (const s of SHAPES) {
    const ctx = s.ownActor ? { tenant_id: f.tenant, actor_id: f.owner } : { tenant_id: f.tenant };
    const extra = s.name.startsWith('a reset link') ? { reset_token: f.resetToken } : {};
    const r = await tx(db.as(s.own), { ...ctx, ...extra }, (c) => c.query(s.sql, s.params()));
    expect(r.rowCount, s.name).toBe(1);
  }
});

it('ROLE1 no role writes ops.subject_summary directly: only the login, reset and operator triggers do', async () => {
  const attempts: [string, Record<string, string>, string][] = [
    // relabel an identity as a one-shop staff identity, so an in-app reset would reach it
    ['munshi_app', { tenant_id: f.tenant, actor_id: f.owner }, `update ops.subject_summary set highest_role = 'staff', memberships = 1 where subject = $1`],
    ['munshi_app', { tenant_id: f.tenant, actor_id: f.owner }, `insert into ops.subject_summary (provider, subject, memberships) values ('password', $1 || '-x', 1)`],
    ['munshi_public', { tenant_id: f.tenant }, 'update ops.subject_summary set epoch = epoch + 1 where subject = $1'],
    ['munshi_platform', {}, 'update ops.subject_summary set is_operator = true where subject = $1'],
  ];
  const summary = async () =>
    (await db.admin.query('select memberships, highest_role, epoch, is_operator from ops.subject_summary where subject = $1', [f.subject])).rows;
  const before = await summary();
  expect(before).toEqual([{ memberships: 1, highest_role: 'staff', epoch: expect.any(Number), is_operator: false }]);
  for (const [role, ctx, sql] of attempts) {
    const r = await refused(tx(db.as(role), ctx, (c) => c.query(sql, [f.subject])));
    expect(r.code, `${role}: ${sql}`).toBe('MS018');
  }
  expect(await summary()).toEqual(before);
});
