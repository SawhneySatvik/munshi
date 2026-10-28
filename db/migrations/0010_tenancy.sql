-- 0010 · Tenancy (MS-19a; docs/MERCHANTS-DESIGN.md §1, §8.1): what kind of business a tenant is and what kind of data it
-- holds, which kind of database this is, and the global slug directory. Also ops.member_audit, replaced in the first file
-- of the merchants work so that no member added from here on (a live owner provisioned before 0013 included) is chained
-- with a name or a phone: the audit chain is permanent, and a live shop's staff are real people.
set local role munshi_owner;

-- Both are written once, when the tenant is created (the app has no UPDATE on ops.tenant, 0002), and the trigger below
-- refuses a change by anyone, the owner included. The defaults keep every existing tenant what it is: a synthetic kirana.
alter table ops.tenant add column business_type text not null default 'kirana' check (business_type in ('kirana', 'apparel', 'salon'));
alter table ops.tenant add column data_class text not null default 'synthetic' check (data_class in ('synthetic', 'showcase', 'live'));

-- Global, one row: whether this database is the demo deploy's or the live deploy's (two deploys on two databases, §8.1).
-- No row counts as demo, which is what dev and the tests are. Inserted only by the operator as munshi_owner, and never
-- changed: a new kind means a new database.
create table ops.deployment (
  one boolean primary key default true check (one),
  kind text not null check (kind in ('demo', 'live')),
  created_at timestamptz not null default now()
);

-- Global: slug → tenant, read before any tenant context exists (sign-in, a site key, an invite link). Forced RLS hides
-- every other tenant's row of ops.tenant, so a lookup by slug there is impossible. Slugs are public, not secrets.
-- Inserted only by provisioning as munshi_owner; the foreign key check bypasses RLS (asserted in test/tenancy.test.ts).
create table ops.tenant_directory (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{2,39}$'),
  tenant_id uuid not null unique references ops.tenant,
  created_at timestamptz not null default now()
);

-- A live tenant only in a live database, and no other kind there (gate T1). business_type and data_class never change.
create function ops.tenant_class() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  deployed text;
begin
  if tg_op = 'UPDATE' then
    if new.business_type is distinct from old.business_type or new.data_class is distinct from old.data_class then
      raise exception 'tenant refused: business_type and data_class are fixed when the tenant is created' using errcode = 'MS010';
    end if;
    return new;
  end if;
  select d.kind into deployed from ops.deployment d;
  if (new.data_class = 'live') is distinct from (coalesce(deployed, 'demo') = 'live') then
    raise exception 'tenant refused: a % tenant does not belong in a % database', new.data_class, coalesce(deployed, 'demo')
      using errcode = 'MS010';
  end if;
  return new;
end $$;
revoke execute on function ops.tenant_class() from public;
create trigger tenant_class before insert or update of business_type, data_class on ops.tenant
  for each row execute function ops.tenant_class();

-- The row comes before any tenant: a database that holds a tenant (or held one) is never given a kind afterwards, so a
-- demo database's synthetic tenants cannot be relabelled live. Forced RLS hides every tenant row from munshi_owner, the
-- role that inserts this row, but not the heap's size: a table that ever stored a row has a page (until TRUNCATE).
-- Row triggers do not fire on TRUNCATE, so a statement trigger covers it. (The owner can still DISABLE TRIGGER: the
-- owner is the operator, who can also drop the database.)
create function ops.deployment_fixed() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if pg_relation_size('ops.tenant') > 0 then
      raise exception 'deployment refused: the deployment row comes before any tenant' using errcode = 'MS010';
    end if;
    return new;
  end if;
  raise exception 'deployment refused: a database never changes its deployment kind' using errcode = 'MS010';
end $$;
revoke execute on function ops.deployment_fixed() from public;
create trigger fixed before insert or update or delete on ops.deployment for each row execute function ops.deployment_fixed();
create trigger fixed_truncate before truncate on ops.deployment for each statement execute function ops.deployment_fixed();

-- The member's id and role only, never to_jsonb(new): that carried the name and the phone into the permanent chain. The
-- entries already chained hold only the kirana's invented members.
create or replace function ops.member_audit() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'member.add', 'ops.member', new.id,
          jsonb_build_object('member_id', new.id, 'role', new.role));
  return null;
end $$;

-- Global tables have no tenant policy (gate G13 lists them against the manifest's globalTables). The app reads both;
-- nobody but the owner writes them; the agent sees neither.
revoke all on ops.deployment from public, munshi_app, munshi_agent;
grant select on ops.deployment to munshi_app;

revoke all on ops.tenant_directory from public, munshi_app, munshi_agent;
grant select on ops.tenant_directory to munshi_app;
