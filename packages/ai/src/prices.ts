// What a model call costs: a list price per alias, per million tokens (per million characters for a speak
// alias), in USD micro-units (1 000 000 = one dollar). The spend ledger stores a call's cost in millionths of a minor
// unit (ai.spend.cost_minor_e6, 22_ai_controls.sql): with a price in cents per million tokens, cost = tokens × price, so
// from micro-dollars it is tokens × price / 10 000, rounded up per call (a cost is never under-reported).
//
// An alias with no row here has no price: its calls are kept with a NULL cost and every screen says "Cannot verify",
// never zero. A price is listed only where its source can be named; `estimate` marks one not checked against the
// provider's own page in this build, and the screens mark a cost computed from it. No price was found in this build for
// the Gemini, OpenAI, OpenRouter, NVIDIA and Sarvam aliases, Muse Spark Open on Baseten, SAM or Muse Voice: they stay
// unpriced until a source is recorded here.
import { MODEL_ALIASES } from "./models.ts";
import type { Usage } from "./providers/types.ts";

export type Price = {
  /** what a million of is priced: tokens, or the characters a speak alias voices */
  per: "tokens" | "chars";
  /** USD micro-units per million */
  input: number;
  output: number;
  cached: number;
  currency: "USD";
  /** where the figure came from */
  source: string;
  /** true: not checked against the provider's own price page in this build */
  estimate: boolean;
};

export const PRICES: Readonly<Record<string, Price>> = {
  // A provisional figure of $1.25 input, $4.25 output and $0.15 cache reads per million tokens: Meta's own price page
  // could not be reached to check it, so it is an estimate until it is.
  "muse-spark": { per: "tokens", input: 1_250_000, output: 4_250_000, cached: 150_000, currency: "USD", source: "provisional figure, not checked against Meta's price page", estimate: true },
  // Anthropic's public list price for Claude Haiku 4.5 as published at the model's release (Oct 2025, anthropic.com/pricing):
  // $1 input, $5 output, $0.10 cache reads per million tokens. Not re-checked against the page from this build, so an
  // estimate until it is.
  "haiku-4-5": { per: "tokens", input: 1_000_000, output: 5_000_000, cached: 100_000, currency: "USD", source: "anthropic.com/pricing (Oct 2025)", estimate: true },
};

for (const alias of Object.keys(PRICES)) {
  if (!Object.hasOwn(MODEL_ALIASES, alias)) throw new Error(`prices: ${alias} is not a model alias`);
}

/** A call's cost as the spend ledger stores it, or null when the alias has no price. */
export type Cost = { costMinorE6: number; currency: Price["currency"] } | null;

// The schema's bound for one call (cost_minor_e6 <= 10^15): a figure past it is a units bug, refused there.
const MAX = 1_000_000_000_000_000n;

/**
 * The cost of one call of `alias` from the adapter's usage: input, output and cached counts each times its price, summed,
 * divided by 10 000 and rounded up, in integers. Null when the alias has no price, or the adapter reported no usage
 * (a speech-to-text, segment or document call): unknown counts are never priced as zero.
 */
export function costOf(alias: string, usage: (Usage & { cachedTokens?: number }) | null): Cost {
  const p = Object.hasOwn(PRICES, alias) ? PRICES[alias] : undefined;
  if (!p || !usage) return null;
  return costFrom(p, usage);
}

/** One call's cost at a given price (costOf's arithmetic): a fraction of a millionth of a cent rounds up. */
export function costFrom(p: Price, usage: Usage & { cachedTokens?: number }): Cost {
  const counts = [usage.inputTokens, usage.outputTokens, usage.cachedTokens ?? 0];
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const [i, o, c] = counts.map(BigInt) as [bigint, bigint, bigint];
  const total = i * BigInt(p.input) + o * BigInt(p.output) + c * BigInt(p.cached);
  const cost = (total + 9_999n) / 10_000n;
  return cost > MAX ? null : { costMinorE6: Number(cost), currency: p.currency };
}
