// What a person types into a field, read as the books' whole numbers: rupees to paise, a quantity to milli-units of the
// item's unit. Strings are split at the decimal point and the parts read as integers, never through a float, so "0.29"
// is 29 paise and not 28. Devanagari digits are read as digits; Indian digit grouping ("1,200") is allowed. Anything
// else, or too large, is null; so is zero, except for a shelf count (an empty shelf is a count).

const DEVANAGARI = /[०-९]/g;
const plain = (s: string) => s.trim().replace(DEVANAGARI, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/,/g, "");

function scaled(text: string, places: number, maxWhole: number, zero = false): number | null {
  const m = new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${places}}))?$`).exec(plain(text));
  if (!m) return null;
  const whole = Number(m[1]);
  if (whole > maxWhole) return null;
  const value = whole * 10 ** places + Number((m[2] ?? "").padEnd(places, "0"));
  return value > 0 || (zero && value === 0) ? value : null;
}

/** "250" → 25000, "99.5" → 9950; at most two decimals; up to ₹1,00,00,000. */
export function rupeesToMinor(text: string): number | null {
  return scaled(text, 2, 10_000_000);
}

const COUNTED = new Set(["pack", "piece"]);

/** Packs and pieces are whole ("2" → 2000); weighed or measured units take up to three decimals ("1.25" kg → 1250). */
export function qtyToMilli(text: string, unit: string, zero = false): number | null {
  if (COUNTED.has(unit) && plain(text).includes(".")) return null;
  return scaled(text, 3, 100_000, zero);
}
