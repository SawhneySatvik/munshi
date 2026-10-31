import type { Case } from './case.ts';

export const PAYTM_SEED_CASES: Case[] = [
  {
    sabotage: 'v2-elite-attendance-includes-today',
    file: 'test/v2/core/seed/elite-attendance.test.ts',
    test: 'SHOWATTENDANCE Elite attendance ends before today at the month boundary and after it',
    config: 'vitest.v2.config.ts',
    ts: {
      file: 'db/seed/elite.ts',
      from: 'for (let day = periodStart; day <= attendanceEnd; day = addDays(day, 1)) {',
      to: 'for (let day = periodStart; day <= periodEnd; day = addDays(day, 1)) {',
    },
  },
  {
    sabotage: 'v2-platform-stale-digest-refusal',
    file: 'test/console.test.tsx',
    test: 'approval is refused for a wrong or stale digest, and for a channel grant without a fresh, unused code; nothing is written until it holds',
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: {
      file: 'packages/core/src/platform.ts',
      from: "if (diff.digest !== opts.digest || diff.stray.length) throw new CoreError('conflict');",
      to: "if (false) throw new CoreError('conflict');",
    },
  },
  {
    // The overdue udhaar given 20 days later falls due 25 days ago: the key's 45 days no longer holds.
    sabotage: 'v2-bansal-overdue-moved',
    file: 'test/v2/core/seed/bansal.test.ts',
    test: 'PAYTMSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder',
    config: 'vitest.v2.config.ts',
    ts: { file: 'db/seed/bansal.ts', from: 'const OVERDUE_DAY = -75;', to: 'const OVERDUE_DAY = -55;' },
  },
];
