-- 12 · Staff records: the roster and one-day changes, leave, holidays, attendance, advances
-- and salary runs. Books, through books.write. Leave, holidays, advances and salary runs reverse (leave and
-- holidays match their columns, an advance and a salary line negate their amounts); the roster and attendance do not
-- (the latest in effect wins; the day's mark is the latest of the highest rank). No column here names a table of a
-- later file; advances and pay post to the journal from 15.
--
-- Locks: a rule that serialises per staff member takes the tenant's chain lock (class 1) first, then the staff
-- member's (class 5).
set local role munshi_owner;

-- The weekly roster: latest in effect per staff member and weekday wins; `off` means no hours. No shift crosses
-- midnight (a stated limit).
create table books.shift_pattern (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  shop_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  starts time,
  ends time,
  off boolean not null default false,
  effective_from date not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (case when off then starts is null and ends is null else starts is not null and ends > starts end)
);

-- A one-day swap: the latest row for that staff member and day wins over the pattern.
create table books.shift_change (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  day date not null,
  shop_id uuid not null,
  starts time,
  ends time,
  off boolean not null default false,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (case when off then starts is null and ends is null else starts is not null and ends > starts end)
);

-- Leave over a run of days; a half day is one day. b_leave_overlap refuses a row overlapping a live one for the same
-- staff member, so an unpaid day is never counted twice.
create table books.leave (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  kind text not null check (kind in ('paid', 'unpaid', 'sick')),
  first_day date not null,
  last_day date not null,
  half_day boolean not null default false,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, reverses_id) references books.leave,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (last_day >= first_day),
  check (not half_day or last_day = first_day),
  check ((reverses_id is null) = (reason is null))
);

create function books.leave_overlap() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.reverses_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(5, hashtext(new.tenant_id::text || new.staff_id::text));
  if exists (select 1 from books.leave l
              where l.tenant_id = new.tenant_id and l.staff_id = new.staff_id and l.reverses_id is null
                and daterange(l.first_day, l.last_day, '[]') && daterange(new.first_day, new.last_day, '[]')
                and not exists (select 1 from books.leave r where r.tenant_id = l.tenant_id and r.reverses_id = l.id)) then
    raise exception 'leave refused: it overlaps live leave of the same staff member' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.leave_overlap() from public;

-- A closed day, for one branch or every branch (shop_id NULL).
create table books.holiday (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  shop_id uuid,
  day date not null,
  name_key text not null check (name_key ~ '^[a-z_]{2,40}$'),
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, reverses_id) references books.holiday,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

-- A day's mark. The mark that counts is the latest of the highest rank present (an owner's or manager's over a staff
-- member's, then by created_at). b_attendance_rank stamps the marker's role, lets a staff member mark only their
-- own row, and refuses a staff mark once an owner or manager has marked that day.
create table books.attendance (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  shop_id uuid not null,
  day date not null,
  status text not null check (status in ('present', 'absent', 'half_day', 'leave', 'off')),
  in_at timestamptz,
  out_at timestamptz,
  marked_by_role text not null check (marked_by_role in ('owner', 'manager', 'staff')),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (out_at > in_at)
);

create function books.attendance_rank() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(5, hashtext(new.tenant_id::text || new.staff_id::text));
  new.marked_by_role := (select m.role from ops.member m where m.tenant_id = new.tenant_id and m.id = new.created_by);
  if new.marked_by_role = 'staff' then
    if not exists (select 1 from books.staff s where s.tenant_id = new.tenant_id and s.id = new.staff_id and s.member_id = new.created_by) then
      raise exception 'attendance refused: a staff member marks only their own day' using errcode = 'MS001';
    end if;
    if exists (select 1 from books.attendance a
                where a.tenant_id = new.tenant_id and a.staff_id = new.staff_id and a.day = new.day
                  and a.marked_by_role in ('owner', 'manager')) then
      raise exception 'attendance refused: an owner or manager has marked this day' using errcode = 'MS001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function books.attendance_rank() from public;

