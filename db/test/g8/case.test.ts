import { expect, inject, it } from 'vitest';

it('G8 child case', () => {
  expect(inject('pgPort')).toBeGreaterThan(0); // the embedded cluster really started
  expect(process.env.G8_CASE).toBe('pass'); // fails on purpose when G8_CASE=fail
});
