// Red-proofs of the spend ledger and money cap gates (test/v2/gates/22-ai-spend.test.ts), and of the model role set
// (test/v2/gates/22-ai-roles.test.ts, the speak role).
import type { Case } from './case.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/22-ai-spend.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const STAMP = 'ai.spend_stamp()';
const MONTH = 'ai.spend_month()';

const SPEND1 = 'SPEND1 a call writes its spend row, as the app with an active member or the jobs role with no actor, stamped at now';
const SPEND2 = 'SPEND2 no role updates or deletes a spend row';
const SPEND3 = "SPEND3 another shop neither reads nor writes a shop's spend rows, the table's owner included (RLS forced)";
const SPEND4 = 'SPEND4 a cost needs its currency and a currency its cost; an unpriced call has neither; nothing is negative, no cost past 10^15';
const SPEND5 = 'SPEND5 a shop’s AI budget is written only under an approved ai_budget change for exactly that payload, and chained';
const SPEND7 = "SPEND7 a call's spend is written only against the writer's own open run";
const SPEND6 = 'SPEND6 ai.spend_month() reads under, soft from 80% and hard from 100% of the budget, exactly, in its currency, for this shop only';

const LEDGER_CASES: Case[] = [
  t(SPEND1, 'v2-spend-stamp', mutate(STAMP, 'new.at := now();', 'new.at := coalesce(new.at, now());')),
  t(SPEND1, 'v2-spend-writer', mutate(STAMP, "(current_user = 'munshi_jobs' and ctx_actor is null)", "current_user = 'munshi_jobs'")),
  t(SPEND1, 'v2-spend-member-active', mutate(STAMP, 'm.id = ctx_actor and m.active', 'm.id = ctx_actor')),
  t(SPEND1, 'v2-spend-member-tenant', mutate(STAMP, 'm.tenant_id = new.tenant_id and m.id = ctx_actor', 'm.id = ctx_actor')),
  t(SPEND7, 'v2-spend-run-ended', mutate(STAMP, 'if found and run_ended is not null then', 'if false then')),
  t(SPEND7, 'v2-spend-run-own', mutate(STAMP, 'if found and run_by is distinct from ctx_actor then', 'if false then')),
  t(SPEND7, 'v2-spend-run-starter', mutate(STAMP, 'if found and run_by is distinct from ctx_actor then', 'if found and ctx_actor is not null and run_by is distinct from ctx_actor then')),
  t(SPEND7, 'v2-spend-run-tenant', mutate(STAMP, 'where r.tenant_id = new.tenant_id and r.id = new.run_id', 'where false')),
  t(SPEND2, 'v2-spend-update', 'grant update (tokens_in) on ai.spend to munshi_app;'),
  t(SPEND2, 'v2-spend-delete', 'grant delete on ai.spend to munshi_jobs;'),
  t(SPEND3, 'v2-spend-rls-policy', 'drop policy tenant_isolation on ai.spend; create policy tenant_isolation on ai.spend using (true) with check (true);'),
  t(SPEND3, 'v2-spend-rls-force', asOwner('alter table ai.spend no force row level security;')),
  t(SPEND3, 'v2-spend-with-check', `drop policy tenant_isolation on ai.spend; create policy tenant_isolation on ai.spend
    using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid)) with check (true);`),
  t(SPEND4, 'v2-spend-currency', dropCheck('ai.spend', '(cost_minor_e6 IS NULL) = (currency IS NULL)')),
  t(SPEND4, 'v2-spend-cost-bound', dropCheck('ai.spend', '1000000000000000')),
  t(SPEND5, 'v2-spend-budget-guard', asOwner('drop trigger guard on platform.ai_budget;')),
  t(SPEND5, 'v2-spend-budget-kind', asOwner(`drop trigger guard on platform.ai_budget; create trigger guard before insert on platform.ai_budget
    for each row execute function platform.platform_guard('ai_budget|shop_config', 'monthly_minor', 'currency');`)),
  t(SPEND6, 'v2-spend-soft-line', mutate(MONTH, 'when v_spent * 5 >= v_budget * 4000000', 'when v_spent * 5 > v_budget * 4000000')),
  t(SPEND6, 'v2-spend-hard-line', mutate(MONTH, 'when v_spent >= v_budget * 1000000', 'when v_spent > v_budget * 1000000')),
  t(SPEND6, 'v2-spend-currency-sum', mutate(MONTH, 'filter (where s.currency = v_currency)', 'filter (where true)')),
  t(SPEND6, 'v2-spend-month-window', mutate(MONTH, 's.at >= v_from and ', '')),
  t(SPEND6, 'v2-spend-zone-utc', mutate(MONTH, 'select t.time_zone into tz', "select 'UTC'::text into tz")),
  t(SPEND6, 'v2-spend-rolling-window', mutate(MONTH, "v_from := date_trunc('month', now() at time zone tz) at time zone tz;", "v_from := now() - interval '20 days';")),
];

