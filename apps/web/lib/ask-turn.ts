// The shape of an ask turn kept in the tab's sessionStorage (AskProvider). Storage is the person's to edit and older
// builds wrote other shapes, so a saved turn is checked before it is shown; one that does not check out is dropped.
// Hand-written rather than a schema library, so the check does not ship one to every page. Each reader returns a fresh
// copy holding only the known fields (unknown keys are left behind), or null when anything is the wrong shape.
import type { AnswerPart, AskReply, AskTurn } from "./hero-types";
import type { CellValue, Column, Localized, Snapshot, SourceRef } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Every item read, or null when any one fails. */
function each<T>(v: unknown, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = read(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function localized(v: unknown): Localized | null {
  return isObj(v) && isStr(v.en) && isStr(v.hi) ? { en: v.en, hi: v.hi } : null;
}

function sourceRef(v: unknown): SourceRef | null {
  if (!isObj(v)) return null;
  const label = localized(v.label);
  if (!label || !isStr(v.snapshotId) || !Number.isSafeInteger(v.row) || !isStr(v.col)) return null;
  return { label, snapshotId: v.snapshotId, row: v.row as number, col: v.col };
}

function cell(v: unknown): CellValue | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case "int":
      return isNum(v.v) ? { t: "int", v: v.v } : null;
    case "money":
      return isNum(v.minor) && isStr(v.currency) ? { t: "money", minor: v.minor, currency: v.currency } : null;
    case "qty":
      return isNum(v.milli) && isStr(v.unit) ? { t: "qty", milli: v.milli, unit: v.unit } : null;
    case "text":
    case "date":
    case "time":
      return isStr(v.v) ? { t: v.t, v: v.v } : null;
    case "null":
      return { t: "null" };
    default:
      return null;
  }
}

function column(v: unknown): Column | null {
  if (!isObj(v) || !isStr(v.key)) return null;
  if (v.numeric === undefined) return { key: v.key };
  return typeof v.numeric === "boolean" ? { key: v.key, numeric: v.numeric } : null;
}

function row(v: unknown): Record<string, CellValue> | null {
  if (!isObj(v)) return null;
  const out: Record<string, CellValue> = {};
  for (const [k, x] of Object.entries(v)) {
    const c = cell(x);
    if (!c) return null;
    out[k] = c;
  }
  return out;
}

function snapshot(v: unknown): Snapshot | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.query) || !isStr(v.readAt)) return null;
  const title = localized(v.title);
  const columns = each(v.columns, column);
  const rows = each(v.rows, row);
  if (!title || !columns || !rows) return null;
  const s: Snapshot = { id: v.id, query: v.query, readAt: v.readAt, title, columns, rows };
  if (v.simulatedSupplier === undefined) return s;
  return typeof v.simulatedSupplier === "boolean" ? { ...s, simulatedSupplier: v.simulatedSupplier } : null;
}

function part(v: unknown): AnswerPart | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case "text":
    case "name":
      return isStr(v.v) ? { t: v.t, v: v.v } : null;
    case "ref": {
      const ref = sourceRef(v.ref);
      return ref ? { t: "ref", ref } : null;
    }
    case "cannot":
      return { t: "cannot" };
    default:
      return null;
  }
}

function reply(v: unknown): AskReply | null {
  if (!isObj(v)) return null;
  if (v.kind === "answer") {
    const segments = each(v.segments, (s) => each(s, part));
    return isStr(v.desk) && segments ? { kind: "answer", desk: v.desk, segments } : null;
  }
  if (v.kind === "abstain") {
    const missing = each(v.missing, (m) => (isStr(m) ? m : null));
    return missing ? { kind: "abstain", missing } : null;
  }
  return null;
}

function turn(v: unknown): AskTurn | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.at) || (v.via !== "text" && v.via !== "voice")) return null;
  if (v.words !== null && !isStr(v.words)) return null;
  if (typeof v.recorded !== "boolean") return null;
  const r = reply(v.reply);
  const snapshots = each(v.snapshots, snapshot);
  if (!r || !snapshots) return null;
  return { id: v.id, at: v.at, via: v.via, words: v.words, reply: r, snapshots, recorded: v.recorded };
}

/** The turns in a stored JSON string that check out; anything else (not an array, a malformed turn) is dropped. */
export function savedTurns(json: string | null): AskTurn[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const ok = turn(t);
    return ok ? [ok] : [];
  });
}
