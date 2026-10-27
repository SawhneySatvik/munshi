import { expect, it } from 'vitest';
import { addDays, businessDate, dayStart, daysBetween, localTime } from '../src/time.ts';

it('time: a business date is the Asia/Kolkata calendar date', () => {
  expect(businessDate(new Date('2026-10-26T18:29:59Z'))).toBe('2026-10-26'); // 23:59:59 IST
  expect(businessDate(new Date('2026-10-26T18:30:00Z'))).toBe('2026-10-27'); // midnight IST
  expect(dayStart('2026-10-27').toISOString()).toBe('2026-10-26T18:30:00.000Z');
  expect(localTime('2026-10-27', 8 * 60).toISOString()).toBe('2026-10-27T02:30:00.000Z'); // 08:00 IST
});

it('time: another zone resolves on the right side of both DST changes (Australia/Melbourne)', () => {
  const tz = 'Australia/Melbourne';
  expect(dayStart('2026-10-04', tz).toISOString()).toBe('2026-10-03T14:00:00.000Z'); // AEST, the day clocks go forward
  expect(dayStart('2026-10-05', tz).toISOString()).toBe('2026-10-04T13:00:00.000Z'); // AEDT
  expect(localTime('2026-10-04', 150, tz).toISOString()).toBe('2026-10-03T16:30:00.000Z'); // 02:30 does not exist: 03:30
  expect(dayStart('2026-04-05', tz).toISOString()).toBe('2026-04-04T13:00:00.000Z'); // AEDT, the day clocks go back
  expect(dayStart('2026-04-06', tz).toISOString()).toBe('2026-04-05T14:00:00.000Z'); // AEST
  expect(businessDate(new Date('2026-10-03T13:59:59Z'), tz)).toBe('2026-10-03');
  expect(businessDate(new Date('2026-10-03T14:00:00Z'), tz)).toBe('2026-10-04');
});

it('time: calendar arithmetic on business dates', () => {
  expect(addDays('2026-10-27', -30)).toBe('2026-09-27');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(daysBetween('2026-09-27', '2026-10-27')).toBe(30);
  expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  expect(() => addDays('27-10-2026', 1)).toThrow(RangeError);
});
