// What the counter, the credit book and the stock page share (server only). Every figure they show is a cell of a
// snapshot a core view mints from a named read, under the signed-in member, in the page's one transaction: on each
// render, and again inside each server action after its command commits, so a figure shown after a write was read after
// it. Names and ids come from the same views (they are not figures); commands run only through core's runCommand under
// the session.
import {
  type BookRow,
  type Capability,
  type Cell,
  CoreError,
  capsOf,
  type Session,
  signedInMember,
  stampOf as stamp,
  type StoredSnapshot,
  switchedOn,
  type Viewer,
  viewFloor,
  withPage,
} from "@munshi/core";
import { EXTRA, type Extra, extrasFor } from "../nav";
import { type OpsDict, opsLabel } from "../i18n-ops";
import type { Floor, OpsError, Stamped } from "../ops-types";
import type { CellValue, Column, Localized, Member, Snapshot, SourceRef } from "../types";
import { appPool } from "./db";
import { named } from "./ledger";

export type Client = Parameters<Parameters<typeof withPage>[2]>[0];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Runs a page's (or an action's) core views in one transaction, as the signed-in member. */
export async function page<T>(session: Session, fn: (c: Client) => Promise<T>): Promise<T> {
  return withPage(await appPool(), session, fn);
}

const SYNTHETIC = /\s*\(synthetic\)$/;

/** The page's frame from core's viewer: the member, the shop's name, and the commands the member's role holds. */
export const frame = (v: Viewer): Floor & { may: Set<string> } => ({ member: v.member as Member, shop: v.tenantName.replace(SYNTHETIC, ""), may: v.mayRun });

/** The signed-in member, the shop, today's business date in the shop's zone, the commands the member's role holds, and
 * the Ask desks theirs (core's map, D-082). */
export async function floorOf(session: Session): Promise<Floor & { today: string; may: Set<string>; desks: string[] }> {
  const v = await page(session, (c) => viewFloor(c, session));
  return { ...frame(v.viewer), today: v.today, desks: v.desks };
}

/** The signed-in member's name and role (the navigation's only question). */
export async function memberOf(session: Session): Promise<Member | null> {
  return page(session, (c) => signedInMember(c, session)) as Promise<Member | null>;
}

// The capabilities the navigation asks about: every extra section's but the inbox's (keyed by the messaging switch).
const NAV_CAPS = [...new Set(Object.values(EXTRA).map((e) => e.cap))].filter((c): c is Capability => c !== null && c !== "messaging");

/** The signed-in member and the extra sections the shop's capabilities open for their role, in one transaction. */
export async function navOf(session: Session): Promise<{ member: Member; extra: Extra[] } | null> {
  return page(session, async (c) => {
    const member = (await signedInMember(c, session)) as Member | null;
    if (!member) return null;
    const on = new Set<string>(await capsOf(c, session, NAV_CAPS));
    if (await switchedOn(c, "messaging")) on.add("messaging");
    return { member, extra: extrasFor(member.role, on) };
  });
}

// The source drawer's title and columns for each read these pages show: ids stay out; a person's name stands beside
// their id (named(), from people.ts: a name is never a cell).
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

export const minted = (s: StoredSnapshot): Minted => mintedAs(s);

/** `title` and `show` name a read the table above does not: the drawer's title and the columns it shows (ids out). */
export function mintedAs(s: StoredSnapshot, title?: Localized, show?: string[]): Minted {
  const view = VIEW[s.query];
  const rows = s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, cell]) => [col, value(cell)])), s.names));
  const first = rows[0] ?? {};
  const columns: Column[] = (show ?? view?.columns ?? Object.keys(first)).map((key) => {
    const v = first[key];
    return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
  });
  return {
    id: s.id,
    cells: s.rows,
    snapshot: { id: s.id, query: s.query, readAt: s.readAt, title: title ?? (view ? opsLabel(view.title) : { en: s.query, hi: s.query }), columns, rows },
  };
}

/** A ref to one cell of a minted read; `row` is the stored row (0-based), shown 1-based. */
export const refTo = (m: Minted, row: number, col: string, label: Localized): SourceRef => ({ label, snapshotId: m.id, row: row + 1, col });

export const textOf = (cell: Cell | undefined) => (cell?.kind === "text" ? cell.txt : "");

/** The stored row whose text cell `col` holds `id`, or -1. */
export const rowOf = (m: Minted, col: string, id: string) => m.cells.findIndex((r) => textOf(r[col]) === id);

/** Who wrote a book row and when, from its audit entry. */
export function stampOf(session: Session, table: BookRow, id: string): Promise<Stamped> {
  return page(session, (c) => stamp(c, table, id));
}

/** A command's refusal in the screen's terms. CoreError carries a code and field paths only, never a value. */
export function errorOf(err: unknown): OpsError {
  if (!(err instanceof CoreError)) return "other";
  if (err.code === "refused" || err.code === "not_for_role") return "refused"; // a read the member's role may not make (D-082)
  if (err.code === "capability_off" || err.code === "feature_off") return "off";
  if (err.code === "not_proposed") return "conflict";
  if (err.code === "conflict") return "conflict";
  if (err.code === "invalid" || err.code === "not_found") {
    const fields = err.fields ?? [];
    // An Instagram post's card (core's attachCard and proposeCampaign): its own reasons.
    if (fields.includes("cardErased")) return "card_erased";
    if (fields.includes("cardMissing")) return "card_missing";
    if (fields.includes("card")) return "card_bad";
    if (fields.includes("qtyMilli") || fields.includes("countedQtyMilli")) return "short";
    if (fields.includes("customerId")) return "customer";
    return "invalid";
  }
  return "other";
}

export const supplierName = (name: string, simulated: boolean) => (simulated ? name.replace(/\s*\(simulated\)$/, "") : name);
