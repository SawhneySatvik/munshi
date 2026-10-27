-- 0001 · Roles and schemas. Runs as a superuser (it creates roles and revokes on pg_catalog functions); every later
-- migration starts with `set local role munshi_owner`, so munshi_owner owns every object (a gate asserts it).
-- None of these roles is a superuser or bypasses RLS; the app and agent roles own nothing.

create role munshi_owner nologin nosuperuser nobypassrls nocreaterole nocreatedb;
create role munshi_migrator login nosuperuser nobypassrls nocreaterole nocreatedb noinherit;
grant munshi_owner to munshi_migrator;
create role munshi_app login nosuperuser nobypassrls nocreaterole nocreatedb;
create role munshi_agent login nosuperuser nobypassrls nocreaterole nocreatedb;

create schema ops authorization munshi_owner;        -- tenancy, members, documents, findings, agent runs
create schema books authorization munshi_owner;      -- the books: every table here is guarded and append-only
create schema approval authorization munshi_owner;   -- drafts and decisions
create schema snap authorization munshi_owner;       -- snapshots and their cells: the only source of shown numbers
create schema audit authorization munshi_owner;      -- the hash-chained audit log
create schema agent_view authorization munshi_owner; -- the agent's named read views (names, no numbers)

revoke all on schema ops, books, approval, snap, audit, agent_view from public;
grant usage on schema ops, books, approval, snap, audit to munshi_app;
grant usage on schema snap, agent_view to munshi_agent;

-- Writes no table grant covers: PUBLIC holds TEMP on a new database, and EXECUTE on the large-object functions, so any
-- role could create temporary tables and large objects. No munshi role needs either, so nothing is granted back.
-- A REVOKE on an object the runner does not own only warns, so the outcome is asserted: where the admin is not a
-- superuser (pg_catalog functions belong to the bootstrap superuser) this migration fails instead of silently no-opping.
-- CREATE DATABASE … TEMPLATE does not copy a database's ACL; the test harness copies it onto each clone.
do $$
declare
  f regprocedure;
begin
  execute format('revoke temporary on database %I from public', current_database());
  revoke create on schema public from public;
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'pg_catalog'::regnamespace and (p.proname like 'lo\_%' or p.proname in ('loread', 'lowrite'))
              and has_function_privilege('public', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public', f);
  end loop;
  if has_database_privilege('munshi_agent', current_database(), 'TEMPORARY')
     or has_schema_privilege('munshi_agent', 'public', 'CREATE')
     or exists (select 1 from pg_proc p
                 where p.pronamespace = 'pg_catalog'::regnamespace and (p.proname like 'lo\_%' or p.proname in ('loread', 'lowrite'))
                   and has_function_privilege('munshi_agent', p.oid, 'EXECUTE')) then
    raise exception '0001: TEMP, CREATE on public or a large-object function is still granted to PUBLIC (run 0001 as a superuser)';
  end if;
end $$;
