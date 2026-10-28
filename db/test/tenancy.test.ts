// MS-19a, 0010: a tenant's class against the database's deployment (T1), the global tables nobody but the owner writes
// (T2), the global tables' privileges (G13), and no function running with its owner's rights (G9). Three databases: no
// deployment row (dev and the tests: demo), an explicit demo row, and a live one.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrationsDir } from '../src/migrate.ts';
import { type Ctx, MANIFEST, openTestDb, refused, SCHEMAS, setCtx, type TestDb, tx } from './db.ts';

type Shop = { tenant: string; owner: string };
let demo: TestDb; // no ops.deployment row
let demoRow: TestDb; // ops.deployment = demo
let live: TestDb; // ops.deployment = live

// As munshi_owner (what provisioning logs in as), in one transaction, optionally under a tenant's context.
async function owner(db: TestDb, sql: string, params: unknown[] = [], ctx: Ctx = {}): Promise<pg.QueryResult> {
  const c = await db.admin.connect();
  try {
    await c.query('begin');
    await c.query('set local role munshi_owner');
    await setCtx(c, ctx);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

// A tenant of the given class, created the way core's sign-up does: the owner adding themself.
const tenantOf = async (db: TestDb, dataClass: string, businessType = 'kirana'): Promise<Shop> => {
  const s = { tenant: randomUUID(), owner: randomUUID() };
  await tx(db.app, { tenant: s.tenant, actor: s.owner }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, $2, $3, $4)', [
      s.tenant,
      `A ${dataClass} shop`,
      businessType,
      dataClass,
    ]);
    await c.query(`insert into ops.member (tenant_id, id, name, role) values ($1, $2, 'Owner (synthetic)', 'owner')`, [s.tenant, s.owner]);
  });
  return s;
};

beforeAll(async () => {
  [demo, demoRow, live] = await Promise.all([openTestDb(), openTestDb(), openTestDb()]);
  await owner(demoRow, "insert into ops.deployment (kind) values ('demo')");
  await owner(live, "insert into ops.deployment (kind) values ('live')");
  for (const db of [demo, demoRow, live]) await db.sabotage();
});
afterAll(() => Promise.all([demo, demoRow, live].map((db) => db.close())));

const CLASS = { code: 'MS010', message: expect.stringMatching(/^tenant refused: a (synthetic|showcase|live) tenant does not belong in a (demo|live) database$/) };

it('T1 a live tenant only in a live database, and no other kind there', async () => {
  for (const db of [demo, demoRow]) {
    expect(await refused(tenantOf(db, 'live'))).toEqual(CLASS);
    await tenantOf(db, 'synthetic');
    await tenantOf(db, 'showcase', 'salon');
  }
  expect(await refused(tenantOf(live, 'synthetic'))).toEqual(CLASS);
  expect(await refused(tenantOf(live, 'showcase', 'apparel'))).toEqual(CLASS);
  const l = await tenantOf(live, 'live', 'salon');
  const { rows } = await live.admin.query('select data_class, business_type from ops.tenant where tenant_id = $1', [l.tenant]);
  expect(rows).toEqual([{ data_class: 'live', business_type: 'salon' }]);
});

it('T1 business_type and data_class never change, even for the owner', async () => {
  const s = await tenantOf(demo, 'synthetic');
  for (const set of ["data_class = 'showcase'", "business_type = 'apparel'", "data_class = 'synthetic', business_type = 'salon'"]) {
    const r = await refused(owner(demo, `update ops.tenant set ${set} where tenant_id = $1`, [s.tenant], { tenant: s.tenant }));
    expect(r, set).toEqual({ code: 'MS010', message: 'tenant refused: business_type and data_class are fixed when the tenant is created' });
  }
  // The owner's other updates still work (count_max_age, 0009), and the row still reads as created.
  const ok = await owner(demo, "update ops.tenant set count_max_age = interval '2 hours' where tenant_id = $1", [s.tenant], { tenant: s.tenant });
  expect(ok.rowCount).toBe(1);
  const { rows } = await demo.admin.query('select data_class, business_type from ops.tenant where tenant_id = $1', [s.tenant]);
  expect(rows).toEqual([{ data_class: 'synthetic', business_type: 'kirana' }]);
});

it('T1 ops.deployment is one row and never changes, even for the owner', async () => {
  for (const sql of ["update ops.deployment set kind = 'demo'", 'delete from ops.deployment', 'truncate ops.deployment']) {
    expect(await refused(owner(live, sql)), sql).toEqual({ code: 'MS010', message: 'deployment refused: a database never changes its deployment kind' });
  }
  expect((await live.admin.query('select kind from ops.deployment')).rows).toEqual([{ kind: 'live' }]);
});

