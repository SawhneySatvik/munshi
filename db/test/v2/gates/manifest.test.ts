// The manifest-driven gates over the built schema: G1 (the agent cannot write), G4 (roles, ownership, RLS and isolation
// over every tenant table, every role), G5 (exact privileges, append-only), G9 (functions), G10 (indexes, tenant-led
// keys), G13 (global tables), PG17 (ids). Every expected count comes from the merged manifest, never from the catalog.
// Red-proofs: test/v2/sabotage/manifest.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { plant } from './lib.ts';
import { expectedPrivileges, MANIFEST, privileges, RUNTIME_ROLES, refused, SCHEMAS, TENANT_TABLES } from './lib.ts';

let db: TestDb;
let a: Filled;
let b: Filled;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  a = await fillTenant(db, await signUp(db, 'alpha-shop'));
  b = await fillTenant(db, await signUp(db, 'beta-shop', { type: 'salon' }));
  for (const [shop, suffix] of [[a, 'a'], [b, 'b']] as const) {
    await plant(db.admin, `insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, 'ask', 'test-model', $2)`, [shop.tenant, shop.owner]);
    await plant(db.admin, `insert into ops.import_file (tenant_id, sha256, rows, imported_by) values ($1, $2, 1, $3)`, [shop.tenant, suffix.repeat(64), shop.owner]);
    await plant(
      db.admin,
      `insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out, cost_minor_e6, currency) values ($1, $2, 'reason', 'test-model', 10, 5, 1250, 'USD')`,
      [shop.tenant, shop.run],
    );
  }
  await db.sabotage();
});
afterAll(() => db?.close());

const relations = async (kinds: string[]) =>
  (
    await db.admin.query<{ rel: string }>(
      `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1) and c.relkind = any($2) order by 1`,
      [SCHEMAS, kinds],
    )
  ).rows.map((r) => r.rel);

const tenantCount = async (rel: string, tenant: string) =>
  (await db.admin.query(`select count(*)::int as n from ${rel} where tenant_id = $1`, [tenant])).rows[0].n as number;

const readers = (rel: string) => RUNTIME_ROLES.filter((r) => expectedPrivileges(MANIFEST.grants[rel]?.[r]).some((p) => p.startsWith('SELECT')));

it('G1 the manifest lists exactly the tables and views in the ten schemas', async () => {
  const tables = await relations(['r', 'p']);
  const views = await relations(['v', 'm']);
  const other = await relations(['f', 'S']);
  console.log(`G1 manifest: ${MANIFEST.tables.length} tables, ${MANIFEST.views.length} views; catalog: ${tables.length} tables, ${views.length} views`);
  expect(MANIFEST.tables.length).toBeGreaterThan(0);
  expect(tables).toEqual([...MANIFEST.tables].sort());
  expect(views).toEqual([...MANIFEST.views].sort());
  expect(other).toEqual([]);
});

it('G1 the agent holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table or view', async () => {
  const rels = [...MANIFEST.tables, ...MANIFEST.views];
  const held: string[] = [];
  for (const rel of rels) {
    const p = (await privileges(db.admin, 'munshi_agent', rel)).filter((x) => !x.startsWith('SELECT'));
    if (p.length) held.push(`${rel}: ${p.join(' ')}`);
  }
  console.log(`G1 agent write privileges checked on ${rels.length} relations`);
  expect(rels.length).toBe(MANIFEST.tables.length + MANIFEST.views.length);
  expect(held).toEqual([]);
});

it('G1 the agent is refused INSERT, UPDATE and DELETE on every table', async () => {
  const agent = db.as('munshi_agent');
  let refusals = 0;
  for (const rel of MANIFEST.tables) {
    const col = (await db.admin.query(`select attname from pg_attribute where attrelid = $1::regclass and attnum = 1`, [rel])).rows[0].attname;
    for (const sql of [`insert into ${rel} default values`, `update ${rel} set ${col} = ${col}`, `delete from ${rel}`]) {
      const r = await refused(tx(agent, { tenant_id: a.tenant }, (c) => c.query(sql)));
      expect(r.code, sql).toBe('42501');
      refusals++;
    }
  }
  console.log(`G1 the agent was refused ${refusals} writes on ${MANIFEST.tables.length} tables`);
  expect(refusals).toBe(3 * MANIFEST.tables.length);
});

