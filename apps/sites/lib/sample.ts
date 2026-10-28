import type { Count, Money } from "./types.ts";

// Builders for the illustrative fixtures. A sample figure has no snapshot ref: it names no book row, and says so.
export const rupees = (n: number): Money => ({ minor: n * 100, currency: "INR", ref: null, source: null });
export const count = (n: number): Count => ({ value: n, ref: null });
