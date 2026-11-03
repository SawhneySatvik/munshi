// Commands for staff, attendance and salary: the roster (a weekly pattern, a one-day change), leave and holidays with
// their reversals, a day's attendance mark, pay terms, an advance, wages paid, and the salary run. All are books,
// written through the guard under the command's authority (12_staff_records.sql, 15_trade_journal.sql). Money to a
// staff member is written only by advance.give (the owner) and wages.pay (owner, manager), never by payment.record,
// which staff hold (b_payment_kind); payments are recorded, never processed. salary.run is draft-only: an owner
// approves the draft, made from the salary.preview read, and the run re-derives every figure with that read's SQL
// (salary.ts), in the approval's transaction right after its check that every cited cell still holds, under the
// tenant's chain lock (citesPreview). Helpers from commands.ts are used only inside a run, so the value import is safe
// while commands.ts spreads STAFF_COMMANDS.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { at, type Checks, type CommandResult, type Ctx, type Def, journal, methodAccount, one } from './commands.ts';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import { COUNT_COL, type CellRef } from './read.ts';
import { type PreviewRow, period, SALARY_PREVIEW } from './salary.ts';
import { recheck, runReadOnly } from './snapshots.ts';
import { businessDate } from './time.ts';

const id = z.guid();
const day = z.iso.date();
const minor = z.number().int().safe();
const tender = z.enum(['cash', 'upi', 'card', 'bank']);
const reference = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/); // a shift never crosses midnight
const reversal = { reason: z.enum(['wrong_figure', 'duplicate', 'entered_in_error', 'other']) };

// Hours, or a day off: off has no times, a working day ends after it starts.
const shiftHours = { starts: time.optional(), ends: time.optional(), off: z.boolean().default(false) };
const fitsHours = (i: { starts?: string | undefined; ends?: string | undefined; off: boolean }) =>
  i.off ? i.starts === undefined && i.ends === undefined : i.starts !== undefined && i.ends !== undefined && i.ends > i.starts;

const shiftPatternSet = z
  .strictObject({ staffId: id, shopId: id, weekday: z.number().int().min(1).max(7), effectiveFrom: day, ...shiftHours })
  .refine(fitsHours, { path: ['ends'] });
const shiftChange = z.strictObject({ staffId: id, shopId: id, day, ...shiftHours }).refine(fitsHours, { path: ['ends'] });
const leaveRecord = z
  .strictObject({ staffId: id, kind: z.enum(['paid', 'unpaid', 'sick']), firstDay: day, lastDay: day, halfDay: z.boolean().default(false) })
  .refine((i) => i.lastDay >= i.firstDay && (!i.halfDay || i.lastDay === i.firstDay), { path: ['lastDay'] });
