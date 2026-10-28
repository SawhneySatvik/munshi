import type { Money } from "./types.ts";

/** Indian grouping (12,34,567) in integer arithmetic: the last three digits, then pairs. */
export function groupIndian(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  if (s.length <= 3) return s;
  const head = s.slice(0, -3);
  const pairs = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${pairs},${s.slice(-3)}`;
}

/** ₹1,24,999 for whole rupees; paise only when there are any (₹149.50). */
export function formatMoney(m: Money): string {
  const rupees = Math.trunc(m.minor / 100);
  const paise = Math.abs(m.minor % 100);
  return `₹${groupIndian(rupees)}${paise ? `.${String(paise).padStart(2, "0")}` : ""}`;
}

export function sumMoney(list: Money[]): Money {
  return { minor: list.reduce((a, m) => a + m.minor, 0), currency: "INR", ref: null, source: null };
}