const ROLES_FILE = 'test/v2/gates/22-ai-roles.test.ts';
const r = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: ROLES_FILE, test, config: V2, sql });
const OLD_ROLES = "('router', 'reason', 'vision', 'segment', 'voice', 'narrate')";
// A column's check put back to the set before speak; NOT VALID, so rows the fixtures already wrote cannot stop it applying.
const narrow = (table: string, column: string, set: string) => `${dropCheck(table, "'speak'")} alter table ${table} add check (${column} in ${set}) not valid;`;
const CHOICE = 'ops.model_choice_guard()';

const SPEAK1 = 'SPEAK1 every check that lists the model roles lists exactly the same ones, speak among them, on the role tables only';
const SPEAK2 = "SPEAK2 the speak desk serves the speak role, and a read-aloud starts its own run under the speak trigger, a member's only";
const SPEAK3 = 'SPEAK3 an approved allow-list row for speak, and an owner choosing it for the speak desk, are taken; another role or set is refused';
const SPEAK4 = 'SPEAK4 the role checks of ai.usage and ai.spend admit speak and refuse a role outside the set';

const SPEAK_CASES: Case[] = [
  r(SPEAK1, 'v2-speak-set-drops', narrow('ai.usage', 'role', OLD_ROLES)),
  r(SPEAK1, 'v2-speak-set-new-table', `create table ops.voice_log (role text check (role in ${OLD_ROLES}));`),
  r(SPEAK1, 'v2-speak-set-drifts', `${dropCheck('ref.ai_agent', "'speak'")}
    alter table ref.ai_agent add check (role in ('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak', 'shout'));`),
  r(SPEAK2, 'v2-speak-desk', "delete from ref.ai_agent where agent = 'speak';"),
  r(SPEAK2, 'v2-speak-trigger', `${dropCheck('ai.run', "'recipe'")}
    alter table ai.run add check (trigger in ('question', 'voice', 'watcher', 'brief', 'photo', 'inbox', 'campaign', 'recipe')) not valid;`),
  r(SPEAK2, 'v2-speak-trigger-open', dropCheck('ai.run', "'recipe'")),
  r(SPEAK2, 'v2-speak-run-starter', dropCheck('ai.run', 'started_by IS NOT NULL')),
  r(SPEAK3, 'v2-speak-allow-set', narrow('platform.model_allow', 'role', OLD_ROLES)),
  r(SPEAK3, 'v2-speak-choice-role', mutate(CHOICE, 'where ma.alias = new.alias and ma.role = a.role', 'where ma.alias = new.alias')),
  r(SPEAK3, 'v2-speak-allow-open', dropCheck('platform.model_allow', "'speak'")),
  r(SPEAK4, 'v2-speak-usage-set', narrow('ai.usage', 'role', OLD_ROLES)),
  r(SPEAK4, 'v2-speak-spend-set', narrow('ai.spend', 'role', OLD_ROLES)),
  r(SPEAK4, 'v2-speak-usage-open', dropCheck('ai.usage', "'speak'")),
  r(SPEAK4, 'v2-speak-spend-open', dropCheck('ai.spend', "'speak'")),
];

// Both sets join the registry as SPEND_CASES, so sabotage/index.ts is unchanged.
export const SPEND_CASES: Case[] = [...LEDGER_CASES, ...SPEAK_CASES];