-- Money a staff member took ahead of pay; salary runs recover it. Positive unless a reversal.
create table books.advance (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  amount_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  given_on date not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, reverses_id) references books.advance,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null)),
  check ((reverses_id is null) = (amount_minor > 0))
);

-- A month's pay (draft-only: salary.run), header and one line per staff member.
create table books.salary_run (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  period_start date not null,
  period_end date not null,
  shop_id uuid,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, reverses_id) references books.salary_run,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (period_end >= period_start),
  check ((reverses_id is null) = (reason is null))
);

-- A line copies its terms through a composite key, so pay kind, rate and currency are the named terms'.
-- net = gross − recovered; each ≥ 0 unless a reversal, which negates them. b_advance_recovery keeps recovery within the
-- staff member's outstanding advances (MS009); b_one_live_pay refuses a second live line for a staff member in a run
-- whose period overlaps. Both under the staff member's lock.
create table books.salary_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  staff_id uuid not null,
  terms_id uuid not null,
  pay_kind text not null,
  pay_minor bigint not null,
  days_milli bigint not null,
  gross_minor bigint not null,
  advance_recovered_minor bigint not null,
  net_minor bigint not null,
  currency char(3) not null,
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references books.salary_run,
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, terms_id, staff_id, pay_kind, pay_minor, currency)
    references books.staff_terms (tenant_id, id, staff_id, pay_kind, pay_minor, currency),
  foreign key (tenant_id, reverses_id) references books.salary_line,
  foreign key (reason, reason_use) references ref.reason_use,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (net_minor = gross_minor - advance_recovered_minor),
  check (reverses_id is not null or (days_milli >= 0 and gross_minor >= 0 and advance_recovered_minor >= 0 and net_minor >= 0)),
  check ((reverses_id is null) = (reason is null))
);

create function books.advance_recovery() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  outstanding bigint;
begin
  if new.reverses_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(5, hashtext(new.tenant_id::text || new.staff_id::text));
  outstanding := coalesce((select sum(a.amount_minor) from books.advance a
                            where a.tenant_id = new.tenant_id and a.staff_id = new.staff_id and a.currency = new.currency), 0)
               - coalesce((select sum(l.advance_recovered_minor) from books.salary_line l
                            where l.tenant_id = new.tenant_id and l.staff_id = new.staff_id and l.currency = new.currency), 0);
  if new.advance_recovered_minor > outstanding then
    raise exception 'salary refused: % recovered against % outstanding in advances', new.advance_recovered_minor, outstanding using errcode = 'MS009';
  end if;
  return new;
end $$;
revoke execute on function books.advance_recovery() from public;

create function books.one_live_pay() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.reverses_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(5, hashtext(new.tenant_id::text || new.staff_id::text));
  if exists (select 1 from books.salary_line l
               join books.salary_run r on r.tenant_id = l.tenant_id and r.id = l.run_id
               join books.salary_run mine on mine.tenant_id = new.tenant_id and mine.id = new.run_id
              where l.tenant_id = new.tenant_id and l.staff_id = new.staff_id and l.reverses_id is null
                and daterange(r.period_start, r.period_end, '[]') && daterange(mine.period_start, mine.period_end, '[]')
                and not exists (select 1 from books.salary_line x where x.tenant_id = l.tenant_id and x.reverses_id = l.id)) then
    raise exception 'salary refused: the staff member already has a live line for an overlapping period' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.one_live_pay() from public;

