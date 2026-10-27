// G9: no function in the munshi schemas is executable by PUBLIC (functions get EXECUTE for PUBLIC by default), the
// agent can execute none, and the functions are exactly the manifest's.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MANIFEST, openTestDb, SCHEMAS, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  await db.sabotage();
});
afterAll(() => db.close());

type Fn = { fn: string; public_exec: boolean; agent_exec: boolean; app_exec: boolean };
const functions = async () =>
  (
    await db.admin.query<Fn>(
      `select n.nspname || '.' || p.proname as fn,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                       where x.grantee = 0 and x.privilege_type = 'EXECUTE') as public_exec,
              has_function_privilege('munshi_agent', p.oid, 'EXECUTE') as agent_exec,
              has_function_privilege('munshi_app', p.oid, 'EXECUTE') as app_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1)`,
      [SCHEMAS],
    )
  ).rows;

it('G9 no function in the munshi schemas grants EXECUTE to PUBLIC', async () => {
  const rows = await functions();
  console.log(`G9 ${rows.length} functions in the munshi schemas; the manifest lists ${MANIFEST.functions.length}`);
  expect(MANIFEST.functions.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.fn).sort()).toEqual([...MANIFEST.functions].sort());
  expect(rows.filter((r) => r.public_exec).map((r) => r.fn)).toEqual([]);
  expect(rows.filter((r) => r.agent_exec).map((r) => r.fn)).toEqual([]);
});

it('G9 the app executes only what it is granted, and the guard triggers still fire without EXECUTE', async () => {
  const rows = await functions();
  expect(rows.filter((r) => r.app_exec).map((r) => r.fn).sort()).toEqual(['audit.entry_hash', 'audit.verify_chain']);
  // books.guard is not executable by munshi_app, yet every book row the fixture wrote went through it (and was audited).
  const { rows: audited } = await tx(db.app, { tenant: a.tenant }, (c) =>
    c.query(`select count(*)::int as n from audit.audit_log where entity like 'books.%'`),
  );
  expect(audited[0].n).toBeGreaterThan(0);
});
