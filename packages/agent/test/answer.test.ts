// The cite-or-abstain rules on their own, against a resolver over a fixed set of cells (the database-backed versions,
// with RLS and real runs, are db/test/a1-agent.test.ts).
import type { Cell, CellRef } from "@munshi/core/read";
import { describe, expect, it } from "vitest";
import { type Answer, checkAnswer, freeDigit, renderReply, renderSegment } from "../src/answer.ts";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const cells = new Map<string, Cell>([
  [`${S1}:0:item`, { kind: "text", txt: "Glucose biscuits 70 g" }],
  [`${S1}:0:total`, { kind: "money", num: "653900", currency: "INR" }],
  [`${S1}:0:sold`, { kind: "quantity", num: "24000", unit: "pack" }],
  [`${S2}:3:overdue`, { kind: "money", num: "120000", currency: "INR" }],
  [`${S2}:4:overdue`, { kind: "money", num: "65000", currency: "INR" }],
]);
const resolve = async (r: CellRef) => cells.get(`${r.snapshotId}:${r.row}:${r.col}`) ?? null;
const scope = new Map<string, number | null>([
  [S1, null], // minted in this run: any row
  [S2, 3], // the finding asked about: its row only
]);
const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
const one = (text: string, refs: CellRef[]): Answer => ({ segments: [{ text, refs }] });
const rules = async (a: Answer) => {
  const r = await checkAnswer(a, scope, resolve);
  return r.ok ? [] : r.failures.map((f) => f.rule);
};

describe("cite or abstain", () => {
  it("a cited answer passes and renders every number from its cell", async () => {
    const a = one("⟦1⟧ sold ⟦2⟧, ⟦3⟧ in all; ⟦4⟧ is overdue.", [ref(S1, 0, "item"), ref(S1, 0, "sold"), ref(S1, 0, "total"), ref(S2, 3, "overdue")]);
    const r = await checkAnswer(a, scope, resolve);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map((seg) => renderSegment(seg))).toEqual(["Glucose biscuits 70 g sold 24 packs, ₹6,539 in all; ₹1,200 is overdue."]);
    expect(renderReply({ kind: "answer", specialist: "sales", segments: r.segments })).toHaveLength(1);
  });

  it("a free digit fails the answer, in any script, and so does a percent sign", async () => {
    for (const text of ["Sales were 6539 rupees.", "बिक्री ६५३९ रुपये", "about ½ of it", "up ⟦1⟧, or 7%", "⟦1⟧ and ⟦0⟧", "₹⟦1⟧2"]) {
      expect(freeDigit(text), text).toBe(true);
      expect(await rules(one(text, [ref(S1, 0, "total")])), text).toContain("free_digit");
    }
    expect(freeDigit("⟦1⟧ sold ⟦12⟧ — nothing else")).toBe(false);
  });

  it("a handle with no ref fails", async () => {
    expect(await rules(one("⟦1⟧ and ⟦2⟧", [ref(S1, 0, "total")]))).toEqual(["unknown_handle"]);
  });

  it("a ref outside the run's scope fails, and an admitted snapshot admits only its own row", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    expect(await rules(one("⟦1⟧", [ref(other, 0, "total")]))).toEqual(["not_this_run", "unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S2, 4, "overdue")]))).toEqual(["not_this_run"]); // resolves, but not the admitted row
    expect(await rules(one("⟦1⟧", [ref(S2, 3, "overdue")]))).toEqual([]);
  });

  it("a ref that does not resolve fails, and so does a malformed one", async () => {
    expect(await rules(one("⟦1⟧", [ref(S1, 9, "total")]))).toEqual(["unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S1, 0, "Total; drop")]))).toEqual(["unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S1, -1, "total")]))).toEqual(["unresolved"]);
  });

  it("the renderer refuses a free digit even if it is handed one, and an abstention names what is missing", () => {
    expect(renderSegment({ text: "Sales were 6539.", refs: [], cells: [] })).toBe("Cannot verify");
    expect(renderReply({ kind: "abstain", specialist: "sales", missing: ["free_digit", "unresolved"] })).toEqual([
      "Cannot verify: a number without a source; a source that does not exist.",
    ]);
  });
});