it('G1 the agent can create nothing: no temporary table, no object in any schema, no large object', async () => {
  const lo = await db.admin.query<{ fn: string; exec: boolean }>(
    `select p.oid::regprocedure::text as fn, has_function_privilege('munshi_agent', p.oid, 'EXECUTE') as exec
       from pg_proc p where p.pronamespace = 'pg_catalog'::regnamespace and (p.proname like 'lo\\_%' or p.proname in ('loread', 'lowrite'))`,
  );
  console.log(`G1 ${lo.rows.length} large-object functions, ${lo.rows.filter((r) => r.exec).length} executable by the agent`);
  expect(lo.rows.length).toBeGreaterThan(0);
  expect(lo.rows.filter((r) => r.exec).map((r) => r.fn)).toEqual([]);
  expect((await db.admin.query(`select nspname from pg_namespace where has_schema_privilege('munshi_agent', oid, 'CREATE')`)).rows).toEqual([]);
  const agent = db.as('munshi_agent');
  for (const [sql, message] of [
    ['create temp table scratch (a int)', /^permission denied to create temporary tables/],
    ['create table public.scratch (a int)', /^permission denied for schema public/],
    ['select lo_create(0)', /^permission denied for function lo_create/],
    ["select lo_from_bytea(0, '\\x00')", /^permission denied for function lo_from_bytea/],
  ] as const) {
    const r = await refused(tx(agent, { tenant_id: a.tenant }, (c) => c.query(sql)));
    expect(r.code, sql).toBe('42501');
    expect(r.message, sql).toMatch(message);
  }
});

it("G1 the agent reads its own tenant's snapshots (the accepted case)", async () => {
  const { rows } = await tx(db.as('munshi_agent'), { tenant_id: a.tenant }, (c) =>
    c.query(`select count(*)::int as own, count(*) filter (where tenant_id <> $1)::int as other from snap.snapshot`, [a.tenant]),
  );
  const own = await tenantCount('snap.snapshot', a.tenant);
  expect(own).toBeGreaterThan(1);
  expect(rows[0]).toEqual({ own, other: 0 });
});

it("G4 the roles are exactly the manifest's eight, none a superuser or bypassing RLS, and munshi_owner owns every object", async () => {
  const roles = await db.admin.query<{ rolname: string; login: boolean; inherit: boolean; bad: boolean }>(
    `select rolname, rolcanlogin as login, rolinherit as inherit, rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication as bad
       from pg_roles where rolname like 'munshi\\_%' order by rolname`,
  );
  const expected = Object.entries(MANIFEST.roles).map(([rolname, r]) => ({ rolname, ...r, bad: false }));
  expect(expected.length).toBe(8);
  expect(roles.rows).toEqual(expected.sort((x, y) => x.rolname.localeCompare(y.rolname)));
  const owners = await db.admin.query<{ obj: string; owner: string }>(
    `select 'schema ' || nspname as obj, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = any($1)
     union all
     select 'relation ' || n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'S')
     union all
     select 'function ' || p.oid::regprocedure, pg_get_userbyid(p.proowner)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1)`,
    [SCHEMAS],
  );
  console.log(`G4 ownership checked on ${owners.rows.length} objects`);
  expect(owners.rows.length).toBe(SCHEMAS.length + MANIFEST.tables.length + MANIFEST.views.length + MANIFEST.functions.length);
  expect(owners.rows.filter((r) => r.owner !== 'munshi_owner')).toEqual([]);
});

