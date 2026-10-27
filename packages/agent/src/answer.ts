// Cite or abstain. An answer is short segments of prose; a number appears in a segment only as a handle ⟦1⟧…⟦n⟧ that
// points into the segment's refs (snapshot cells). The validator fails the whole answer on any rule below, and the
// renderer substitutes each handle with its cell's value, so a number on screen always comes from a stored cell and
// never from model text. A failed answer is shown as "Cannot verify" plus what is missing (fixed phrases, never model
// text).
//
// A handle is one whole number from one cell, so the prose may not build a number around it (fix cycle 1 of the
// guarantee review): no digit, number symbol or emoji (💯, 🔟, keycaps); no number in words (English; Hindi in Devanagari
// and in Latin letters, with ordinal and plural endings; Han numerals; Roman numerals in any case; letters that pass for
// digits, "lOO"); no letter outside the Latin and Devanagari scripts (the lists cannot read them, so "இருபத்து நான்கு"
// is refused whole); no two handles run together or joined only by glue ("⟦1⟧⟦2⟧", "⟦1⟧.⟦2⟧"); nothing glued onto a
// handle but brackets, quotes and closing punctuation ("-⟦1⟧", "⟦1⟧th"); no scale, sign, decimal, fraction, currency or
// unit beside one ("⟦1⟧ lakh", "minus ⟦1⟧", "⟦1⟧ point ⟦2⟧", "₹⟦1⟧", "⟦1⟧ packs"): a money cell renders its own sign and
// a quantity cell its own unit. The word lists are data (words.ts). The text is checked and rendered in one folded
// form (NFKC, format characters removed), so what passed is what shows.
//
// Homographs (MS-12): a word that is a number and also an ordinary word (do, teen, tin, char, sat, bees, tees; couple,
// score, trio; a lone Roman letter; एक, दो) is a number in an answer only in a quantity context (quantityContext), so
// "do not", "a tin of ghee", "i.e." and "मुझे बता दो" pass and "do ⟦1⟧", "tees packets", "teen dozen" do not. Shelf
// phrases (textRules) still read every homograph as a number. The precision corpus is test/corpus/.
//
// Names: a text cell renders as text. Its digits are part of the name only when the segment cites it from a name
// column (NAME_COLUMNS: "Glucose biscuits 70 g", bill GT-1013); a text cell from any other column that holds a digit
// or a number word is refused, and no text cell may carry a currency sign ("Sharma (owes ₹50,000)"). A text cell with no
// letter ("15000"), or the name of a person or firm with a figure standing alone in it ("Sharma 50000"), is refused too.
// An id column, or a text cell shaped like a uuid, is never cited: the owner never sees an id.
import { CANNOT_VERIFY, type Cell, type CellRef, formatRef, parseRef, renderCell } from "@munshi/core/read";
import {
  AFTER_EK,
  CJK_NUMERALS,
  COUNT_NOUNS,
  CURRENCY_WORDS,
  DETERMINERS,
  DIGIT_LIKE,
  DIGIT_LIKE_WORDS,
  HINDI_CARDINALS,
  HINDI_ENDINGS,
  HINDI_LATIN_CARDINALS,
  HINDI_LATIN_ENDINGS,
  HINGLISH_WORDS,
  HOMOGRAPHS,
  LATIN_SKELETON,
  LIGHT_VERBS,
  MODIFIERS,
  NAME_COLUMNS,
  NAME_STOPWORDS,
  NUMBER_WORDS,
  OF_PRONOUNS,
  PARTY_COLUMNS,
  QUANTIFIERS,
  ROMAN_WORDS,
  SCALE_SIGNS,
  SCALE_WORDS,
  SIGNS,
  UNIT_WORDS,
} from "./words.ts";

export type Segment = { text: string; refs: CellRef[] };
export type Answer = { segments: Segment[] };
export type CheckedSegment = Segment & { cells: Cell[] };

export const RULES = [
  "free_digit",
  "number_word",
  "other_script",
  "handle_glue",
  "scale_word",
  "unit_or_currency",
  "unknown_handle",
  "id_ref",
  "not_this_run",
  "unresolved",
  "not_a_name",
] as const;
export type Rule = (typeof RULES)[number];
export type Failure = { segment: number; rule: Rule; ref?: number };

/** The snapshots an answer may cite: minted in this run (any row: null), or admitted for one row (the finding asked about). */
export type Scope = ReadonlyMap<string, number | null>;