// Fix cycle 1 (the guarantee review): a handle is one whole number from one cell. Nothing in the prose may build a
// number around it (another handle, a scale, a unit, a currency) or say a number in words.
const C = "44444444-4444-4444-8444-444444444444";
const probeCells: Record<string, Cell> = {
  a: { kind: "integer", num: "1" },
  b: { kind: "integer", num: "2" },
  c: { kind: "integer", num: "3" },
  m: { kind: "money", num: "500000", currency: "INR" },
  q: { kind: "quantity", num: "3000", unit: "pack" },
  one: { kind: "quantity", num: "1000", unit: "pack" },
  kg: { kind: "quantity", num: "1500", unit: "kg" },
  pcs: { kind: "quantity", num: "3000", unit: "piece" },
  customer: { kind: "text", txt: "Sharma (owes ₹50,000)" },
  item: { kind: "text", txt: "Glucose biscuits 70 g" },
  supplier: { kind: "text", txt: "A1 Traders\u202e000,05" },
  note: { kind: "text", txt: "50000" },
  label: { kind: "text", txt: "biscuits" },
  customer_id: { kind: "text", txt: "9a1b2c3d-0000-4000-8000-000000000001" },
  category: { kind: "text", txt: "9a1b2c3d-0000-4000-8000-000000000001" },
};
const cScope = new Map<string, number | null>([[C, null]]);
const cResolve = async (r: CellRef) => (r.snapshotId === C && r.row === 0 ? (probeCells[r.col] ?? null) : null);
const cRules = async (text: string, cols: string[] = ["a", "b", "c"]) => {
  const r = await checkAnswer(one(text, cols.map((col) => ref(C, 0, col))), cScope, cResolve);
  return r.ok ? [] : r.failures.map((f) => f.rule);
};
const cRender = async (text: string, cols: string[]) => {
  const r = await checkAnswer(one(text, cols.map((col) => ref(C, 0, col))), cScope, cResolve);
  return r.ok ? r.segments.map((s) => renderSegment(s)) : r.failures.map((f) => f.rule);
};

it("FC1 two handles run together or joined only by glue are refused, and so is anything glued onto a handle", async () => {
  for (const text of [
    "Sales were ⟦1⟧⟦2⟧ bills.",
    "About ⟦1⟧.⟦2⟧ today.",
    "⟦1⟧,⟦2⟧",
    "⟦1⟧/⟦2⟧",
    "⟦1⟧:⟦2⟧",
    "⟦1⟧-⟦2⟧",
    "⟦1⟧ ⟦2⟧",
    "⟦1⟧\u200b⟦2⟧",
    "⟦1⟧\u00a0⟦2⟧",
    "⟦1⟧\u2009⟦2⟧",
    "⟦1⟧ - ⟦2⟧",
    "⟦1⟧ / ⟦2⟧",
    "Sales fell by -⟦1⟧.",
    "It is −⟦1⟧ now.",
    "It is ~⟦1⟧ now.",
    "We sold ⟦1⟧OO today.",
    "the ⟦1⟧th bill",
    "Sharma⟦1⟧ paid",
  ]) {
    expect(await cRules(text), text).toContain("handle_glue");
  }
});

it("FC1 a list of handles, a bracket, a range in words and sentence ends pass", async () => {
  for (const text of ["⟦1⟧, ⟦2⟧ and ⟦3⟧ sold.", "⟦1⟧ (⟦2⟧) sold.", "⟦1⟧; ⟦2⟧.", "from ⟦1⟧ to ⟦2⟧", "Sales were ⟦1⟧. ⟦2⟧ came by UPI.", "(⟦1⟧)", "\"⟦1⟧\""]) {
    expect(await cRules(text), text).toEqual([]);
  }
});

