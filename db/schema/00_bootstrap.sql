-- 00 · Bootstrap (BLUEPRINT §2.2, §3.1): run by the cluster's admin once per database (`pnpm db:bootstrap`), never by
-- the build. The admin is a real superuser locally and `postgres` (CREATEROLE, CREATEDB, not a superuser) on Supabase, so
-- nothing here needs a superuser. Idempotent: a second run changes nothing.
--
-- The eight roles. None is a superuser, bypasses RLS, creates roles or databases, or replicates; the owner owns every
-- Munshi object and logs in as nobody; the migrator may SET ROLE to the owner but inherits nothing from it (NOINHERIT,
-- and the membership grants INHERIT FALSE). The roles are cluster-wide, so an existing role is checked, never altered:
-- a non-superuser admin cannot change SUPERUSER or BYPASSRLS, and a role that is wrong must stop the bootstrap.
do $$
declare
  r record;
begin
  for r in select * from (values
      ('munshi_owner', false, true),
      ('munshi_migrator', true, false),
      ('munshi_app', true, true),
      ('munshi_public', true, true),
      ('munshi_jobs', true, true),
      ('munshi_agent', true, true),
      ('munshi_idp', true, true),
      ('munshi_platform', true, true)) as t(name, login, inherit)
  loop
    if not exists (select 1 from pg_roles where rolname = r.name) then
      execute format('create role %I %s %s nosuperuser nobypassrls nocreaterole nocreatedb noreplication',
                     r.name, case when r.login then 'login' else 'nologin' end, case when r.inherit then 'inherit' else 'noinherit' end);
    end if;
    perform 1 from pg_roles
     where rolname = r.name and rolcanlogin = r.login and rolinherit = r.inherit
       and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication;
    if not found then
      raise exception 'bootstrap: role % exists with other attributes than login=%, inherit=%, and no superuser, bypassrls, createrole, createdb or replication',
        r.name, r.login, r.inherit;
    end if;
  end loop;
end $$;

-- The migrator builds by SET ROLE munshi_owner, and the admin needs SET on the owner to run `create schema …
-- authorization munshi_owner` on PostgreSQL 16+. Neither inherits the owner's rights.
grant munshi_owner to munshi_migrator with inherit false, set true;
grant munshi_owner to current_user with inherit false, set true;

-- The owner creates the ten schemas in 01 (CREATE on this database), and nothing else on the cluster.
do $$
begin
  execute format('grant create on database %I to munshi_owner', current_database());
end $$;

-- btree_gist backs the booking exclusion (14). Created here, as the admin, because it is a trusted extension the
-- database owner may create and the migrator may not. The owner needs USAGE to name its operator classes.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
grant usage on schema extensions to munshi_owner;

-- Writes that no table grant covers. PUBLIC holds TEMP on a new database, CREATE on schema public, and EXECUTE on the
-- large-object functions, so any role could create temporary tables, objects in public, and large objects. No Munshi
-- role needs any of them, so nothing is granted back.
--
-- The large-object functions belong to the bootstrap superuser, so a non-superuser admin's REVOKE only warns ("no
-- privileges could be revoked"). That is not raised: the outcome is printed as the residual line below, and the gates
-- measure it (G1 requires that the agent creates no large object where the admin is a superuser; on Supabase,
-- deploy-check prints agent_large_objects=possible, a stated residual: unlinked bytes, never a table row or a book).
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
  -- What the admin owns must hold: TEMP and CREATE on public are revoked by any admin that owns the database.
  if has_database_privilege('munshi_agent', current_database(), 'TEMPORARY') or has_schema_privilege('munshi_agent', 'public', 'CREATE') then
    raise exception 'bootstrap: PUBLIC still holds TEMP on this database or CREATE on schema public';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'pg_catalog'::regnamespace and (p.proname like 'lo\_%' or p.proname in ('loread', 'lowrite'))
                and has_function_privilege('munshi_agent', p.oid, 'EXECUTE')) then
    raise warning 'bootstrap residual: agent_large_objects=possible (the large-object functions belong to the bootstrap superuser, so this admin could not revoke them from PUBLIC)';
  else
    raise notice 'bootstrap: agent_large_objects=none';
  end if;
end $$;
