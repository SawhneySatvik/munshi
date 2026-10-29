// Red-proofs of calendar, bookings and staff (BP-F2): test/v2/core/staff/*. Each breaks one rule of slots.ts, booking.ts,
// commands-booking.ts, commands-staff.ts or salary.ts (a ts case), or of the database rule the core path relies on (an
// sql case), and its named test must fail. index.ts joins them into CASES.
import type { Case } from '../../sabotage.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/staff';
const SLOTS_TEST = `${DIR}/slot1-slots.test.ts`;
const BOOKINGS_TEST = `${DIR}/bookings.test.ts`;
const SALARY_TEST = `${DIR}/sal1-pay1.test.ts`;
const SLOTS = 'packages/core/src/slots.ts';
const BOOKING = 'packages/core/src/booking.ts';
const CONFIRM = 'packages/core/src/commands-booking.ts';
const STAFF = 'packages/core/src/commands-staff.ts';
const SALARY = 'packages/core/src/salary.ts';
const APPROVALS = 'packages/core/src/approvals.ts';
const C4 = 'test/v2/core/approvals/c4-approvals.test.ts';
const FLOW = 'ops.booking_flow()';

const SLOT1 =
  'SLOT1 a hand-worked roster’s free slots are the key’s, each naming its roster row; the database accepts each and refuses the step past each edge; every booking recomputes from its own row; a row not in effect is refused';
const SLOT1_LEAVE =
  'SLOT1 leave and holidays remove slots: a stylist’s leave (a half day too) clears their day, a holiday clears its branch’s or every branch’s day, and each reversal gives the slots back';
const BK1 =
  'BK1 two live bookings of one stylist never overlap: a hold or a desk booking over a taken slot is refused (23P01), another stylist may take the same time, and an expired hold frees its slot';
const BK2 = 'BK2 a hold outside the shift, on leave, on a holiday, off the quarter hour or in the past is refused, and so is a request after its hold expired';
const HOLD1 =
  'HOLD1 a second live hold from one device, a fourth from one IP hash or a third on one stylist’s day is refused; a lapsed hold on another stylist frees its device and its IP; a hold moves only with its token';
const CONFIRM1 =
  'booking.confirm writes the customer through the vault and the customer’s message naming the booking with the move, under the person who confirms; the database refuses a confirm without the message at commit (MS007)';
const DESK =
  'the desk handles a booking as ops: a request is declined only with a reason code, by an owner or manager; a confirmed booking is cancelled or marked a no-show; none writes a book';
const SAL1 =
  'SAL1 the hand-worked month’s preview is the key, cell for cell; the owner’s approved run writes exactly it with a balanced journal, recovers advances only up to what is outstanding, and pays no one twice for overlapping days';
const SAL1_WINDOW =
  'SAL1 a book row committing while the owner approves is seen by the check, never slipped past it: the check waits on the tenant’s chain lock and the draft goes stale';
const C4_CURRENT = "C4 a stock or money draft must cite the current on-hand of every item it names; a watcher's dated read is not enough";
const SAL1_STALE =
  'SAL1 a salary draft whose preview moved since it was made is stale and pays nothing, though the cell it cites still holds; one leave never overlaps another';
const PAY1 =
  'PAY1 payment.record cannot pay a staff member and its body under payment.record is refused; wages.pay (owner, manager) and advance.give (owner) can; staff mark only their own day, never after an owner’s or manager’s mark';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file, test, config: V2, sql: text });

