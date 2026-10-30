import { expect, it } from 'vitest';
import { seedElite } from '../../../../seed/elite.ts';
import { openTestDb } from '../../db.ts';

const CASES = [
  { now: new Date('2026-10-31T23:30:00+05:30'), today: '2026-10-31', asOf: '2026-11-01' },
  { now: new Date('2026-11-01T00:30:00+05:30'), today: '2026-11-01', asOf: '2026-11-02' },
  { now: new Date('2026-11-15T12:00:00+05:30'), today: '2026-11-15', asOf: '2026-11-16' },
] as const;

it('SHOWATTENDANCE Elite attendance ends before today at the month boundary and after it', async () => {
  const db = await openTestDb();
  const app = db.as('munshi_app');
  const owner = await db.migrator();
  try {
    for (const { now, today, asOf } of CASES) {
      const slug = `elite-${today.replaceAll('-', '')}`;
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
