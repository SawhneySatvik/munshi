import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TestDb } from '../../db.ts';
import { openTestDb, tx } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { firstOperator, type Operator } from './fixture.ts';

let db: TestDb;
let shopA: Tenant;
let shopB: Tenant;
let operator: Operator;
let modelChange: string;
const alias = 'gemini-flash';

beforeAll(async () => {
  db = await openTestDb();
  shopA = await signUp(db, 'model-controls-a');
  shopB = await signUp(db, 'model-controls-b');
  operator = await firstOperator(db);
  modelChange = crypto.randomUUID();
  await plant(
    db.admin,
    `insert into platform.change (id, kind, tenant_id, payload, proposed_by, proposed_txid)
     values ($1, 'model_allow', null, jsonb_build_object('alias', $2::text, 'role', 'reason', 'enabled', true), $3, txid_current())`,
    [modelChange, alias, operator.operatorId],
  );
  await plant(
    db.admin,
    `update platform.change set decided_by = $2, decided_at = now(), verdict = 'approved', decided_txid = txid_current() where id = $1`,
    [modelChange, operator.operatorId],
  );
  await plant(
    db.admin,
    `insert into platform.model_allow (alias, role, enabled, change_id) values ($1, 'reason', true, $2)`,
    [alias, modelChange],
  );
  await db.sabotage();
});
afterAll(() => db?.close());

it('the deployment call count is shared across tenants and never exceeds the approved cap', async () => {
  const day = '2026-10-31';
  const calls = [shopA, shopB, shopA, shopB];
  const result: boolean[] = [];
  for (const shop of calls) {
    const { rows } = await tx(db.as('munshi_app'), { tenant_id: shop.tenant }, (c) =>
      c.query<{ ok: boolean }>('select platform.count_ai_call($1::date, 3) as ok', [day]),
    );
    result.push(rows[0]?.ok === true);
  }
  expect(result).toEqual([true, true, true, false]);
  expect((await db.admin.query('select calls from platform.ai_usage_total where day = $1', [day])).rows[0]?.calls).toBe(3);
  await expect(tx(db.as('munshi_agent'), {}, (c) => c.query('select platform.count_ai_call($1::date, 3)', [day]))).rejects.toThrow(/permission denied/i);
});

it('only an active owner running model.choose may choose an enabled alias for an agent', async () => {
  const insert = (tenant: Tenant, actor: string, command: string, modelAlias = alias) =>
    tx(db.as('munshi_app'), { tenant_id: tenant.tenant, actor_id: actor, command }, (c) =>
      c.query<{ id: string; chosen_by: string; alias: string }>(
        `insert into ops.model_choice (tenant_id, agent, alias, chosen_by)
         values ($1, 'ask', $2, $3) returning id::text, chosen_by::text, alias`,
        [tenant.tenant, modelAlias, actor],
      ),
    );

  await expect(insert(shopA, shopA.owner, 'settings.change')).rejects.toThrow(/model choice refused/);
  await expect(insert(shopA, shopA.manager, 'model.choose')).rejects.toThrow(/model choice refused/);
  const { rows } = await insert(shopA, shopA.owner, 'model.choose');
  expect(rows[0]).toMatchObject({ chosen_by: shopA.owner, alias });
  const audit = await tx(db.as('munshi_app'), { tenant_id: shopA.tenant }, (c) =>
    c.query<{ n: number }>("select count(*)::int as n from audit.audit_log where action = 'model.choose' and entity_id = $1", [rows[0]?.id]),
  );
  expect(audit.rows[0]?.n).toBe(1);
  const other = await tx(db.as('munshi_app'), { tenant_id: shopB.tenant }, (c) =>
    c.query<{ n: number }>('select count(*)::int as n from ops.model_choice where tenant_id = $1', [shopA.tenant]),
  );
  expect(other.rows[0]?.n).toBe(0);

  const disabledAlias = 'gemini-disabled';
  await plant(db.admin, `insert into platform.model_allow (alias, role, enabled, change_id) values ($1, 'reason', false, $2)`, [disabledAlias, modelChange]);
  await expect(insert(shopA, shopA.owner, 'model.choose', disabledAlias)).rejects.toThrow(/model choice refused/);
});

it('settlement imports are tenant-scoped, unique by file hash, audited, and limited to owners and managers', async () => {
  const insert = (tenant: Tenant, actor: string, sha256: string) =>
    tx(db.as('munshi_app'), { tenant_id: tenant.tenant, actor_id: actor, command: 'settlement.import' }, (c) =>
      c.query<{ id: string; imported_by: string }>(
        `insert into ops.import_file (tenant_id, sha256, rows, imported_by)
         values ($1, $2, 1, $3) returning id::text, imported_by::text`,
        [tenant.tenant, sha256, actor],
      ),
    );
  const hashA = 'a'.repeat(64);
  const first = await insert(shopA, shopA.owner, hashA);
  expect(first.rows[0]?.imported_by).toBe(shopA.owner);
  const managerHash = 'b'.repeat(64);
  expect((await insert(shopA, shopA.manager, managerHash)).rows[0]?.imported_by).toBe(shopA.manager);
  await expect(insert(shopA, shopA.manager, hashA)).rejects.toThrow(/duplicate key/i);
  await expect(insert(shopA, shopA.staff, 'c'.repeat(64))).rejects.toThrow(/import refused/);
  const audit = await tx(db.as('munshi_app'), { tenant_id: shopA.tenant }, (c) =>
    c.query<{ n: number }>("select count(*)::int as n from audit.audit_log where action = 'settlement.import'"),
  );
  expect(audit.rows[0]?.n).toBe(2);
  const other = await tx(db.as('munshi_app'), { tenant_id: shopB.tenant }, (c) =>
    c.query<{ n: number }>('select count(*)::int as n from ops.import_file where tenant_id = $1', [shopA.tenant]),
  );
  expect(other.rows[0]?.n).toBe(0);
});