it('T1 the deployment row comes before any tenant: a database holding tenants is never given a kind', async () => {
  const fresh = await openTestDb();
  await fresh.sabotage();
  try {
    expect((await refused(owner(fresh, 'insert into ops.deployment (one, kind) values (false, $1)', ['live']))).code).toBe('23514');
    await owner(fresh, "insert into ops.deployment (kind) values ('demo')"); // before any tenant: accepted, once
    expect((await refused(owner(fresh, "insert into ops.deployment (kind) values ('live')"))).code).toBe('23505');
    const late = await openTestDb();
    await late.sabotage();
    try {
      await tenantOf(late, 'synthetic'); // a synthetic shop first, as a demo database holds
      for (const kind of ['live', 'demo']) {
        expect(await refused(owner(late, 'insert into ops.deployment (kind) values ($1)', [kind])), kind).toEqual({
          code: 'MS010',
          message: 'deployment refused: the deployment row comes before any tenant',
        });
      }
      expect((await late.admin.query('select count(*)::int as n from ops.deployment')).rows[0].n).toBe(0);
    } finally {
      await late.close();
    }
  } finally {
    await fresh.close();
  }
});

it("T2 the app cannot write either global table, nor change a tenant's business_type or data_class", async () => {
  const s = await tenantOf(demoRow, 'synthetic');
  await owner(demoRow, "insert into ops.tenant_directory (slug, tenant_id) values ('w-shop', $1)", [s.tenant]);
  const attempts: [string, unknown[]][] = [
    ["insert into ops.deployment (kind) values ('live')", []],
    ["update ops.deployment set kind = 'live'", []],
    ['delete from ops.deployment', []],
    ['truncate ops.deployment', []],
    ["insert into ops.tenant_directory (slug, tenant_id) values ('x-shop', $1)", [s.tenant]],
    ["update ops.tenant_directory set slug = 'y-shop' where tenant_id = $1", [s.tenant]],
    ['delete from ops.tenant_directory where tenant_id = $1', [s.tenant]],
    ['truncate ops.tenant_directory', []],
    ["update ops.tenant set data_class = 'live' where tenant_id = $1", [s.tenant]],
    ["update ops.tenant set business_type = 'salon' where tenant_id = $1", [s.tenant]],
  ];
  for (const [sql, params] of attempts) {
    const r = await refused(tx(demoRow.app, { tenant: s.tenant, actor: s.owner }, (c) => c.query(sql, params)));
    expect(r.code, sql).toBe('42501');
    expect(r.message, sql).toMatch(/^permission denied for table (deployment|tenant_directory|tenant)$/);
  }
  console.log(`T2 refused ${attempts.length} writes by the app to the global tables and the tenant's class`);
  expect((await demoRow.admin.query('select kind from ops.deployment')).rows).toEqual([{ kind: 'demo' }]);
  expect((await demoRow.admin.query('select slug from ops.tenant_directory')).rows).toEqual([{ slug: 'w-shop' }]);
});