create trigger a_write before insert or update or delete on books.shift_pattern for each row execute function books.write();
create trigger z_audit after insert on books.shift_pattern for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.shift_change for each row execute function books.write();
create trigger z_audit after insert on books.shift_change for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.leave for each row execute function books.write();
create trigger b_leave_overlap before insert on books.leave for each row execute function books.leave_overlap();
create trigger z_audit after insert on books.leave for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.holiday for each row execute function books.write();
create trigger z_audit after insert on books.holiday for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.attendance for each row execute function books.write();
create trigger b_attendance_rank before insert on books.attendance for each row execute function books.attendance_rank();
create trigger z_audit after insert on books.attendance for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.advance for each row execute function books.write();
create trigger z_audit after insert on books.advance for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.salary_run for each row execute function books.write();
create trigger z_audit after insert on books.salary_run for each row execute function books.audit_row();
create constraint trigger z_reversal_complete after insert on books.salary_run deferrable initially deferred for each row
  execute function books.check_reversal();
create trigger a_write before insert or update or delete on books.salary_line for each row execute function books.write();
create trigger b_advance_recovery before insert on books.salary_line for each row execute function books.advance_recovery();
create trigger b_one_live_pay before insert on books.salary_line for each row execute function books.one_live_pay();
create trigger z_audit after insert on books.salary_line for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create index shift_pattern_latest on books.shift_pattern (tenant_id, staff_id, weekday, effective_from desc, created_at desc);
create index shift_change_day on books.shift_change (tenant_id, staff_id, day, created_at desc);
create index leave_staff on books.leave (tenant_id, staff_id, first_day);
create unique index leave_reverses on books.leave (tenant_id, reverses_id) where reverses_id is not null;
create index holiday_day on books.holiday (tenant_id, day);
create unique index holiday_reverses on books.holiday (tenant_id, reverses_id) where reverses_id is not null;
create index attendance_day on books.attendance (tenant_id, staff_id, day, created_at);
create index advance_staff on books.advance (tenant_id, staff_id, given_on);
create unique index advance_reverses on books.advance (tenant_id, reverses_id) where reverses_id is not null;
create index salary_run_period on books.salary_run (tenant_id, period_start);
create unique index salary_run_reverses on books.salary_run (tenant_id, reverses_id) where reverses_id is not null;
create unique index salary_line_run on books.salary_line (tenant_id, run_id, staff_id);
create index salary_line_staff on books.salary_line (tenant_id, staff_id);
create unique index salary_line_reverses on books.salary_line (tenant_id, reverses_id) where reverses_id is not null;

-- The book table manifest and the commands. advance.give and salary.run add their journal and payment
-- tables in 15; wages.pay lands there.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.shift_pattern', null, null, false, '{}', '{}', '{}'),
  ('books.shift_change', null, null, false, '{}', '{}', '{}'),
  ('books.leave', null, null, true, '{}', '{staff_id,kind,first_day,last_day,half_day}', '{b_leave_overlap}'),
  ('books.holiday', null, null, true, '{}', '{shop_id,day,name_key}', '{}'),
  ('books.attendance', null, null, false, '{}', '{}', '{b_attendance_rank}'),
  ('books.advance', null, null, true, '{amount_minor}', '{staff_id,currency,given_on}', '{}'),
  ('books.salary_run', null, null, true, '{}', '{period_start,period_end,shop_id}', '{}'),
  ('books.salary_line', 'books.salary_run', 'run_id', true, '{days_milli,gross_minor,advance_recovered_minor,net_minor}',
   '{staff_id,terms_id,pay_kind,pay_minor,currency}', '{b_advance_recovery,b_one_live_pay}');
insert into ref.command (command, draft_only) values
  ('shift.pattern.set', false), ('shift.change', false), ('leave.record', false), ('leave.reverse', false),
  ('holiday.set', false), ('holiday.reverse', false), ('attendance.mark', false), ('advance.give', false),
  ('advance.reverse', false), ('salary.run', true);
