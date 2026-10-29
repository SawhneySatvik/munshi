// SAL1 and PAY1 end to end through core (BLUEPRINT §8.10, §2.13). SAL1: the salary preview of a month worked by hand here
// is the key's, cell for cell; a salary run is draft-only, executed under the owner's approved decision, writes exactly
// the preview's figures and a balanced journal, recovers advances only up to what is outstanding, and pays no one twice
// for overlapping days; a draft whose preview moved since is stale. PAY1: wages and advances are written only by
// wages.pay (owner, manager) and advance.give (the owner, per 12), never by payment.record, which staff hold; a staff
// member marks only their own day, never after an owner's or manager's mark. Each test has its own salon. A salary draft
// is made through proposeDraft, the app's "Make the draft": salary.run's checks re-verify every cell of the preview it
// cites (recheckedByChecks), at proposal and again at approval, under the tenant's chain lock.
// Red-proofs: test/v2/sabotage/core-staff.ts.
import { type CellRef, command, type Decision, decide, execute, mintSnapshot, proposeDraft, runCommand, type Session, withTx } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Salon, salon } from './salon.ts';

let db: TestDb;
let app: pg.Pool;
let s: Salon; // SAL1's month
let t: Salon; // the stale draft
let p: Salon; // PAY1
let w: Salon; // the approval window
let nisha: string;

const run = async (who: Session, name: string, input: unknown) => (await runCommand(app, who, name, input)) as Record<string, string>;
const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const sep = (d: number) => `2026-09-${String(d).padStart(2, '0')}`;
const mark = (shop: Salon, by: Session, staffId: string, day: string, status: string) =>
  run(by, 'attendance.mark', { staffId, shopId: shop.shopId, day, status });
const preview = (shop: Salon, period_start: string, period_end: string) =>
  mintSnapshot(app, { kind: 'member', session: shop.owner }, 'salary.preview', { period_start, period_end });
// The owner's draft of the run, citing the preview's row count (decide's own re-check) and resting on salary.run's check
// that every cell of that preview still holds.
const draft = (shop: Salon, periodStart: string, periodEnd: string, cites: CellRef[]) =>
  proposeDraft(app, { session: shop.owner }, { command: 'salary.run', payload: { periodStart, periodEnd }, basedOn: cites });
const count = (snapshotId: string): CellRef[] => [{ snapshotId, row: 0, col: '_count' }];
const cellsOf = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v as { num?: string; txt?: string }).num ?? (v as { txt?: string }).txt])));

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  [s, t, p, w] = [await salon(app, 'SAL1'), await salon(app, 'SAL1-stale'), await salon(app, 'PAY1'), await salon(app, 'SAL1-window')];
  // September 2026, worked by hand below. Pooja is the front desk (daily ₹600 from 1 Aug, she signs in); Ravi is monthly
  // ₹18,000 from 1 Aug; Nisha joins on 16 Sep at ₹15,000 a month.
  const pooja = s.deskStaffId;
  const ravi = s.stylists.ravi;
  await run(s.owner, 'staff.terms', { staffId: ravi, shopId: s.shopId, payKind: 'monthly', payMinor: 1_800_000, effectiveFrom: '2026-08-01' });
  nisha = (await run(s.owner, 'staff.create', { name: 'Nisha' })).staffId as string;
  await run(s.owner, 'staff.terms', { staffId: nisha, shopId: s.shopId, payKind: 'monthly', payMinor: 1_500_000, effectiveFrom: '2026-09-16' });
  await run(s.manager, 'holiday.set', { shopId: s.shopId, day: sep(15), nameKey: 'local_fair' });
  await run(s.manager, 'holiday.set', { day: sep(9), nameKey: 'festival' });
  for (let d = 1; d <= 20; d++) await mark(s, s.manager, pooja, sep(d), 'present');
  await mark(s, s.manager, pooja, sep(21), 'half_day');
  await mark(s, s.manager, pooja, sep(22), 'half_day');
  await mark(s, s.manager, pooja, sep(23), 'absent');
  await run(s.manager, 'leave.record', { staffId: pooja, kind: 'paid', firstDay: sep(24), lastDay: sep(24) });
  await run(s.manager, 'leave.record', { staffId: pooja, kind: 'sick', firstDay: sep(25), lastDay: sep(25) });
  await mark(s, s.desk, pooja, sep(26), 'present');
  await mark(s, s.desk, pooja, sep(27), 'present');
  await mark(s, s.manager, pooja, sep(27), 'absent');
  await run(s.manager, 'leave.record', { staffId: pooja, kind: 'paid', firstDay: sep(28), lastDay: sep(28), halfDay: true });
  await mark(s, s.manager, pooja, sep(28), 'half_day');
  await mark(s, s.manager, pooja, sep(29), 'present');
  await mark(s, s.owner, pooja, sep(29), 'present');
  await run(s.manager, 'leave.record', { staffId: ravi, kind: 'unpaid', firstDay: sep(8), lastDay: sep(10) });
  await run(s.manager, 'leave.record', { staffId: ravi, kind: 'unpaid', firstDay: sep(18), lastDay: sep(18), halfDay: true });
  await mark(s, s.manager, ravi, sep(22), 'absent');
  await run(s.manager, 'leave.record', { staffId: ravi, kind: 'sick', firstDay: sep(25), lastDay: sep(25) });
  await run(s.owner, 'advance.give', { staffId: pooja, amountMinor: 200_000, method: 'cash', paidAt: '2026-09-10T11:00:00+05:30' });
  await run(s.owner, 'advance.give', { staffId: nisha, amountMinor: 1_000_000, method: 'upi', paidAt: '2026-09-20T11:00:00+05:30' });
  // The stale draft's salon: one day of Asha's in September.
  await mark(t, t.manager, t.stylists.asha, sep(1), 'present');
  await db.sabotage();
});
afterAll(() => db?.close());

