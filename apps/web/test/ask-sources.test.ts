// Every read an agent tool can call is one Ask may cite, so each needs its own drawer title and chip label: a read
// missing from the table would fall back to another's name ("Stock ledger" on a PayPal link).
import { TOOLS } from "@munshi/agent";
import { expect, test } from "vitest";
import { HERO } from "../lib/i18n-hero";
import { VIEW } from "../lib/server/hero";

test("every read an agent tool calls has its own source title and label, in both languages", () => {
  const missing = TOOLS.map((t) => t.query).filter((q) => !VIEW[q]);
  expect(missing).toEqual([]);
  for (const q of TOOLS.map((t) => t.query)) {
    const v = VIEW[q];
    if (!v) continue;
    for (const lang of ["en", "hi"] as const) {
      expect(HERO[lang][v.title], `${q} title ${lang}`).toBeTruthy();
      expect(HERO[lang][v.label], `${q} label ${lang}`).toBeTruthy();
    }
  }
  expect(VIEW["paypal.links"]?.label).toBe("labelPaypalLinks");
});
