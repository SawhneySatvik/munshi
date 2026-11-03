// The model role set (W2-C, M2: the speak role). SPEAK1 (every check in the schema that lists the model roles lists the
// same ones, speak among them, on exactly the role tables), SPEAK2 (the speak desk, and a read-aloud's own run, a
// member's), SPEAK3 (an approved allow-list row and an owner's choice for speak; an alias allowed only for another role is
// refused; a role outside the set is refused) and SPEAK4 (the role checks of ai.usage and ai.spend). Whether a speak call
// counts against a cap is core's allow(), not tested here. D-081's two roles (M4): ROLES1 (the documents and shelf_video
// desks serve document and video, a clip's run starts under the photo trigger, and an owner chooses an allowed model for
// each desk while an alias of another role is refused) and ROLES2 (ai.usage and ai.spend take both roles). Red-proofs:
// test/v2/sabotage/spend.ts and test/v2/sabotage/surplus.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { sha, signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let a: Tenant;
let platform: pg.Pool;
let operator: string;

// The one role set, as PostgreSQL reads every role check back.
const ROLES = ['router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video'];
const ROLE_CHECK = `CHECK ((role = ANY (ARRAY[${ROLES.map((r) => `'${r}'::text`).join(', ')}])))`;
const ROLE_TABLES = ['ai.usage', 'ai.spend', 'platform.model_allow', 'ref.ai_agent'];

beforeAll(async () => {
  db = await openTestDb();
  platform = db.as('munshi_platform');
  a = await signUp(db, 'speak-a');
  // The first operator, seeded as the owner role while none exists (`pnpm platform:operator`).
  const subject = randomUUID();
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(`insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, '{}', now())`, [
      subject,
      sha(subject),
      randomBytes(64),
      randomBytes(16),
    ]);
    const r = await c.query<{ id: string }>(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Founder', $2) returning id`, [
      subject,
      randomBytes(32),
    ]);
    operator = r.rows[0]?.id as string;
  } finally {
    await c.query('reset role');
    c.release();
  }
  await db.sabotage();
});
afterAll(() => db?.close());

const op = (extra: Record<string, string> = {}) => ({ operator_id: operator, ...extra });
// Proposed in one transaction; decided, then the allow-list row written, in a later one, as the platform role and this
// operator.
async function allowRow(alias: string, role: string, enabled = true) {
  const payload = { alias, role, enabled };
  const id = await tx(platform, op(), async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, payload, proposed_by, proposed_txid) values ('model_allow', $1, $2, 0) returning id`, [
        JSON.stringify(payload),
        operator,
      ])
    ).rows[0]?.id as string,
  );
  await tx(platform, op({ platform_change_id: id }), async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [id, operator]);
    await c.query(`insert into platform.model_allow (alias, role, enabled, change_id) values ($1, $2, $3, $4)`, [alias, role, enabled, randomUUID()]);
  });
  return id;
}
const choose = (agent: string, alias: string) =>
  tx(db.as('munshi_app'), { tenant_id: a.tenant, actor_id: a.owner, command: 'model.choose' }, (c) =>
    c.query<{ agent: string; alias: string }>(`insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, $2, $3, $4) returning agent, alias`, [
      a.tenant,
      agent,
      alias,
      a.owner,
    ]),
  );
const newRun = (trigger: string, desk: string) =>
  tx(db.as('munshi_app'), { tenant_id: a.tenant, actor_id: a.owner }, async (c) =>
    (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, $2, $3) returning id`, [a.tenant, trigger, desk])).rows[0]?.id as string,
  );

it('SPEAK1 every check that lists the model roles lists exactly the same ones, speak among them, on the role tables only', async () => {
  // Found, not named: every CHECK in the database whose definition names a role only the model role set has.
  const { rows } = await db.admin.query<{ rel: string; def: string }>(
    `select c.conrelid::regclass::text as rel, pg_get_constraintdef(c.oid) as def
       from pg_constraint c
      where c.contype = 'c' and (strpos(pg_get_constraintdef(c.oid), '''narrate''') > 0 or strpos(pg_get_constraintdef(c.oid), '''segment''') > 0)
      order by 1, 2`,
  );
  expect(rows).toEqual([...ROLE_TABLES].sort().map((rel) => ({ rel, def: ROLE_CHECK })));
});