it('G4 every tenant table has RLS enabled and forced, and its tenant policy reads back as written', async () => {
  // The expected predicate, deparsed by this server from the text the schema files use, on a scratch table.
  const scratch = await db.admin.connect();
  let want: { q: string; w: string };
  try {
    await scratch.query('begin');
    await scratch.query(
      `create temp table g4_probe (tenant_id uuid);
       create policy tenant_isolation on g4_probe
         using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
         with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))`,
    );
    want = (
      await scratch.query(
        `select pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as w from pg_policy where polrelid = 'g4_probe'::regclass`,
      )
    ).rows[0];
  } finally {
    await scratch.query('rollback');
    scratch.release();
  }
  const { rows } = await db.admin.query<{ rel: string; enabled: boolean; forced: boolean; q: string; w: string; cmd: string; permissive: boolean; roles: string[] }>(
    `select n.nspname || '.' || c.relname as rel, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
            pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w, p.polcmd::text as cmd,
            p.polpermissive as permissive, p.polroles::regrole[]::text[] as roles
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       left join pg_policy p on p.polrelid = c.oid and p.polname = 'tenant_isolation'
      where n.nspname || '.' || c.relname = any($1)`,
    [TENANT_TABLES],
  );
  console.log(`G4 ${rows.length} tenant tables; the manifest lists ${TENANT_TABLES.length}`);
  expect(TENANT_TABLES.length).toBeGreaterThan(0);
  expect(rows.length).toBe(TENANT_TABLES.length);
  const bad = rows.filter(
    (r) => !r.enabled || !r.forced || r.q !== want.q || r.w !== want.w || r.cmd !== '*' || !r.permissive || r.roles.join() !== '-',
  );
  expect(bad.map((r) => r.rel)).toEqual([]);
});

it('G4 every table carries exactly its declared policies', async () => {
  const { rows } = await db.admin.query<{ rel: string; policies: string[] }>(
    `select n.nspname || '.' || c.relname as rel, coalesce(array_agg(p.polname::text order by p.polname) filter (where p.polname is not null), '{}') as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_policy p on p.polrelid = c.oid
      where n.nspname = any($1) and c.relkind in ('r', 'p') group by 1 order by 1`,
    [SCHEMAS],
  );
  const declared = Object.entries(MANIFEST.policies)
    .map(([rel, policies]) => ({ rel, policies: [...policies].sort() }))
    .sort((x, y) => x.rel.localeCompare(y.rel));
  console.log(`G4 ${declared.reduce((n, d) => n + d.policies.length, 0)} policies declared on ${declared.length} tables`);
  expect(declared.length).toBe(MANIFEST.tables.length);
  expect(rows).toEqual(declared);
});

it("G4 every role that reads a tenant table sees its own tenant's rows and none of another's", async () => {
  let checks = 0;
  for (const rel of TENANT_TABLES) {
    const own = await tenantCount(rel, a.tenant);
    expect(own, `${rel} has rows of tenant A`).toBeGreaterThan(0);
    expect(await tenantCount(rel, b.tenant), `${rel} has rows of tenant B to hide`).toBeGreaterThan(0);
    for (const role of readers(rel)) {
      const restrictive = (
        await db.admin.query(
          `select count(*)::int as n from pg_policy where polrelid = $1::regclass and not polpermissive and polcmd in ('r', '*')
              and ($2::regrole::oid = any(polroles) or 0::oid = any(polroles))`,
          [rel, role],
        )
      ).rows[0].n;
      const seen = (await tx(db.as(role), { tenant_id: a.tenant }, (c) => c.query(`select count(*)::int as n from ${rel}`))).rows[0].n;
      if (restrictive) expect(seen, `${role} on ${rel}`).toBeLessThanOrEqual(own);
      else expect(seen, `${role} on ${rel}`).toBe(own);
      if (expectedPrivileges(MANIFEST.grants[rel]?.[role]).includes('SELECT')) {
        const other = await tx(db.as(role), { tenant_id: a.tenant }, (c) =>
          c.query(`select count(*)::int as n from ${rel} where tenant_id <> $1`, [a.tenant]),
        );
        expect(other.rows[0].n, `${role} on ${rel}`).toBe(0);
      }
      checks++;
    }
  }
  const expected = TENANT_TABLES.reduce((n, rel) => n + readers(rel).length, 0);
  console.log(`G4 ${checks} (table, role) reads isolated`);
  expect(expected).toBeGreaterThan(TENANT_TABLES.length);
  expect(checks).toBe(expected);
});

