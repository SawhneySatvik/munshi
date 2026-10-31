// Settlement reconciliation (server only, P-4). The page: the last 30 days' receipts and payouts, every figure a cell
// of core's settlements.reconcile minted under the signed-in member. A statement is the uploaded file itself: its bytes
// are hashed and read into the file's own strings here (CSV by papaparse, XLSX by read-excel-file, under the grid's
// caps), and core parses every amount from those strings; no other field of the form is read. The statement's own
// figures are the document's, shown as "Sample statement, line N", never as cells of the books.
import { createHash } from "node:crypto";
import { type PreviewLine, renderCell, type Session, type StatementInput, type StatementPreview, type StoredSnapshot, viewSettlements } from "@munshi/core";
import Papa from "papaparse";
import { declaredUnzippedSize, MAX_BYTES, MAX_ROWS } from "../grid/files";
import type { Localized, Snapshot, SourceRef } from "../types";
import { frame, mintedAs, page, refTo, textOf } from "./ops";

const MAX_UNZIPPED = 50 * 1024 * 1024;
export type FileProblem = "missing" | "big" | "long" | "type" | "unreadable";

/** The uploaded statement as core takes it: its sha256 and its rows, each cell the file's own string. */
export async function statementOf(file: FormDataEntryValue | null): Promise<StatementInput | { problem: FileProblem }> {
  if (!(file instanceof File) || file.size === 0) return { problem: "missing" };
  if (file.size > MAX_BYTES) return { problem: "big" };
  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let rows: string[][];
  try {
    if (name.endsWith(".csv")) {
      rows = Papa.parse<string[]>(bytes.toString("utf8"), { skipEmptyLines: false }).data;
    } else if (name.endsWith(".xlsx")) {
      if ((await declaredUnzippedSize(file)) > MAX_UNZIPPED) return { problem: "big" };
      const { readSheet } = await import("read-excel-file/node");
      rows = (await readSheet(bytes)).map((line) =>
        line.map((v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))),
      );
    } else return { problem: "type" };
  } catch {
    return { problem: "unreadable" };
  }
  if (rows.length > MAX_ROWS) return { problem: "long" };
  return { sha256: createHash("sha256").update(bytes).digest("hex"), rows };
}

const books = (): Localized => ({ en: "Settlements · the books", hi: "सेटलमेंट · बही" });
const COLUMNS = ["business_date", "channel", "receipts", "settled", "difference", "verdict", "utr", "received_on"];

export type DayRow = { day: SourceRef; channel: string; receipts: SourceRef; settled: SourceRef | null; difference: SourceRef; verdict: string };
export type StatementRow = Omit<PreviewLine, "row"> & { net: string; receipts: SourceRef | null };
export type PreviewView = {
  alreadyImported: boolean;
  errors: StatementPreview["errors"];
  lines: StatementRow[];
  missing: { day: SourceRef; channel: string; receipts: SourceRef }[];
  canRecord: boolean; // a record would write at least one line
  snapshots: Snapshot[];
};
export type SettlementsPage = { shop: string; days: DayRow[]; snapshots: Snapshot[] };

function daysOf(s: StoredSnapshot) {
  const m = mintedAs(s, books(), COLUMNS);
  const label = books();
  const days: DayRow[] = m.cells.map((row, i) => ({
    day: refTo(m, i, "business_date", label),
    channel: textOf(row.channel),
    receipts: refTo(m, i, "receipts", label),
    settled: row.settled?.kind === "money" ? refTo(m, i, "settled", label) : null,
    difference: refTo(m, i, "difference", label),
    verdict: textOf(row.verdict),
  }));
  return { m, days };
}

/** The page for an owner or a manager (the roles holding settlement.import); null for anyone else. */
export async function loadSettlements(session: Session): Promise<SettlementsPage | null> {
  const v = await page(session, (c) => viewSettlements(c, session));
  const floor = frame(v.viewer);
  if (!floor.may.has("settlement.import")) return null;
  const { m, days } = daysOf(v.reconcile);
  return { shop: floor.shop, days, snapshots: [m.snapshot] };
}

/** A core preview as the screen shows it: the books' side as refs to the preview's own reconcile snapshot. */
export function previewView(p: StatementPreview): PreviewView {
  const r = p.reconcile ? daysOf(p.reconcile) : null;
  const label = books();
  const first = p.reconcile?.rows[0]?.receipts;
  const currency = first?.kind === "money" ? first.currency : "INR"; // the statement names none: the books' own
  return {
    alreadyImported: p.alreadyImported,
    errors: p.errors,
    lines: p.lines.map(({ row, ...l }) => ({
      ...l,
      net: renderCell({ kind: "money", num: String(l.netMinor), currency }),
      receipts: r && row !== null ? refTo(r.m, row, "receipts", label) : null,
    })),
    missing: r ? p.missing.map((n) => ({ day: refTo(r.m, n, "business_date", label), channel: r.days[n]?.channel ?? "", receipts: refTo(r.m, n, "receipts", label) })) : [],
    canRecord: !p.alreadyImported && p.errors.length === 0 && p.lines.some((l) => l.status === "SETTLED" && l.verdict !== "already_recorded"),
    snapshots: r ? [r.m.snapshot] : [],
  };
}
