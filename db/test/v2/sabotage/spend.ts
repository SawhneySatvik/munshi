// Red-proofs of the spend ledger and money cap gates (test/v2/gates/22-ai-spend.test.ts).
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
const SPEND6 = 'SPEND6 ai.spend_month() reads under, soft from 80% and hard from 100% of the budget, exactly, in its currency, for this shop only';

export const SPEND_CASES: Case[] = [
  t(SPEND1, 'v2-spend-stamp', mutate(STAMP, 'new.at := now();', 'new.at := coalesce(new.at, now());')),
  t(SPEND1, 'v2-spend-writer', mutate(STAMP, "(current_user = 'munshi_jobs' and ctx_actor is null)", "current_user = 'munshi_jobs'")),
  t(SPEND1, 'v2-spend-member-active', mutate(STAMP, 'm.id = ctx_actor and m.active', 'm.id = ctx_actor')),
  t(SPEND1, 'v2-spend-member-tenant', mutate(STAMP, 'm.tenant_id = new.tenant_id and m.id = ctx_actor', 'm.id = ctx_actor')),
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