it("G4 tenant A cannot write tenant B's rows on any tenant table", async () => {
  const fingerprint = async (rel: string) =>
    (await db.admin.query(`select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from ${rel} t where tenant_id = $1`, [b.tenant]))
      .rows[0].h as string;
  let attempts = 0;
  for (const rel of TENANT_TABLES) {
    const before = await fingerprint(rel);
    const sample = (await db.admin.query(`select to_jsonb(t) as r from ${rel} t where tenant_id = $1 limit 1`, [b.tenant])).rows[0].r;
    if ('id' in sample) sample.id = randomUUID();
    for (const role of RUNTIME_ROLES) {
      const held = expectedPrivileges(MANIFEST.grants[rel]?.[role]);
      const ctx = { tenant_id: a.tenant, actor_id: a.owner };
      if (held.includes('INSERT')) {
        await refused(tx(db.as(role), ctx, (c) => c.query(`insert into ${rel} select * from jsonb_populate_record(null::${rel}, $1)`, [sample])));
        attempts++;
      }
      const updatable = held.find((p) => p.startsWith('UPDATE'));
      if (updatable) {
        const col = updatable === 'UPDATE' ? 'tenant_id' : updatable.slice('UPDATE('.length, -1);
        const where = held.some((p) => p === 'SELECT' || p === 'SELECT(tenant_id)') ? ` where tenant_id = '${b.tenant}'` : '';
        const r = await tx(db.as(role), ctx, (c) => c.query(`update ${rel} set ${col} = ${col}${where}`)).catch((e) => e);
        expect(r instanceof Error ? 'refused' : r.rowCount, `${role} update ${rel}`).toSatisfy((x: unknown) => x === 'refused' || x === 0);
        attempts++;
      }
      if (held.includes('DELETE')) {
        const r = await tx(db.as(role), ctx, (c) => c.query(`delete from ${rel}`)).catch((e) => e);
        expect(r instanceof Error ? 'refused' : r.rowCount, `${role} delete ${rel}`).toSatisfy((x: unknown) => x === 'refused' || x === 0);
        attempts++;
      }
    }
    expect(await fingerprint(rel), rel).toBe(before);
  }
  const expected = TENANT_TABLES.reduce(
    (n, rel) =>
      n +
      RUNTIME_ROLES.reduce((m, role) => {
        const held = expectedPrivileges(MANIFEST.grants[rel]?.[role]);
        return m + Number(held.includes('INSERT')) + Number(held.some((p) => p.startsWith('UPDATE'))) + Number(held.includes('DELETE'));
      }, 0),
    0,
  );
  console.log(`G4 ${attempts} cross-tenant writes refused or touching nothing, over ${TENANT_TABLES.length} tenant tables`);
  expect(expected).toBeGreaterThan(TENANT_TABLES.length);
  expect(attempts).toBe(expected);
});

it('G4 a transaction with no tenant context sees no rows, as any role', async () => {
  let checks = 0;
  for (const rel of TENANT_TABLES) {
    for (const role of readers(rel)) {
      const { rows } = await tx(db.as(role), {}, (c) => c.query(`select count(*)::int as n from ${rel}`));
      expect(rows[0].n, `${role} on ${rel}`).toBe(0);
      checks++;
    }
  }
  expect(checks).toBe(TENANT_TABLES.reduce((n, rel) => n + readers(rel).length, 0));
});

it('G5 every role holds exactly its declared privileges on every tenant table', async () => {
  const wrong: string[] = [];
  for (const rel of TENANT_TABLES) {
    for (const role of [...RUNTIME_ROLES, 'munshi_migrator']) {
      const held = await privileges(db.admin, role, rel);
      const want = expectedPrivileges(MANIFEST.grants[rel]?.[role]);
      if (held.join() !== want.join()) wrong.push(`${role} on ${rel}: holds [${held.join(' ')}], declared [${want.join(' ')}]`);
    }
  }
  console.log(`G5 privileges of ${RUNTIME_ROLES.length + 1} roles checked on ${TENANT_TABLES.length} tenant tables`);
  expect(Object.keys(MANIFEST.grants).sort()).toEqual([...MANIFEST.tables].sort());
  expect(wrong).toEqual([]);
});

it('G5 no runtime role may update an append-only table, and an update by the app is refused', async () => {
  const updaters: string[] = [];
  for (const rel of MANIFEST.appendOnly) {
    for (const role of RUNTIME_ROLES) {
      if ((await privileges(db.admin, role, rel)).some((p) => p.startsWith('UPDATE'))) updaters.push(`${role} on ${rel}`);
    }
    const col = (await db.admin.query(`select attname from pg_attribute where attrelid = $1::regclass and attnum = 1`, [rel])).rows[0].attname;
    const r = await refused(tx(db.as('munshi_app'), { tenant_id: a.tenant, actor_id: a.owner }, (c) => c.query(`update ${rel} set ${col} = ${col}`)));
    expect(r.code, rel).toBe('42501');
  }
  console.log(`G5 ${MANIFEST.appendOnly.length} append-only tables`);
  expect(MANIFEST.appendOnly.length).toBeGreaterThan(0);
  expect(updaters).toEqual([]);
});

