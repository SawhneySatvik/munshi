// G4: row-level security isolates tenants on every tenant table, for reads and writes, through the agent's views too;
// and nothing that could bypass it (a superuser, BYPASSRLS, an object owned outside munshi_owner) is in play.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MANIFEST, openTestDb, refused, SCHEMAS, TENANT_TABLES, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  b = await seedTenant(db.app, 'B');
  await db.sabotage();
});
afterAll(() => db.close());

const countB = async (table: string) =>
  (await db.admin.query(`select count(*)::int as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from ${table} t where tenant_id = $1`, [b.tenant]))
    .rows[0] as { n: number; h: string };

it('G4 no munshi role is a superuser or bypasses RLS, and munshi_owner owns every object', async () => {
  const roles = await db.admin.query(
    `select rolname, rolsuper, rolbypassrls from pg_roles where rolname like 'munshi\\_%' order by rolname`,
  );
  expect(roles.rows.map((r) => r.rolname)).toEqual(['munshi_agent', 'munshi_app', 'munshi_migrator', 'munshi_owner']);
  expect(roles.rows.filter((r) => r.rolsuper || r.rolbypassrls)).toEqual([]);

  const owners = await db.admin.query<{ obj: string; owner: string }>(
    `select 'schema ' || nspname as obj, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = any($1)
     union all
     select 'relation ' || n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = any($1) and c.relkind in ('r', 'p', 'v')
     union all
     select 'function ' || n.nspname || '.' || p.proname, pg_get_userbyid(p.proowner)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1)`,
    [SCHEMAS],
  );
  console.log(`G4 ownership checked on ${owners.rows.length} objects`);
  expect(owners.rows.length).toBe(SCHEMAS.length + MANIFEST.tables.length + MANIFEST.views.length + MANIFEST.functions.length);
  expect(owners.rows.filter((r) => r.owner !== 'munshi_owner')).toEqual([]);
});

it('G4 every tenant table has RLS enabled and forced with a policy, and only those tables carry tenant_id', async () => {
  const { rows } = await db.admin.query<{ rel: string; enabled: boolean; forced: boolean; policies: number }>(
    `select n.nspname || '.' || c.relname as rel, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p') and n.nspname || '.' || c.relname <> all($2)
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`,
    [SCHEMAS, MANIFEST.globalTables], // a global table (0010, 0013) may name a tenant; G13 holds those to their grants
  );
  console.log(`G4 ${rows.length} tables carry tenant_id; the manifest lists ${TENANT_TABLES.length} tenant tables`);
  expect(TENANT_TABLES.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.rel).sort()).toEqual([...TENANT_TABLES].sort());
  expect(rows.filter((r) => !r.enabled || !r.forced || r.policies < 1)).toEqual([]);
});

it("G4 tenant A sees its own rows and none of tenant B's on every tenant table", async () => {
  for (const table of TENANT_TABLES) {
    expect((await countB(table)).n, `${table} has B rows to hide`).toBeGreaterThan(0);
    const seen = await tx(db.app, { tenant: a.tenant }, (c) =>
      c.query(`select count(*)::int as own, count(*) filter (where tenant_id <> $1)::int as other from ${table}`, [a.tenant]),
    );
    expect(seen.rows[0], table).toEqual({ own: expect.any(Number), other: 0 });
    expect(seen.rows[0].own, table).toBeGreaterThan(0);
  }
});

it("G4 tenant A cannot write tenant B's rows on any tenant table", async () => {
  let checked = 0;
  for (const table of TENANT_TABLES) {
    const before = await countB(table);
    const sample = await db.admin.query(`select to_jsonb(t) as row from ${table} t where tenant_id = $1 limit 1`, [b.tenant]);
    const copy = { ...sample.rows[0].row };
    if ('id' in copy) copy.id = randomUUID();
    const insert = await refused(
      tx(db.app, { tenant: a.tenant, actor: a.owner, command: 'sale.record' }, (c) =>
        c.query(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1)`, [copy]),
      ),
    );
    // BEFORE triggers run ahead of the RLS check, so a trigger may refuse first (guard, decision or draft, audit actor,
    // snapshot parent, member guard); the unchanged hash of B's rows below is what proves isolation.
    expect(['42501', 'MS001', 'MS002', 'MS005', 'MS006', 'MS007'], `${table}: ${insert.message}`).toContain(insert.code);

    const updatable = await db.admin.query<{ attname: string }>(
      `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped
          and has_column_privilege('munshi_app', attrelid, attname, 'UPDATE') limit 1`,
      [table],
    );
    const col = updatable.rows[0]?.attname;
    if (col) {
      const upd = await tx(db.app, { tenant: a.tenant }, (c) => c.query(`update ${table} set ${col} = ${col} where tenant_id = $1`, [b.tenant]));
      expect(upd.rowCount, table).toBe(0);
    } else {
      const upd = await refused(tx(db.app, { tenant: a.tenant }, (c) => c.query(`update ${table} set tenant_id = tenant_id where tenant_id = $1`, [b.tenant])));
      expect(upd.code, table).toBe('42501');
    }
    const del = await refused(tx(db.app, { tenant: a.tenant }, (c) => c.query(`delete from ${table} where tenant_id = $1`, [b.tenant])));
    expect(del.code, table).toBe('42501');

    expect(await countB(table), table).toEqual(before);
    checked++;
  }
  console.log(`G4 cross-tenant INSERT, UPDATE and DELETE refused on ${checked} tenant tables`);
  expect(checked).toBe(TENANT_TABLES.length);
});

it('G4 a transaction with no tenant context sees no rows', async () => {
  for (const table of TENANT_TABLES) {
    const { rows } = await tx(db.app, {}, (c) => c.query(`select count(*)::int as n from ${table}`));
    expect(rows[0].n, table).toBe(0);
  }
});

it('G4 the agent sees only its own tenant through snapshots and views', async () => {
  for (const rel of ['snap.snapshot', 'snap.snapshot_cell', ...MANIFEST.views]) {
    const { rows } = await tx(db.agent, { tenant: a.tenant }, (c) =>
      c.query(`select count(*)::int as own, count(*) filter (where tenant_id <> $1)::int as other from ${rel}`, [a.tenant]),
    );
    expect(rows[0].other, rel).toBe(0);
    expect(rows[0].own, rel).toBeGreaterThan(0);
  }
});
