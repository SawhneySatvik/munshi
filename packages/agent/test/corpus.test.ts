// The precision corpus. clean.jsonl holds answers as narrate writes them (English, Hindi, Hinglish; handles for
// every number and every name with a digit), using the homographs in their ordinary senses: none may abstain.
// attacks.jsonl holds every attack of the guarantee review's probes, verbatim, and new ones that put a homograph in a
// quantity context: every one must be refused. dropped.jsonl holds sentences written for clean that can pass only by
// opening a hole (each with its reason): they stay refused. The cells and names they cite are in corpus/world.ts.
import { CANNOT_VERIFY } from "@munshi/core/read";
import { expect, it } from "vitest";
import { textRules } from "../src/answer.ts";
import { HOMOGRAPHS } from "../src/words.ts";
import { corpus, type Line, rendered } from "./corpus/world.ts";

const passing = async (lines: Line[]) => {
  const out: string[] = [];
  for (const l of lines) if ((await rendered(l)) !== null) out.push(l.text);
  return out;
};

it("MS12 the clean corpus: no ordinary answer abstains, in English, Hindi or Hinglish", async () => {
  const clean = corpus("clean");
  expect(clean.length).toBeGreaterThanOrEqual(150);
  expect(new Set(clean.map((l) => l.lang))).toEqual(new Set(["en", "hi", "hinglish", "mixed"]));
  const abstained: string[] = [];
  for (const l of clean) {
    const shown = await rendered(l);
    if (shown === null || shown.includes(CANNOT_VERIFY)) abstained.push(l.text); // the renderer re-checks: it must agree
  }
  expect(abstained).toEqual([]);
});

it("MS12 the attack corpus: every probe and probe2 attack and every homograph in a quantity context is refused", async () => {
  const attacks = corpus("attacks");
  expect(attacks.filter((l) => l.from === "probe")).toHaveLength(11);
  expect(attacks.filter((l) => l.from === "probe2")).toHaveLength(31);
  expect(attacks.filter((l) => l.from === "ms12").length).toBeGreaterThanOrEqual(50);
  expect(await passing(attacks)).toEqual([]);
});

it("MS12 the sentences dropped from clean need a hole to pass, so they stay refused", async () => {
  const dropped = corpus("dropped");
  expect(dropped.every((l) => l.reason)).toBe(true);
  expect(await passing(dropped)).toEqual([]);
});

it("MS12 shelf phrases (textRules) still read every homograph as a number: the context reading is for answers only", () => {
  const all = [...HOMOGRAPHS.latin, ...HOMOGRAPHS.collective, ...HOMOGRAPHS.roman, ...HOMOGRAPHS.hindi];
  expect(all).toHaveLength(20);
  expect(all.filter((w) => !textRules(`${w} ok`).includes("number_word"))).toEqual([]);
});
