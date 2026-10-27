// What the counter, the credit book and the stock page share (server only). Every figure they show is a cell of a
// snapshot minted here from a named read, under the signed-in member: on each render, and again inside each server
// action after its command commits, so a figure shown after a write was read after it. Names and ids are read directly
// (they are not figures); commands run only through core's runCommand under the session.
import { type Cell, CoreError, businessDate, mintSnapshot, type Session, withTx } from "@munshi/core";
import { type OpsDict, opsLabel } from "../i18n-ops";
import type { Floor, OpsError, Stamped } from "../ops-types";
import type { CellValue, Column, Localized, Member, Snapshot, SourceRef } from "../types";
import { appPool } from "./db";

export type Client = Parameters<Parameters<typeof withTx>[2]>[0];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readOnly<T>(session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withTx(await appPool(), { kind: "member", session }, async (c) => {
    await c.query("set transaction read only");
    return fn(c);
  });
}

const SYNTHETIC = /\s*\(synthetic\)$/;

/** The signed-in member, the shop, today's business date in the shop's zone, and the commands the member's role holds. */
export function floorOf(session: Session): Promise<Floor & { today: string; may: Set<string> }> {
  return readOnly(session, async (c) => {
    const [tenant] = (await c.query<{ name: string; time_zone: string }>("select name, time_zone from ops.tenant")).rows;
    const [me] = (await c.query<Member>("select name, role from ops.member where id = $1", [session.memberId])).rows;
    if (!tenant || !me) throw new Error("ops: the signed-in member's shop is not readable");
    const may = (await c.query<{ command: string }>("select command from ops.command_authority where role = $1", [me.role])).rows;
    return {
      member: me,
      shop: tenant.name.replace(SYNTHETIC, ""),
      today: businessDate(new Date(), tenant.time_zone),
      may: new Set(may.map((r) => r.command)),
    };
  });
}

/** The signed-in member's name and role (the navigation's only question). */
export function memberOf(session: Session): Promise<Member | null> {
  return readOnly(session, async (c) => (await c.query<Member>("select name, role from ops.member where id = $1", [session.memberId])).rows[0] ?? null);
}

// The source drawer's title and columns for each read these pages show: ids stay out.
const VIEW: Record<string, { title: keyof OpsDict; columns: string[] }> = {
  "items.list": { title: "titleItems", columns: ["item", "category", "on_hand"] },
  "stock.below_reorder": { title: "titleLow", columns: ["item", "on_hand", "sold_28d", "days_cover", "suggested", "supplier"] },
  "stock.on_hand": { title: "titleOnHand", columns: ["item", "on_hand"] },
  "credit.balances": { title: "titleBalances", columns: ["customer", "balance", "overdue", "oldest_due_on"] },
  "sales.by_day": { title: "titleSalesDay", columns: ["day", "bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_item": { title: "titleSalesItem", columns: ["item", "sold", "revenue", "bills"] },
  "sale.quote": { title: "titleQuote", columns: ["item", "qty", "unit_price", "amount", "total"] },
  "sale.receipt": { title: "titleReceipt", columns: ["item", "qty", "unit_price", "amount", "total", "cash", "upi", "card", "on_credit", "sold_at"] },
};

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("ops: a stored figure is out of range");
  return n;
}

function value(cell: Cell): CellValue {
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

/** A minted read: its stored cells (for the server's lookups) and the snapshot as the drawer shows it. */
export type Minted = { id: string; cells: Record<string, Cell>[]; snapshot: Snapshot };

export async function mint(session: Session, name: string, params: Record<string, unknown>): Promise<Minted> {
  const made = await mintSnapshot(await appPool(), { kind: "member", session }, name, params);
  const readAt = await readOnly(session, async (c) => {
    const { rows } = await c.query<{ at: Date }>("select created_at as at from snap.snapshot where id = $1", [made.id]);
    return (rows[0] as { at: Date }).at.toISOString();
  });
  const view = VIEW[name];
  const rows = made.rows.map((row) => Object.fromEntries(Object.entries(row).map(([col, cell]) => [col, value(cell)])));
  const first = rows[0] ?? {};
  const columns: Column[] = (view?.columns ?? Object.keys(first)).map((key) => {
    const v = first[key];
    return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
  });
  return {
    id: made.id,
    cells: made.rows,
    snapshot: { id: made.id, query: name, readAt, title: view ? opsLabel(view.title) : { en: name, hi: name }, columns, rows },
  };
}

/** A ref to one cell of a minted read; `row` is the stored row_no (0-based), shown 1-based. */
export const refTo = (m: Minted, row: number, col: string, label: Localized): SourceRef => ({ label, snapshotId: m.id, row: row + 1, col });

export const textOf = (cell: Cell | undefined) => (cell?.kind === "text" ? cell.txt : "");

/** The stored row whose text cell `col` holds `id`, or -1. */
export const rowOf = (m: Minted, col: string, id: string) => m.cells.findIndex((r) => textOf(r[col]) === id);

/** Who wrote a book row and when, from its audit entry. */
export async function stampOf(session: Session, entity: string, id: string): Promise<Stamped> {
  return readOnly(session, async (c) => {
    const { rows } = await c.query<{ at: Date; by: string }>(
      `select a.created_at as at, m.name as by from audit.audit_log a join ops.member m on m.tenant_id = a.tenant_id and m.id = a.actor_id
        where a.entity = $1 and a.entity_id = $2 and a.action = 'insert' order by a.seq limit 1`,
      [entity, id],
    );
    const row = rows[0];
    if (!row) throw new Error("ops: a written row has no audit entry");
    return { by: row.by, at: row.at.toISOString() };
  });
}

/** A command's refusal in the screen's terms. CoreError carries a code and field paths only, never a value. */
export function errorOf(err: unknown): OpsError {
  if (!(err instanceof CoreError)) return "other";
  if (err.code === "refused") return "refused";
  if (err.code === "conflict") return "conflict";
  if (err.code === "invalid" || err.code === "not_found") {
    const fields = err.fields ?? [];
    if (fields.includes("qtyMilli") || fields.includes("countedQtyMilli")) return "short";
    if (fields.includes("customerId")) return "customer";
    return "invalid";
  }
  return "other";
}

export const supplierName = (name: string, simulated: boolean) => (simulated ? name.replace(/\s*\(simulated\)$/, "") : name);
