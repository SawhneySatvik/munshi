// What the bills, suppliers and day-report pages share on the server: minting a named read as the signed-in member,
// reading the stored snapshots back (the page shows only what snap.snapshot_cell holds), the shop's business date,
// the member and the commands their role holds, and the suppliers. Reads run in READ ONLY transactions under the member;
// the only writes are the snapshots core's mintSnapshot stores.
import { addDays, businessDate, CELL_COLUMNS, type Cell, type CellRow, cellFromRow, mintSnapshot, type Session, withTx } from "@munshi/core";
import { BOOKS, type BooksDict } from "../i18n-books";
import { DICT, type Dict, fillText } from "../i18n";
import type { CellValue, Column, Lang, Localized, Member, Snapshot, SourceRef, Supplier } from "../types";
import { appPool } from "./db";

export type Client = Parameters<Parameters<typeof withTx>[2]>[0];

export async function readOnly<T>(session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withTx(await appPool(), { kind: "member", session }, async (c) => {
    await c.query("set transaction read only");
    return fn(c);
  });
}

/** Runs a named read as the member and stores it; the id is all the page keeps until it reads the stored cells back. */
export async function mint(session: Session, query: string, params: Record<string, unknown>): Promise<string> {
  return (await mintSnapshot(await appPool(), { kind: "member", session }, query, params)).id;
}

