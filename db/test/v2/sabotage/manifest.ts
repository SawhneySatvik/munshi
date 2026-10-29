// Red-proofs of the manifest-driven gates (test/v2/gates/manifest.test.ts): each breaks one rule in the built schema.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/manifest.test.ts';

const only = (relation: string, policy = 'tenant_isolation') =>
  `drop policy ${policy} on ${relation}; create policy ${policy} on ${relation} using (true) with check (true);`;

export const MANIFEST_CASES: Case[] = [
  {
    sabotage: 'v2-g1-stray-view',
    file: FILE,
    test: 'G1 the manifest lists exactly the tables and views in the ten schemas',
    config: V2,
    sql: asOwner('create view ops.stray_view as select 1 as n;'),
  },
  {
    // the agent holds USAGE on snap, so a DELETE grant there is enough for a write to succeed
    sabotage: 'v2-g1-agent-delete',
    file: FILE,
    test: 'G1 the agent is refused INSERT, UPDATE and DELETE on every table',
    config: V2,
    sql: 'grant delete on snap.pin to munshi_agent;',
  },
  {
    sabotage: 'v2-g1-agent-create',
    file: FILE,
    test: 'G1 the agent can create nothing: no temporary table, no object in any schema, no large object',
    config: V2,
    sql: 'grant create on schema snap to munshi_agent;',
  },
  {
    sabotage: 'v2-g1-agent-blind',
    file: FILE,
    test: "G1 the agent reads its own tenant's snapshots (the accepted case)",
    config: V2,
    sql: 'revoke select on snap.snapshot from munshi_agent;',
  },
  {
    // the app role owning a table bypasses its RLS (gotcha 3)
    sabotage: 'v2-g4-app-owns',
    file: FILE,
    test: "G4 the roles are exactly the manifest's eight, none a superuser or bypassing RLS, and munshi_owner owns every object",
    config: V2,
    sql: 'alter table ops.shop owner to munshi_app;',
  },
  {
    sabotage: 'v2-g4-cross-write',
    file: FILE,
    test: "G4 tenant A cannot write tenant B's rows on any tenant table",
    config: V2,
    sql: only('ai.usage'),
  },
  {
    sabotage: 'v2-g4-no-context',
    file: FILE,
    test: 'G4 a transaction with no tenant context sees no rows, as any role',
    config: V2,
    sql: only('ops.shop_hours'),
  },
  {
    sabotage: 'v2-g1-agent-insert',
    file: FILE,
    test: 'G1 the agent holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table or view',
    config: V2,
    sql: 'grant insert on ops.contact to munshi_agent;',
  },
  {
    sabotage: 'v2-g4-no-force',
    file: FILE,
    test: 'G4 every tenant table has RLS enabled and forced, and its tenant policy reads back as written',
    config: V2,
    sql: 'alter table ops.contact no force row level security;',
  },
  {
    // A policy that admits every row keeps a forced-RLS canary green (gotcha 22); the predicate must read back.
    sabotage: 'v2-g4-policy-true',
    file: FILE,
    test: 'G4 every tenant table has RLS enabled and forced, and its tenant policy reads back as written',
    config: V2,
    sql: 'drop policy tenant_isolation on ops.shop; create policy tenant_isolation on ops.shop using (true) with check (true);',
  },
  {
    sabotage: 'v2-g4-isolation',
    file: FILE,
    test: "G4 every role that reads a tenant table sees its own tenant's rows and none of another's",
    config: V2,
    sql: 'drop policy tenant_isolation on ops.contact; create policy tenant_isolation on ops.contact using (true) with check (true);',
  },
  {
    sabotage: 'v2-g4-extra-policy',
    file: FILE,
    test: 'G4 every table carries exactly its declared policies',
    config: V2,
    sql: 'create policy app_reads_all on ops.member for select to munshi_app using (true);',
  },
  {
    sabotage: 'v2-g5-append-update',
    file: FILE,
    test: 'G5 every role holds exactly its declared privileges on every tenant table',
    config: V2,
    sql: 'grant update (action) on audit.audit_log to munshi_app;',
  },
  {
    sabotage: 'v2-g5-append-only',
    file: FILE,
    test: 'G5 no runtime role may update an append-only table, and an update by the app is refused',
    config: V2,
    sql: 'grant update (created_at) on ops.shop_hours to munshi_app;',
  },
  {
    sabotage: 'v2-g9-public-execute',
    file: FILE,
    test: "G9 the functions are exactly the manifest's; none is SECURITY DEFINER or executable by PUBLIC, and each pins search_path",
    config: V2,
    sql: 'grant execute on function ops.only_erase() to public;',
  },
  {
    sabotage: 'v2-g9-app-execute',
    file: FILE,
    test: 'G9 each runtime role executes exactly the functions the manifest grants it, and the trigger functions fire without EXECUTE',
    config: V2,
    sql: 'grant execute on function books.write() to munshi_app;',
  },
  {
    sabotage: 'v2-g10-missing-index',
    file: FILE,
    test: 'G10 every declared index exists in pg_index exactly as declared, and no undeclared index exists',
    config: V2,
    sql: 'drop index snap.snapshot_reuse;',
  },
  {
    // `create index if not exists` no-ops on a same-name index with other columns (gotcha 1): the columns must match.
    sabotage: 'v2-g10-wrong-columns',
    file: FILE,
    test: 'G10 every declared index exists in pg_index exactly as declared, and no undeclared index exists',
    config: V2,
    sql: asOwner('drop index ops.member_active; create index member_active on ops.member (tenant_id, role);'),
  },
  {
    sabotage: 'v2-g10-tenant-lead',
    file: FILE,
    test: 'G10 tenant_id leads every index of a tenant table and every foreign key into one',
    config: V2,
    sql: asOwner('create unique index member_id_first on ops.member (id, tenant_id);'),
  },
  {
    sabotage: 'v2-g13-unlisted-table',
    file: FILE,
    test: "G13 the global tables are exactly the manifest's, each with RLS forced, and every role holds exactly its declared privileges",
    config: V2,
    sql: asOwner(
      'create table ops.stray (n int); alter table ops.stray enable row level security; alter table ops.stray force row level security; create policy global_rows on ops.stray using (true);',
    ),
  },
  {
    sabotage: 'v2-pg17-default',
    file: FILE,
    test: 'PG17 every column the manifest names defaults to ops.uuidv7(), and every id column is among them',
    config: V2,
    sql: 'alter table ops.contact alter column id set default gen_random_uuid();',
  },
  {
    sabotage: 'v2-pg17-uuidv7-now',
    file: FILE,
    test: 'PG17 ops.uuidv7() makes version 7 ids at the clock, in the order they were made',
    config: V2,
    sql: mutate('ops.uuidv7()', 'extract(epoch from clock_timestamp())', 'extract(epoch from now())'),
  },
];
