// Money is a whole number of the currency's minor unit (paise for INR) plus the currency; never a float. Quantities are
// milli-units of the item's unit (1 pack = 1000), so a line amount is qty_milli × unit price / 1000, rounded once.

export type Money = { minor: number; currency: string };

export function money(minor: number, currency: string): Money {
  if (!Number.isSafeInteger(minor)) throw new RangeError('money: not a whole number of minor units');
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('money: not an ISO 4217 currency code');
  return { minor, currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new RangeError(`money: cannot add ${a.currency} to ${b.currency}`);
  return money(a.minor + b.minor, a.currency);
}

// The amount of qtyMilli at unitMinor a unit, rounded half away from zero to a whole minor unit. The database's watchers
// round the same way ((x + 500) / 1000 on non-negative bigints).
export function lineAmount(qtyMilli: number, unitMinor: number): number {
  const exact = qtyMilli * unitMinor; // thousandths of a minor unit
  if (!Number.isSafeInteger(qtyMilli) || !Number.isSafeInteger(unitMinor) || !Number.isSafeInteger(exact)) {
    throw new RangeError('lineAmount: out of range');
  }
  const rounded = Math.floor((Math.abs(exact) + 500) / 1000);
  return exact < 0 ? -rounded : rounded;
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// "₹56", "₹1,234.50": whole amounts drop the minor digits.
export function formatMoney(m: Money, locale = 'en-IN'): string {
  const digits = fractionDigits(m.currency);
  const scale = 10 ** digits;
  const shown = m.minor % scale === 0 ? 0 : digits;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, minimumFractionDigits: shown, maximumFractionDigits: shown }).format(
    m.minor / scale,
  );
}

// "24", "1.5 kg": counted units (piece, pack) show the count, measured units carry the unit.
export function formatQuantity(qtyMilli: number, unit: string, locale = 'en-IN'): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qtyMilli / 1000);
  return unit === 'piece' || unit === 'pack' ? n : `${n} ${unit}`;
}