const functions = async () =>
  (
    await db.admin.query<{ fn: string; definer: boolean; owner: string; config: string[] | null; public_exec: boolean }>(
      `select p.oid::regprocedure::text as fn, p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner, p.proconfig as config,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1) order by 1`,
      [SCHEMAS],
    )
  ).rows;

it("G9 the functions are exactly the manifest's; only the deployment call counter is SECURITY DEFINER, none executable by PUBLIC, and each pins search_path", async () => {
  const rows = await functions();
  console.log(`G9 ${rows.length} functions in the ten schemas; the manifest lists ${MANIFEST.functions.length}`);
  expect(MANIFEST.functions.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.fn)).toEqual([...MANIFEST.functions].sort());
  expect(rows.filter((r) => r.public_exec).map((r) => r.fn)).toEqual([]);
  const definers = rows.filter((r) => r.definer);
  expect(definers.map((r) => r.fn)).toEqual(['platform.count_ai_call(date,integer)']);
  expect(definers.map((r) => r.owner)).toEqual(['munshi_owner']);
  expect(rows.filter((r) => !(r.config ?? []).includes('search_path=pg_catalog, pg_temp')).map((r) => r.fn)).toEqual([]);
});

it('G9 each runtime role executes exactly the functions the manifest grants it, and the trigger functions fire without EXECUTE', async () => {
  let granted = 0;
  for (const role of [...RUNTIME_ROLES, 'munshi_migrator']) {
    const { rows } = await db.admin.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and has_function_privilege($2, p.oid, 'EXECUTE') order by 1`,
      [SCHEMAS, role],
    );
    const want = Object.entries(MANIFEST.executable)
      .filter(([, roles]) => roles.includes(role))
      .map(([fn]) => fn)
      .sort();
    expect(rows.map((r) => r.fn), role).toEqual(want);
    granted += want.length;
  }
  console.log(`G9 ${granted} (function, role) EXECUTE grants, as declared`);
  expect(granted).toBe(Object.values(MANIFEST.executable).reduce((n, roles) => n + roles.length, 0));
  // No runtime role may execute the trigger functions, yet every audit entry of the fixture came through them.
  const { rows } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) => c.query(`select count(*)::int as n from audit.audit_log`));
  expect(rows[0].n).toBeGreaterThan(5);
});

it('G10 every declared index exists in pg_index exactly as declared, and no undeclared index exists', async () => {
  const declared = Object.entries(MANIFEST.indexes);
  for (const [name, spec] of declared) {
    const [schema, index] = name.split('.') as [string, string];
    const real = await db.admin.query<{ def: string }>(
      `select pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class ic on ic.oid = i.indexrelid
        where ic.relname = $1 and ic.relnamespace = $2::regnamespace`,
      [index, schema],
    );
    // The declaration rebuilt on a scratch index, so columns, order, INCLUDE, uniqueness and the predicate all compare.
    const unique = spec.startsWith('unique ');
    const scratch = await db.admin.connect();
    try {
      await scratch.query('begin');
      await scratch.query(`create ${unique ? 'unique ' : ''}index g10_probe ${unique ? spec.slice('unique '.length) : spec}`);
      const probe = await scratch.query<{ def: string }>(`select pg_get_indexdef($1::regclass) as def`, [`${schema}.g10_probe`]);
      expect(real.rows.map((r) => r.def), name).toEqual([probe.rows[0]?.def.replace(' g10_probe ', ` ${index} `)]);
    } finally {
      await scratch.query('rollback');
      scratch.release();
    }
  }
  const { rows } = await db.admin.query<{ name: string }>(
    `select n.nspname || '.' || ic.relname as name from pg_index i join pg_class ic on ic.oid = i.indexrelid
       join pg_namespace n on n.oid = ic.relnamespace
      where n.nspname = any($1)
        and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.conrelid = i.indrelid and c.contype in ('p', 'u', 'x'))
      order by 1`,
    [SCHEMAS],
  );
  console.log(`G10 ${declared.length} indexes declared in the manifest; ${rows.length} non-constraint indexes in the catalog`);
  expect(declared.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.name)).toEqual(declared.map(([n]) => n).sort());
});

it('G10 tenant_id leads every index of a tenant table and every foreign key into one', async () => {
  const { rows } = await db.admin.query<{ rel: string; kind: string; name: string; first: string; target_first: string | null }>(
    `select i.indrelid::regclass::text as rel, 'index' as kind, ic.relname::text as name,
            (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0])::text as first,
            null::text as target_first
       from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = any($1::regclass[])
     union all
     select c.conrelid::regclass::text, 'foreign key', c.conname::text,
            (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1])::text,
            (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1])::text
       from pg_constraint c where c.contype = 'f' and c.confrelid = any($1::regclass[])`,
    [TENANT_TABLES],
  );
  const indexes = rows.filter((r) => r.kind === 'index').length;
  console.log(`G10 ${indexes} indexes on ${TENANT_TABLES.length} tenant tables; ${rows.length - indexes} foreign keys into them`);
  expect(indexes).toBeGreaterThanOrEqual(TENANT_TABLES.length);
  expect(rows.length - indexes).toBeGreaterThan(TENANT_TABLES.length);
  expect(rows.filter((r) => r.first !== 'tenant_id' || (r.kind === 'foreign key' && r.target_first !== 'tenant_id'))).toEqual([]);
});

it("G13 the global tables are exactly the manifest's, each with RLS forced, and every role holds exactly its declared privileges", async () => {
  const { rows } = await db.admin.query<{ rel: string; forced: boolean }>(
    `select n.nspname || '.' || c.relname as rel, c.relrowsecurity and c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_isolation') order by 1`,
    [SCHEMAS],
  );
  console.log(`G13 ${rows.length} tables have no tenant policy; the manifest lists ${MANIFEST.globalTables.length} global tables`);
  expect(MANIFEST.globalTables.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.rel)).toEqual([...MANIFEST.globalTables].sort());
  expect(rows.filter((r) => !r.forced)).toEqual([]);
  const wrong: string[] = [];
  for (const rel of MANIFEST.globalTables) {
    for (const role of [...RUNTIME_ROLES, 'munshi_migrator']) {
      const held = await privileges(db.admin, role, rel);
      const want = expectedPrivileges(MANIFEST.grants[rel]?.[role]);
      if (held.join() !== want.join()) wrong.push(`${role} on ${rel}: holds [${held.join(' ')}], declared [${want.join(' ')}]`);
    }
  }
  expect(wrong).toEqual([]);
});

