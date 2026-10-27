import { expect, it } from 'vitest';
import { add, formatMoney, formatQuantity, lineAmount, money } from '../src/money.ts';

it('money: a line amount rounds half away from zero, once', () => {
  expect(lineAmount(3000, 1000)).toBe(3000); // 3 packs at ₹10
  expect(lineAmount(1500, 6200)).toBe(9300); // 1.5 packs at ₹62
  expect(lineAmount(500, 4601)).toBe(2301); // 0.5 kg at ₹46.01: 2300.5 → 2301
  expect(lineAmount(1, 500)).toBe(1); // half a paisa rounds up
  expect(lineAmount(1, 499)).toBe(0);
  expect(lineAmount(-1, 500)).toBe(-1); // and away from zero for a reversal
  expect(() => lineAmount(2 ** 40, 2 ** 20)).toThrow(RangeError);
});

it('money: amounts are whole minor units of one currency', () => {
  expect(money(5600, 'INR')).toEqual({ minor: 5600, currency: 'INR' });
  expect(() => money(56.5, 'INR')).toThrow(RangeError);
  expect(() => money(1, 'inr')).toThrow(RangeError);
  expect(add(money(100, 'INR'), money(250, 'INR'))).toEqual({ minor: 350, currency: 'INR' });
  expect(() => add(money(100, 'INR'), money(100, 'AUD'))).toThrow(RangeError);
});

it('money: rupees render in Indian grouping, whole amounts without paise', () => {
  expect(formatMoney(money(5600, 'INR'))).toBe('₹56');
  expect(formatMoney(money(123_450, 'INR'))).toBe('₹1,234.50');
  expect(formatMoney(money(23_500_000, 'INR'))).toBe('₹2,35,000');
  expect(formatQuantity(16_000, 'pack')).toBe('16');
  expect(formatQuantity(1500, 'kg')).toBe('1.5 kg');
});
