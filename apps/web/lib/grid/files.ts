// Files in and out, in the browser only. A file is read into plain strings (formulas are not evaluated: a cell's stored
// value is taken), capped, and handed to importTable like a paste. Export is the books' snapshot, not what is pending.
import Papa from "papaparse";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;

const MAX_UNZIPPED = 50 * 1024 * 1024;

/** An .xlsx is a zip: read its central directory (declared sizes, no inflating) and refuse one that claims to expand past
 *  the cap, before the spreadsheet library inflates anything. */
export async function declaredUnzippedSize(file: Blob): Promise<number> {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65_557)).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FileRefused("unreadable");
  const entries = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirAt = tail.getUint32(eocd + 16, true);
  if (dirAt + dirSize > file.size) throw new FileRefused("unreadable");
  const dir = new DataView(await file.slice(dirAt, dirAt + dirSize).arrayBuffer());
  let total = 0;
  let at = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > dir.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw new FileRefused("unreadable");
    total += dir.getUint32(at + 24, true);
    at += 46 + dir.getUint16(at + 28, true) + dir.getUint16(at + 30, true) + dir.getUint16(at + 32, true);
  }
  return total;
}

export class FileRefused extends Error {
  constructor(readonly reason: "big" | "long" | "type" | "unreadable") {
    super(reason);
  }
}

export async function readTable(file: File): Promise<string[][]> {
  if (file.size > MAX_BYTES) throw new FileRefused("big");
  const name = file.name.toLowerCase();
  let rows: string[][];
  try {
    if (name.endsWith(".xlsx")) {
      if ((await declaredUnzippedSize(file)) > MAX_UNZIPPED) throw new FileRefused("big");
      const { readSheet } = await import("read-excel-file/browser");
      rows = (await readSheet(file)).map((line) => line.map((v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))));
    } else if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
      rows = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" }).data;
    } else throw new FileRefused("type");
  } catch (e) {
    throw e instanceof FileRefused ? e : new FileRefused("unreadable");
  }
  if (rows.length > MAX_ROWS) throw new FileRefused("long");
  return rows;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(matrix: string[][], name: string) {
  save(new Blob([Papa.unparse(matrix)], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
}

export async function downloadXlsx(matrix: string[][], name: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  save(await writeXlsxFile(matrix.map((line) => line.map((v) => ({ value: v })))).toBlob(), `${name}.xlsx`);
}
