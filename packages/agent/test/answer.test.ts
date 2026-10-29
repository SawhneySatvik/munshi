// The cite-or-abstain rules on their own, against a resolver over a fixed set of cells (the database-backed versions,
// with RLS and real runs, are db/test/a1-agent.test.ts).
import type { Cell, CellRef } from "@munshi/core/read";
import { describe, expect, it } from "vitest";
import { type Answer, checkAnswer, freeDigit, renderReply, renderSegment } from "../src/answer.ts";
import { CLDR_HI, CLDR_HI_SCALES, REVIEW_HI, REVIEW_HI_LATN } from "./hindi-tables.ts";

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

// From the guarantee review: a handle is one whole number from one cell. Nothing in the prose may build a
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
  remark: { kind: "text", txt: "due 50000" },
  remark_words: { kind: "text", txt: "fifty due" },
  label: { kind: "text", txt: "biscuits" },
  customer_id: { kind: "text", txt: "9a1b2c3d-0000-4000-8000-000000000001" },
  item_id: { kind: "text", txt: "9a1b2c3d-0000-4000-8000-000000000002" },
  supplier_id: { kind: "null" },
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

it("FC1 a ref to an id column or a uuid-shaped text cell is refused, unless it is a person's id cited as their name", async () => {
  // A person is named by their id (no name is a cell); the screen shows the name, the plain renderer a fixed word.
  expect(await cRender("⟦1⟧ owes the most.", ["customer_id"])).toEqual(["[customer] owes the most."]);
  expect(await cRules("⟦1⟧ supplies it.", ["supplier_id"])).toEqual(["unresolved"]); // a null id names no one
  expect(await cRules("⟦1⟧ sells best.", ["item_id"])).toEqual(["id_ref"]); // any other id column
  expect(await cRules("⟦1⟧ sells best.", ["category"])).toEqual(["id_ref"]);
});

it("FC1 a text cell's digits render only when it is cited as a name, and a name never carries a currency sign", async () => {
  expect(await cRender("⟦1⟧ is selling.", ["item"])).toEqual(["Glucose biscuits 70 g is selling."]); // a name: its digits are its own
  expect(await cRules("⟦1⟧ is owed.", ["note"])).toEqual(["not_a_name"]); // digits in a text cell that is not a name
  expect(await cRules("⟦1⟧ is owed.", ["remark"])).toEqual(["not_a_name"]); // beside letters, too
  expect(await cRules("⟦1⟧ is owed.", ["remark_words"])).toEqual(["not_a_name"]); // or in words
  expect(await cRender("⟦1⟧ is the category.", ["label"])).toEqual(["biscuits is the category."]); // no digits: plain text
  expect(await cRules("⟦1⟧ is the top debtor.", ["customer"])).toEqual(["not_a_name"]); // an amount planted in a name
  for (const txt of ["Sharma (owes ₨50,000)", "Sharma (owes Rs 50,000)", "Sharma (owes INR 50,000)", "शर्मा (उधार रुपये पचास हज़ार)"]) {
    const r = await checkAnswer(one("⟦1⟧ is the top debtor.", [ref(C, 0, "customer")]), cScope, async () => ({ kind: "text", txt }));
    expect(r.ok ? [] : r.failures.map((f) => f.rule), txt).toEqual(["not_a_name"]);
  }
  expect(await cRender("⟦1⟧ supplies it.", ["supplier"])).toEqual(["A1 Traders000,05 supplies it."]); // bidi controls never render
});

// The guarantee review's probe, its cases verbatim (plus its name attack under a name column): every one must fail.
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

// From a guarantee review that failed clause 2: the number words are checked against tables
// words.ts did not come from (hindi-tables.ts: Unicode CLDR's Hindi spell-out, and the review's own lists), and the
// Latin spellings against an independent romaniser of the CLDR table.
const refusedAsWord = async (text: string) => (await cRules(text, [])).includes("number_word");
const missedOf = async (texts: string[]) => {
  const missed: string[] = [];
  for (const t of texts) if (!(await refusedAsWord(t))) missed.push(t);
  return missed;
};

