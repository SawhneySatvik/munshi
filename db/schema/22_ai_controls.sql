-- 22 · Model controls, the deployment AI-call ceiling, settlement-import provenance, and the spend ledger with each
-- shop's monthly AI budget (W1-C).
set local role munshi_owner;

create table ref.ai_agent (
  agent text primary key check (agent ~ '^[a-z][a-z0-9_]{1,31}$'),
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video'))
);
-- The speak role reads aloud text already validated (the brief, an answer) and writes no text of its own; its desk is
-- `speak`, so an owner picks its model like any other agent's. D-081's two roles: `document` (any PDF-capable model;
-- desk `documents`) and `video` (a shelf walk-through clip counted into a stock.count draft; desk `shelf_video`). A clip's
-- run starts under trigger `photo`, as a shelf photo's and a bill's (PDF included) do: the trigger says a member captured
-- media, and no rule reads it beyond speak's; the desk names the clip.
insert into ref.ai_agent (agent, role) values
  ('ask', 'reason'), ('counter', 'reason'), ('bills', 'vision'), ('shelf', 'vision'), ('voice', 'voice'),
  ('brief', 'narrate'), ('chat_to_order', 'reason'), ('campaigns', 'reason'), ('replies', 'reason'), ('settlements', 'reason'),
  ('speak', 'speak'), ('documents', 'document'), ('shelf_video', 'video');

create table platform.model_allow (
  id uuid primary key default ops.uuidv7(),
  alias text not null check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video')),
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

-- An owner's pick of the model for one agent, the latest winning. alias NULL is "Default": follow the shop's default for
-- the agent's role (the operator's, ai.shop_models()), else the edition's, as either changes later; the guard checks
-- an alias against the lists only when one is named.
create table ops.model_choice (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  agent text not null references ref.ai_agent(agent),
  alias text check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
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
     or (new.alias is not null and not exists (
       select 1 from ref.ai_agent a
        where a.agent = new.agent
          and (select ma.enabled from platform.model_allow ma
                where ma.alias = new.alias and ma.role = a.role
                order by ma.effective_from desc, ma.id desc limit 1) is true
          -- The shop's own list for the role, once it has one (platform.shop_model, below), narrows the deployment's.
          and (not exists (select 1 from platform.shop_model sm where sm.tenant_id = new.tenant_id and sm.role = a.role)
               or (select sm.allowed from platform.shop_model sm
                    where sm.tenant_id = new.tenant_id and sm.alias = new.alias and sm.role = a.role
                    order by sm.effective_from desc, sm.id desc limit 1) is true)
     )) then
    raise exception 'model choice refused: the active owner must choose a model enabled for this agent, on the shop''s list' using errcode = 'MS007';
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
          -- "Default" (alias NULL) is the entry with no alias: an entry's payload holds no null.
          jsonb_strip_nulls(jsonb_build_object('agent', new.agent, 'alias', new.alias)));
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
--   run_id          the call's run (every model call traces through a run's port, so never NULL). The run is open and
--                   the writer's own: the app's actor started it, or, for the jobs role, it has no starter. So the spend
--                   is written before the run ends (a brief's narration runs inside its open jobs run); a run of another
--                   shop is the foreign key's to refuse (23503)
--   role            the role the call served, the set ai.usage takes
--   alias           the alias that answered (after any fallback), as platform.model_allow spells it; no provider name
--   tokens_in, tokens_out, tokens_cached
--                   as the adapter reported them, each >= 0. Whether cached tokens are inside tokens_in differs by
--                   provider, so it is the price table's rule and no check relates them. For role 'speak' (text read
--                   aloud), tokens_in counts the characters of the text read and tokens_out is 0
--   cost_minor_e6, currency
--                   the call's cost in millionths of a minor unit (1000000 = one cent, one paisa) of an ISO currency,
--                   both or neither. A call's cost is mostly a fraction of a minor unit, so a whole-minor column would
--                   sum to nothing. With a price in minor units per million tokens, cost_minor_e6 = tokens × price, in
--                   integers (for 'speak', a price per million characters); a price that is not a whole number of minor
--                   units per million rounds up per call. NULL for an alias with no price (a speak alias too): the
--                   screen shows "Cannot verify", never a guessed figure. At most 10^15 (a billion minor units for one
--                   call), so a units bug is refused, not summed
--   at              stamped here at now(), so no row can be backdated out of this month's sum
create table ai.spend (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video')),
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
  run_by uuid;
  run_ended timestamptz;
begin
  if not ((current_user = 'munshi_app' and exists (
             select 1 from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active))
          or (current_user = 'munshi_jobs' and ctx_actor is null)) then
    raise exception 'spend refused: a call''s spend is the app''s, as a member, or the jobs role''s, with no actor' using errcode = 'MS018';
  end if;
  -- No run found under this context: the foreign key (or the policy) refuses the row.
  select r.started_by, r.ended_at into run_by, run_ended from ai.run r where r.tenant_id = new.tenant_id and r.id = new.run_id;
  if found and run_ended is not null then
    raise exception 'spend refused: a call''s spend is written while its run is open' using errcode = 'MS010';
  end if;
  if found and run_by is distinct from ctx_actor then
    raise exception 'spend refused: a call''s spend is written against the writer''s own run' using errcode = 'MS018';
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
-- The app and the jobs role read only their own shop's budget (ai.spend_month() reads it under the shop's context); the
-- platform role reads every shop's.
create policy own_shop on platform.ai_budget as restrictive for select to munshi_app, munshi_jobs
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on platform.ai_budget from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.ai_budget to munshi_platform;
grant select on platform.ai_budget to munshi_app, munshi_jobs;

