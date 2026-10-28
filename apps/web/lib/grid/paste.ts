// Paste, import and copy. All of it only moves text into (or out of) the pending store: nothing is sent anywhere.
import Papa from "papaparse";
import type { Lang } from "../types";
import { editText } from "./columns";
import { begin, cellView, commit, putCell, putRow, type Store, viewRows } from "./store";

export type PasteReport = { applied: number; refused: number; clipped: number; added: number };

/** Excel and Google Sheets put tab-separated text on the clipboard. A cell is quoted only when it starts with a quote and
 *  the quote closes right before a tab, a line break or the end ("a<tab>b", with "" for a quote inside); any other quote
 *  is just a character, so `5" pipe` stays one cell and an unmatched `"` cannot swallow the rows after it. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  const endsField = (j: number) => j >= n || text[j] === "\t" || text[j] === "\n" || text[j] === "\r";
  while (i <= n) {
    let field: string | null = null;
    if (text[i] === '"') {
      let j = i + 1;
      let out = "";
      while (j < n) {
        if (text[j] === '"' && text[j + 1] === '"') {
          out += '"';
          j += 2;
        } else if (text[j] === '"' && endsField(j + 1)) {
          field = out;
          i = j + 1;
          break;
        } else out += text[j++];
      }
    }
    if (field === null) {
      let j = i;
      while (!endsField(j)) j++;
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === "\t") i++;
    else {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      i++;
      rows.push(row);
      row = [];
      if (i >= n) return trim(rows);
    }
  }
  rows.push(row);
  return trim(rows);
}
const trim = (rows: string[][]) => {
  while (rows.length && rows.at(-1)?.every((c) => c === "")) rows.pop();
  return rows;
};

export function rangeToTsv(s: Store, from: { row: number; col: number }, to: { row: number; col: number }): string {
  const keys = viewRows(s);
  const lines: string[][] = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
    const key = keys[r]?.key;
    if (!key) continue;
    const line: string[] = [];
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
      const col = s.columns[c];
      line.push(col ? cellView(s, key, col.key).text : "");
    }
    lines.push(line);
  }
  return Papa.unparse(lines, { delimiter: "\t", newline: "\n" });
}

/** Writes the block from the anchor cell. Rows past the last one become added rows; cells past the last column are
 *  dropped; a cell the column refuses (read-only) is left as it was. One undo step. */
export function pasteGrid(s: Store, anchor: { row: number; col: number }, block: string[][]): { store: Store; report: PasteReport } {
  const report: PasteReport = { applied: 0, refused: 0, clipped: 0, added: 0 };
  const keys = viewRows(s).map((r) => r.key);
  const w = begin(s);
  block.forEach((line, i) => {
    let key = keys[anchor.row + i];
    if (key === undefined) {
      key = putRow(w);
      keys.push(key);
      report.added++;
    }
    line.forEach((text, j) => {
      const col = s.columns[anchor.col + j];
      if (!col) {
        report.clipped++;
        return;
      }
      const put = putCell(w, key as string, col.key, text);
      if (put.refused) report.refused++;
      else if (!put.noop) report.applied++;
    });
  });
  return { store: commit(s, w), report };
}

const norm = (v: string) => v.trim().toLowerCase();

/** A file's rows into the store like a paste. A header row maps columns by name (key or label, either language); a row
 *  whose id is a row on the page edits that row, any other row is added. Without a recognisable header, by position. */
export function importTable(s: Store, table: string[][]): { store: Store; report: PasteReport } {
  const report: PasteReport = { applied: 0, refused: 0, clipped: 0, added: 0 };
  const head = (table[0] ?? []).map(norm);
  const names = (key: string) => {
    const c = s.columns.find((x) => x.key === key);
    return [key, c?.label.en, c?.label.hi].filter(Boolean).map((n) => norm(n as string));
  };
  const at = head.map((h) => s.columns.findIndex((c) => names(c.key).includes(h)));
  const hasHeader = at.some((i) => i >= 0);
  const idAt = hasHeader ? head.indexOf("id") : -1;
  const data = hasHeader ? table.slice(1) : table;
  const known = new Set(s.base.map((r) => r.key));
  const w = begin(s);
  for (const line of data) {
    if (line.every((c) => c.trim() === "")) continue;
    let key = idAt >= 0 && known.has(line[idAt] ?? "") ? (line[idAt] as string) : undefined;
    if (key === undefined) {
      key = putRow(w);
      report.added++;
    }
    line.forEach((text, j) => {
      const ci = hasHeader ? (at[j] ?? -1) : j;
      const col = s.columns[ci];
      if (!col) {
        if (j !== idAt) report.clipped++;
        return;
      }
      const put = putCell(w, key as string, col.key, text);
      if (put.refused) report.refused++;
      else if (!put.noop) report.applied++;
    });
  }
  return { store: commit(s, w), report };
}

/** The rows of the books' snapshot, for a file: the row id first, the snapshot id last. Never what is pending. */
export function exportMatrix(s: Store, lang: Lang): string[][] {
  const head = ["id", ...s.columns.map((c) => c.label[lang]), "snapshot"];
  const body = s.base.map((r) => [r.key, ...s.columns.map((c) => guard(editText(r.cells[c.key]?.value))), s.snapshotId]);
  return [head, ...body];
}

/** A cell that starts with = + - @ is read as a formula by a spreadsheet: prefix it so it stays text. */
const guard = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
