// Salary: the period's preview, one row per staff member, and the one SQL behind both the named read salary.preview
// (queries-staff.ts, whose every figure is a cell) and the salary.run it drafts (commands-staff.ts, which re-derives
// these rows with it). Each distinct day counts once; the day's mark is the latest of the highest rank (an owner's or
// manager's over a staff member's). The rules, as the screen states them:
// - the terms are the latest in effect on the period's last day; their branch is the run's, when the run names one;
// - daily: pay × days present, a half day counting half and a day of paid leave counting (half for a half day), at most
//   one a day, rounded half up to the paisa;
// - monthly: pay − (pay ÷ 30) × unpaid days, rounded half up, never below zero; an unpaid day is a day of unpaid leave
//   that is not a holiday (half for a half day), or a day before the staff member's first terms;
// - sick leave neither pays a daily wage nor docks a monthly one; an absent mark docks nothing (the desk records unpaid
//   leave for that); a holiday pays a daily wage only when they were marked present;
// - advance recovery: the whole outstanding balance, up to the gross, so the net is never below zero.
// A staff member with a live line for an overlapping period is left out, so no one is paid twice (b_one_live_pay refuses
// it too). No name: a staff member is an id here, named on the screen from the vault.
import { z } from 'zod';
import { daysBetween } from './time.ts';

export const MAX_PERIOD_DAYS = 31;

// A period of one to 31 days, first to last.
export const period = (start: string, end: string) => daysBetween(start, end) >= 0 && daysBetween(start, end) < MAX_PERIOD_DAYS;

export const previewParams = z
  .strictObject({ period_start: z.iso.date(), period_end: z.iso.date(), shop_id: z.guid().optional() })
  .refine((p) => period(p.period_start, p.period_end), { path: ['period_end'] });

// $1 period_start, $2 period_end, $3 the branch or null.
export const SALARY_PREVIEW = `
  with days as (select d::date as day from generate_series($1::date, $2::date, interval '1 day') d),
  terms as (
    select distinct on (t.staff_id) t.tenant_id, t.id, t.staff_id, t.shop_id, t.pay_kind, t.pay_minor, t.currency
      from books.staff_terms t
     where t.effective_from <= $2::date
     order by t.staff_id, t.effective_from desc, t.created_at desc, t.id desc
  ),
  staff as (
    select t.*, (select min(f.effective_from) from books.staff_terms f where f.tenant_id = t.tenant_id and f.staff_id = t.staff_id) as joined
      from terms t
     where ($3::uuid is null or t.shop_id = $3::uuid)
       and not exists (
         select 1 from books.salary_line l join books.salary_run r on r.tenant_id = l.tenant_id and r.id = l.run_id
          where l.tenant_id = t.tenant_id and l.staff_id = t.staff_id and l.reverses_id is null
            and daterange(r.period_start, r.period_end, '[]') && daterange($1::date, $2::date, '[]')
            and not exists (select 1 from books.salary_line x where x.tenant_id = l.tenant_id and x.reverses_id = l.id))
  ),
  each_day as (
    select s.staff_id, d.day < s.joined as before_joining, lv.kind as leave_kind, lv.half_day as leave_half,
           (select a.status from books.attendance a where a.tenant_id = s.tenant_id and a.staff_id = s.staff_id and a.day = d.day
             order by a.marked_by_role = 'staff', a.created_at desc, a.id desc limit 1) as mark,
           exists (select 1 from books.holiday h
                    where h.tenant_id = s.tenant_id and h.day = d.day and (h.shop_id is null or h.shop_id = s.shop_id) and h.reverses_id is null
                      and not exists (select 1 from books.holiday x where x.tenant_id = h.tenant_id and x.reverses_id = h.id)) as holiday
      from staff s cross join days d
      left join lateral (
        select l.kind, l.half_day from books.leave l
         where l.tenant_id = s.tenant_id and l.staff_id = s.staff_id and l.reverses_id is null and d.day between l.first_day and l.last_day
           and not exists (select 1 from books.leave x where x.tenant_id = l.tenant_id and x.reverses_id = l.id)
         limit 1) lv on true
  ),
  counted as (
    select s.tenant_id, s.staff_id, s.id as terms_id, s.pay_kind, s.pay_minor, s.currency,
           sum(least(1000, (case e.mark when 'present' then 1000 when 'half_day' then 500 else 0 end)
                         + (case when e.leave_kind = 'paid' then case when e.leave_half then 500 else 1000 end else 0 end)))::bigint as worked,
           sum(case when e.before_joining then 1000
                    when e.leave_kind = 'unpaid' and not e.holiday then case when e.leave_half then 500 else 1000 end
                    else 0 end)::bigint as unpaid
      from staff s join each_day e on e.staff_id = s.staff_id
     group by s.tenant_id, s.staff_id, s.id, s.pay_kind, s.pay_minor, s.currency
  ),
  gross as (
    select c.*,
           case when c.pay_kind = 'daily' then c.worked else (select count(*) from days) * 1000 - c.unpaid end as days_milli,
           case when c.pay_kind = 'daily' then 0 else c.unpaid end as unpaid_milli,
           case when c.pay_kind = 'daily' then (c.pay_minor * c.worked + 500) / 1000
                else greatest(0, c.pay_minor - (c.pay_minor * c.unpaid + 15000) / 30000) end as gross_minor,
           greatest(0, coalesce((select sum(a.amount_minor) from books.advance a
                                  where a.tenant_id = c.tenant_id and a.staff_id = c.staff_id and a.currency = c.currency), 0)
                     - coalesce((select sum(l.advance_recovered_minor) from books.salary_line l
                                  where l.tenant_id = c.tenant_id and l.staff_id = c.staff_id and l.currency = c.currency), 0)) as outstanding_minor
      from counted c
  )
  select g.staff_id::text as staff_id, g.terms_id::text as terms_id, g.pay_kind, g.pay_minor as pay, 'day' as unit,
         g.days_milli as days, g.unpaid_milli as unpaid_days, g.gross_minor as gross, g.outstanding_minor as outstanding,
         least(g.outstanding_minor, g.gross_minor) as recovered, g.gross_minor - least(g.outstanding_minor, g.gross_minor) as net, g.currency
    from gross g
   order by g.staff_id
   limit 500`;

export type PreviewRow = {
  staff_id: string;
  terms_id: string;
  pay_kind: 'daily' | 'monthly';
  pay: string;
  days: string;
  unpaid_days: string;
  gross: string;
  outstanding: string;
  recovered: string;
  net: string;
  currency: string;
};