-- The superadmin's router per shop (D-079 §8, D-081): on top of the deployment's allow-list, which models and which AI
-- features each shop may use, each set only by an approved platform change for that shop (platform_guard, 09), audited
-- and chained (platform.audit_write).
--
-- platform.shop_model, kind `shop_models`, payload exactly {alias, role, allowed, is_default}: one row per (shop, alias,
-- role), the latest winning (`order by effective_from desc, id desc`). Once a shop has any row for a role, its list for
-- that role is the aliases whose latest row is allowed, and the deployment's still bounds it (an alias the deployment
-- has disabled is off for every shop); a role the shop has no row for takes the deployment's list. The shop's default
-- for a role is the most recent allowed row marked is_default, while the deployment enables it; with none, the
-- caller's own default is the fallback (the contract: the edition's default from core's catalogue).
--
-- platform.shop_feature, kind `shop_features`, payload exactly {feature, enabled}: the latest row per (shop, feature)
-- wins, and a feature with no row is on. This does not duplicate the AI switch: whether a shop has AI at all stays
-- platform.shop_config's ai_enabled (a real shop has none until the operator turns AI on, spec §1) or, for a sample
-- shop with no row, the demo default (as core's platformLimits reads them). The contract: a feature is usable when AI
-- is on there AND its switch here is on, so a real shop's every feature is off until AI is turned on, a sample shop's
-- all on, and the operator can turn single features off for either. Core does not yet read the switches here (its
-- modelFor and feature checks are the next builder lane's): until it does, only the refusals below hold.
--
-- Where a write exists the database refuses a feature that is off (MS021, ai.feature_gate): a member's or a run's AI run
-- of that feature (ai.run by trigger: question = ask, photo = photos, voice = voice, speak = read_aloud, campaign =
-- campaign_copy, inbox = inbox_drafts), the brief's narrated lines (ai.answer kind brief_line = narration), and a memory
-- note (ai.memory = memory, attached in 23). A brief, watcher or recipe run is not a feature's and is never refused here
-- (the brief's template runs without narration). A model off the shop's list is refused where it is chosen
-- (ops.model_choice's guard, above). The contract for every model call is ai.shop_models() (core's modelFor is to read
-- it in place of platform.model_allow); a call's spend row (ai.spend) is always kept, since it records a call that
-- happened, so the database does not refuse a call's alias there.
create table platform.shop_model (
  id uuid primary key default ops.uuidv7(),
  tenant_id uuid not null references ops.tenant,
  alias text not null check (alias ~ '^[a-z0-9][a-z0-9.-]{1,31}$'),
  role text not null check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'document', 'video')),
  allowed boolean not null,
  is_default boolean not null,
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change,
  check (allowed or not is_default)
);
create index shop_model_latest on platform.shop_model (tenant_id, role, alias, effective_from desc, id desc);
create trigger guard before insert on platform.shop_model for each row
  execute function platform.platform_guard('shop_models', 'alias', 'role', 'allowed', 'is_default');
create trigger audit after insert on platform.shop_model for each row execute function platform.audit_write();

create table platform.shop_feature (
  id uuid primary key default ops.uuidv7(),
  tenant_id uuid not null references ops.tenant,
  feature text not null check (feature in ('ask', 'photos', 'voice', 'read_aloud', 'narration', 'campaign_copy', 'inbox_drafts', 'memory')),
  enabled boolean not null,
  effective_from timestamptz not null default now(),
  change_id uuid not null references platform.change
);
create index shop_feature_latest on platform.shop_feature (tenant_id, feature, effective_from desc, id desc);
create trigger guard before insert on platform.shop_feature for each row
  execute function platform.platform_guard('shop_features', 'feature', 'enabled');
create trigger audit after insert on platform.shop_feature for each row execute function platform.audit_write();

-- The shop's effective models, the read core's modelFor, the AI staff page and the console's router panel use:
-- `select * from ai.shop_models()`, every (role, alias) the shop may use now, under the transaction's shop (MS003 with
-- none), as the rules above say. Invoker; the app and the jobs role read only their own shop's platform rows (policy
-- own_shop); the platform role reads every shop's, so it names the shop by its context (the console's shopIn sets it),
-- as for ai.spend_month().
--   role, alias   an alias the deployment enables for the role and, where the shop has a list for the role, on it
--   is_default    the shop's own default for the role (at most one per role); false everywhere when it has none
--   source        'shop' where the shop's list governs the role, 'deployment' where the deployment's does
create function ai.shop_models() returns table (role text, alias text, is_default boolean, source text) language plpgsql stable
  set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare
  ctx uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
