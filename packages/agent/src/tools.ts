// The specialists' tools: one per named read (packages/core/src/queries-agent.ts), grouped by desk. A tool's arguments
// are what the model may choose; the run supplies the rest (the business date `as_of`; the tenant is the port's). The
// model never sees a uuid: an id cell is shown as a handle like item:3, numbered in order of first appearance in the
// run (so a recorded request is the same on every reseed), and a tool takes back only a handle this run has shown.
import { type Cell, renderCell } from "@munshi/core/read";
import { z } from "zod";
import type { ToolSpec } from "./providers/types.ts";

export const DESKS = ["stock", "sales", "credit"] as const;
export type Desk = (typeof DESKS)[number];

export class Handles {
  #byId = new Map<string, string>();
  #byHandle = new Map<string, string>();
  #next = new Map<string, number>();

  show(kind: string, id: string): string {
    const known = this.#byId.get(id);
    if (known) return known;
    const n = (this.#next.get(kind) ?? 0) + 1;
    this.#next.set(kind, n);
    const handle = `${kind}:${n}`;
    this.#byId.set(id, handle);
    this.#byHandle.set(handle, id);
    return handle;
  }

  id(kind: string, handle: string): string | undefined {
    return handle.startsWith(`${kind}:`) ? this.#byHandle.get(handle) : undefined;
  }
}

export type ToolContext = { asOf: string; handles: Handles };
type Tool = {
  name: string;
  query: string;
  description: string;
  args: z.ZodType;
  // null: an id handle this run has not shown
  params: (args: Record<string, unknown>, ctx: ToolContext) => Record<string, unknown> | null;
};

const item = z.string().describe("an item handle shown in a read, like item:1");
const day = z.iso.date().describe("a date, YYYY-MM-DD");
const none = z.object({});
const itemOnly = (a: Record<string, unknown>, ctx: ToolContext) => {
  const id = ctx.handles.id("item", a.item_id as string);
  return id ? { item_id: id } : null;
};

export const TOOLS: Tool[] = [
  {
    name: "items_list",
    query: "items.list",
    description: "Every item in the shop with what the books hold now. Use it to find an item's handle.",
    args: none,
    params: () => ({}),
  },
  {
    name: "stock_on_hand",
    query: "stock.on_hand",
    description: "What the books hold now of one item.",
    args: z.object({ item_id: item }),
    params: itemOnly,
  },
  {
    name: "stock_below_reorder",
    query: "stock.below_reorder",
    description: "Items whose stock lasts fewer than seven days at the last four weeks' sales, with a suggested quantity and the usual supplier.",
    args: none,
    params: (_, ctx) => ({ as_of: ctx.asOf }),
  },
  {
    name: "purchases_last_price",
    query: "purchases.last_price",
    description: "The latest supplier bill line for one item: supplier, bill, unit cost, quantity.",
    args: z.object({ item_id: item }),
    params: itemOnly,
  },
  {
    name: "purchases_price_history",
    query: "purchases.price_history",
    description: "Every supplier bill line for one item over the last `days` days (at most 180), oldest first.",
    args: z.object({ item_id: item, days: z.number().int().min(1).max(180) }),
    params: (a, ctx) => {
      const p = itemOnly(a, ctx);
      return p && { ...p, days: a.days, as_of: ctx.asOf };
    },
  },
  {
    name: "bills_recent",
    query: "bills.recent",
    description: "Supplier bills of the last `days` days (at most 31), newest first.",
    args: z.object({ days: z.number().int().min(1).max(31) }),
    params: (a, ctx) => ({ days: a.days, as_of: ctx.asOf }),
  },
  {
    name: "sales_by_day",
    query: "sales.by_day",
    description: "Counter sales per business day from..to (at most 92 days): bills, total, cash, UPI, card, and what was left on credit.",
    args: z.object({ from: day, to: day }),
    params: (a) => ({ from: a.from, to: a.to }),
  },
  {
    name: "sales_by_item",
    query: "sales.by_item",
    description: "The best-selling items from..to (at most 92 days) by revenue: units sold, revenue, bills. `limit` is at most 50.",
    args: z.object({ from: day, to: day, limit: z.number().int().min(1).max(50) }),
    params: (a) => ({ from: a.from, to: a.to, limit: a.limit }),
  },
  {
    name: "credit_balances",
    query: "credit.balances",
    description: "What each credit (udhaar) customer owes, how much of it is past due, and the oldest due date still open.",
    args: none,
    params: (_, ctx) => ({ as_of: ctx.asOf }),
  },
];

const byName = (...names: string[]) => names.map((n) => TOOLS.find((t) => t.name === n) as Tool);

export const DESK_TOOLS: Record<Desk, Tool[]> = {
  stock: byName("items_list", "stock_on_hand", "stock_below_reorder", "purchases_last_price", "purchases_price_history", "bills_recent"),
  sales: byName("sales_by_day", "sales_by_item", "items_list"),
  credit: byName("credit_balances"),
};

export const DESK_TITLES: Record<Desk, string> = { stock: "Stock & purchasing", sales: "Sales & money", credit: "Credit (udhaar)" };

export function toolSpec(t: Tool): ToolSpec {
  const { $schema: _drop, ...parameters } = z.toJSONSchema(t.args) as Record<string, unknown>;
  return { name: t.name, description: t.description, parameters };
}

/**
 * Text from the books (names, bill numbers, notes people typed) or from a model, made safe to put in a prompt as data:
 * control, format and line-separator characters go (bidi overrides, zero-width joiners), and the characters that could
 * close a data block or forge a handle are escaped.
 */
export const asData = (text: string) =>
  text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/[<>⟦⟧]/g, (c) => `\\u${(c.codePointAt(0) as number).toString(16).padStart(4, "0")}`);

/** A read as the model sees it: one <data> block of rendered values (id cells as handles). Everything inside is data. */
export function present(n: number, label: string, rows: Record<string, Cell>[], handles: Handles): string {
  const shown = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([col, cell]) => [
        col,
        cell.kind === "null" ? null : col.endsWith("_id") && cell.kind === "text" ? handles.show(col.slice(0, -3), cell.txt) : renderCell(cell),
      ]),
    ),
  );
  return `<data read="${n}" query="${label}">${asData(JSON.stringify(shown))}</data>`;
}