export type Checked = { ok: true; segments: CheckedSegment[] } | { ok: false; failures: Failure[] };

const HANDLE = /⟦([1-9][0-9]{0,2})⟧/g;
// Any Unicode number (ASCII and Devanagari digits, ½, ², Ⅻ …), a percent or per-mille sign, or a symbol or emoji (💯,
// 🔟, a keycap, a die face: no list of the ones that mean a number could be complete), once the handles are out.
const NUMBERISH = /[\p{N}%‰‱\p{So}\p{Extended_Pictographic}]|\u20e3/u;

/** The form an answer is checked and shown in: compatibility forms folded (fullwidth, ligatures, ₨), format characters gone. */
const shown = (text: string) => text.normalize("NFKC").replace(/\p{Cf}/gu, "");
/** Also no accents on Latin letters ("dō" is "do", "ïï" is "ii"). */
const unaccented = (text: string) => shown(text).normalize("NFD").replace(/([A-Za-z])\p{M}+/gu, "$1");
/** The form a word is matched in: also no nukta, chandrabindu as anusvara, lower case. */
const fold = (text: string) => unaccented(text).replace(/\u093c/g, "").replace(/\u0901/g, "\u0902").toLowerCase();
const skeleton = (w: string) => LATIN_SKELETON.reduce((s, [from, to]) => s.replace(from, to), w);

const NUMBER = new Set([...NUMBER_WORDS.en, ...NUMBER_WORDS.hi].map(fold));
const ENGLISH = new Set(NUMBER_WORDS.en.map(fold));
const HINDI = new Set(HINDI_CARDINALS.map(fold));
const HINDI_ENDS = HINDI_ENDINGS.map(fold);
const LATIN = new Set(NUMBER_WORDS.hiLatn.map((w) => skeleton(fold(w))));
const LATIN_CARDINAL = new Set(HINDI_LATIN_CARDINALS.map((w) => skeleton(fold(w))));
const SCALE = new Set(SCALE_WORDS.map(fold));
const UNIT = new Set([...UNIT_WORDS, ...CURRENCY_WORDS].map(fold));
const CURRENCY = new Set(CURRENCY_WORDS.map(fold));
const CJK = new RegExp(`[${CJK_NUMERALS}]`, "u");
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LATIN_HOMOGRAPH = new Set(HOMOGRAPHS.latin);
const COLLECTIVE = new Set(HOMOGRAPHS.collective);
const ROMAN_LETTER = new Set(HOMOGRAPHS.roman);
const [EK, DO] = HOMOGRAPHS.hindi.map(fold) as [string, string];
const HOMOGRAPH = new Set([...HOMOGRAPHS.latin, ...HOMOGRAPHS.collective, ...HOMOGRAPHS.hindi].map(fold));
const COUNT = new Set(COUNT_NOUNS.map(fold));
const MODIFIER = new Set(MODIFIERS.map(fold));
const DETERMINER = new Set(DETERMINERS);
const OF_PRONOUN = new Set(OF_PRONOUNS);
const QUANTIFIER = new Set(QUANTIFIERS.map(fold));
const LIGHT_VERB = new Set(LIGHT_VERBS.map(fold));
const HINGLISH = new Set(HINGLISH_WORDS);
const NAME_STOP = new Set(NAME_STOPWORDS);
const AFTER_ONE = new Set(AFTER_EK.map(fold));
// "sat" and "do" are ordinary after "just" or "only" ("it just sat there", "only do a recount"); the others are not.
const QUANTIFIED = new Set(["teen", "tin", "char", "bees", "tees", EK]);