begin
  if ctx is null then
    raise exception 'models refused: no shop in this transaction''s context' using errcode = 'MS003';
  end if;
  return query
    with dep as (select distinct on (a.alias, a.role) a.alias, a.role, a.enabled from platform.model_allow a
                  order by a.alias, a.role, a.effective_from desc, a.id desc),
         shop as (select distinct on (m.alias, m.role) m.alias, m.role, m.allowed, m.is_default, m.effective_from, m.id
                    from platform.shop_model m where m.tenant_id = ctx
                   order by m.alias, m.role, m.effective_from desc, m.id desc),
         listed as (select distinct x.role from shop x),
         dflt as (select distinct on (x.role) x.role, x.alias from shop x
                   where x.allowed and x.is_default order by x.role, x.effective_from desc, x.id desc)
    select d.role, d.alias, coalesce(f.alias = d.alias, false), case when l.role is null then 'deployment' else 'shop' end
      from dep d left join listed l on l.role = d.role left join dflt f on f.role = d.role
     where d.enabled
       and (l.role is null or exists (select 1 from shop x where x.alias = d.alias and x.role = d.role and x.allowed))
     order by d.role, d.alias;
end $$;
revoke execute on function ai.shop_models() from public;
grant execute on function ai.shop_models() to munshi_app, munshi_jobs, munshi_platform;

-- The shop's AI features: `select * from ai.shop_features()`, one row per feature, under the transaction's shop (MS003
-- with none; the console's platform role sets it, as for ai.shop_models()). enabled is the feature's own switch (true with no row); change_id names the approved change behind it
-- (NULL with no row). The contract: a caller ANDs it with the shop's AI switch (platformLimits) before offering the
-- surface. A refusal here reaches core as CoreError feature_off (MS021, errors.ts).
create function ai.shop_features() returns table (feature text, enabled boolean, change_id uuid) language plpgsql stable
  set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare
  ctx uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
begin
  if ctx is null then
    raise exception 'features refused: no shop in this transaction''s context' using errcode = 'MS003';
  end if;
  return query
    select f.feature, coalesce(x.enabled, true), x.change_id
      from unnest(array['ask', 'photos', 'voice', 'read_aloud', 'narration', 'campaign_copy', 'inbox_drafts', 'memory']) f(feature)
      left join lateral (select s.enabled, s.change_id from platform.shop_feature s where s.tenant_id = ctx and s.feature = f.feature
                          order by s.effective_from desc, s.id desc limit 1) x on true
     order by f.feature;
end $$;
revoke execute on function ai.shop_features() from public;
grant execute on function ai.shop_features() to munshi_app, munshi_jobs, munshi_platform;

-- ai.feature_gate(), trigger `feature`, before insert on ai.run, ai.answer (here) and ai.memory (23): the row's feature,
-- by its table, and MS021 when that feature's latest switch for the row's shop is off. Read as the writing role, under
-- its own shop's policy; a row for another shop is the tenant policy's to refuse anyway.
create function ai.feature_gate() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  f text;
begin
  if tg_table_name = 'run' then
    f := case new.trigger when 'question' then 'ask' when 'photo' then 'photos' when 'voice' then 'voice' when 'speak' then 'read_aloud'
                          when 'campaign' then 'campaign_copy' when 'inbox' then 'inbox_drafts' end;
  elsif tg_table_name = 'answer' then
    f := case when new.kind = 'brief_line' then 'narration' end;
  elsif tg_table_name = 'memory' then
    f := 'memory';
  else
    raise exception 'feature_gate: %.% has no feature', tg_table_schema, tg_table_name using errcode = 'MS021';
  end if;
  if f is not null and (select s.enabled from platform.shop_feature s where s.tenant_id = new.tenant_id and s.feature = f
                         order by s.effective_from desc, s.id desc limit 1) is false then
    raise exception '%.% refused: the operator has turned this shop''s % off', tg_table_schema, tg_table_name, f using errcode = 'MS021';
  end if;
  return new;
end $$;
revoke execute on function ai.feature_gate() from public;
create trigger feature before insert on ai.run for each row execute function ai.feature_gate();
create trigger feature before insert on ai.answer for each row execute function ai.feature_gate();

alter table platform.shop_model enable row level security;
alter table platform.shop_model force row level security;
create policy global_rows on platform.shop_model using (true) with check (true);
create policy own_shop on platform.shop_model as restrictive for select to munshi_app, munshi_jobs
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on platform.shop_model from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.shop_model to munshi_platform;
grant select on platform.shop_model to munshi_app, munshi_jobs;

alter table platform.shop_feature enable row level security;
alter table platform.shop_feature force row level security;
create policy global_rows on platform.shop_feature using (true) with check (true);
create policy own_shop on platform.shop_feature as restrictive for select to munshi_app, munshi_jobs
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on platform.shop_feature from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on platform.shop_feature to munshi_platform;
grant select on platform.shop_feature to munshi_app, munshi_jobs;