// Devanagari to Latin letters as Hindi is commonly typed: a long form (aa, ee, oo, chh, v, d for ड़, z for ज़) and a short
// one (a, i, u, ch, w, r, j); the inherent vowel is dropped at the end of a word (unless a conjunct precedes it) and
// between a vowel and consonant on one side and a consonant and vowel on the other (पचपन → pachpan, उनतालीस → untalis).
type Phone = { kind: "C" | "V" | "A" | "N"; latin: [string, string] };
const both = (x: string | [string, string]): [string, string] => (typeof x === "string" ? [x, x] : x);
const CONSONANTS: Record<string, string | [string, string]> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: ["chh", "ch"], ज: "j", झ: "jh", ञ: "n", ट: "t", ठ: "th", ड: "d",
  ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n", प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r",
  ल: "l", व: ["v", "w"], श: "sh", ष: "sh", स: "s", ह: "h", "ड़": ["d", "r"], "ढ़": ["dh", "rh"], "ज़": ["z", "j"], "फ़": "f",
};
const VOWELS: Record<string, string | [string, string]> = { अ: "a", आ: ["aa", "a"], इ: "i", ई: ["ee", "i"], उ: "u", ऊ: ["oo", "u"], ए: "e", ऐ: "ai", ओ: "o", औ: "au" };
const SIGNS_OF: Record<string, string | [string, string]> = { "ा": ["aa", "a"], "ि": "i", "ी": ["ee", "i"], "ु": "u", "ू": ["oo", "u"], "े": "e", "ै": "ai", "ो": "o", "ौ": "au" };
function romanise(word: string): [string, string] {
  const chars = [...word.normalize("NFC")];
  const phones: Phone[] = [];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i] as string;
    if (chars[i + 1] === "़") ch += chars[++i];
    const consonant = CONSONANTS[ch];
    const vowel = VOWELS[ch];
    if (consonant) {
      phones.push({ kind: "C", latin: both(consonant) });
      const next = chars[i + 1] as string;
      if (next === "्") i++;
      else if (SIGNS_OF[next]) phones.push({ kind: "V", latin: both(SIGNS_OF[chars[++i] as string] as string) });
      else phones.push({ kind: "A", latin: ["a", "a"] });
    } else if (vowel) {
      const [long, short] = both(vowel);
      phones.push({ kind: "V", latin: phones.at(-1)?.kind === "V" || phones.at(-1)?.kind === "A" ? [short, short] : [long, short] }); // बाईस: baais
    } else if (ch === "ं" || ch === "ँ") phones.push({ kind: "N", latin: ["n", "n"] });
    else throw new Error(`romanise: no letter for ${ch}`);
  }
  if (phones.at(-1)?.kind === "A" && phones.at(-3)?.kind !== "C") phones.pop();
  const isVowel = (p?: Phone) => p?.kind === "V" || p?.kind === "A";
  for (let i = 2; i < phones.length - 2; i++) {
    if (phones[i]?.kind === "A" && phones[i - 1]?.kind === "C" && isVowel(phones[i - 2]) && phones[i + 1]?.kind === "C" && isVowel(phones[i + 2])) phones.splice(i, 1);
  }
  return [0, 1].map((k) => phones.map((p) => p.latin[k]).join("")) as [string, string];
}

it("MS8 the romaniser of the CLDR table writes Hindi numbers as they are commonly typed", () => {
  expect(["एक", "छह", "पाँच", "पन्द्रह", "बाईस", "पच्चीस", "उनतालीस", "पचपन", "बहत्तर", "सतहत्तर", "अड़सठ", "इक्यानबे", "शून्य", "करोड़"].map(romanise)).toEqual([
    ["ek", "ek"], ["chhah", "chah"], ["paanch", "panch"], ["pandrah", "pandrah"], ["baais", "bais"], ["pachchees", "pachchis"],
    ["untaalees", "untalis"], ["pachpan", "pachpan"], ["bahattar", "bahattar"], ["sathattar", "sathattar"], ["adsath", "arsath"],
    ["ikyaanbe", "ikyanbe"], ["shoonya", "shunya"], ["karod", "karor"],
  ]);
});

it("MS8 Hindi numbers 1–100 are refused in CLDR's spelling and the review's, with their ordinal and plural endings, and the scales", async () => {
  const cldr = [...CLDR_HI, ...CLDR_HI_SCALES].flatMap((w) => w.split(" "));
  expect(cldr).toHaveLength(108); // 101 words for 1–100 (एक सौ is two), शून्य, and एक हज़ार, एक लाख, एक करोड़
  expect(await missedOf(cldr.map((w) => `${w} ग्राहक`))).toEqual([]);
  expect(REVIEW_HI).toHaveLength(100);
  expect(await missedOf(REVIEW_HI.map((w) => `${w} पैकेट बचे हैं।`))).toEqual([]);
  // Ordinals: the 5th to the 100th are the cardinal with an ending (छठा is irregular); 1st–4th and 6th are their own words.
  const ordinals = CLDR_HI.map((w) => w.split(" ").at(-1) as string).filter((_, i) => i >= 4 && i !== 5).flatMap((w) => [`${w}वाँ`, `${w}वां`, `${w}वीं`, `${w}वें`]);
  expect(ordinals).toHaveLength(95 * 4); // the 5th to the 100th but the 6th
  expect(await missedOf([...ordinals, "पहला", "पहली", "दूसरा", "दूसरी", "तीसरा", "चौथा", "छठा", "छठी"].map((w) => `${w} ग्राहक`))).toEqual([]);
  expect(await missedOf(["हज़ारों रुपये", "लाखों", "करोड़ों", "सैकड़ों", "दसियों बिल", "दोनों ग्राहक", "चारों पैकेट"])).toEqual([]);
});