it("FC1 a scale or magnitude word or symbol beside a handle is refused, in any case, width or script", async () => {
  for (const text of [
    "Takings were ⟦1⟧ lakh.",
    "Takings were ⟦1⟧ LAKH.",
    "Takings were ⟦1⟧ Lac.",
    "⟦1⟧ crore",
    "⟦1⟧ cr",
    "You sold ⟦1⟧ thousand.",
    "⟦1⟧ hazaar",
    "⟦1⟧ हज़ार",
    "⟦1⟧ हजार",
    "⟦1⟧ k",
    "⟦1⟧ K",
    "⟦1⟧ M",
    "⟦1⟧ million",
    "⟦1⟧ billion",
    "⟦1⟧ percent",
    "⟦1⟧ प्रतिशत",
    "⟦1⟧ x",
    "⟦1⟧ times",
    "⟦1⟧ ×",
    "half ⟦1⟧",
    "double ⟦1⟧",
    "twice ⟦1⟧",
    "⟦1⟧ ｌａｋｈ",
    "⟦1⟧ (lakh)",
  ]) {
    expect(await cRules(text), text).toContain("scale_word");
  }
});

it("FC1 a currency sign or a unit beside a handle is refused: the cell renders its own", async () => {
  for (const text of [
    "₹⟦1⟧ came in.",
    "₹ ⟦1⟧ came in.",
    "Rs ⟦1⟧",
    "Rs.⟦1⟧",
    "Rs. ⟦1⟧",
    "INR ⟦1⟧",
    "$⟦1⟧",
    "₨⟦1⟧",
    "⟦1⟧ rupees",
    "⟦1⟧ रुपये",
    "⟦1⟧ packs",
    "⟦1⟧ pcs",
    "⟦1⟧ kg",
    "⟦1⟧ g",
    "⟦1⟧ litre",
    "⟦1⟧ l",
    "⟦1⟧ ml",
    "⟦1⟧ units",
    "⟦1⟧ packets",
    "⟦1⟧ boxes",
    "⟦1⟧ पैकेट",
    "⟦1⟧ किलो",
    "⟦1⟧ (packs)",
  ]) {
    expect(await cRules(text, ["q"]), text).toContain("unit_or_currency");
  }
});

it("FC1 a money cell renders with its currency sign and a quantity cell with its unit", async () => {
  expect(await cRender("Takings were ⟦1⟧; ⟦2⟧ left, ⟦3⟧ of it loose, and ⟦4⟧ of rice.", ["m", "q", "one", "kg"])).toEqual([
    "Takings were ₹5,000; 3 packs left, 1 pack of it loose, and 1.5 kg of rice.",
  ]);
  expect(await cRender("⟦1⟧ are on the shelf.", ["pcs"])).toEqual(["3 pieces are on the shelf."]);
});

it("FC1 English number words are refused: cardinals, ordinals, fractions, multiplicatives, compounds, Roman numerals", async () => {
  for (const text of [
    "Twenty-four customers owe you; sales doubled.",
    "twentyfour customers",
    "TWENTY‐FOUR customers",
    "a dozen bills",
    "half of the stock",
    "sales tripled",
    "the first bill",
    "once a week",
    "one customer",
    "XII customers",
    "Ⅻ customers",
    "tw\u200benty customers",
    "a ninth of it",
    "zero left",
  ]) {
    expect(await cRules(text, []), text).toEqual(expect.arrayContaining([expect.stringMatching(/^(number_word|free_digit)$/)]));
  }
  for (const text of ["anyone may ask", "someone often pays", "money and tone", "mix it", "I did it", "civil", "The UPI total", "It is done."]) {
    expect(await cRules(text, []), text).toEqual([]);
  }
});

it("FC1 Hindi number words are refused, with or without the nukta and either nasal mark", async () => {
  for (const text of [
    "चौबीस ग्राहक उधार पर हैं।",
    "दो ग्राहक",
    "आधा माल",
    "बिक्री दोगुना हुई",
    "डेढ़ पैकेट",
    "ढाई",
    "सवा",
    "साढ़े",
    "लाख",
    "करोड़",
    "करोड",
    "पाँच",
    "पांच",
    "हज़ार",
    "पहली बार",
    "तिगुना",
  ]) {
    expect(await cRules(text, []), text).toContain("number_word");
  }
  for (const text of ["ग्राहक उधार पर हैं।", "बिक्री अच्छी रही", "⟦1⟧ ने सबसे ज़्यादा उधार लिया।"]) {
    expect(await cRules(text, text.includes("⟦1⟧") ? ["a"] : []), text).toEqual([]);
  }
});

