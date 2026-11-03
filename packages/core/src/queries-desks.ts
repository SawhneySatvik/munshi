// The office's desks (/app/office): what each cast member's runs did over the last seven days, and one run's trace step
// by step. Same rules as every named read (queries.ts): read-only under the tenant's RLS, at most 500 rows in a stable
// order, integral numbers, declared columns and key. The cast is the screen's (apps/web/lib/cast.ts); it comes in as
// the read's params (the cast in order, and which member a desk, else a trigger, names; the first answers for a run
// nothing names), so the stored snapshot says how its runs were grouped, and every count is counted here, never added
// up on a screen. The window is the database's clock: runs started in the seven days before the read. Type-only import:
// queries.ts spreads DESK_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };
const money: Column = { kind: 'money', currency: 'currency' };

const castId = z.string().regex(/^[a-z]{2,20}$/);

/** A run's cast member in SQL: the member its desk names, else its trigger's, else the first (`cast`, `desks` and
 *  `triggers` are the placeholders holding the cast array and the two jsonb maps). desks.week and the run log share it. */
export const castOfRun = (r: string, cast: string, desks: string, triggers: string) =>
  `coalesce(${desks}::jsonb ->> ${r}.desk, ${triggers}::jsonb ->> ${r}.trigger, (${cast}::text[])[1])`;
const code = z.string().regex(/^[a-z_]{2,40}$/);

export const DESK_QUERIES: [string, NamedQuery][] = [
  [
    // One row per cast member, in the order given: the window's runs, the drafts those runs proposed and the decisions on
    // them, the runs that abstained or failed, and the member's latest run in the window (an open run has no outcome)
    // with where its drafts stand: undecided (any still proposed), else approved, else rejected; null when it made none;
    // and whether it is a finished watcher or brief run that started in the last hour (1, else 0), by the database clock.
    'desks.week',
    {
      params: z.strictObject({ cast: z.array(castId).min(1).max(12), desks: z.record(code, castId), triggers: z.record(code, castId) }),
      order: ['cast', 'desks', 'triggers'],
      key: ['cast_id'],
      columns: {
        cast_id: text,
        runs: int,
        proposed: int,
        approved: int,
        rejected: int,
        abstained: int,
        failed: int,
        latest_run_id: text,
        latest_at: stamp,
        latest_outcome: text,
        latest_trigger: text,
        latest_desk: text,
        latest_draft: text,
        latest_watching: int,
      },
      sql: `with who as (select w.who, w.n from unnest($1::text[]) with ordinality as w(who, n)),
            runs as (
              select r.tenant_id, r.id, r.started_at, r.outcome, r.trigger, r.desk,
                     ${castOfRun('r', '$1', '$2', '$3')} as who
                from ai.run r
               where r.started_at > now() - interval '7 days'
            ),
            drafts as (
              select x.who, d.id, d.run_id, d.status,
                     exists (select 1 from approval.decision v where v.tenant_id = d.tenant_id and v.draft_id = d.id and v.verdict = 'approved') as approved,
                     exists (select 1 from approval.decision v where v.tenant_id = d.tenant_id and v.draft_id = d.id and v.verdict = 'rejected') as rejected
                from runs x join approval.draft d on d.tenant_id = x.tenant_id and d.run_id = x.id
            ),
            latest as (select distinct on (who) who, id, started_at, outcome, trigger, desk from runs order by who, started_at desc, id desc)
            select w.who as cast_id,
                   (select count(*) from runs x where x.who = w.who)::bigint as runs,
                   (select count(*) from drafts d where d.who = w.who)::bigint as proposed,
                   (select count(*) from drafts d where d.who = w.who and d.approved)::bigint as approved,
                   (select count(*) from drafts d where d.who = w.who and d.rejected)::bigint as rejected,
                   (select count(*) from runs x where x.who = w.who and x.outcome = 'abstained')::bigint as abstained,
                   (select count(*) from runs x where x.who = w.who and x.outcome = 'failed')::bigint as failed,
                   l.id::text as latest_run_id, l.started_at as latest_at, l.outcome as latest_outcome, l.trigger as latest_trigger,
                   l.desk as latest_desk,
                   case when l.id is null then null
                        when exists (select 1 from drafts d where d.run_id = l.id and d.status = 'proposed') then 'undecided'
                        when exists (select 1 from drafts d where d.run_id = l.id and d.approved) then 'approved'
                        when exists (select 1 from drafts d where d.run_id = l.id and d.rejected) then 'rejected'
                   end as latest_draft,
                   case when l.outcome is not null and l.trigger in ('watcher', 'brief') and l.started_at > now() - interval '1 hour'
                        then 1 else 0 end::bigint as latest_watching
              from who w left join latest l on l.who = w.who
             order by w.n
             limit 500`,
    },
  ],
  [
    // A run's trace, step by step: each step's kind, its fixed label (a model step's label names the role, then the alias
    // that answered) and how long it took.
    'desks.trace',
    {
      params: z.strictObject({ run_id: z.guid() }),
      order: ['run_id'],
      key: ['step'],
      columns: { step: int, kind: text, label: text, ms: int },
      sql: `select t.seq::bigint as step, t.kind, t.label, t.ms::bigint as ms
              from ai.trace t
             where t.run_id = $1::uuid
             order by t.seq
             limit 500`,
    },
  ],
  [
    // This month's AI spend against the shop's budget (ai.spend_month()), one row: the month's start, the budget and
    // the spend in whole minor units of the budget's currency (the spend rounded up, never under-reported; both null
    // with no budget), this month's calls, those with no price and those priced in another currency (their cost cannot
    // be verified against the budget), and the state: under, soft (from 80%) or hard (from 100%).
    'ai.spend_month',
    {
      params: z.strictObject({}),
      order: [],
      key: ['month_from'],
      columns: {
        month_from: stamp,
        budget_minor: money,
        spent_minor: money,
        currency: text,
        calls: int,
        unpriced_calls: int,
        other_currency_calls: int,
        state: text,
      },
      sql: `select m.month_from, m.budget_minor, m.spent_minor, m.currency::text as currency, m.calls::bigint as calls,
                   m.unpriced_calls::bigint as unpriced_calls, m.other_currency_calls::bigint as other_currency_calls, m.state
              from ai.spend_month() m`,
    },
  ],
  [
    // This month's calls by desk and the alias that answered: how many, and their cost in whole minor units rounded up,
    // null whenever a call of the group has no price (a partial sum would read as the whole: "Cannot verify").
    'ai.spend_by_desk',
    {
      params: z.strictObject({}),
      order: [],
      key: ['desk', 'alias'],
      columns: { desk: text, alias: text, calls: int, cost_minor: money, currency: text, unpriced_calls: int },
      sql: `with m as (select month_from, month_to from ai.spend_month())
            select r.desk, s.alias, count(*)::bigint as calls,
                   case when count(*) filter (where s.cost_minor_e6 is null) > 0 or count(distinct s.currency) <> 1 then null
                        else ceil(sum(s.cost_minor_e6) / 1000000.0)::bigint end as cost_minor,
                   case when count(distinct s.currency) = 1 then min(s.currency)::text end as currency,
                   (count(*) filter (where s.cost_minor_e6 is null))::bigint as unpriced_calls
              from ai.spend s join ai.run r on r.tenant_id = s.tenant_id and r.id = s.run_id, m
             where s.at >= m.month_from and s.at < m.month_to
             group by r.desk, s.alias
             order by r.desk, s.alias
             limit 500`,
    },
  ],
];