// Glue allowed on a handle: opening brackets and quotes before it; closing ones, a possessive and sentence or list
// punctuation after it. Between two handles: a word, or list punctuation and a space ("⟦1⟧, ⟦2⟧", "⟦1⟧ (⟦2⟧)").
const OPENERS = /^[(["'“‘]*$/u;
const CLOSERS = /^(?:['’]s)?[)\]"'”’.,;:!?…।॥]*$/u;
const SEPARATOR = /[.,;:!?…।॥]/u;
const LIST_GAP = /^[)\]"'”’]*[,;.:!?।]?\s+[(["'“‘]*$/u;
const GAP_MARK = /[,;.:!?।()[\]"'“”‘’]/u;

// "twentyfour": a word made only of English number words.
function compound(w: string): boolean {
  const ok = [true];
  for (let i = 1; i <= w.length; i++) ok[i] = ok.slice(0, i).some((o, j) => o && ENGLISH.has(w.slice(j, i)));
  return ok[w.length] === true;
}

// A folded word that is a number: listed, an English compound, a Hindi cardinal with an ordinal or plural ending, or
// Hindi in Latin letters by its skeleton (with or without an ordinal ending).
function isNumber(w: string): boolean {
  if (NUMBER.has(w) || compound(w)) return true;
  if (HINDI_ENDS.some((e) => w.endsWith(e) && HINDI.has(w.slice(0, -e.length)))) return true;
  if (!/^[a-z]+$/.test(w)) return false;
  const s = skeleton(w);
  // the rest is skeletoned again: "gyarahvaan" keeps the h that "gyarah" alone drops
  return LATIN.has(s) || HINDI_LATIN_ENDINGS.some((e) => s.endsWith(e) && LATIN_CARDINAL.has(skeleton(s.slice(0, -e.length))));
}

// A number in words. With `names` (an answer), a homograph counts only in a quantity context; without (a shelf phrase,
// a text cell), every homograph is a number.
function numberWord(text: string, names?: ReadonlySet<string>): boolean {
  const plain = unaccented(text).replace(HANDLE, " ");
  if (CJK.test(plain)) return true;
  for (const m of plain.matchAll(WORD)) {
    const w = m[0];
    // A lone letter against an apostrophe is a contraction or an elision ("we'd", "I'm", "L'Oréal"), not a numeral; in
    // an answer any lone letter is read by quantityContext.
    const elided = w.length === 1 && (names !== undefined || /['’]/.test(`${plain[m.index - 1]}${plain[m.index + 1]}`));
    if (!elided && ROMAN.test(w.toUpperCase()) && !ROMAN_WORDS.includes(w)) return true;
    if (w.length > 1 && /[Oo]/.test(w) && [...w].every((c) => DIGIT_LIKE.includes(c)) && !DIGIT_LIKE_WORDS.includes(w)) return true;
  }
  const words = fold(plain).match(WORD) ?? [];
  if (words.some(glued)) return true;
  if (!names) return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));
  return words.some((w) => isNumber(w) && !HOMOGRAPH.has(w)) || quantityContext(text, names);
}

// A homograph glued to a unit, a currency or a count noun is one ("teenpackets", "do\u2060packets" once the joiner is
// folded away, "दोपैकेट"); the tail has three letters or more, so "dog" and "satin" are words.
const GLUE_TAIL = new Set([...UNIT, ...COUNT].filter((w) => w.length >= 3));
const glued = (w: string) => [...HOMOGRAPH].some((h) => w.length > h.length && w.startsWith(h) && GLUE_TAIL.has(w.slice(h.length)));

// "i.e." and "e.g." are abbreviations: not a Roman i, and not a gram beside a handle.
const unabbreviated = (text: string) => text.replace(/(?<![\p{L}\p{M}])(?:(i)\.\s?e|e\.\s?g)\.(?![\p{L}\p{M}])/giu, (_, i) => (i ? "ie" : "eg"));

// A word keeps its apostrophes ("I'm", "we'd", "L'Oréal" are not lone letters) and a handle its possessive ("⟦1⟧'s").
const TOKEN = /⟦[1-9][0-9]{0,2}⟧(?:['’]s)?|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;
const CLAUSE_END = /[.!?;।॥…]/u;
const SPACED = /^\s+$/u;
const CHAINED = /^[\s\-‐‑]+$/u; // a space or a hyphen: "do naye grahak", "teen-packet"
const signIn = (gap: string) => /\p{Sc}/u.test(gap) || [...gap].some((c) => SCALE_SIGNS.includes(c));

/**
 * Whether a homograph in an answer stands where a quantity is said. Beside a word means with nothing between but spaces
 * and binding marks (brackets, quotes, dashes, colons, commas, except a comma after "do"); a clause ends at . ! ? ; । and
 * … A homograph is a number when:
 * - a handle, a unit or currency, a scale or number word, or a name from this run's reads is beside it, or a currency or
 *   scale sign ("do ⟦1⟧", "⟦1⟧ teen", "tees rupees", "teen dozen", "teen Maggi", "do ₹");
 * - a count noun follows it, directly or (but for एक and a lone letter) across "of", a determiner and modifiers ("do
 *   customers", "a couple of new customers", "teen of the bills", "दो और पैकेट");
 * - it ends its clause after a colon or a dash ("Left: teen", "बचे हुए पैकेट: दो"), or it is a sentence by itself
 *   ("teen? ⟦1⟧", "⟦1⟧. Teen.");
 * - teen, tin, char, bees, tees or एक follows a quantifier ("only teen", "सिर्फ़ एक", "उनमें से एक"), or एक comes before
 *   a verb or particle that only the number takes ("एक बचा है", "एक ही");
 * - it is दो, or a Latin homograph in a Hindi sentence (one with Devanagari or a Hindi function word in Latin letters:
 *   "⟦1⟧ ke teen bache hain"), unless it is "do"/दो after a light verb ("kar do", "बता दो") with no handle, unit, count
 *   noun or name directly after it.
 * "do not" is never a number, and "a tin of" is the container.
 */
function quantityContext(text: string, names: ReadonlySet<string>): boolean {
  const t = fold(unabbreviated(text));
  const toks = [...t.matchAll(TOKEN)].map((m) => ({ w: m[0], handle: m[0].startsWith("⟦"), start: m.index, end: m.index + m[0].length }));
  const before = (i: number) => t.slice(toks[i - 1]?.end ?? 0, toks[i]?.start);
  const after = (i: number) => t.slice(toks[i]?.end, toks[i + 1]?.start ?? t.length);
  const hindi: boolean[] = [];
  let sentence = 0;
  const sentenceOf = toks.map((tok, i) => {
    if (i > 0 && CLAUSE_END.test(before(i))) sentence++;
    hindi[sentence] ||= /\p{Script=Devanagari}/u.test(tok.w) || HINGLISH.has(tok.w);
    return sentence;
  });
  const amount = (k: number) => {
    const tok = toks[k] as (typeof toks)[number];
    return tok.handle || UNIT.has(tok.w) || SCALE.has(tok.w) || (isNumber(tok.w) && !HOMOGRAPH.has(tok.w)) || names.has(tok.w);
  };
  for (const [i, tok] of toks.entries()) {
    const w = tok.w;
    if (!ROMAN_LETTER.has(w) && !LATIN_HOMOGRAPH.has(w) && !COLLECTIVE.has(w) && w !== EK && w !== DO) continue;
    const p = i > 0 && !CLAUSE_END.test(before(i)) ? i - 1 : null;
    // English "do" ends its clause at a comma too ("if you do, ⟦1⟧ …").
    const n = i + 1 < toks.length && !CLAUSE_END.test(after(i)) && !(w === "do" && after(i).includes(",")) ? i + 1 : null;
    if (w === "do" && n !== null && toks[n]?.w === "not" && SPACED.test(after(i))) continue;
    const verb = toks[p ?? -1];
    if ((w === "do" || w === DO) && verb && SPACED.test(before(i)) && LIGHT_VERB.has(verb.w) && !names.has(verb.w)) {
      if (n !== null && SPACED.test(after(i)) && (amount(n) || COUNT.has(toks[n]?.w ?? ""))) return true;
      continue;
    }
    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;
    if (/[:=\-–—]\s*$/u.test(before(i)) && /^\s*(?:[.!?;।॥…,]|$)/u.test(after(i))) return true;
    if (p === null && n === null) return true;
    if (QUANTIFIED.has(w) && p !== null && QUANTIFIER.has(toks[p]?.w ?? "")) return true;
    if (w === EK && p !== null && toks[p]?.w === "से" && /में$/u.test(toks[p - 1]?.w ?? "")) return true;
    if (w === EK && n !== null && AFTER_ONE.has(toks[n]?.w ?? "")) return true;
    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;
    // The count noun after it, across "of", a determiner and modifiers for the Latin and collective words.
    let j = i + 1;
    const chained = (k: number) => k < toks.length && CHAINED.test(after(k - 1));
    if (LATIN_HOMOGRAPH.has(w) || COLLECTIVE.has(w)) {
      if (chained(j) && toks[j]?.w === "of" && (COLLECTIVE.has(w) || !DETERMINER.has(toks[p ?? -1]?.w ?? ""))) {
        j++;
        if (chained(j) && OF_PRONOUN.has(toks[j]?.w ?? "")) return true;
        while (chained(j) && DETERMINER.has(toks[j]?.w ?? "")) j++;
      }
      while (chained(j) && MODIFIER.has(toks[j]?.w ?? "")) j++;
    }
    const target = j === i + 1 ? n : chained(j) ? j : null;
    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;
  }
  return false;
}

/** The words of the names in a run's reads that can mark a count beside a homograph ("Maggi noodles" → maggi, noodles). */
function nameWords(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    for (const w of fold(name).match(WORD) ?? []) {
      if (w.length >= 3 && !/\p{N}/u.test(w) && !NAME_STOP.has(w) && !HOMOGRAPH.has(w) && !UNIT.has(w) && !SCALE.has(w)) out.add(w);
    }
  }
  return out;
}

// The scripts the word lists read: Latin (accents aside) and Devanagari. A letter of any other script is refused.
const otherScript = (text: string) => /[\p{L}\p{M}]/u.test(unaccented(text).replace(/[A-Za-z]|\p{Script=Devanagari}/gu, ""));

// What a chunk of text beside a handle adds to it: a scale, a currency or a unit.
function beside(chunk: string, out: Set<Rule>): void {
  for (const ch of chunk) {
    if (/\p{Sc}/u.test(ch)) out.add("unit_or_currency");
    if (SCALE_SIGNS.includes(ch)) out.add("scale_word");
  }
  if (!/\p{L}/u.test(chunk) && [...chunk].some((ch) => SIGNS.includes(ch))) out.add("scale_word");
  for (const w of fold(chunk.replace(HANDLE, " ")).match(WORD) ?? []) {
    if (UNIT.has(w)) out.add("unit_or_currency");
    if (SCALE.has(w)) out.add("scale_word");
  }
}

function aroundHandles(text: string, out: Set<Rule>): void {
  const handles = [...text.matchAll(HANDLE)];
  for (const [i, h] of handles.entries()) {
    const start = h.index;
    const end = start + h[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const gluedBefore = (/\S*$/u.exec(before) as RegExpExecArray)[0];
    const gluedAfter = (/^\S*/u.exec(after) as RegExpExecArray)[0];
    if (!OPENERS.test(gluedBefore)) {
      out.add("handle_glue");
      beside(gluedBefore, out);
    }
    if (!CLOSERS.test(gluedAfter)) {
      out.add("handle_glue");
      beside(gluedAfter, out);
    }
    const prev = /(\S+)\s+$/u.exec(before.slice(0, before.length - gluedBefore.length))?.[1];
    if (prev) beside(prev, out); // always: "Rs. ⟦1⟧" ends in a full stop
    const next = /^\s+(\S+)/u.exec(after.slice(gluedAfter.length))?.[1];
    if (next && !SEPARATOR.test(gluedAfter)) beside(next, out);
    const following = handles[i + 1];
    if (following) {
      const gap = text.slice(end, following.index);
      if (!/\p{L}/u.test(gap) && !(GAP_MARK.test(gap) && LIST_GAP.test(gap))) out.add("handle_glue");
    }
  }
}

export const freeDigit = (text: string) => NUMBERISH.test(text.replace(HANDLE, "")) || NUMBERISH.test(shown(text).replace(HANDLE, ""));

function rulesOf(text: string, names?: ReadonlySet<string>): Rule[] {
  const out = new Set<Rule>();
  if (freeDigit(text)) out.add("free_digit");
  if (numberWord(text, names)) out.add("number_word");
  if (otherScript(text)) out.add("other_script");
  aroundHandles(unabbreviated(shown(text)), out);
  return RULES.filter((r) => out.has(r));
}

/** The rules a text breaks on its own (no refs needed), in RULES order, every homograph read as a number (shelf phrases). */
export const textRules = (text: string): Rule[] => rulesOf(text);

/** The rules an answer segment's text breaks on its own: a homograph is a number only in a quantity context, `names`
 * (the names in this run's reads) included. */
export const answerRules = (text: string, names: Iterable<string> = []): Rule[] => rulesOf(text, nameWords(names));

const idRef = (ref: CellRef) => ref.col === "id" || ref.col.endsWith("_id");

/** The rule a resolved cell breaks as cited from its column, if any. */
function cellRule(ref: CellRef, cell: Cell): Rule | null {
  if (cell.kind !== "text") return null;
  if (UUID.test(cell.txt.trim())) return "id_ref";
  const t = shown(cell.txt);
  // An amount planted in a name: a currency sign (in the raw text too, since NFKC folds ₨ to the letters Rs) or word.
  if (/\p{Sc}/u.test(cell.txt + t) || (fold(t).match(WORD) ?? []).some((w) => CURRENCY.has(w))) return "not_a_name";
  if (!NAME_COLUMNS.includes(ref.col) && (NUMBERISH.test(t) || numberWord(t))) return "not_a_name";
  if (!/\p{L}/u.test(t)) return "not_a_name"; // "15000" is no name
  if (PARTY_COLUMNS.includes(ref.col) && loneFigure(t)) return "not_a_name";
  return null;
}

// A word of digits (and digit punctuation) that no unit follows: "Sharma 50000", not "Butter 100 g".
function loneFigure(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  return words.some((w, i) => /\p{N}/u.test(w) && !/\p{L}/u.test(w) && !UNIT.has(fold(words[i + 1] ?? "").replace(/[^\p{L}]/gu, "")));
}

/**
 * Checks every rule on every segment and every ref (no short cut), so each failure is reported. `names`: the names in
 * this run's reads (catalogue items, customers, suppliers), beside which a homograph is a count.
 */
export async function checkAnswer(
  answer: Answer,
  scope: Scope,
  resolve: (ref: CellRef) => Promise<Cell | null>,
  names: Iterable<string> = [],
): Promise<Checked> {
  const failures: Failure[] = [];
  const segments: CheckedSegment[] = [];
  const words = nameWords(names);
  for (const [i, seg] of answer.segments.entries()) {
    for (const rule of rulesOf(seg.text, words)) failures.push({ segment: i, rule });
    for (const m of seg.text.matchAll(HANDLE)) if (Number(m[1]) > seg.refs.length) failures.push({ segment: i, rule: "unknown_handle" });
    const cells: Cell[] = [];
    for (const [k, ref] of seg.refs.entries()) {
      if (idRef(ref)) failures.push({ segment: i, rule: "id_ref", ref: k });
      const allowed = scope.get(ref.snapshotId);
      if (allowed === undefined || (allowed !== null && allowed !== ref.row)) failures.push({ segment: i, rule: "not_this_run", ref: k });
      const wellFormed = parseRef(formatRef(ref));
      const cell = wellFormed ? await resolve(wellFormed) : null;
      if (!cell) {
        failures.push({ segment: i, rule: "unresolved", ref: k });
        continue;
      }
      cells.push(cell);
      const rule = idRef(ref) ? null : cellRule(ref, cell);
      if (rule) failures.push({ segment: i, rule, ref: k });
    }
    segments.push({ ...seg, cells });
  }
  return failures.length ? { ok: false, failures } : { ok: true, segments };
}

/**
 * One checked segment as text. A segment that breaks a rule here (it cannot pass checkAnswer) still renders as "Cannot
 * verify". The re-check has no names of the run's reads, so it refuses less than checkAnswer did, never more.
 */
export function renderSegment(seg: CheckedSegment, locale = "en-IN"): string {
  if (answerRules(seg.text).length) return CANNOT_VERIFY;
  for (const [k, ref] of seg.refs.entries()) {
    const cell = seg.cells[k];
    if (!cell || idRef(ref) || cellRule(ref, cell)) return CANNOT_VERIFY;
  }
  return shown(seg.text).replace(HANDLE, (_, n: string) => renderCell(seg.cells[Number(n) - 1] ?? null, locale));
}

// What an abstention says is missing: the validator's rules, plus the run's own reasons.
export const MISSING = {
  free_digit: "a number without a source",
  number_word: "a number written in words",
  other_script: "text in a script the checker does not read",
  handle_glue: "numbers run together or joined to other text",
  scale_word: "a number scaled by a word beside it",
  unit_or_currency: "a unit or currency the source does not give",
  unknown_handle: "a number pointing at no source",
  id_ref: "an internal id",
  not_this_run: "a source this question did not read",
  unresolved: "a source that does not exist",
  not_a_name: "text cited as a number",
  no_answer: "the books do not hold what this needs",
  out_of_scope: "this is outside what the books answer",
  model_error: "the assistant did not answer",
  finding_closed: "this finding is dismissed or resolved",
  finding_stale: "the latest check no longer sees this finding",
} as const;
export type Missing = keyof typeof MISSING;

export type Reply =
  | { kind: "answer"; specialist: string; segments: CheckedSegment[] }
  | { kind: "abstain"; specialist: string | null; missing: Missing[] };

export function renderReply(reply: Reply, locale = "en-IN"): string[] {
  if (reply.kind === "abstain") return [`${CANNOT_VERIFY}: ${reply.missing.map((m) => MISSING[m]).join("; ")}.`];
  return reply.segments.map((s) => renderSegment(s, locale));
}
