// pnpm dev seeds the demo shop as of the day the recorded answers replay (27 Oct 2026) in recorded mode, and as of today
// with a live model.
import { describe, expect, test } from "vitest";
import { seedDate } from "../../../db/src/dev.ts";

describe("the dev seed date", () => {
  test("recorded mode (also the default, and an empty setting) seeds as of 2026-10-27; live and record seed as of today", () => {
    for (const mode of ["recorded", undefined, ""]) expect(seedDate(mode).asOf, String(mode)).toBe("2026-10-27");
    for (const mode of ["live", "record"]) expect(seedDate(mode), mode).toMatchObject({ asOf: undefined, label: "today (live mode)" });
    expect(seedDate("recorded").label).toContain("recorded mode");
  });
});