it('T2 the directory is read with no tenant context, names a tenant once, and its foreign key sees a tenant RLS hides from the owner', async () => {
  const a = await tenantOf(demo, 'showcase', 'apparel');
  const b = await tenantOf(demo, 'synthetic');
  // No tenant context: forced RLS shows munshi_owner no ops.tenant row, yet the foreign key check finds the tenant.
  expect((await owner(demo, 'select count(*)::int as n from ops.tenant')).rows[0].n).toBe(0);
  await owner(demo, "insert into ops.tenant_directory (slug, tenant_id) values ('suit-shop', $1)", [a.tenant]);
  expect((await refused(owner(demo, "insert into ops.tenant_directory (slug, tenant_id) values ('no-shop', $1)", [randomUUID()]))).code).toBe('23503');
  expect((await refused(owner(demo, "insert into ops.tenant_directory (slug, tenant_id) values ('suit-shop-2', $1)", [a.tenant]))).code).toBe('23505');
  for (const slug of ['Suit-Shop', 'su', '9-shop', 'suit shop', 'a'.repeat(41)]) {
    expect((await refused(owner(demo, 'insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [slug, b.tenant]))).code, slug).toBe('23514');
  }
  const { rows } = await tx(demo.app, {}, (c) => c.query('select slug, tenant_id from ops.tenant_directory'));
  expect(rows).toEqual([{ slug: 'suit-shop', tenant_id: a.tenant }]);
});

// 0010's own ops.member_audit (0013 replaces it again, so the live function is 0013's): installed from the file, it
// chains a new member as {member_id, role}; 0007's, installed the same way, chained the name and the phone.
const fnFrom = (file: string) => {
  const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
  const m = sql.match(/create (or replace )?function ops\.member_audit\(\)[\s\S]*?end \$\$;/);
  if (!m) throw new Error(`${file} defines no ops.member_audit`);
  return m[0].replace(/^create (or replace )?function/, 'create or replace function');
};

it('T0 the ops.member_audit 0010 installs chains a member as {member_id, role}; the one 0007 installed chained the name', async () => {
  const s = await tenantOf(demoRow, 'synthetic');
  const payloadOf = async (file: string, name: string) => {
    await owner(demoRow, fnFrom(file));
    const id = randomUUID();
    await tx(demoRow.app, { tenant: s.tenant, actor: s.owner }, (c) =>
      c.query(`insert into ops.member (tenant_id, id, name, phone, role) values ($1, $2, $3, '+919800000555', 'staff')`, [s.tenant, id, name]),
    );
    const { rows } = await demoRow.admin.query(`select payload from audit.audit_log where tenant_id = $1 and entity = 'ops.member' and entity_id = $2`, [
      s.tenant,
      id,
    ]);
    return { id, rows };
  };
  const before = await payloadOf('0007_phase2.sql', 'Ravi Planted-0007');
  expect(JSON.stringify(before.rows)).toContain('Ravi Planted-0007'); // the positive control: the old chain held names
  const after = await payloadOf('0010_tenancy.sql', 'Ravi Planted-0010');
  expect(after.rows).toEqual([{ payload: { member_id: after.id, role: 'staff' } }]);
  await owner(demoRow, fnFrom('0013_sign_in.sql')); // put the live function back
});

// The privileges each global table grants the app, declared here: an independent list the catalog must match.
const GLOBAL_GRANTS: Record<string, string[]> = {
  'ops.command_authority': ['SELECT'],
  'ops.command_table': ['SELECT'],
  'ops.deployment': ['SELECT'],
  'ops.tenant_directory': ['SELECT'],
  'ops.member_login': ['INSERT', 'SELECT', 'UPDATE(erased_at)', 'UPDATE(revoked_at)', 'UPDATE(subject)'],
};

const privileges = async (role: string, rel: string): Promise<string[]> =>
  (
    await demo.admin.query<{ p: string }>(
      `select p from (
         select t.p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as t(p)
          where has_table_privilege($1::name, $2::text, t.p)
         union all
         select t.p || '(' || a.attname || ')'
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as t(p)
           join pg_attribute a on a.attrelid = $2::text::regclass and a.attnum > 0 and not a.attisdropped
          where not has_table_privilege($1::name, $2::text, t.p) and has_column_privilege($1::name, $2::text, a.attname::text, t.p)) x
        order by p`,
      [role, rel],
    )
  ).rows.map((r) => r.p);

it('G13 the global tables are exactly the munshi tables with no tenant policy; the app holds exactly their declared privileges, the agent none', async () => {
  const { rows } = await demo.admin.query<{ rel: string }>(
    `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_isolation')`,
    [SCHEMAS],
  );
  console.log(`G13 ${rows.length} tables have no tenant policy; the manifest lists ${MANIFEST.globalTables.length} global tables`);
  expect(MANIFEST.globalTables.length).toBe(5);
  expect(rows.map((r) => r.rel).sort()).toEqual([...MANIFEST.globalTables].sort());
  expect(Object.keys(GLOBAL_GRANTS).sort()).toEqual([...MANIFEST.globalTables].sort());
  for (const rel of MANIFEST.globalTables) {
    expect(await privileges('munshi_app', rel), rel).toEqual(GLOBAL_GRANTS[rel]);
    expect(await privileges('munshi_agent', rel), rel).toEqual([]);
  }
});

// Functions written before 0010 (and not replaced since) keep the session's search_path; every later one pins it.
const PRE_0010 = [
  'snap.snapshot_txn',
  'approval.stamp_draft',
  'approval.stamp_decision',
  'approval.draft_status',
  'audit.entry_hash',
  'audit.chain',
  'audit.verify_chain',
  'books.guard',
  'books.audit_row',
  'books.check_balanced',
  'books.entry_txn',
  'ops.member_guard',
  'ops.bill_read_txn',
];

it('G9 no function in the munshi schemas is SECURITY DEFINER, and every one written from 0010 pins its search_path', async () => {
  const { rows } = await demo.admin.query<{ fn: string; definer: boolean; config: string[] | null }>(
    `select n.nspname || '.' || p.proname as fn, p.prosecdef as definer, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1)`,
    [SCHEMAS],
  );
  expect(rows.map((r) => r.fn).sort()).toEqual([...MANIFEST.functions].sort());
  expect(rows.filter((r) => r.definer).map((r) => r.fn)).toEqual([]);
  const later = rows.filter((r) => !PRE_0010.includes(r.fn));
  console.log(`G9 ${rows.length} functions, none SECURITY DEFINER; ${later.length} written from 0010 pin search_path`);
  expect(later.length).toBe(MANIFEST.functions.length - PRE_0010.length);
  expect(later.length).toBeGreaterThanOrEqual(13);
  expect(later.filter((r) => !(r.config ?? []).includes('search_path=pg_catalog, pg_temp')).map((r) => r.fn)).toEqual([]);
});