it("SPEAK2 the speak desk serves the speak role, and a read-aloud starts its own run under the speak trigger, a member's only", async () => {
  const { rows } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) => c.query(`select agent, role from ref.ai_agent where role = 'speak'`));
  expect(rows).toEqual([{ agent: 'speak', role: 'speak' }]);
  const run = await newRun('speak', 'speak');
  const { rows: started } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) =>
    c.query('select trigger, desk, started_by::text from ai.run where id = $1', [run]),
  );
  expect(started).toEqual([{ trigger: 'speak', desk: 'speak', started_by: a.owner }]);
  expect((await refused(newRun('read_aloud', 'speak'))).code, 'a trigger outside the set').toBe('23514');
  // A speak run is a member's: the jobs role, which has no actor, cannot start one (it still starts its own kinds).
  const jobsRun = (trigger: string) =>
    tx(db.as('munshi_jobs'), { tenant_id: a.tenant }, (c) => c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, $2, $2)`, [a.tenant, trigger]));
  expect((await refused(jobsRun('speak'))).code, 'a speak run by the jobs role').toBe('23514');
  expect((await jobsRun('brief')).rowCount).toBe(1);
});

it('SPEAK3 an approved allow-list row for speak, and an owner choosing it for the speak desk, are taken; another role or set is refused', async () => {
  await allowRow('voice-out', 'speak');
  const { rows } = await tx(platform, op(), (c) => c.query(`select alias, role, enabled from platform.model_allow where alias = 'voice-out'`));
  expect(rows).toEqual([{ alias: 'voice-out', role: 'speak', enabled: true }]);
  expect((await choose('speak', 'voice-out')).rows).toEqual([{ agent: 'speak', alias: 'voice-out' }]);
  // An alias enabled for another role only is no choice for the speak desk, and a speak alias none for a reason desk.
  await allowRow('text-only', 'reason');
  expect((await refused(choose('speak', 'text-only'))).code, 'a reason alias for speak').toBe('MS007');
  expect((await refused(choose('ask', 'voice-out'))).code, 'a speak alias for ask').toBe('MS007');
  // A role outside the set, even under an approved change for exactly that row.
  expect((await refused(allowRow('voice-out', 'painter'))).code, 'a role outside the set').toBe('23514');
});

it('SPEAK4 the role checks of ai.usage and ai.spend admit speak and refuse a role outside the set', async () => {
  const run = await newRun('speak', 'speak');
  const ctx = { tenant_id: a.tenant, actor_id: a.owner };
  const usage = (role: string) =>
    tx(db.as('munshi_app'), ctx, (c) =>
      c.query(`insert into ai.usage (tenant_id, day, role, calls) values ($1, current_date, $2, 1)
               on conflict (tenant_id, day, role) do update set calls = ai.usage.calls + 1 returning role, calls`, [a.tenant, role]),
    );
  const spend = (role: string) =>
    tx(db.as('munshi_app'), ctx, (c) =>
      c.query(`insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out) values ($1, $2, $3, 'voice-out', 120, 0) returning role, alias`, [
        a.tenant,
        run,
        role,
      ]),
    );
  expect((await usage('speak')).rows).toEqual([{ role: 'speak', calls: 1 }]);
  expect((await spend('speak')).rows).toEqual([{ role: 'speak', alias: 'voice-out' }]);
  expect((await refused(usage('painter'))).code, 'ai.usage').toBe('23514');
  expect((await refused(spend('painter'))).code, 'ai.spend').toBe('23514');
});

it('ROLES1 the documents and shelf_video desks serve the document and video roles; a clip runs under photo; an owner chooses an allowed model for each', async () => {
  const { rows } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) =>
    c.query(`select agent, role from ref.ai_agent where role in ('document', 'video') order by agent`),
  );
  expect(rows).toEqual([
    { agent: 'documents', role: 'document' },
    { agent: 'shelf_video', role: 'video' },
  ]);
  const run = await newRun('photo', 'shelf_video');
  const { rows: started } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) => c.query('select trigger, desk from ai.run where id = $1', [run]));
  expect(started).toEqual([{ trigger: 'photo', desk: 'shelf_video' }]);
  await allowRow('pdf-reader', 'document');
  await allowRow('clip-counter', 'video');
  expect((await choose('documents', 'pdf-reader')).rows).toEqual([{ agent: 'documents', alias: 'pdf-reader' }]);
  expect((await choose('shelf_video', 'clip-counter')).rows).toEqual([{ agent: 'shelf_video', alias: 'clip-counter' }]);
  // Each desk takes only an alias allowed for its own role.
  expect((await refused(choose('documents', 'clip-counter'))).code, 'a video alias for documents').toBe('MS007');
  expect((await refused(choose('shelf_video', 'pdf-reader'))).code, 'a document alias for shelf_video').toBe('MS007');
  expect((await refused(choose('bills', 'pdf-reader'))).code, 'a document alias for the vision desk').toBe('MS007');
});

it('ROLES2 the role checks of ai.usage and ai.spend admit document and video', async () => {
  const run = await newRun('photo', 'documents');
  const ctx = { tenant_id: a.tenant, actor_id: a.owner };
  for (const role of ['document', 'video']) {
    const usage = await tx(db.as('munshi_app'), ctx, (c) =>
      c.query(`insert into ai.usage (tenant_id, day, role, calls) values ($1, current_date, $2, 1) returning role`, [a.tenant, role]),
    );
    expect(usage.rows, role).toEqual([{ role }]);
    const spend = await tx(db.as('munshi_app'), ctx, (c) =>
      c.query(`insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out) values ($1, $2, $3, 'pdf-reader', 10, 2) returning role`, [a.tenant, run, role]),
    );
    expect(spend.rows, role).toEqual([{ role }]);
  }
});