it("MS8 Hindi numbers in Latin letters are refused: every CLDR word romanised, long and short, with ordinal endings, and the review's", async () => {
  const words = [...CLDR_HI, ...CLDR_HI_SCALES].flatMap((w) => w.split(" "));
  const latin = [...new Set(words.flatMap(romanise))];
  expect(latin.length).toBeGreaterThan(150);
  expect(await missedOf(latin.map((w) => `${w} packet`))).toEqual([]);
  expect(await missedOf(latin.map((w) => `Aaj ${w[0]?.toUpperCase()}${w.slice(1)} grahak aaye.`))).toEqual([]);
  const ordinals = CLDR_HI.slice(4).filter((_, i) => i !== 1).flatMap((w) => romanise(w.split(" ").at(-1) as string)).flatMap((r) => [`${r}vaan`, `${r}van`, `${r}veen`, `${r}ven`]);
  expect(await missedOf(ordinals)).toEqual([]);
  expect(REVIEW_HI_LATN).toHaveLength(38);
  expect(await missedOf(REVIEW_HI_LATN.map((w) => `${w} packet`))).toEqual([]);
  expect(await missedOf(["hazaar rupaye", "das hazaar", "lakhon", "crore", "karodon", "dedh sau", "dhai", "pehla grahak", "doosri baar", "dasvin"])).toEqual([]);
  expect(await missedOf(["dō packet", "tīn grahak", "lākh rupaye", "ēk bill"])).toEqual([]); // accents do not hide a word
});

it("MS8 Roman numerals in any case, letters passing for digits, and number symbols are refused", async () => {
  for (const text of ["Sold xxiv packs today.", "Sold XXIV packs today.", "iv bills", "Bill ii was paid", "c customers", "Xii bills"]) {
    expect(await cRules(text, []), text).toContain("number_word");
  }
  for (const text of ["Sales were lOO bills.", "Sales were IOO bills.", "lO bills", "OO bills", "Sales were 𝐥𝐎𝐎 bills."]) expect(await cRules(text, []), text).toContain("number_word");
  for (const text of ["Sales hit 💯 and 🔟 bills.", "#️⃣ bills", "⚂ packs", "🕒 left", "🈩 bill", "Sold ✓"]) expect(await cRules(text, []), text).toContain("free_digit");
  for (const text of ["I checked the bills.", "Mix the stock.", "A loo roll sold.", "Mustard oil sold well.", "OIL is low.", "Lo, the stock is in.", "I'd restock it; we’d sold out.", "I'm sure.", "L’Oréal shampoo sold."]) {
    expect(await cRules(text, []), text).toEqual([]);
  }
});

it("MS8 a letter outside the Latin and Devanagari scripts is refused, and so are Latin look-alikes outside ASCII", async () => {
  for (const text of ["இருபத்து நான்கு பொதிகள்", "চব্বিশ প্যাকেট", "Sales were ЗО bills.", "ચોવીસ પેકેટ", "ਚੌਵੀ ਪੈਕਟ", "Ventes: vingt-quatre ΟΟ", "ʒ packs", "Ƨ bills"]) {
    expect(await cRules(text, []), text).toContain("other_script");
  }
  for (const text of ["The café stock is low.", "चाय पत्ती का स्टॉक कम है।", "Naïve buyers paid by UPI."]) expect(await cRules(text, []), text).toEqual([]);
});

it("MS8 a sign, a decimal or a fraction word beside a handle is refused as a scale", async () => {
  for (const text of ["Sales were ⟦1⟧ point ⟦2⟧.", "Profit was minus ⟦1⟧.", "Profit was negative ⟦1⟧.", "It is - ⟦1⟧ now.", "It is − ⟦1⟧ now.", "± ⟦1⟧", "⟦1⟧ decimal ⟦2⟧", "⟦1⟧ dot ⟦2⟧", "लाभ ऋण ⟦1⟧ रहा", "⟦1⟧ दशमलव ⟦2⟧", "⟦1⟧ quarter", "⟦1⟧ चौथाई", "⟦1⟧ ½"]) {
    expect(await cRules(text), text).toContain("scale_word");
  }
  for (const text of ["The best-selling item was ⟦1⟧.", "⟦1⟧ — the most — sold.", "⟦1⟧ sold the most, at that point."]) {
    expect((await cRules(text)).filter((r) => r !== "number_word"), text).toEqual([]);
  }
});