insert into ref.command_authority (command, role) values
  ('shift.pattern.set', 'owner'), ('shift.pattern.set', 'manager'), ('shift.change', 'owner'), ('shift.change', 'manager'),
  ('leave.record', 'owner'), ('leave.record', 'manager'), ('leave.reverse', 'owner'), ('leave.reverse', 'manager'),
  ('holiday.set', 'owner'), ('holiday.set', 'manager'), ('holiday.reverse', 'owner'), ('holiday.reverse', 'manager'),
  ('attendance.mark', 'owner'), ('attendance.mark', 'manager'), ('attendance.mark', 'staff'),
  ('advance.give', 'owner'), ('advance.reverse', 'owner'), ('salary.run', 'owner');
insert into ref.command_table (command, rel) values
  ('shift.pattern.set', 'books.shift_pattern'), ('shift.change', 'books.shift_change'),
  ('leave.record', 'books.leave'), ('leave.reverse', 'books.leave'),
  ('holiday.set', 'books.holiday'), ('holiday.reverse', 'books.holiday'), ('attendance.mark', 'books.attendance'),
  ('advance.give', 'books.advance'), ('advance.reverse', 'books.advance'),
  ('salary.run', 'books.salary_run'), ('salary.run', 'books.salary_line');
insert into ref.command_capability (command, capability, use) values
  ('shift.pattern.set', 'staff', 'start'), ('shift.change', 'staff', 'start'), ('leave.record', 'staff', 'start'),
  ('leave.reverse', 'staff', 'finish'), ('holiday.set', 'staff', 'start'), ('holiday.reverse', 'staff', 'finish'),
  ('attendance.mark', 'staff', 'start'), ('advance.give', 'staff', 'start'), ('advance.reverse', 'staff', 'finish'),
  ('salary.run', 'salary', 'start');

-- RLS and the grants. The public role reads only what live slots need: ids, days and times, never a name or an
-- amount, with the columns the booking guard's tie-breaks read (created_at, effective_from).
alter table books.shift_pattern enable row level security;
alter table books.shift_pattern force row level security;
create policy tenant_isolation on books.shift_pattern
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.shift_pattern from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.shift_pattern to munshi_app;
grant select on books.shift_pattern to munshi_jobs;
grant select (tenant_id, id, staff_id, shop_id, weekday, starts, ends, off, effective_from, created_at) on books.shift_pattern to munshi_public;

alter table books.shift_change enable row level security;
alter table books.shift_change force row level security;
create policy tenant_isolation on books.shift_change
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.shift_change from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.shift_change to munshi_app;
grant select on books.shift_change to munshi_jobs;
grant select (tenant_id, id, staff_id, day, shop_id, starts, ends, off, created_at) on books.shift_change to munshi_public;

alter table books.leave enable row level security;
alter table books.leave force row level security;
create policy tenant_isolation on books.leave
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.leave from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.leave to munshi_app;
grant select on books.leave to munshi_jobs;
grant select (tenant_id, id, staff_id, first_day, last_day, half_day, reverses_id) on books.leave to munshi_public;

alter table books.holiday enable row level security;
alter table books.holiday force row level security;
create policy tenant_isolation on books.holiday
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.holiday from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.holiday to munshi_app;
grant select on books.holiday to munshi_jobs;
grant select (tenant_id, id, shop_id, day, reverses_id) on books.holiday to munshi_public;

alter table books.attendance enable row level security;
alter table books.attendance force row level security;
create policy tenant_isolation on books.attendance
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.attendance from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.attendance to munshi_app;
grant select on books.attendance to munshi_jobs;

alter table books.advance enable row level security;
alter table books.advance force row level security;
create policy tenant_isolation on books.advance
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.advance from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.advance to munshi_app;
grant select on books.advance to munshi_jobs;

alter table books.salary_run enable row level security;
alter table books.salary_run force row level security;
create policy tenant_isolation on books.salary_run
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.salary_run from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.salary_run to munshi_app;
grant select on books.salary_run to munshi_jobs;

alter table books.salary_line enable row level security;
alter table books.salary_line force row level security;
create policy tenant_isolation on books.salary_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.salary_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.salary_line to munshi_app;
grant select on books.salary_line to munshi_jobs;
