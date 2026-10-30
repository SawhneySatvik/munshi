-- 22 · Model controls, the deployment AI-call ceiling, and settlement-import provenance.
set local role munshi_owner;

create table ref.ai_agent (
  agent text primary key check (agent ~ '^[a-z][a-z0-9_]{1,31}$'),
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate'))
);
insert into ref.ai_agent (agent, role) values
  ('ask', 'reason'), ('counter', 'reason'), ('bills', 'vision'), ('shelf', 'vision'), ('voice', 'voice'),
  ('brief', 'narrate'), ('chat_to_order', 'reason'), ('campaigns', 'reason'), ('replies', 'reason'), ('settlements', 'reason');

create table platform.model_allow (
  id uuid primary key default ops.uuidv7(),
  alias text not null check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate')),
  enabled boolean not null,
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change,
  unique (alias, role, change_id)
);
create index model_allow_latest on platform.model_allow (alias, role, effective_from desc, id desc);
create trigger guard before insert on platform.model_allow for each row
  execute function platform.platform_guard('model_allow', 'alias', 'role', 'enabled');
create trigger audit after insert on platform.model_allow for each row execute function platform.audit_write();

create table platform.ai_usage_total (
  day date primary key,
  calls int not null check (calls between 0 and 100000)
);
create function platform.count_ai_call(p_day date, p_cap int) returns boolean language plpgsql security definer
  set search_path = pg_catalog, pg_temp as $$
declare
  counted boolean;
begin
  if p_cap < 0 or p_cap > 100000 then
    raise exception 'AI call cap is invalid' using errcode = '22023';
  end if;
  if p_cap = 0 then
    return false;
  end if;
  insert into platform.ai_usage_total (day, calls) values (p_day, 1)
  on conflict (day) do update
    set calls = platform.ai_usage_total.calls + 1
    where platform.ai_usage_total.calls < p_cap
  returning true into counted;
  return coalesce(counted, false);
end $$;
alter function platform.count_ai_call(date, integer) owner to munshi_owner;
revoke execute on function platform.count_ai_call(date, integer) from public;
grant execute on function platform.count_ai_call(date, integer) to munshi_app, munshi_jobs;

alter table platform.default_config
  add column deployment_daily_calls int not null default 0 check (deployment_daily_calls between 0 and 100000),
  add column sandbox_ai_enabled boolean not null default false;

create table ops.model_choice (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  agent text not null references ref.ai_agent(agent),
  alias text not null check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
  chosen_by uuid not null,
  chosen_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, chosen_by) references ops.member
);
create function ops.model_choice_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_command text := nullif(current_setting('munshi.command', true), '');
begin
  if current_user <> 'munshi_app' or ctx_command is distinct from 'model.choose' or ctx_actor is null
     or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role = 'owner' and m.active)
     or not exists (
       select 1 from ref.ai_agent a
        where a.agent = new.agent
          and (select ma.enabled from platform.model_allow ma
                where ma.alias = new.alias and ma.role = a.role
                order by ma.effective_from desc, ma.id desc limit 1) is true
     ) then
    raise exception 'model choice refused: the active owner must choose an enabled model for this agent' using errcode = 'MS007';
  end if;
  new.chosen_by := ctx_actor;
  new.chosen_at := clock_timestamp();
  return new;
end $$;
revoke execute on function ops.model_choice_guard() from public;
create trigger guard before insert on ops.model_choice for each row execute function ops.model_choice_guard();

create function ops.model_choice_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, new.chosen_by, 'model.choose', 'ops.model_choice', new.id,
          jsonb_build_object('agent', new.agent, 'alias', new.alias));
  return null;
end $$;
revoke execute on function ops.model_choice_audit() from public;
create trigger audit after insert on ops.model_choice for each row execute function ops.model_choice_audit();
create index model_choice_latest on ops.model_choice (tenant_id, agent, chosen_at desc, id desc);

create table ops.import_file (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  kind text not null default 'settlement' check (kind = 'settlement'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  rows int not null check (rows between 1 and 10000),
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, imported_by) references ops.member
);
create function ops.import_file_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_command text := nullif(current_setting('munshi.command', true), '');
begin
  if current_user <> 'munshi_app' or ctx_command is distinct from 'settlement.import' or ctx_actor is null
     or not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.role in ('owner', 'manager') and m.active) then
    raise exception 'import refused: an owner or manager records a settlement import' using errcode = 'MS007';
  end if;
  new.imported_by := ctx_actor;
  new.imported_at := clock_timestamp();
  return new;
end $$;
revoke execute on function ops.import_file_guard() from public;
create trigger guard before insert on ops.import_file for each row execute function ops.import_file_guard();

create function ops.import_file_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, new.imported_by, 'settlement.import', 'ops.import_file', new.id,
          jsonb_build_object('sha256', new.sha256));
  return null;
end $$;
revoke execute on function ops.import_file_audit() from public;
create trigger audit after insert on ops.import_file for each row execute function ops.import_file_audit();
create unique index import_file_sha256 on ops.import_file (tenant_id, sha256);

-- Settlement import's book rows are ordinary, audited settlement records under the importing person's authority.
insert into ref.command (command, draft_only) values ('settlement.import', false);
insert into ref.command_authority (command, role) values ('settlement.import', 'owner'), ('settlement.import', 'manager');
insert into ref.command_table (command, rel) values
  ('settlement.import', 'books.settlement'), ('settlement.import', 'books.journal_entry'), ('settlement.import', 'books.journal_line');
insert into ref.command_capability (command, capability, use) values ('settlement.import', 'counter', 'start');

-- Tenant-keyed import and model history, and global reference/config rows.
alter table ref.ai_agent enable row level security;
alter table ref.ai_agent force row level security;
create policy global_rows on ref.ai_agent using (true) with check (true);
revoke all on ref.ai_agent from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.ai_agent to munshi_app, munshi_jobs;

alter table platform.model_allow enable row level security;
alter table platform.model_allow force row level security;
create policy global_rows on platform.model_allow using (true) with check (true);
revoke all on platform.model_allow from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.model_allow to munshi_platform;
grant select on platform.model_allow to munshi_app, munshi_jobs;

alter table platform.ai_usage_total enable row level security;
alter table platform.ai_usage_total force row level security;
create policy global_rows on platform.ai_usage_total using (true) with check (true);
revoke all on platform.ai_usage_total from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;

alter table ops.model_choice enable row level security;
alter table ops.model_choice force row level security;
create policy tenant_isolation on ops.model_choice
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.model_choice from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.model_choice to munshi_app;
grant select on ops.model_choice to munshi_jobs;

alter table ops.import_file enable row level security;
alter table ops.import_file force row level security;
create policy tenant_isolation on ops.import_file
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.import_file from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.import_file to munshi_app;
grant select on ops.import_file to munshi_jobs;
