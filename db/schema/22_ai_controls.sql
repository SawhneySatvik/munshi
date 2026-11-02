-- 22 · Model controls, the deployment AI-call ceiling, settlement-import provenance, and the spend ledger with each
-- shop's monthly AI budget (W1-C).
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

-- The spend ledger (W1-C): one row per model call, written right after the call from the run's port, in the context
-- its trace is written in: the app as an active member (the run's), or the jobs role with no actor. The app with no
-- actor (allow()'s system transaction) is refused (MS018). The agent role has no write grant. A row records a call
-- that happened, so no role may UPDATE or DELETE it. The writer's contract:
--   run_id          the call's run (every model call traces through a run's port, so never NULL)
--   role            the role the call served, the set ai.usage takes
--   alias           the alias that answered (after any fallback), as platform.model_allow spells it; no provider name
--   tokens_in, tokens_out, tokens_cached
--                   as the adapter reported them, each >= 0. Whether cached tokens are inside tokens_in differs by
--                   provider, so it is the price table's rule and no check relates them
--   cost_minor_e6, currency
--                   the call's cost in millionths of a minor unit (1000000 = one cent, one paisa) of an ISO currency,
--                   both or neither. A call's cost is mostly a fraction of a minor unit, so a whole-minor column would
--                   sum to nothing. With a price in minor units per million tokens, cost_minor_e6 = tokens × price, in
--                   integers; a price that is not a whole number of minor units per million rounds up per call. NULL
--                   for an alias with no price: the screen shows "Cannot verify", never a guessed figure. At most
--                   10^15 (a billion minor units for one call), so a units bug is refused, not summed
--   at              stamped here at now(), so no row can be backdated out of this month's sum
create table ai.spend (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate')),
  alias text not null check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
  tokens_in int not null check (tokens_in >= 0),
  tokens_out int not null check (tokens_out >= 0),
  tokens_cached int not null default 0 check (tokens_cached >= 0),
  cost_minor_e6 bigint check (cost_minor_e6 between 0 and 1000000000000000),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ai.run,
  check ((cost_minor_e6 is null) = (currency is null))
);
create index spend_at on ai.spend (tenant_id, at);

create function ai.spend_stamp() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
begin
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active))
          or (current_user = 'munshi_jobs' and ctx_actor is null)) then
    raise exception 'spend refused: a call''s spend is the app''s, as a member, or the jobs role''s, with no actor' using errcode = 'MS018';
  end if;
  new.at := now();
  return new;
end $$;
revoke execute on function ai.spend_stamp() from public;
create trigger stamp before insert on ai.spend for each row execute function ai.spend_stamp();

-- A shop's monthly AI budget: latest wins (`order by effective_from desc, id desc`), written only under an approved
-- `ai_budget` change whose payload is exactly {monthly_minor, currency} (platform_guard, 09). No row, or a row with a
-- NULL amount, means no money cap. The amount is in whole minor units; the change payload admits no number above
-- 100000 (CH1, 09), so neither does this column. Budgets are set in USD (the prices are USD, and the schema converts
-- nothing), so the ceiling is $1,000 a month; the currency column keeps the row's unit explicit.
create table platform.ai_budget (
  id uuid primary key default ops.uuidv7(),
  tenant_id uuid not null references ops.tenant,
  monthly_minor bigint check (monthly_minor between 0 and 100000),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change,
  check ((monthly_minor is null) = (currency is null))
);
create index ai_budget_latest on platform.ai_budget (tenant_id, effective_from desc, id desc);
create trigger guard before insert on platform.ai_budget for each row
  execute function platform.platform_guard('ai_budget', 'monthly_minor', 'currency');
create trigger audit after insert on platform.ai_budget for each row execute function platform.audit_write();

