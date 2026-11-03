// W1-C's price table: a call's cost in the spend ledger's unit (millionths of a cent), from a list price in USD
// micro-units per million tokens, rounded up per call; an alias with no price, or a call with no usage, has no cost
// (never zero). Every priced alias is a model alias and names its source.
import { expect, it } from "vitest";
import { costFrom, costOf, MODEL_ALIASES, type Price, PRICES } from "../src/index.ts";

it("PRICE1 a million input tokens of Muse Spark at $1.25 is 125 cents: 125 000 000 millionths of a cent", () => {
  expect(costOf("muse-spark", { inputTokens: 1_000_000, outputTokens: 0 })).toEqual({ costMinorE6: 125_000_000, currency: "USD" });
  expect(costOf("muse-spark", { inputTokens: 0, outputTokens: 1_000_000 })).toEqual({ costMinorE6: 425_000_000, currency: "USD" });
  expect(costOf("haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toEqual({ costMinorE6: 600_000_000, currency: "USD" });
  // One token: 1.25 micro-dollars is 125 millionths of a cent, exactly; a fraction rounds up, never down.
  expect(costOf("muse-spark", { inputTokens: 1, outputTokens: 0 })).toEqual({ costMinorE6: 125, currency: "USD" });
  expect(costOf("haiku-4-5", { inputTokens: 0, outputTokens: 0, cachedTokens: 1 })).toEqual({ costMinorE6: 10, currency: "USD" });
  expect(costOf("muse-spark", { inputTokens: 0, outputTokens: 0, cachedTokens: 1 })).toEqual({ costMinorE6: 15, currency: "USD" });
});

it("PRICE2 no price is no cost, never zero: an unpriced alias, an unknown one, or a call with no usage", () => {
  for (const alias of ["spark-open", "gemini-flash", "bulbul-v3", "no-such-model"]) expect(costOf(alias, { inputTokens: 10, outputTokens: 10 }), alias).toBeNull();
  expect(costOf("muse-spark", null)).toBeNull();
  expect(costOf("muse-spark", { inputTokens: -1, outputTokens: 0 })).toBeNull();
  expect(costOf("toString", { inputTokens: 1, outputTokens: 1 })).toBeNull();
});

it("PRICE4 a fraction of a millionth of a cent rounds up per call, never down", () => {
  // A price that is not a whole number of cents per million: one micro-dollar per million input tokens, three output.
  const tiny: Price = { per: "tokens", input: 1, output: 3, cached: 0, currency: "USD", source: "test", estimate: true };
  expect(costFrom(tiny, { inputTokens: 1, outputTokens: 0 })).toEqual({ costMinorE6: 1, currency: "USD" }); // 1/10 000, up
  expect(costFrom(tiny, { inputTokens: 10_000, outputTokens: 0 })).toEqual({ costMinorE6: 1, currency: "USD" }); // exactly 1
  expect(costFrom(tiny, { inputTokens: 10_001, outputTokens: 0 })).toEqual({ costMinorE6: 2, currency: "USD" });
  expect(costFrom(tiny, { inputTokens: 0, outputTokens: 3_334 })).toEqual({ costMinorE6: 2, currency: "USD" }); // 10 002/10 000
});

it("PRICE3 every priced alias is a model alias, names its source and says whether it is an estimate", () => {
  for (const [alias, p] of Object.entries(PRICES)) {
    expect(Object.hasOwn(MODEL_ALIASES, alias), alias).toBe(true);
    expect(p.source.length, alias).toBeGreaterThan(0);
    expect(typeof p.estimate, alias).toBe("boolean");
    expect([p.input, p.output, p.cached].every((n) => Number.isSafeInteger(n) && n >= 0), alias).toBe(true);
  }
});
