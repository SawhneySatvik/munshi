// The site's one time module: an offer's last day, a published row's date, a slot's time and an order step's moment are
// read on the shop's clock (Asia/Kolkata), and each reads exactly as the Intl call its page used to make inline, in both
// languages. The instants cross midnight in Kolkata but not in UTC, so a formatter that lost the shop's zone shows the
// wrong day.
import { expect, test } from "vitest";
import { clock, publishedOn, stepAt, untilDay } from "../lib/time.ts";

const inline = (options: Intl.DateTimeFormatOptions) => (at: string, lang: "en" | "hi") =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", ...options }).format(new Date(at));

const CASES = [
  [untilDay, inline({ day: "numeric", month: "long" })],
  [publishedOn, inline({ day: "numeric", month: "short", year: "numeric" })],
  [clock, inline({ hour: "numeric", minute: "2-digit" })],
  [stepAt, inline({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })],
] as const;

// 19:00 UTC on 31 Oct is half past midnight on 1 Nov in Kolkata; the others land mid-morning and late at night.
const INSTANTS = ["2026-10-31T19:00:00Z", "2026-01-15T04:05:00Z", "2026-12-31T18:29:00Z"];

test("each helper reads exactly as its page's inline Intl call did, in both languages", () => {
  for (const [helper, old] of CASES) {
    for (const at of INSTANTS) {
      for (const lang of ["en", "hi"] as const) expect(helper(at, lang)).toBe(old(at, lang));
    }
  }
});

test("the helpers read the shop's clock: an instant after midnight in Kolkata is the next day there", () => {
  const at = "2026-10-31T19:00:00Z";
  expect(untilDay(at, "en")).toBe("1 November");
  expect(publishedOn(at, "en")).toBe("1 Nov 2026");
  expect(clock(at, "en")).toBe("12:30 am");
  expect(stepAt(at, "en")).toBe("1 Nov, 12:30 am");
});
