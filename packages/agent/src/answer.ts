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
// Names: a text cell renders as text. Its digits are part of the name only when the segment cites it from a name
// column (NAME_COLUMNS: "Glucose biscuits 70 g", bill GT-1013); a text cell from any other column that holds a digit
// or a number word is refused, and no text cell may carry a currency sign ("Sharma (owes ₹50,000)"). A text cell with no
// letter ("15000"), or the name of a person or firm with a figure standing alone in it ("Sharma 50000"), is refused too.
// An id column, or a text cell shaped like a uuid, is never cited: the owner never sees an id.
import { CANNOT_VERIFY, type Cell, type CellRef, formatRef, parseRef, renderCell } from "@munshi/core/read";
import {
  CJK_NUMERALS,
  CURRENCY_WORDS,
  DIGIT_LIKE,
  DIGIT_LIKE_WORDS,
  HINDI_CARDINALS,
  HINDI_ENDINGS,
  HINDI_LATIN_CARDINALS,
  HINDI_LATIN_ENDINGS,
  LATIN_SKELETON,
  NAME_COLUMNS,
  NUMBER_WORDS,
  PARTY_COLUMNS,
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

function numberWord(text: string): boolean {
  const plain = unaccented(text).replace(HANDLE, " ");
  if (CJK.test(plain)) return true;
  for (const m of plain.matchAll(WORD)) {
    const w = m[0];
    // A lone letter against an apostrophe is a contraction or an elision ("we'd", "I'm", "L'Oréal"), not a numeral.
    const elided = w.length === 1 && /['’]/.test(`${plain[m.index - 1]}${plain[m.index + 1]}`);
    if (!elided && ROMAN.test(w.toUpperCase()) && !ROMAN_WORDS.includes(w)) return true;
    if (w.length > 1 && /[Oo]/.test(w) && [...w].every((c) => DIGIT_LIKE.includes(c)) && !DIGIT_LIKE_WORDS.includes(w)) return true;
  }
  return (fold(plain).match(WORD) ?? []).some(isNumber);
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

/** The rules a segment's text breaks on its own (no refs needed), in RULES order. */
export function textRules(text: string): Rule[] {
  const out = new Set<Rule>();
  if (freeDigit(text)) out.add("free_digit");
  if (numberWord(text)) out.add("number_word");
  if (otherScript(text)) out.add("other_script");
  aroundHandles(shown(text), out);
  return RULES.filter((r) => out.has(r));
}

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

/** Checks every rule on every segment and every ref (no short cut), so each failure is reported. */
export async function checkAnswer(answer: Answer, scope: Scope, resolve: (ref: CellRef) => Promise<Cell | null>): Promise<Checked> {
  const failures: Failure[] = [];
  const segments: CheckedSegment[] = [];
  for (const [i, seg] of answer.segments.entries()) {
    for (const rule of textRules(seg.text)) failures.push({ segment: i, rule });
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

/** One checked segment as text. A segment that breaks a rule here (it cannot pass checkAnswer) still renders as "Cannot verify". */
export function renderSegment(seg: CheckedSegment, locale = "en-IN"): string {
  if (textRules(seg.text).length) return CANNOT_VERIFY;
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