-- This month's spend against the shop's budget, for allow() and the screens: `select * from ai.spend_month()`, one row,
-- for the shop the transaction names in munshi.tenant_id (MS003 with none). It takes no shop argument, but any role with
-- EXECUTE can set munshi.tenant_id to any shop: what keeps a caller to its own shop is the app setting the tenant from
-- the signed-in session (and the jobs runner from the job's tenant), as for every tenant read. Invoker: ai.spend's RLS
-- applies under that tenant. The month is the shop's (ops.tenant.time_zone), from month_from up to, not including,
-- month_to. The schema converts no currency, so only calls priced in the budget's currency are summed; calls priced in
-- another currency, and calls with no price, are counted apart, for the screen to show "Cannot verify".
--   budget_minor, currency  the latest budget, in whole minor units; NULL is no money cap
--   spent_minor_e6          the exact sum, in millionths of a minor unit; NULL with no budget
--   spent_minor             that sum rounded up to whole minor units (never under-reports), for display
--   calls                   this month's calls with a spend row
--   unpriced_calls          of those, the ones with no price
--   other_currency_calls    of those, the ones priced in another currency than the budget's (with no budget, every
--                           priced call)
--   state                   'hard' once spent >= budget (a budget of 0 is hard at once); else 'soft' once spent >= 80%
--                           of it; else 'under'; always 'under' with no budget. Compared exactly, in millionths, in
--                           numeric, so no month's sum overflows the comparison.
-- Calls already admitted when the state is read may still pass a line: allow() reads it, then the call runs.
-- The screens' breakdown (this month by cast member, role and alias) is a plain read under the shop's context, on
-- ai.spend_at:
--   select r.desk, r.trigger, s.role, s.alias, s.currency, count(*) as calls, sum(s.cost_minor_e6) as cost_minor_e6,
--          count(*) filter (where s.cost_minor_e6 is null) as unpriced_calls
--     from ai.spend s join ai.run r on r.tenant_id = s.tenant_id and r.id = s.run_id
--    where s.at >= $month_from and s.at < $month_to group by 1, 2, 3, 4, 5
create function ai.spend_month()
  returns table (month_from timestamptz, month_to timestamptz, budget_minor bigint, currency char(3), spent_minor_e6 bigint,
                 spent_minor bigint, calls int, unpriced_calls int, other_currency_calls int, state text)
  language plpgsql stable
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_budget bigint;
  v_currency char(3);
  v_spent numeric;
  v_calls int;
  v_unpriced int;
  v_other int;
begin
  select t.time_zone into tz from ops.tenant t where t.tenant_id = ctx;
  if tz is null then
    raise exception 'spend refused: no shop in this transaction''s context' using errcode = 'MS003';
  end if;
  v_from := date_trunc('month', now() at time zone tz) at time zone tz;
  v_to := (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz;
  select b.monthly_minor, b.currency into v_budget, v_currency
    from platform.ai_budget b where b.tenant_id = ctx order by b.effective_from desc, b.id desc limit 1;
  select case when v_currency is null then null
              else coalesce(sum(s.cost_minor_e6) filter (where s.currency = v_currency), 0) end,
         count(*)::int,
         (count(*) filter (where s.cost_minor_e6 is null))::int,
         (count(*) filter (where s.cost_minor_e6 is not null and s.currency is distinct from v_currency))::int
    into v_spent, v_calls, v_unpriced, v_other
    from ai.spend s
   where s.tenant_id = ctx and s.at >= v_from and s.at < v_to;
  return query select v_from, v_to, v_budget, v_currency, v_spent::bigint, ceil(v_spent / 1000000)::bigint, v_calls, v_unpriced, v_other,
    case when v_budget is null then 'under'
         when v_spent >= v_budget * 1000000 then 'hard'
         when v_spent * 5 >= v_budget * 4000000 then 'soft'
         else 'under' end;
end $$;
revoke execute on function ai.spend_month() from public;
grant execute on function ai.spend_month() to munshi_app, munshi_jobs, munshi_platform;

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

alter table ai.spend enable row level security;
alter table ai.spend force row level security;
create policy tenant_isolation on ai.spend
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.spend from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.spend to munshi_app, munshi_jobs;
grant select on ai.spend to munshi_platform;

alter table platform.ai_budget enable row level security;
alter table platform.ai_budget force row level security;
create policy global_rows on platform.ai_budget using (true) with check (true);
revoke all on platform.ai_budget from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.ai_budget to munshi_platform;
grant select on platform.ai_budget to munshi_app, munshi_jobs;