// The key, worked by hand (rules in packages/core/src/salary.ts), September: 30 days.
// - Pooja, daily ₹600: present 1–20 (the 15th is a holiday, and she was present) = 20; half days 21, 22 = 1; absent 23 =
//   0; paid leave 24 = 1; sick leave 25 = 0; her own present 26 = 1; 27 her present, then the manager's absent, which
//   ranks higher = 0; 28 a half day of paid leave and a half-day mark = 1; 29 marked present twice, one day = 1; 30 = 0.
//   25 days: ₹15,000. Her ₹2,000 advance is outstanding: recovered whole, net ₹13,000.
// - Ravi, monthly ₹18,000: unpaid leave 8–10, the 9th a holiday for every branch = 2; a half day of unpaid leave on 18 =
//   ½; his absent mark on 22 and sick leave on 25 dock nothing. 2½ unpaid days: 18,00,000 × 2,500 ÷ 30,000 = 1,50,000
//   paise, gross ₹16,500; 27½ days paid; no advance, net ₹16,500.
// - Nisha, monthly ₹15,000 from the 16th: 1–15 are before her first terms, 15 unpaid days: gross ₹7,500 over 15 days. Her
//   ₹10,000 advance is recovered up to the gross, ₹7,500, so her net is zero and ₹2,500 stays outstanding.
// - Asha, Meena, Kiran and Dev (daily ₹600, Dev at the other branch): no attendance, every figure zero.
type Line = [string, string, number, number, number, number, number, number, number];
const SEPTEMBER = (): Line[] => [
  // staff, pay kind, pay, days (milli), unpaid (milli), gross, outstanding, recovered, net
  [s.deskStaffId, 'daily', 60_000, 25_000, 0, 1_500_000, 200_000, 200_000, 1_300_000],
  [s.stylists.ravi, 'monthly', 1_800_000, 27_500, 2_500, 1_650_000, 0, 0, 1_650_000],
  [nisha, 'monthly', 1_500_000, 15_000, 15_000, 750_000, 1_000_000, 750_000, 0],
  ...(['asha', 'meena', 'kiran', 'dev'] as const).map((w): Line => [s.stylists[w], 'daily', 60_000, 0, 0, 0, 0, 0, 0]),
];
const asRows = (lines: Line[]) =>
  lines
    .map(([staff_id, pay_kind, pay, days, unpaid_days, gross, outstanding, recovered, net]) => ({
      staff_id,
      pay_kind,
      pay: String(pay),
      days: String(days),
      unpaid_days: String(unpaid_days),
      gross: String(gross),
      outstanding: String(outstanding),
      recovered: String(recovered),
      net: String(net),
    }))
    .sort((a, b) => a.staff_id.localeCompare(b.staff_id));

