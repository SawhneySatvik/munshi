// G1: the agent role holds no write privilege on any table, can create nothing (no temporary table, no object in a
// schema, no large object), and every write it attempts is refused; the tables checked are exactly the manifest.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MANIFEST, openTestDb, refused, SCHEMAS, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  await db.sabotage();
});
afterAll(() => db.close());

it('G1 the manifest lists exactly the tables and views in the munshi schemas', async () => {
  const { rows } = await db.admin.query<{ rel: string; relkind: string }>(
    `select n.nspname || '.' || c.relname as rel, c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
    [SCHEMAS],
  );
  const tables = rows.filter((r) => r.relkind === 'r' || r.relkind === 'p').map((r) => r.rel).sort();
  const views = rows.filter((r) => r.relkind === 'v').map((r) => r.rel).sort();
  console.log(`G1 manifest: ${MANIFEST.tables.length} tables, ${MANIFEST.views.length} views; catalog: ${tables.length} tables, ${views.length} views`);
  expect(MANIFEST.tables.length).toBeGreaterThan(0);
  expect(tables).toEqual([...MANIFEST.tables].sort());
  expect(views).toEqual([...MANIFEST.views].sort());
  expect(rows.length).toBe(tables.length + views.length); // no materialized or foreign tables
});

it('G1 the agent holds no INSERT, UPDATE, DELETE or TRUNCATE privilege on any table or view', async () => {
  const relations = [...MANIFEST.tables, ...MANIFEST.views];
  const { rows } = await db.admin.query<{ rel: string; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
    `select rel,
            has_any_column_privilege('munshi_agent', rel, 'INSERT') as ins,
            has_any_column_privilege('munshi_agent', rel, 'UPDATE') as upd,
            has_table_privilege('munshi_agent', rel, 'DELETE') as del,
            has_table_privilege('munshi_agent', rel, 'TRUNCATE') as trunc
       from unnest($1::text[]) as rel`,
    [relations],
  );
  expect(rows.length).toBe(relations.length);
  expect(rows.filter((r) => r.ins || r.upd || r.del || r.trunc).map((r) => r.rel)).toEqual([]);
});

it('G1 the agent is refused INSERT, UPDATE and DELETE on every table', async () => {
  const firstColumn = await db.admin.query<{ rel: string; col: string }>(
    `select rel, (select a.attname from pg_attribute a where a.attrelid = rel::regclass and a.attnum = 1) as col
       from unnest($1::text[]) as rel`,
    [MANIFEST.tables],
  );
  const refusals: string[] = [];
  for (const { rel, col } of firstColumn.rows) {
    for (const sql of [`insert into ${rel} default values`, `update ${rel} set ${col} = ${col}`, `delete from ${rel}`]) {
      const r = await refused(tx(db.agent, { tenant: a.tenant }, (c) => c.query(sql)));
      expect(r.code, sql).toBe('42501');
      expect(r.message, sql).toMatch(/^permission denied for (table|schema)/);
      refusals.push(sql);
    }
  }
  console.log(`G1 agent refused ${refusals.length} writes on ${MANIFEST.tables.length} tables`);
  expect(refusals.length).toBe(3 * MANIFEST.tables.length);
});

it('G1 the agent can create nothing: no temporary table, no object in any schema, no large object', async () => {
  const lo = await db.admin.query<{ fn: string; exec: boolean }>(
    `select p.oid::regprocedure::text as fn, has_function_privilege('munshi_agent', p.oid, 'EXECUTE') as exec
       from pg_proc p where p.pronamespace = 'pg_catalog'::regnamespace and (p.proname like 'lo\\_%' or p.proname in ('loread', 'lowrite'))`,
  );
  console.log(`G1 ${lo.rows.length} large-object functions, ${lo.rows.filter((r) => r.exec).length} executable by the agent`);
  expect(lo.rows.length).toBeGreaterThan(0);
  expect(lo.rows.filter((r) => r.exec).map((r) => r.fn)).toEqual([]);
  const creatable = await db.admin.query(`select nspname from pg_namespace where has_schema_privilege('munshi_agent', oid, 'CREATE')`);
  expect(creatable.rows).toEqual([]);
  const temp = await db.admin.query(`select has_database_privilege('munshi_agent', current_database(), 'TEMPORARY') as temp`);
  expect(temp.rows[0].temp).toBe(false);
  const attempts: [string, RegExp][] = [
    ['create temp table scratch (a int)', /^permission denied to create temporary tables/],
    ['create table public.scratch (a int)', /^permission denied for schema public/],
    ["select lo_from_bytea(0, '\\x00')", /^permission denied for function lo_from_bytea/],
    ['select lo_create(0)', /^permission denied for function lo_create/],
  ];
  for (const [sql, message] of attempts) {
    const r = await refused(tx(db.agent, { tenant: a.tenant }, (c) => c.query(sql)));
    expect(r.code, sql).toBe('42501');
    expect(r.message, sql).toMatch(message);
  }
});

it('G1 the agent can read snapshots and its views (the accepted case)', async () => {
  await tx(db.agent, { tenant: a.tenant }, async (c) => {
    expect((await c.query('select * from snap.snapshot')).rowCount).toBeGreaterThan(0);
    expect((await c.query('select * from snap.snapshot_cell')).rowCount).toBeGreaterThan(0);
    for (const view of MANIFEST.views) expect((await c.query(`select * from ${view}`)).rowCount, view).toBeGreaterThan(0);
  });
});
