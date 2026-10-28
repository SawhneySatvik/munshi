// Cite or abstain. An answer is short segments of prose; a number appears in a segment only as a handle ⟦1⟧…⟦n⟧ that
// points into the segment's refs (snapshot cells). The validator fails the whole answer on any rule below, and the
// renderer substitutes each handle with its cell's value, so a number on screen always comes from a stored cell and
// never from model text. A failed answer is shown as "Cannot verify" plus what is missing (fixed phrases, never model
// text).
//
// The rules on a segment's text and on the cells it cites (free digits, number words, other scripts, glue, scales,
// units and currencies beside a handle, homographs in a quantity context, names) are core's: packages/core/src/
// numbers.ts, shared with core's own checks on campaign copy and replies (MS-22b). This file adds what only an answer
// has: its handles point at refs, each ref resolves to a cell of a snapshot this run may cite, and the renderer.
import {
  answerRules,
  CANNOT_VERIFY,
  type Cell,
  type CellRef,
  cellRule,
  formatRef,
  HANDLE,
  idRef,
  nameWords,
  parseRef,
  type Rule,
  renderCell,
  rulesOf,
  shown,
} from "@munshi/core/read";

export { answerRules, freeDigit, RULES, type Rule, textRules } from "@munshi/core/read";

export type Segment = { text: string; refs: CellRef[] };
export type Answer = { segments: Segment[] };
export type CheckedSegment = Segment & { cells: Cell[] };

export type Failure = { segment: number; rule: Rule; ref?: number };

/** The snapshots an answer may cite: minted in this run (any row: null), or admitted for one row (the finding asked about). */
export type Scope = ReadonlyMap<string, number | null>;

export type Checked = { ok: true; segments: CheckedSegment[] } | { ok: false; failures: Failure[] };

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