it('SAL1 the hand-worked month’s preview is the key, cell for cell; the owner’s approved run writes exactly it with a balanced journal, recovers advances only up to what is outstanding, and pays no one twice for overlapping days', async () => {
  const snap = await preview(s, '2026-09-01', '2026-09-30');
  const cells = cellsOf(snap.rows).map(({ terms_id: _terms, ...rest }) => rest);
  expect(cells.sort((a, b) => String(a.staff_id).localeCompare(String(b.staff_id)))).toEqual(asRows(SEPTEMBER()));

  // Draft-only: never a direct command, in core or in the database.
  await expect(runCommand(app, s.owner, 'salary.run', { periodStart: '2026-09-01', periodEnd: '2026-09-30' })).rejects.toMatchObject({
    code: 'refused',
    fields: ['command'],
  });
  const direct = withTx(app, { kind: 'member', session: s.owner, command: 'salary.run' }, (c) =>
    execute(c, command('salary.run'), { periodStart: '2026-09-01', periodEnd: '2026-09-30' }),
  );
  await expect(direct).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  // A manager may not approve it.
  const sept = await draft(s, '2026-09-01', '2026-09-30', count(snap.id));
  await expect(decide(app, s.manager, sept, 'approved')).rejects.toMatchObject({ code: 'refused' });

  const done = await decide(app, s.owner, sept, 'approved');
  expect(done.status).toBe('executed');
  const { decisionId, result } = done as Extract<Decision, { status: 'executed' }>;
  const lines = await q(
    `select staff_id::text, pay_kind, pay_minor::text as pay, days_milli::text as days, gross_minor::text as gross,
            advance_recovered_minor::text as recovered, net_minor::text as net, created_by::text, decision_id::text
       from books.salary_line where run_id = $1`,
    [result.runId as string],
  );
  expect(lines.sort((a, b) => a.staff_id.localeCompare(b.staff_id))).toEqual(
    asRows(SEPTEMBER()).map(({ unpaid_days: _u, outstanding: _o, ...r }) => ({ ...r, created_by: s.owner.memberId, decision_id: decisionId })),
  );
  expect(
    await q(
      `select l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id
        where e.source_id = $1 order by l.account`,
      [result.runId],
    ),
  ).toEqual([
    { account: 'staff_advance', amount: -950_000 },
    { account: 'wages_expense', amount: 3_900_000 },
    { account: 'wages_payable', amount: -2_950_000 },
  ]);

  // October: Nisha's last ₹2,500 is recovered, never more; Ravi's full month, 31 days.
  const oct = await preview(s, '2026-10-01', '2026-10-31');
  const octRow = (id: string) => cellsOf(oct.rows).find((r) => r.staff_id === id);
  expect(octRow(nisha)).toMatchObject({ gross: '1500000', outstanding: '250000', recovered: '250000', net: '1250000' });
  expect(octRow(s.stylists.ravi)).toMatchObject({ days: '31000', gross: '1800000', recovered: '0' });
  expect((await decide(app, s.owner, await draft(s, '2026-10-01', '2026-10-31', count(oct.id)), 'approved')).status).toBe('executed');
  expect(await q('select sum(advance_recovered_minor)::int as n from books.salary_line where staff_id = $1', [nisha])).toEqual([{ n: 1_000_000 }]);

  // Days already paid are paid once: a period overlapping both runs leaves everyone out, and a draft citing the September
  // preview again is refused, since its cells no longer hold.
  expect((await preview(s, '2026-09-16', '2026-10-15')).rows).toEqual([]);
  await expect(draft(s, '2026-09-01', '2026-09-30', count(snap.id))).rejects.toMatchObject({ code: 'invalid', fields: ['basedOn'] });
  expect(await q('select count(*)::int as n from books.salary_line l join books.salary_run r on r.id = l.run_id where r.tenant_id = $1', [s.tenantId])).toEqual([
    { n: 14 },
  ]);
});

it('SAL1 a salary draft whose preview moved since it was made is stale and pays nothing, though the cell it cites still holds; one leave never overlaps another', async () => {
  const snap = await preview(t, '2026-09-01', '2026-09-30');
  const asha = cellsOf(snap.rows).find((r) => r.staff_id === t.stylists.asha);
  expect(asha).toMatchObject({ days: '1000', gross: '60000' });
  const id = await draft(t, '2026-09-01', '2026-09-30', count(snap.id));
  await mark(t, t.manager, t.stylists.asha, sep(2), 'present'); // the row count it cites is unchanged
  expect((await decide(app, t.owner, id, 'approved')).status).toBe('stale');
  expect(await q('select count(*)::int as n from books.salary_run where tenant_id = $1', [t.tenantId])).toEqual([{ n: 0 }]);

  await run(t.manager, 'leave.record', { staffId: t.stylists.asha, kind: 'paid', firstDay: '2026-11-02', lastDay: '2026-11-04' });
  await expect(run(t.manager, 'leave.record', { staffId: t.stylists.asha, kind: 'unpaid', firstDay: '2026-11-04', lastDay: '2026-11-05' })).rejects.toMatchObject({
    code: 'refused',
    sqlstate: 'MS001',
  });
});

