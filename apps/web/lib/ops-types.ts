// What the counter, the credit book and the stock page read (built on the server in lib/server/*.ts) and what their
// server actions answer. Every figure is a SourceRef into a snapshot minted under the signed-in member; the snapshots
// travel with the page so the source drawer shows the very row. Names are the books' own text.
import type { Member, Snapshot, Supplier, SourceRef } from "./types";

export type Named = { id: string; name: string };

/** The page's frame: who is signed in and the shop's name (the tenant's, "(synthetic)" dropped). */
export type Floor = { member: Member; shop: string };

export type CounterPage = Floor & {
  /** Every catalogue item, for the search. */
  items: Array<Named & { unit: string }>;
  /** The best sellers of the last four weeks (sales.by_item), for the quick tiles: item ids in rank order. */
  quick: string[];
  customers: Named[];
  /** Today's counter sales (sales.by_day); null if the read returned no row. */
  today: { bills: SourceRef; total: SourceRef; onCredit: SourceRef } | null;
  snapshots: Snapshot[];
  canSell: boolean;
};

/** A recorded sale, from cells minted after its commit. Its own amounts have no read yet ("Cannot verify"). */
export type Receipt = {
  customer: string;
  by: string;
  at: string;
  lines: Array<{ item: string; left: SourceRef | null }>;
  owes: SourceRef | null;
  snapshots: Snapshot[];
};

export type OwingRow = { customer: Named; balance: SourceRef; overdue: SourceRef; due: SourceRef; late: boolean };

export type CreditPage = Floor & {
  owing: OwingRow[];
  customers: Named[];
  snapshots: Snapshot[];
  canPayment: boolean;
  canCredit: boolean;
};

export type StockRow = { id: string; name: string; unit: string; onHand: SourceRef; low: boolean };
export type LowRow = { id: string; name: string; onHand: SourceRef; cover: SourceRef; suggested: SourceRef; supplier: Supplier | null };

export type StockPage = Floor & {
  items: StockRow[];
  low: LowRow[];
  snapshots: Snapshot[];
  canCount: boolean;
  canWaste: boolean;
};

export type OpsError =
  | "refused"
  | "invalid"
  | "conflict"
  | "short"
  | "amount"
  | "qty"
  | "customer"
  | "item"
  | "empty"
  | "coming_soon"
  | "signed_out"
  | "other";

/** Who wrote the row and when, from its audit entry. */
export type Stamped = { by: string; at: string };

export type CounterState = { error: OpsError } | { receipt: Receipt } | null;

export type CreditState =
  | { error: OpsError }
  | { done: { kind: "payment" | "credit"; stamp: Stamped; customer: string; owes: SourceRef | null; snapshots: Snapshot[] } }
  | null;

/** stamp is null when a count matched the books, so nothing was written. */
export type StockState =
  | { error: OpsError }
  | { done: { kind: "count" | "waste"; stamp: Stamped | null; item: string; onHand: SourceRef | null; snapshots: Snapshot[] } }
  | null;