const holidaySet = z.strictObject({ shopId: id.optional(), day, nameKey: z.string().regex(/^[a-z_]{2,40}$/) });
const attendanceMark = z
  .strictObject({
    staffId: id,
    shopId: id,
    day,
    status: z.enum(['present', 'absent', 'half_day', 'leave', 'off']),
    inAt: z.iso.datetime({ offset: true }).optional(),
    outAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((i) => !i.inAt || !i.outAt || new Date(i.outAt) > new Date(i.inAt), { path: ['outAt'] });
const staffTerms = z.strictObject({
  staffId: id,
  shopId: id,
  title: z.string().trim().min(1).max(40).optional(),
  payKind: z.enum(['daily', 'monthly']),
  payMinor: minor.nonnegative(),
  effectiveFrom: day,
});
const staffPayment = z.strictObject({
  staffId: id,
  amountMinor: minor.positive(),
  method: tender,
  reference: reference.optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
});
const salaryRun = z
  .strictObject({ periodStart: day, periodEnd: day, shopId: id.optional() })
  .refine((i) => period(i.periodStart, i.periodEnd), { path: ['periodEnd'] });

export type SalaryRunInput = z.input<typeof salaryRun>;

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

const insertId = async (ctx: Ctx, sql: string, values: unknown[]) => (await one<{ id: string }>(ctx.c, sql, [ctx.t.tenantId, ...values])).id;

// A salary.run draft cites the preview it was made from: a salary.preview snapshot of the same period and branch, with
// rows, every cell of which (and its row count) a fresh read still gives. So at approval the draft is stale if attendance,
// leave, terms or advances moved since. The tenant's chain lock (class 1, which every book row's audit entry takes) is
// taken first and held to commit: a book row in flight is committed before the re-read sees it, and none can commit
// between this check and the run, so the run writes the cells just re-checked.
const citesPreview: Checks = async (c, payload, _refs, basedOn) => {
  await c.query(`select pg_advisory_xact_lock(1, hashtext(nullif(current_setting('munshi.tenant_id', true), '')::uuid::text))`);
  const r = salaryRun.safeParse(payload);
  if (!r.success) return ['periodStart'];
  const { periodStart, periodEnd, shopId } = r.data;
  const params = { period_start: periodStart, period_end: periodEnd, ...(shopId ? { shop_id: shopId } : {}) };
  const { rows } = await c.query<{ id: string; row_count: number }>(
    `select id::text, row_count from snap.snapshot where id = any($1::uuid[]) and query_name = 'salary.preview' and params = $2::jsonb and row_count > 0`,
    [[...new Set(basedOn.map((ref) => ref.snapshotId))], JSON.stringify(params)],
  );
  const cols = Object.keys(QUERIES.get('salary.preview')?.columns ?? {});
  for (const s of rows) {
    const every: CellRef[] = [{ snapshotId: s.id, row: 0, col: COUNT_COL }];
    for (let row = 0; row < s.row_count; row++) for (const col of cols) every.push({ snapshotId: s.id, row, col });
    if ((await recheck(c, every)).length === 0) return [];
  }
  return ['basedOn'];
};

async function staffPaid(ctx: Ctx, i: z.output<typeof staffPayment>): Promise<{ paymentId: string; date: string }> {
  const paidAt = at(i.paidAt);
  const paymentId = randomUUID();
  await ctx.c.query(
    `insert into books.payment (tenant_id, id, direction, method, amount_minor, currency, staff_id, reference, paid_at)
     values ($1, $2, 'out', $3, $4, $5, $6, $7, $8)`,
    [ctx.t.tenantId, paymentId, i.method, i.amountMinor, ctx.t.currency, i.staffId, i.reference ?? null, paidAt],
  );
  return { paymentId, date: businessDate(paidAt, ctx.t.timeZone) };
}

export const STAFF_COMMANDS: [string, Def][] = [
  [
    'shift.pattern.set',
    def(shiftPatternSet, async (ctx, i) => ({
      patternId: await insertId(
        ctx,
        'insert into books.shift_pattern (tenant_id, staff_id, shop_id, weekday, starts, ends, off, effective_from) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [i.staffId, i.shopId, i.weekday, i.starts ?? null, i.ends ?? null, i.off, i.effectiveFrom],
      ),
    })),
  ],
  [
    'shift.change',
    def(shiftChange, async (ctx, i) => ({
      changeId: await insertId(
        ctx,
        'insert into books.shift_change (tenant_id, staff_id, day, shop_id, starts, ends, off) values ($1, $2, $3, $4, $5, $6, $7) returning id',
        [i.staffId, i.day, i.shopId, i.starts ?? null, i.ends ?? null, i.off],
      ),
    })),
  ],
  [
    // b_leave_overlap refuses leave overlapping live leave of the same staff member, so no day counts twice.
    'leave.record',
    def(leaveRecord, async (ctx, i) => ({
      leaveId: await insertId(
        ctx,
        'insert into books.leave (tenant_id, staff_id, kind, first_day, last_day, half_day) values ($1, $2, $3, $4, $5, $6) returning id',
        [i.staffId, i.kind, i.firstDay, i.lastDay, i.halfDay],
      ),
    })),
  ],
  [
    'leave.reverse',
    def(z.strictObject({ leaveId: id, ...reversal }), async (ctx, i) => ({
      reversalId: await insertId(
        ctx,
        `insert into books.leave (tenant_id, staff_id, kind, first_day, last_day, half_day, reverses_id, reason)
         select $1, staff_id, kind, first_day, last_day, half_day, id, $3 from books.leave where id = $2 returning id`,
        [i.leaveId, i.reason],
      ),
    })),
  ],
  [
    // shopId absent: every branch is closed that day.
    'holiday.set',
    def(holidaySet, async (ctx, i) => ({
      holidayId: await insertId(ctx, 'insert into books.holiday (tenant_id, shop_id, day, name_key) values ($1, $2, $3, $4) returning id', [
        i.shopId ?? null,
        i.day,
        i.nameKey,
      ]),
    })),
  ],
  [
    'holiday.reverse',
    def(z.strictObject({ holidayId: id, ...reversal }), async (ctx, i) => ({
      reversalId: await insertId(
        ctx,
        `insert into books.holiday (tenant_id, shop_id, day, name_key, reverses_id, reason)
         select $1, shop_id, day, name_key, id, $3 from books.holiday where id = $2 returning id`,
        [i.holidayId, i.reason],
      ),
    })),
  ],
  [
    // b_attendance_rank stamps marked_by_role from the marker (the value sent here is overwritten), lets a staff member
    // mark only their own day, and refuses a staff mark once an owner or manager has marked that day.
    'attendance.mark',
    def(attendanceMark, async (ctx, i) => ({
      attendanceId: await insertId(
        ctx,
        `insert into books.attendance (tenant_id, staff_id, shop_id, day, status, in_at, out_at, marked_by_role)
         values ($1, $2, $3, $4, $5, $6, $7, 'staff') returning id`,
        [i.staffId, i.shopId, i.day, i.status, i.inAt ?? null, i.outAt ?? null],
      ),
    })),
  ],
  [
    'staff.terms',
    def(staffTerms, async (ctx, i) => ({
      termsId: await insertId(
        ctx,
        `insert into books.staff_terms (tenant_id, staff_id, shop_id, title, pay_kind, pay_minor, currency, effective_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [i.staffId, i.shopId, i.title ?? null, i.payKind, i.payMinor, ctx.t.currency, i.effectiveFrom],
      ),
    })),
  ],
  [
    // Money handed to a staff member ahead of pay: the advance, the payment out, and staff_advance against the tender.
    // A salary run recovers it.
    'advance.give',
    def(staffPayment, async (ctx, i) => {
      const { paymentId, date } = await staffPaid(ctx, i);
      const advanceId = await insertId(ctx, 'insert into books.advance (tenant_id, staff_id, amount_minor, currency, given_on) values ($1, $2, $3, $4, $5) returning id', [
        i.staffId,
        i.amountMinor,
        ctx.t.currency,
        date,
      ]);
      await journal(ctx, date, 'staff_advance', ['books.advance', advanceId], [
        ['staff_advance', i.amountMinor],
        [methodAccount(i.method), -i.amountMinor],
      ]);
      return { advanceId, paymentId };
    }),
  ],
  [
    // Wages paid out of what a salary run made payable: wages_payable against the tender.
    'wages.pay',
    def(staffPayment, async (ctx, i) => {
      const { paymentId, date } = await staffPaid(ctx, i);
      await journal(ctx, date, 'wages_paid', ['books.payment', paymentId], [
        ['wages_payable', i.amountMinor],
        [methodAccount(i.method), -i.amountMinor],
      ]);
      return { paymentId };
    }),
  ],
  [
    // The period's pay: the run, a line per staff member from salary.preview's SQL, and the journal (wages expense
    // against the advances recovered and the wages now payable).
    'salary.run',
    {
      ...def(salaryRun, async (ctx, i) => {
        const { c, t } = ctx;
        const lines = (await runReadOnly(c, SALARY_PREVIEW, [i.periodStart, i.periodEnd, i.shopId ?? null])) as PreviewRow[];
        if (lines.length === 0) throw new CoreError('invalid', { fields: ['periodStart'] });
        const runId = randomUUID();
        await c.query('insert into books.salary_run (tenant_id, id, period_start, period_end, shop_id) values ($1, $2, $3, $4, $5)', [
          t.tenantId,
          runId,
          i.periodStart,
          i.periodEnd,
          i.shopId ?? null,
        ]);
        const col = (k: keyof PreviewRow) => lines.map((l) => l[k]);
        await c.query(
          `insert into books.salary_line (tenant_id, run_id, staff_id, terms_id, pay_kind, pay_minor, days_milli, gross_minor, advance_recovered_minor,
                                          net_minor, currency)
           select $1, $2, l.staff, l.terms, l.kind, l.pay, l.days, l.gross, l.recovered, l.net, l.currency
             from unnest($3::uuid[], $4::uuid[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[])
                  as l(staff, terms, kind, pay, days, gross, recovered, net, currency)`,
          [t.tenantId, runId, col('staff_id'), col('terms_id'), col('pay_kind'), col('pay'), col('days'), col('gross'), col('recovered'), col('net'), col('currency')],
        );
        const sum = (k: 'gross' | 'recovered' | 'net') => lines.reduce((a, l) => a + Number(l[k]), 0);
        await journal(ctx, i.periodEnd, 'salary_run', ['books.salary_run', runId], [
          ['wages_expense', sum('gross')],
          ['staff_advance', -sum('recovered')],
          ['wages_payable', -sum('net')],
        ]);
        return { runId };
      }),
      checks: citesPreview,
      recheckedByChecks: true,
      draftOnly: true,
    },
  ],
];
