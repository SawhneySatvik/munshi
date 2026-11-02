// The office's desks (/app/office, W1-B): what each cast member's runs did over the last seven days, and one run's trace
// step by step. Same rules as every named read (queries.ts): read-only under the tenant's RLS, at most 500 rows in a
// stable order, integral numbers, declared columns and key. The cast is the screen's (apps/web/lib/cast.ts); it comes in
// as the read's params (the cast in order, and which member a desk, else a trigger, names; the first answers for a run
// nothing names), so the stored snapshot says how its runs were grouped, and every count is counted here, never added up
// on a screen. The window is the database's clock: runs started in the seven days before the read.
// Type-only import: queries.ts spreads DESK_QUERIES while it is still being evaluated.
import { z } from 'zod';
import type { Column, NamedQuery } from './queries.ts';

const text: Column = { kind: 'text' };
const int: Column = { kind: 'integer' };
const stamp: Column = { kind: 'timestamp' };

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
];
