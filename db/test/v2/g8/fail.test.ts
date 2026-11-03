// G8's failing child: excluded from the v2 include; run only by test/v2/g8-exit-code.test.ts.
import { expect, inject, it } from 'vitest';

it('child fails on purpose', () => {
  expect(inject('pg17Port')).toBeGreaterThan(0); // the embedded cluster really started
  expect('this run').toBe('failing on purpose');
});