// The drawer's title and columns for each read these pages show: ids stay out; every column a figure points at is in.
const VIEWS: Record<string, { title: keyof BooksDict; columns: string[]; simulatedSupplier?: true }> = {
  "bills.recent": { title: "titleBillsRecent", columns: ["bill_no", "bill_date", "lines", "total"], simulatedSupplier: true },
  "purchases.price_history": {
    title: "titlePriceHistory",
    columns: ["item", "bill_date", "bill_no", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "purchases.last_price": {
    title: "titleLastPrice",
    columns: ["item", "bill_no", "bill_date", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "bill.lines_for": {
    title: "titleBillLines",
    columns: ["line_no", "item", "qty", "unit_cost", "amount", "prev_unit_cost", "expires_on"],
    simulatedSupplier: true,
  },
  "purchases.last_prices": {
    title: "titleLastPrices",
    columns: ["item", "bill_no", "bill_date", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "sales.week_total": { title: "titleWeekTotal", columns: ["bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_day": { title: "titleSalesByDay", columns: ["day", "bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_item": { title: "titleSalesByItem", columns: ["item", "sold", "revenue", "bills"] },
};

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("ledger: a stored figure is out of range");
  return n;
}

export function cellValue(cell: Cell): CellValue {
  switch (cell.kind) {
    case "integer":
      return { t: "int", v: safe(cell.num) };
    case "money":
      return { t: "money", minor: safe(cell.num), currency: cell.currency };
    case "quantity":
      return { t: "qty", milli: safe(cell.num), unit: cell.unit };
    case "text":
      return { t: "text", v: cell.txt };
    case "date":
      return { t: "date", v: cell.day };
    case "timestamp":
      return { t: "time", v: cell.at };
    case "null":
      return { t: "null" };
  }
}

/** A Localized from a key of the pages' own dictionary or the shared one. */
export function words(key: keyof BooksDict | keyof Dict, slots: Record<Lang, Record<string, string>> = { en: {}, hi: {} }): Localized {
  const pick = (lang: Lang) => (key in BOOKS[lang] ? BOOKS[lang][key as keyof BooksDict] : DICT[lang][key as keyof Dict]);
  return { en: fillText(pick("en"), slots.en), hi: fillText(pick("hi"), slots.hi) };
}

/** The stored snapshots, in the order asked, each with every stored cell (the drawer shows the very row). */
export async function stored(c: Client, ids: string[]): Promise<Snapshot[]> {
  const { rows: snaps } = await c.query<{ id: string; query_name: string; created_at: Date }>(
    "select id, query_name, created_at from snap.snapshot where id = any($1::uuid[])",
    [ids],
  );
  const { rows: cells } = await c.query<CellRow & { snapshot_id: string; row_no: number; col: string }>(
    `select snapshot_id, row_no, col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = any($1::uuid[])`,
    [ids],
  );
  const byRow = new Map<string, Array<Record<string, CellValue>>>();
  for (const r of cells) {
    const rows = byRow.get(r.snapshot_id) ?? [];
    rows[r.row_no] = { ...(rows[r.row_no] ?? {}), [r.col]: cellValue(cellFromRow(r)) };
    byRow.set(r.snapshot_id, rows);
  }
  return ids.map((id) => {
    const s = snaps.find((x) => x.id === id);
    if (!s) throw new Error("ledger: a snapshot minted for this page is not readable");
    const view = VIEWS[s.query_name];
    if (!view) throw new Error(`ledger: no drawer view for ${s.query_name}`);
    const rows = Array.from(byRow.get(id) ?? [], (row) => row ?? {});
    const first = rows[0] ?? {};
    const columns: Column[] = view.columns.map((key) => {
      const v = first[key];
      return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
    });
    return {
      id,
      query: s.query_name,
      readAt: s.created_at.toISOString(),
      title: words(view.title),
      ...(view.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows,
    };
  });
}

/** A text cell's value ('' when the cell is not text). Names and bill numbers on these pages come from here. */
export function textOf(s: Snapshot, row: number, col: string): string {
  const v = s.rows[row]?.[col];
  return v?.t === "text" ? v.v : v?.t === "date" ? v.v : "";
}

/** A ref to a stored cell; `row` is the 0-based stored row (SourceRef rows are 1-based, as the drawer shows them). */
export const refTo = (label: Localized, s: Snapshot, row: number, col: string): SourceRef => ({ label, snapshotId: s.id, row: row + 1, col });

const SYNTHETIC = /\s*\(synthetic\)$/;
const SIMULATED = /\s*\(simulated\)$/;

export type Me = { shop: string; member: Member; mayRun: Set<string>; timeZone: string };

export async function me(c: Client, session: Session): Promise<Me> {
  const { rows: tenant } = await c.query<{ name: string; time_zone: string }>("select name, time_zone from ops.tenant");
  const { rows: member } = await c.query<Member>("select name, role from ops.member where id = $1", [session.memberId]);
  const t = tenant[0];
  const m = member[0];
  if (!t || !m) throw new Error("ledger: the signed-in member's shop is not readable");
  const { rows: may } = await c.query<{ command: string }>("select command from ops.command_authority where role = $1", [m.role]);
  return { shop: t.name.replace(SYNTHETIC, ""), member: m, mayRun: new Set(may.map((r) => r.command)), timeZone: t.time_zone };
}

/** The shop's business date the pages read up to: the latest watcher run's (the morning brief's), else today's. */
export async function asOfDate(c: Client, timeZone: string): Promise<string> {
  const { rows } = await c.query<{ as_of: string | null }>(
    `select (select s.params->>'as_of' from snap.snapshot s where s.run_id = r.id limit 1) as as_of
       from ops.run r where r.trigger = 'watcher' and r.ended_at is not null order by r.started_at desc limit 1`,
  );
  return rows[0]?.as_of ?? businessDate(new Date(), timeZone);
}

/** Bills dated in the month to as_of: bills.recent's widest window. */
export const recentBills = (asOf: string) => ({ days: 31, as_of: asOf });
export const dayBefore = (day: string, n = 1) => addDays(day, -n);

/** Every supplier of the shop, its "(simulated)" suffix dropped from the name and carried as a flag instead. */
export async function suppliers(c: Client): Promise<Map<string, Supplier>> {
  const { rows } = await c.query<{ id: string; name: string; is_simulated: boolean }>(
    "select id::text, name, is_simulated from books.supplier order by name, id",
  );
  return new Map(rows.map((s) => [s.id, { name: s.is_simulated ? s.name.replace(SIMULATED, "") : s.name, simulated: s.is_simulated }]));
}

export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The plain name of a supplier's bill as a source: "Gupta Traders' bill" · "Gupta Traders का बिल". */
export const supplierBill = (supplier: Supplier) =>
  words("labelSupplierBill", { en: { supplier: possessive(supplier.name) }, hi: { supplier: supplier.name } });
