import { expect, it } from 'vitest';
import { addDays, businessDate, localTime } from '../../../../../packages/core/src/time.ts';
import { seedElite } from '../../../../seed/elite.ts';
import { openTestDb } from '../../db.ts';

const TZ = 'Asia/Kolkata';

// The seed's `now` is injected, but the desk's bookings (asOf's days 0–2, from 11:00) are checked against the
// database's own now(), which no test can pin. So the cases are built from the real clock, each asOf at least tomorrow
// in the shop's zone: the last day of this month at 23:30, the first of the next at 00:30 (the previous day in UTC), and
// today at noon.
function casesAt(real: Date) {
  const today = businessDate(real, TZ);
  const next = `${addDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7)}-01`; // the first of the next month, after today
  return [
    { now: localTime(addDays(next, -1), 23 * 60 + 30, TZ), asOf: next },
    { now: localTime(next, 30, TZ), asOf: addDays(next, 1) },
    { now: localTime(today, 12 * 60, TZ), asOf: addDays(today, 1) },
  ].map((c) => ({ ...c, today: businessDate(c.now, TZ) }));
}

it('Elite attendance ends before today at the month boundary and after it', async () => {
  // The cases keep their shape at any hour of any day: a month's last day and the next one's first, every asOf after
  // the real today (the bookings in the future).
  for (const real of ['2026-10-31T23:59:00+05:30', '2026-11-01T00:01:00+05:30', '2026-11-03T18:20:00+05:30', '2026-11-15T12:00:00+05:30', '2026-12-31T23:59:59+05:30', '2027-02-28T06:00:00+05:30']) {
    const at = new Date(real);
    const [end, start] = casesAt(at);
    expect(addDays(end?.today as string, 1).endsWith('-01'), real).toBe(true);
    expect(start?.today.endsWith('-01'), real).toBe(true);
    for (const c of casesAt(at)) {
      expect(c.asOf > businessDate(at, TZ), real).toBe(true);
      expect(c.asOf, real).toBe(addDays(c.today, 1));
    }
  }

  const db = await openTestDb();
  const app = db.as('munshi_app');
  const owner = await db.migrator();
  try {
    for (const [n, { now, today, asOf }] of casesAt(new Date()).entries()) {
      const slug = `elite-${n}-${today.replaceAll('-', '')}`;
      const seed = await seedElite(app, owner, { asOf, now, slug });
      const { rows } = await db.admin.query<{ n: number; latest: string | null }>(
        `select count(*)::int as n, max(day)::text as latest from books.attendance where tenant_id = $1 and day >= $2::date`,
        [seed.tenantId, today],
      );
      expect(rows[0], today).toMatchObject({ n: 0, latest: null });
      expect(seed.counts.attendance).toBeGreaterThan(0);
    }
  } finally {
    await owner.end();
    await db.close();
  }
});