export const CORE_STAFF_CASES: Case[] = [
  // SLOT1: the read's roster, hours, grid and holds, and the database's "the row in effect".
  ts('v2-f2-slot1-pattern-on-change-day', SLOTS_TEST, SLOT1, SLOTS, '     where not exists (select 1 from changed c where c.staff_id = p.staff_id)', '     where true'),
  ts('v2-f2-slot1-earliest-change', SLOTS_TEST, SLOT1, SLOTS, 'order by x.staff_id, x.created_at desc, x.id desc', 'order by x.staff_id, x.created_at, x.id'),
  ts('v2-f2-slot1-pattern-not-yet', SLOTS_TEST, SLOT1, SLOTS, " and p.effective_from <= $2::date\n", '\n'),
  ts('v2-f2-slot1-hours-not-yet', SLOTS_TEST, SLOT1, SLOTS, ' and h.effective_from <= $2::date\n', '\n'),
  ts('v2-f2-slot1-past-closing', SLOTS_TEST, SLOT1, SLOTS, 'least(r.ends, h.closes)', 'r.ends'),
  ts('v2-f2-slot1-off-grid', SLOTS_TEST, SLOT1, SLOTS, 'Math.ceil(s.from / GRID_MIN) * GRID_MIN', 's.from'),
  ts('v2-f2-slot1-lapsed-busy', SLOTS_TEST, SLOT1, SLOTS, "or (b.state = 'held' and b.expires_at > now())", "or b.state = 'held'"),
  sql(
    'v2-f2-slot1-any-roster',
    SLOTS_TEST,
    SLOT1,
    mutate(FLOW, 'fits := not exists (select 1 from books.shift_change x where x.tenant_id = new.tenant_id and x.staff_id = new.staff_id and x.day = the_day)', 'fits := true'),
  ),
  // Leave and holidays.
  ts('v2-f2-slot1-leave-ignored', SLOTS_TEST, SLOT1_LEAVE, SLOTS, 'l.reverses_id is null and $2::date between l.first_day and l.last_day', 'l.reverses_id is null and false'),
  ts(
    'v2-f2-slot1-leave-reversal-ignored',
    SLOTS_TEST,
    SLOT1_LEAVE,
    SLOTS,
    '\n                        and not exists (select 1 from books.leave x where x.tenant_id = l.tenant_id and x.reverses_id = l.id))',
    ')',
  ),
  ts('v2-f2-slot1-holiday-every-branch', SLOTS_TEST, SLOT1_LEAVE, SLOTS, '(h.shop_id is null or h.shop_id = $1)', 'h.shop_id = $1'),
  ts('v2-f2-slot1-holiday-any-branch', SLOTS_TEST, SLOT1_LEAVE, SLOTS, '(h.shop_id is null or h.shop_id = $1)', 'true'),
  ts(
    'v2-f2-slot1-holiday-reversal-ignored',
    SLOTS_TEST,
    SLOT1_LEAVE,
    SLOTS,
    '\n                        and not exists (select 1 from books.holiday x where x.tenant_id = h.tenant_id and x.reverses_id = h.id))',
    ')',
  ),

  // BK1: the exclusion decides, and core clears lapsed holds before placing one.
  sql('v2-f2-bk1-exclusion', BOOKINGS_TEST, BK1, 'alter table ops.booking drop constraint booking_no_overlap;'),
  ts('v2-f2-bk1-lapsed-kept', BOOKINGS_TEST, BK1, BOOKING, "    await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()`);\n", ''),
  // BK2: the database's calendar check; core's quarter hour and future.
  sql('v2-f2-bk2-calendar', BOOKINGS_TEST, BK2, mutate(FLOW, 'if not fits then', 'if false then')),
  sql('v2-f2-bk2-expired-request', BOOKINGS_TEST, BK2, mutate(FLOW, "raise exception 'booking refused: the hold has expired' using errcode = 'MS015';", 'null;')),
  ts('v2-f2-bk2-off-grid', BOOKINGS_TEST, BK2, BOOKING, 'minute % GRID_MIN !== 0 || ', ''),
  ts('v2-f2-bk2-past', BOOKINGS_TEST, BK2, BOOKING, ' || start <= t.now', ''),
  // HOLD1: the caps and the token are the database's; core expires every lapsed hold, not only the target stylist's.
  ts(
    'v2-f2-hold1-target-stylist-only',
    BOOKINGS_TEST,
    HOLD1,
    BOOKING,
    "await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()`);",
    "await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now() and staff_id = $1`, [i.staffId]);",
  ),
  sql('v2-f2-hold1-device', BOOKINGS_TEST, HOLD1, asOwner('drop index ops.one_hold_per_device;')),
  sql('v2-f2-hold1-ip-cap', BOOKINGS_TEST, HOLD1, mutate(FLOW, "and b.state = 'held' and b.expires_at > now()) >= 3 then", "and b.state = 'held' and b.expires_at > now()) >= 99 then")),
  sql(
    'v2-f2-hold1-stylist-day',
    BOOKINGS_TEST,
    HOLD1,
    mutate(FLOW, "and (lower(b.during) at time zone tz)::date = the_day) >= 2 then", "and (lower(b.during) at time zone tz)::date = the_day) >= 99 then"),
  ),
  sql(
    'v2-f2-hold1-token',
    BOOKINGS_TEST,
    HOLD1,
    mutate(FLOW, "if sha256(convert_to(coalesce(nullif(current_setting('munshi.hold_token', true), ''), ''), 'UTF8')) <> old.hold_token_sha256 then", 'if false then'),
  ),

  // booking.confirm: the message names the booking, the database holds the commit to it, the vault's customer is reused.
  ts(
    'v2-f2-confirm-message-unnamed',
    BOOKINGS_TEST,
    CONFIRM1,
    CONFIRM,
    "[t.tenantId, messageId, b.wa_updates === false ? 'sms' : 'whatsapp', customerId, text.id, text.body_sha256, i.bookingId]",
    "[t.tenantId, messageId, b.wa_updates === false ? 'sms' : 'whatsapp', customerId, text.id, text.body_sha256, null]",
  ),
  sql('v2-f2-confirm-no-commit-check', BOOKINGS_TEST, CONFIRM1, asOwner('drop trigger z_booking_message on ops.booking;')),
  ts('v2-f2-confirm-customer-not-reused', BOOKINGS_TEST, CONFIRM1, CONFIRM, '  if (rows[0]?.customer_id) return rows[0].customer_id;\n', ''),
  ts('v2-f2-confirm-any-state', BOOKINGS_TEST, CONFIRM1, CONFIRM, "      if (b.state !== 'requested') throw new CoreError('conflict', { fields: ['bookingId'] });\n", ''),
  ts('v2-f2-desk-reason-dropped', BOOKINGS_TEST, DESK, BOOKING, '[i.bookingId, i.state, i.reason ?? null]', '[i.bookingId, i.state, null]'),

  // SAL1: the preview's rules (salary.ts), the run's draft-only path and journal (commands-staff.ts).
  ts('v2-f2-sal1-day-twice', SALARY_TEST, SAL1, SALARY, "generate_series($1::date, $2::date, interval '1 day')", "generate_series($1::date, $2::date, interval '12 hours')"),
  ts('v2-f2-sal1-sick-paid', SALARY_TEST, SAL1, SALARY, "case when e.leave_kind = 'paid' then", "case when e.leave_kind in ('paid', 'sick') then"),
  ts('v2-f2-sal1-holiday-docked', SALARY_TEST, SAL1, SALARY, "when e.leave_kind = 'unpaid' and not e.holiday then", "when e.leave_kind = 'unpaid' then"),
  ts('v2-f2-sal1-before-joining-paid', SALARY_TEST, SAL1, SALARY, 'when e.before_joining then 1000', 'when false then 1000'),
  ts(
    'v2-f2-sal1-recovery-uncapped',
    SALARY_TEST,
    SAL1,
    SALARY,
    'least(g.outstanding_minor, g.gross_minor) as recovered, g.gross_minor - least(g.outstanding_minor, g.gross_minor) as net',
    'g.outstanding_minor as recovered, g.gross_minor - g.outstanding_minor as net',
  ),
  ts(
    'v2-f2-sal1-recovered-forgotten',
    SALARY_TEST,
    SAL1,
    SALARY,
    '\n                     - coalesce((select sum(l.advance_recovered_minor) from books.salary_line l\n                                  where l.tenant_id = c.tenant_id and l.staff_id = c.staff_id and l.currency = c.currency), 0)',
    '',
  ),
  ts('v2-f2-sal1-paid-twice', SALARY_TEST, SAL1, SALARY, '     where ($3::uuid is null or t.shop_id = $3::uuid)\n       and not exists (', '     where ($3::uuid is null or t.shop_id = $3::uuid)\n       and true or not exists ('),
  ts('v2-f2-sal1-not-draft-only', SALARY_TEST, SAL1, STAFF, '      draftOnly: true,\n', ''),
  sql('v2-f2-sal1-not-draft-only-db', SALARY_TEST, SAL1, "update ref.command set draft_only = false where command = 'salary.run';"),
  sql('v2-f2-sal1-manager-approves', SALARY_TEST, SAL1, "insert into ref.command_authority (command, role) values ('salary.run', 'manager');"),
  ts('v2-f2-sal1-journal-short', SALARY_TEST, SAL1, STAFF, "['staff_advance', -sum('recovered')],", "['staff_advance', 0],"),
  ts('v2-f2-sal1-preview-unchecked', SALARY_TEST, SAL1_STALE, STAFF, "  return ['basedOn'];\n};", '  return [];\n};'),
  // The approval window: without the chain lock, a mark committed during the approval is past the check when it lands.
  ts(
    'v2-f2-sal1-window-unlocked',
    SALARY_TEST,
    SAL1_WINDOW,
    STAFF,
    "  await c.query(`select pg_advisory_xact_lock(1, hashtext(nullif(current_setting('munshi.tenant_id', true), '')::uuid::text))`);\n",
    '',
  ),
  // The proposal path: salary.run's flag lets its own checks stand for the generic current-state rule; the flag set on a
  // command whose checks re-check nothing (stock.waste, which C4's rule guards) lets dated evidence through.
  ts('v2-f2-sal1-flag-ignored', SALARY_TEST, SAL1, APPROVALS, 'if (moves.length && !def.recheckedByChecks) {', 'if (moves.length) {'),
  ts('v2-f2-sal1-flag-dropped', SALARY_TEST, SAL1, STAFF, '      recheckedByChecks: true,\n', ''),
  ts(
    'v2-f2-c4-flag-planted',
    C4,
    C4_CURRENT,
    APPROVALS,
    'if (moves.length && !def.recheckedByChecks) {',
    "if (moves.length && !(def.recheckedByChecks || d.command === 'stock.waste')) {",
  ),
  sql('v2-f2-sal1-leave-overlap', SALARY_TEST, SAL1_STALE, asOwner('drop trigger b_leave_overlap on books.leave;')),

  // PAY1: the database's b_payment_kind and b_attendance_rank, and who holds advance.give and wages.pay.
  sql('v2-f2-pay1-payment-kind', SALARY_TEST, PAY1, asOwner('drop trigger b_payment_kind on books.payment;')),
  sql('v2-f2-pay1-advance-manager', SALARY_TEST, PAY1, "insert into ref.command_authority (command, role) values ('advance.give', 'manager');"),
  sql('v2-f2-pay1-wages-staff', SALARY_TEST, PAY1, "insert into ref.command_authority (command, role) values ('wages.pay', 'staff');"),
  sql(
    'v2-f2-pay1-after-manager',
    SALARY_TEST,
    PAY1,
    mutate('books.attendance_rank()', "raise exception 'attendance refused: an owner or manager has marked this day' using errcode = 'MS001';", 'null;'),
  ),
  sql(
    'v2-f2-pay1-someone-else',
    SALARY_TEST,
    PAY1,
    mutate('books.attendance_rank()', "raise exception 'attendance refused: a staff member marks only their own day' using errcode = 'MS001';", 'null;'),
  ),
];
