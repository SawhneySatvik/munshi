// A quantity with no unit of the shop's (a bill line that matched no item) names its unit in the screen's language.
import { describe, expect, test } from "vitest";
import { formatQty } from "../lib/snapshot";

describe("formatQty", () => {
  test("a bare unit is a word in the screen's language: English singular and plural, Hindi one word for both", () => {
    expect(formatQty(12_000, "unit")).toBe("12 units");
    expect(formatQty(1_000, "unit")).toBe("1 unit");
    expect(formatQty(12_000, "unit", "hi")).toBe("12 इकाई");
    expect(formatQty(1_000, "unit", "hi")).toBe("1 इकाई");
    expect(formatQty(1_500, "kg", "hi")).toBe("1.5 kg"); // a real unit keeps its symbol
  });
});