// A munshi_app backend of this test's database waiting on a lock: proof the approval reached a lock the open
// transaction holds, before that transaction commits.
async function appWaitingOnLock(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const [r] = await q(`select count(*)::int as n from pg_stat_activity where datname = $1 and usename = 'munshi_app' and wait_event_type = 'Lock'`, [db.name]);
    if (r.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the approval never waited on a lock');
}

it('SAL1 a book row committing while the owner approves is seen by the check, never slipped past it: the check waits on the tenant’s chain lock and the draft goes stale', async () => {
  const snap = await preview(w, '2026-09-01', '2026-09-30');
  const id = await draft(w, '2026-09-01', '2026-09-30', count(snap.id));
  // A manager's attendance mark, written and left open: its audit entry holds the tenant's chain lock until it commits.
  const c = await app.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'attendance.mark', true)`, [
      w.tenantId,
      w.manager.memberId,
    ]);
    await c.query(`insert into books.attendance (tenant_id, staff_id, shop_id, day, status, marked_by_role) values ($1, $2, $3, $4, 'present', 'staff')`, [
      w.tenantId,
      w.stylists.asha,
      w.shopId,
      sep(4),
    ]);
    const approval = decide(app, w.owner, id, 'approved').catch((e: unknown) => e);
    await appWaitingOnLock();
    await c.query('commit');
    expect(await approval).toMatchObject({ status: 'stale' });
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
  expect(await q('select count(*)::int as n from books.salary_run where tenant_id = $1', [w.tenantId])).toEqual([{ n: 0 }]);
});

it('PAY1 payment.record cannot pay a staff member and its body under payment.record is refused; wages.pay (owner, manager) and advance.give (owner) can; staff mark only their own day, never after an owner’s or manager’s mark', async () => {
  const pooja = p.deskStaffId;
  // payment.record takes no staff member, and a staff payment written under it is refused by the database.
  await expect(run(p.desk, 'payment.record', { direction: 'out', staffId: pooja, method: 'cash', amountMinor: 1000 })).rejects.toMatchObject({ code: 'invalid' });
  const wages = command('wages.pay');
  const asPaymentRecord = withTx(app, { kind: 'member', session: p.desk, command: 'payment.record' }, (c) =>
    execute(c, wages, { staffId: pooja, amountMinor: 1000, method: 'cash' }),
  );
  await expect(asPaymentRecord).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  await expect(run(p.desk, 'wages.pay', { staffId: pooja, amountMinor: 1000, method: 'cash' })).rejects.toMatchObject({ code: 'refused' });
  await expect(run(p.manager, 'advance.give', { staffId: pooja, amountMinor: 1000, method: 'cash' })).rejects.toMatchObject({ code: 'refused' });

  const paymentId = (await run(p.manager, 'wages.pay', { staffId: pooja, amountMinor: 1_300_000, method: 'cash' })).paymentId as string;
  const advance = await run(p.owner, 'advance.give', { staffId: pooja, amountMinor: 50_000, method: 'upi' });
  const [advanceId, advancePaid] = [advance.advanceId as string, advance.paymentId as string];
  expect(await q('select id::text, direction, staff_id::text, amount_minor::int as amount from books.payment where staff_id = $1 order by amount_minor', [pooja])).toEqual([
    { id: advancePaid, direction: 'out', staff_id: pooja, amount: 50_000 },
    { id: paymentId, direction: 'out', staff_id: pooja, amount: 1_300_000 },
  ]);
  expect(
    await q(
      `select e.source_id::text, l.account, l.amount_minor::int as amount from books.journal_line l join books.journal_entry e on e.id = l.entry_id
        where e.source_id = any($1::uuid[]) order by e.source_id, l.account`,
      [[paymentId, advanceId]],
    ),
  ).toEqual(
    [
      { source_id: paymentId, account: 'cash', amount: -1_300_000 },
      { source_id: paymentId, account: 'wages_payable', amount: 1_300_000 },
      { source_id: advanceId, account: 'staff_advance', amount: 50_000 },
      { source_id: advanceId, account: 'upi_clearing', amount: -50_000 },
    ].sort((a, b) => a.source_id.localeCompare(b.source_id) || a.account.localeCompare(b.account)),
  );
  expect(await q(`select actor_id::text, command from audit.audit_log where entity = 'books.payment' and entity_id = $1`, [paymentId])).toEqual([
    { actor_id: p.manager.memberId, command: 'wages.pay' },
  ]);

  // Attendance: her own day; a manager's mark that day outranks her and closes it to her; never someone else's.
  await mark(p, p.desk, pooja, '2026-11-02', 'present');
  await mark(p, p.manager, pooja, '2026-11-03', 'absent');
  await expect(mark(p, p.desk, pooja, '2026-11-03', 'present')).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  await expect(mark(p, p.desk, p.stylists.asha, '2026-11-02', 'present')).rejects.toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  expect(await q(`select day::text, marked_by_role from books.attendance where staff_id = $1 order by day`, [pooja])).toEqual([
    { day: '2026-11-02', marked_by_role: 'staff' },
    { day: '2026-11-03', marked_by_role: 'manager' },
  ]);
});
