// Column definitions and the per-column parsers. A person's text becomes the same CellValue the snapshot holds
// (qty in milli-units with the row's unit, money in minor units), so "set it back to what the books say" compares equal.
// Decimals are split as strings and assembled as integers: a money or quantity string never passes through a float.
import { z } from "zod";
import type { CellValue, Localized } from "../types";

export type Kind = "text" | "int" | "money" | "qty" | "choice";

export type ColumnDef = {
  key: string;
  kind: Kind;
  label: Localized;
  /** Existing rows refuse edits and pastes here; a row the person adds is theirs in every column. */
  readOnly?: boolean;
  /** A new row is incomplete without it. */
  required?: boolean;
  /** For "choice": the values allowed. */
  options?: string[];
  /** For "money". */
  currency?: string;
};

export type ParseError = "empty" | "number" | "decimals" | "range" | "choice" | "long";
export type Parsed = { ok: true; value: CellValue } | { ok: false; error: ParseError };

const DEVANAGARI_ZERO = 0x0966;
const TEXT_MAX = 120;
/** Units sold by the count: a quantity in them is whole (the items table's piece and pack, and the bare "unit"). */
const DISCRETE = new Set(["pack", "piece", "unit"]);

/** Hindi digits to ASCII, a leading ₹ / Rs dropped, and Indian or Western grouping commas removed when they are grouping. */
function plainNumber(raw: string): string {
  const ascii = raw.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
  const bare = ascii.replace(/^\s*(₹|rs\.?)\s*/i, "").replace(/\s+/g, "");
  // Only well-formed grouping is grouping: 1,23,456 (Indian) or 123,456 (Western). "12,34" or "1,5" stay as typed and fail.
  return /^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3})(\.\d*)?$/.test(bare) ? bare.replaceAll(",", "") : bare;
}

/** "19.99" with 2 places is 1999. More places than allowed is an error, never a rounding. */
function scaled(raw: string, places: number): { ok: true; n: number } | { ok: false; error: ParseError } {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(plainNumber(raw));
  if (!m) return { ok: false, error: "number" };
  const frac = m[2] ?? "";
  if (frac.length > places) return { ok: false, error: "decimals" };
  const n = BigInt((m[1] as string) + frac.padEnd(places, "0"));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "range" };
  return { ok: true, n: Number(n) };
}

const fail = (error: ParseError) => ({ ok: false as const, error });

export function parseCell(col: ColumnDef, raw: string, row: { unit: string }): Parsed {
  const text = raw.trim();
  if (!text) return col.kind === "text" && !col.required ? { ok: true, value: { t: "text", v: "" } } : fail("empty");
  switch (col.kind) {
    case "text": {
      const r = z.string().max(TEXT_MAX).safeParse(text);
      return r.success ? { ok: true, value: { t: "text", v: r.data } } : fail("long");
    }
    case "choice": {
      const hit = (col.options ?? []).find((o) => o.toLowerCase() === text.toLowerCase());
      return hit ? { ok: true, value: { t: "text", v: hit } } : fail("choice");
    }
    case "int": {
      const r = scaled(text, 0);
      return r.ok ? { ok: true, value: { t: "int", v: r.n } } : r;
    }
    case "money": {
      const r = scaled(text, 2);
      return r.ok ? { ok: true, value: { t: "money", minor: r.n, currency: col.currency ?? "INR" } } : r;
    }
    case "qty": {
      // A count unit takes whole numbers (read as whole, then scaled to milli); a measured one takes 3 places.
      const whole = DISCRETE.has(row.unit);
      const r = scaled(text, whole ? 0 : 3);
      const milli = r.ok ? (whole ? r.n * 1000 : r.n) : 0;
      if (r.ok && !Number.isSafeInteger(milli)) return fail("range");
      return r.ok ? { ok: true, value: { t: "qty", milli, unit: row.unit } } : r;
    }
  }
}

const decimal = (n: number, places: number): string => {
  const s = String(n).padStart(places + 1, "0");
  const whole = s.slice(0, s.length - places);
  const frac = s.slice(s.length - places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};

/** A canonical value as the person edits, copies or exports it: no symbol, no grouping. */
export function editText(value: CellValue | undefined): string {
  switch (value?.t) {
    case "int":
      return String(value.v);
    case "money":
      return decimal(value.minor, 2);
    case "qty":
      return decimal(value.milli, 3);
    case "text":
    case "date":
    case "time":
      return value.v;
    default:
      return "";
  }
}

export function sameValue(a: CellValue, b: CellValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