it("FC1 CJK numerals are refused", async () => {
  for (const text of ["二十四 customers", "三 bills", "两 packs", "百", "壹"]) {
    expect(await cRules(text, []), text).toContain("number_word");
  }
});

it("FC1 a ref to an id column is refused, and so is a uuid-shaped text cell", async () => {
  expect(await cRules("⟦1⟧ owes the most.", ["customer_id"])).toEqual(["id_ref"]);
  expect(await cRules("⟦1⟧ sells best.", ["category"])).toEqual(["id_ref"]);
});

it("FC1 a text cell's digits render only when it is cited as a name, and a name never carries a currency sign", async () => {
  expect(await cRender("⟦1⟧ is selling.", ["item"])).toEqual(["Glucose biscuits 70 g is selling."]); // a name: its digits are its own
  expect(await cRules("⟦1⟧ is owed.", ["note"])).toEqual(["not_a_name"]); // digits in a text cell that is not a name
  expect(await cRender("⟦1⟧ is the category.", ["label"])).toEqual(["biscuits is the category."]); // no digits: plain text
  expect(await cRules("⟦1⟧ is the top debtor.", ["customer"])).toEqual(["not_a_name"]); // an amount planted in a name
  for (const txt of ["Sharma (owes ₨50,000)", "Sharma (owes Rs 50,000)", "Sharma (owes INR 50,000)", "शर्मा (उधार रुपये पचास हज़ार)"]) {
    const r = await checkAnswer(one("⟦1⟧ is the top debtor.", [ref(C, 0, "customer")]), cScope, async () => ({ kind: "text", txt }));
    expect(r.ok ? [] : r.failures.map((f) => f.rule), txt).toEqual(["not_a_name"]);
  }
  expect(await cRender("⟦1⟧ supplies it.", ["supplier"])).toEqual(["A1 Traders000,05 supplies it."]); // bidi controls never render
});

// The MS-6 guarantee review's probe, its cases verbatim (plus its name attack under a name column): every one must fail.
const PROBE = "11111111-1111-4111-8111-111111111111";
const probeAt: Record<string, Cell> = {
  a: { kind: "integer", num: "1" },
  b: { kind: "integer", num: "2" },
  m: { kind: "money", num: "500000", currency: "INR" },
  q: { kind: "quantity", num: "3000", unit: "pack" },
  n: { kind: "text", txt: "Sharma (owes ₹50,000)" },
  customer: { kind: "text", txt: "Sharma (owes ₹50,000)" },
};
const probe: [string, string[], string][] = [
  ["Sales were ⟦1⟧⟦2⟧ bills.", ["a", "b"], "handle_glue"],
  ["About ⟦1⟧.⟦2⟧ lakh.", ["a", "b"], "handle_glue"],
  ["Takings were ⟦1⟧ lakh.", ["m"], "scale_word"],
  ["You sold ⟦1⟧ thousand.", ["q"], "scale_word"],
  ["₹⟦1⟧ came in.", ["q"], "unit_or_currency"],
  ["Twenty-four customers owe you; sales doubled.", [], "number_word"],
  ["चौबीस ग्राहक उधार पर हैं।", [], "number_word"],
  ["二十四 customers", [], "number_word"],
  ["⟦1⟧ is the top debtor.", ["n"], "not_a_name"],
  ["⟦1⟧ is the top debtor.", ["customer"], "not_a_name"],
  ["Sales were 24 (fullwidth ２４).", [], "free_digit"],
];
it("FC1 every attack of the probe is refused, each by its rule", async () => {
  for (const [text, cols, rule] of probe) {
    const r = await checkAnswer(one(text, cols.map((col) => ref(PROBE, 0, col))), new Map([[PROBE, null]]), async (x) => probeAt[x.col] ?? null);
    expect(r.ok, text).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.rule), text).toContain(rule);
  }
});
