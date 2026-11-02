// Read aloud's own words (lib/i18n-speak.ts): what is read aloud is checked text whose figures are cells, so the button's
// words around it carry no digit in either language, and the English ones no Devanagari.
import { expect, test } from "vitest";
import { SPEAK } from "../lib/i18n-speak";

test("SPEAKWORDS the read-aloud words carry no digit, and the English ones no Devanagari", () => {
  for (const lang of ["en", "hi"] as const) for (const [k, v] of Object.entries(SPEAK[lang])) expect(v, `${lang}.${k}`).not.toMatch(/\p{Nd}/u);
  for (const [k, v] of Object.entries(SPEAK.en)) expect(v, k).not.toMatch(/\p{Script=Devanagari}/u);
  expect(Object.keys(SPEAK.hi)).toEqual(Object.keys(SPEAK.en));
});
