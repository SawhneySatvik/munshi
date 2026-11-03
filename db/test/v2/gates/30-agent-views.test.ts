// 30_agent_views.sql, G1 for the agent's reads: munshi_agent reads only the views (and snap.snapshot, G1's own test),
// each scoped to its tenant; it holds SELECT on every view and nothing else; no view has a numeric column but the
// finding's row index; a person's name shows on a synthetic tenant and is NULL on a live one. Red-proofs:
// test/v2/sabotage/agent-views.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { acceptTenant, asOwner, MANIFEST, privileges, RUNTIME_ROLES, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let g: Filled & Books;
let agent: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  agent = db.as('munshi_agent');
  f = await fillTenant(db, await signUp(db, 'view-shop'));
  g = await fillTenant(db, await signUp(db, 'view-other'));
  await db.sabotage();
});
afterAll(() => db?.close());

const VIEWS = MANIFEST.views;
const BASES: Record<string, string> = {
  'agent_view.item': 'books.item',
  'agent_view.shop': 'ops.shop',
  'agent_view.customer': 'books.customer',
  'agent_view.supplier': 'books.supplier',
  'agent_view.staff': 'books.staff',
  'agent_view.finding': 'ai.finding',
};

it('the agent reads every view, its own tenant’s rows only, and no base table; it holds SELECT on the views and nothing else, and no other role holds anything on them', async () => {
  expect([...VIEWS].sort()).toEqual(Object.keys(BASES).sort());
  for (const view of VIEWS) {
    const base = BASES[view] as string;
    const want = (await db.admin.query(`select count(*)::int as n from ${base} where tenant_id = $1`, [f.tenant])).rows[0].n as number;
    const { rows } = await tx(agent, { tenant_id: f.tenant }, (c) => c.query(`select id from ${view}`));
    expect(rows.length, view).toBe(want);
    expect(want, `${view} has rows to read`).toBeGreaterThan(0);
    const ids = new Set((await db.admin.query(`select id from ${base} where tenant_id = $1`, [g.tenant])).rows.map((r) => r.id));
    expect(rows.filter((r) => ids.has(r.id)), view).toEqual([]);
    expect((await refused(tx(agent, { tenant_id: f.tenant }, (c) => c.query(`select id from ${base}`)))).code, base).toBe('42501');
    for (const role of [...RUNTIME_ROLES, 'munshi_migrator']) {
      expect(await privileges(db.admin, role, view), `${role} on ${view}`).toEqual(role === 'munshi_agent' ? ['SELECT'] : []);
    }
  }
});

it('no view has a numeric column but the finding’s snapshot row index; numbers reach the agent only as cells', async () => {
  const { rows } = await db.admin.query(
    `select table_name || '.' || column_name as col from information_schema.columns
      where table_schema = 'agent_view' and data_type in ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'money') order by 1`,
  );
  expect(rows.map((r) => r.col)).toEqual(['finding.snapshot_row']);
});

it('a person’s name reaches the agent only on a synthetic or showcase tenant; on a live one it is NULL', async () => {
  const names = await tx(agent, { tenant_id: f.tenant }, (c) => c.query(`select name from agent_view.customer where id = $1`, [f.customer]));
  expect(names.rows).toEqual([{ name: 'Customer' }]);
  const live = await openTestDb();
  try {
    await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
    await live.sabotage(); // the live clone is this test's own, so the current red-proof reaches it too
    const t = { tenant: randomUUID(), owner: randomUUID() };
    const liveApp = live.as('munshi_app');
    const customer = await tx(liveApp, { tenant_id: t.tenant, actor_id: t.owner }, async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Live', 'kirana', 'live')`, [t.tenant]);
      await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('live-views', $1)`, [t.tenant]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [t.tenant, t.owner]);
      return t;
    }).then(async () => {
      await acceptTenant(live.admin, t.tenant);
      return tx(liveApp, { tenant_id: t.tenant, actor_id: t.owner, command: 'customer.create' }, async (c) => {
        const k = (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Real Person', '+919811100000') returning id`, [t.tenant])).rows[0]?.id;
        const x = (await c.query<{ id: string }>('insert into books.customer (tenant_id) values ($1) returning id', [t.tenant])).rows[0]?.id;
        await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [t.tenant, x, k]);
        return x;
      });
    });
    const { rows } = await tx(live.as('munshi_agent'), { tenant_id: t.tenant }, (c) => c.query('select id, name from agent_view.customer'));
    expect(rows).toEqual([{ id: customer, name: null }]);
  } finally {
    await live.close();
  }
});