it('PG17 every column the manifest names defaults to ops.uuidv7(), and every id column is among them', async () => {
  const { rows } = await db.admin.query<{ col: string; def: string | null }>(
    `select n.nspname || '.' || c.relname || '.' || a.attname as col, pg_get_expr(d.adbin, d.adrelid) as def
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = any($1) and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        and (a.attname = 'id' or pg_get_expr(d.adbin, d.adrelid) like '%uuidv7%') order by 1`,
    [SCHEMAS],
  );
  console.log(`PG17 ${rows.length} id or uuidv7 columns; the manifest lists ${MANIFEST.uuidv7Ids.length}`);
  expect(MANIFEST.uuidv7Ids.length).toBeGreaterThan(0);
  expect(rows.map((r) => r.col)).toEqual([...MANIFEST.uuidv7Ids].sort());
  expect(rows.filter((r) => r.def !== 'ops.uuidv7()')).toEqual([]);
});

it('PG17 ops.uuidv7() makes version 7 ids at the clock, in the order they were made', async () => {
  const c = await db.as('munshi_app').connect();
  const ids: string[] = [];
  try {
    await c.query('begin');
    for (let i = 0; i < 20; i++) ids.push((await c.query<{ id: string }>('select ops.uuidv7() as id')).rows[0]?.id as string);
    const { rows } = await c.query<{ v: number; drift: number }>(
      `select uuid_extract_version(id) as v, abs(extract(epoch from clock_timestamp() - uuid_extract_timestamp(id)))::float as drift
         from unnest($1::uuid[]) id`,
      [ids],
    );
    await c.query('commit');
    expect(rows.every((r) => r.v === 7)).toBe(true);
    expect(Math.max(...rows.map((r) => r.drift))).toBeLessThan(5);
  } finally {
    c.release();
  }
  expect(new Set(ids).size).toBe(20);
  expect([...ids].sort()).toEqual(ids);
});
