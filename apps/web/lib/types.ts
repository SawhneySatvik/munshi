// The shape the owner home reads, built on the server from the books (lib/server/home.ts): findings and drafts whose
// numbers are refs into stored snapshot cells, plus those snapshots' rows. Plain data, so it crosses to the client as is.

export type Lang = "en" | "hi";
export type Localized = Record<Lang, string>;

/** Points at one stored snapshot cell. `row` is 1-based, as shown in the source drawer (core's row_no + 1). */
export type SourceRef = { label: Localized; snapshotId: string; row: number; col: string };

export type CellValue =
  | { t: "int"; v: number }
  | { t: "money"; minor: number; currency: string }
  | { t: "qty"; milli: number; unit: string }
  | { t: "text"; v: string }
  | { t: "date"; v: string }
  | { t: "time"; v: string }
  | { t: "null" };

export type Column = { key: string; numeric?: boolean };

/** A shelf photo reduced to slots: one string per shelf, "#" a packet, "." an empty space. */
export type ShelfPhoto = { takenAt: string; shelves: string[] };

export type Snapshot = {
  id: string;
  query: string;
  readAt: string;
  title: Localized;
  simulatedSupplier?: boolean;
  /** The columns the drawer shows, in order (ids stay out). */
  columns: Column[];
  rows: Array<Record<string, CellValue>>;
  photo?: ShelfPhoto;
};

/** Names are the books' own text, one spelling in both languages. */
export type Supplier = { name: string; simulated: boolean };

export type Finding =
  | { kind: "shelf_gap"; id: string; item: string; books: SourceRef; shelf: SourceRef }
  | { kind: "price_rise"; id: string; item: string; supplier: Supplier; was: SourceRef; now: SourceRef }
  | { kind: "overdue_credit"; id: string; customers: SourceRef; owed: SourceRef; days: SourceRef }
  | { kind: "expiry"; id: string; item: string; left: SourceRef; days: SourceRef; value: SourceRef }
  | { kind: "short_settlement"; id: string; day: SourceRef; short: SourceRef };

/** A line whose number has no source yet: shown as "Cannot verify", never as a figure. */
export type Unverified = { what: Localized; reason: Localized };

/** Who decided a draft and when, from its audit entry (for `stale`: who tried to approve it after the evidence changed). */
export type DecisionStamp = { by: string; at: string };

export type Draft = {
  id: string;
  command: "reorder.place";
  status: "proposed" | "executed" | "rejected" | "stale" | "failed";
  /** Every line the draft would order. qty: the cited cell holding that very quantity; null when none does. */
  lines: Array<{ item: string; qty: SourceRef | null }>;
  supplier: Supplier;
  decision: DecisionStamp | null;
  /** The signed-in member's role holds the draft's command, so Approve and Reject are offered. */
  canDecide: boolean;
};

export type Member = { name: string; role: "owner" | "manager" | "staff" };

export type OwnerHome = {
  shop: { name: string; synthetic: boolean };
  member: Member;
  /** When the watchers that wrote this brief ran; null before any run. */
  briefAt: string | null;
  snapshots: Snapshot[];
  findings: Finding[];
  unverified: Unverified[];
  drafts: Draft[];
};