it("MS8 a text cell with no letter is no name, and a person's or firm's name may not carry a figure standing alone", async () => {
  const cell = async (col: string, txt: string) => {
    const r = await checkAnswer(one("⟦1⟧ is it.", [ref(C, 0, col)]), cScope, async () => ({ kind: "text", txt }));
    return r.ok ? [] : r.failures.map((f) => f.rule);
  };
  for (const [col, txt] of [["bill_no", "15000"], ["item", "1200"], ["customer", "Sharma 50000"], ["supplier", "Gupta 1,20,000"], ["staff", "Ravi 500"], ["item", "—"]]) {
    expect(await cell(col as string, txt as string), `${col}: ${txt}`).toEqual(["not_a_name"]);
  }
  for (const [col, txt] of [["item", "Glucose biscuits 70 g"], ["item", "Candles pack of 6"], ["item", "Atta (5 kg)"], ["supplier", "A1 Traders"], ["bill_no", "GT-1013"], ["status", "open"]]) {
    expect(await cell(col as string, txt as string), `${col}: ${txt}`).toEqual([]);
  }
});

// The guarantee review's second probe (probe2/probe2.ts), its cases verbatim: every attack fails; "open" (a status
// cell, plain text) is the probe's control and passes, and so does "मुझे बता दो।", दो as the verb "give".
const probe2Cells: Record<string, Cell> = {
  a: { kind: "integer", num: "24" },
  b: { kind: "integer", num: "5" },
  m: { kind: "money", num: "500000", currency: "INR" },
  q: { kind: "quantity", num: "3000", unit: "pack" },
  customer: { kind: "text", txt: "Sharma 50000" },
  bill_no: { kind: "text", txt: "15000" },
  item: { kind: "text", txt: "1200" },
  status: { kind: "text", txt: "open" },
};
const probe2: [string, string[]][] = [
  ["Sales were lOO bills.", []],
  ["Sales were IOO bills.", []],
  ["Sales were ЗО bills.", []],
  ["Sold xxiv packs today.", []],
  ["Sold XXIV packs today.", []],
  ["Sales hit 💯 and 🔟 bills.", []],
  ["Sales were ⟦1‍⟧ bills.", ["a"]],
  ["Sales were ⟦​1⟧ bills.", ["a"]],
  ["Sales were ⟦1⟧‍⟦2⟧ bills.", ["a", "b"]],
  ["Sales were ⟦1⟧ point ⟦2⟧ lakh.", ["a", "b"]],
  ["Sales were ⟦1⟧ point ⟦2⟧.", ["a", "b"]],
  ["Profit was minus ⟦1⟧.", ["m"]],
  ["Profit was negative ⟦1⟧.", ["m"]],
  ["⟦1⟧ owes the most.", ["customer"]],
  ["Takings today were ⟦1⟧.", ["bill_no"]],
  ["Takings today were ⟦1⟧.", ["item"]],
  ["एक ग्राहक ने ⟦1⟧ दिए।", ["m"]],
  ["छत्तीस पैकेट बचे हैं।", []],
  ["बयालीस ग्राहक उधार पर हैं।", []],
  ["अड़तालीस पैकेट बचे हैं।", []],
  ["बहत्तर बिल आज बने।", []],
  ["इक्यावन ग्राहक।", []],
  ["Aaj tees packet bache hain.", []],
  ["Chalis grahak udhaar par hain.", []],
  ["Nau packet bache.", []],
  ["Gyarah bill bane.", []],
  ["A score of customers owe you.", []],
  ["Ninty packs left.", []],
  ["A couple of bills are due.", []],
  ["இருபத்து நான்கு பொதிகள்", []],
  ["চব্বিশ প্যাকেট", []],
];
it("MS8 every attack of the review's second probe is refused", async () => {
  const S = "11111111-1111-4111-8111-111111111111";
  const check = (text: string, cols: string[]) => checkAnswer(one(text, cols.map((col) => ref(S, 0, col))), new Map([[S, null]]), async (x) => probe2Cells[x.col] ?? null);
  const passed: string[] = [];
  for (const [text, cols] of probe2) if ((await check(text, cols)).ok) passed.push(text);
  expect(passed).toEqual([]);
  expect((await check("Takings today were ⟦1⟧.", ["status"])).ok).toBe(true);
  expect((await check("मुझे बता दो।", [])).ok).toBe(true);
});
