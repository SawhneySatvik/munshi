// @vitest-environment node
// The month pages' heading and tabs (invoices, salary) name a month through lib/time's monthYear. It must read exactly as
// the Intl call each page used to make inline, for every month in both languages, and never slip into the month before
// or after: a calendar month has no time zone.
import { expect, test } from "vitest";
import { monthYear } from "../lib/time";

const inline = (m: string, lang: "en" | "hi") =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

test("monthYear names a calendar month exactly as the pages' own Intl call did, in both languages", () => {
  for (const lang of ["en", "hi"] as const) {
    for (let i = 1; i <= 12; i++) {
      const m = `2026-${String(i).padStart(2, "0")}`;
      expect(monthYear(m, lang)).toBe(inline(m, lang));
    }
  }
  expect(monthYear("2026-10", "en")).toBe("October 2026");
  expect(monthYear("2027-01", "en")).toBe("January 2027");
  expect(monthYear("2026-12", "hi")).toBe(inline("2026-12", "hi"));
  expect(monthYear("2026-12", "hi")).toContain("2026");
});
