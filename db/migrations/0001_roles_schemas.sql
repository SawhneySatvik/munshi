-- 0001 · Roles and schemas. Runs as an admin that can create roles; every later migration starts with
-- `set local role munshi_owner`, so munshi_owner owns every object (a gate asserts it).
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
