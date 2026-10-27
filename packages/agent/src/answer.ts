// Cite or abstain. An answer is short segments of prose; a number appears in a segment only as a handle ⟦1⟧…⟦n⟧ that
// points into the segment's refs (snapshot cells). The validator fails the whole answer on any of four rules, and the
// renderer substitutes each handle with its cell's value, so a number on screen always comes from a stored cell and
// never from model text. A failed answer is shown as "Cannot verify" plus what is missing (fixed phrases, never model
// text).
import { CANNOT_VERIFY, type Cell, type CellRef, formatRef, parseRef, renderCell } from "@munshi/core/read";

export type Segment = { text: string; refs: CellRef[] };
export type Answer = { segments: Segment[] };
export type CheckedSegment = Segment & { cells: Cell[] };

export const RULES = ["free_digit", "unknown_handle", "not_this_run", "unresolved"] as const;
export type Rule = (typeof RULES)[number];
export type Failure = { segment: number; rule: Rule; ref?: number };

/** The snapshots an answer may cite: minted in this run (any row: null), or admitted for one row (the finding asked about). */
export type Scope = ReadonlyMap<string, number | null>;

export type Checked = { ok: true; segments: CheckedSegment[] } | { ok: false; failures: Failure[] };

const HANDLE = /⟦([1-9][0-9]{0,2})⟧/g;
// Any Unicode number (ASCII and Devanagari digits, ½, ², Ⅻ …) or a percent sign, once the handles are taken out.
const NUMBERISH = /[\p{N}%]/u;

export const freeDigit = (text: string) => NUMBERISH.test(text.replace(HANDLE, ""));

/** Checks every rule on every segment and every ref (no short cut), so each failure is reported. */
export async function checkAnswer(answer: Answer, scope: Scope, resolve: (ref: CellRef) => Promise<Cell | null>): Promise<Checked> {
  const failures: Failure[] = [];
  const segments: CheckedSegment[] = [];
  for (const [i, seg] of answer.segments.entries()) {
    if (freeDigit(seg.text)) failures.push({ segment: i, rule: "free_digit" });
    for (const m of seg.text.matchAll(HANDLE)) if (Number(m[1]) > seg.refs.length) failures.push({ segment: i, rule: "unknown_handle" });
    const cells: Cell[] = [];
    for (const [k, ref] of seg.refs.entries()) {
      const allowed = scope.get(ref.snapshotId);
      if (allowed === undefined || (allowed !== null && allowed !== ref.row)) failures.push({ segment: i, rule: "not_this_run", ref: k });
      const wellFormed = parseRef(formatRef(ref));
      const cell = wellFormed ? await resolve(wellFormed) : null;
      if (cell) cells.push(cell);
      else failures.push({ segment: i, rule: "unresolved", ref: k });
    }
    segments.push({ ...seg, cells });
  }
  return failures.length ? { ok: false, failures } : { ok: true, segments };
}

/** One checked segment as text. A free digit here (it cannot pass checkAnswer) still renders as "Cannot verify". */
export function renderSegment(seg: CheckedSegment, locale = "en-IN"): string {
  if (freeDigit(seg.text)) return CANNOT_VERIFY;
  return seg.text.replace(HANDLE, (_, n: string) => renderCell(seg.cells[Number(n) - 1] ?? null, locale));
}

// What an abstention says is missing: the validator's rules, plus the run's own reasons.
export const MISSING = {
  free_digit: "a number without a source",
  unknown_handle: "a number pointing at no source",
  not_this_run: "a source this question did not read",
  unresolved: "a source that does not exist",
  no_answer: "the books do not hold what this needs",
  out_of_scope: "this is outside what the books answer",
  model_error: "the assistant did not answer",
} as const;
export type Missing = keyof typeof MISSING;

export type Reply =
  | { kind: "answer"; specialist: string; segments: CheckedSegment[] }
  | { kind: "abstain"; specialist: string | null; missing: Missing[] };

export function renderReply(reply: Reply, locale = "en-IN"): string[] {
  if (reply.kind === "abstain") return [`${CANNOT_VERIFY}: ${reply.missing.map((m) => MISSING[m]).join("; ")}.`];
  return reply.segments.map((s) => renderSegment(s, locale));
}
