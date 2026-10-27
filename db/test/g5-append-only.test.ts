// G5: the books (and the audit log, snapshots and decisions) are append-only for munshi_app: no UPDATE, DELETE or
// TRUNCATE privilege, and every such statement is refused by the grants even with a full command context.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BOOK_TABLES, openTestDb, refused, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

const APPEND_ONLY = [...BOOK_TABLES, 'audit.audit_log', 'snap.snapshot', 'snap.snapshot_cell', 'approval.decision'];

let db: TestDb;
let a: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  await db.sabotage();
});
afterAll(() => db.close());

it('G5 munshi_app holds no UPDATE, DELETE or TRUNCATE privilege on any append-only table', async () => {
  const { rows } = await db.admin.query<{ rel: string; upd: boolean; del: boolean; trunc: boolean }>(
    `select rel, has_any_column_privilege('munshi_app', rel, 'UPDATE') as upd, has_table_privilege('munshi_app', rel, 'DELETE') as del,
            has_table_privilege('munshi_app', rel, 'TRUNCATE') as trunc
       from unnest($1::text[]) as rel`,
    [APPEND_ONLY],
  );
  expect(rows.length).toBe(BOOK_TABLES.length + 4);
  expect(rows.filter((r) => r.upd || r.del || r.trunc).map((r) => r.rel)).toEqual([]);
});

it('G5 UPDATE and DELETE on every append-only table are refused for munshi_app', async () => {
  const ctx = { tenant: a.tenant, actor: a.owner, command: 'journal.post' };
  let refusals = 0;
  for (const table of APPEND_ONLY) {
    expect((await db.admin.query(`select 1 from ${table} where tenant_id = $1`, [a.tenant])).rowCount, `${table} has rows`).toBeGreaterThan(0);
    for (const sql of [`update ${table} set tenant_id = tenant_id where tenant_id = $1`, `delete from ${table} where tenant_id = $1`]) {
      const r = await refused(tx(db.app, ctx, (c) => c.query(sql, [a.tenant])));
      expect(r.code, sql).toBe('42501');
      expect(r.message, sql).toMatch(/^permission denied for table/);
      refusals++;
    }
  }
  console.log(`G5 refused ${refusals} UPDATE/DELETE statements on ${APPEND_ONLY.length} append-only tables`);
  expect(refusals).toBe(2 * APPEND_ONLY.length);
});

it('G5 an INSERT with a direct command is accepted (the paired case)', async () => {
  const { rowCount } = await tx(db.app, { tenant: a.tenant, actor: a.owner, command: 'stock.waste' }, (c) =>
    c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, at) values ($1, $2, -1000, 'waste', now())`, [a.tenant, a.item]),
  );
  expect(rowCount).toBe(1);
});
