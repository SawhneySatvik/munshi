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

export type Finding = (
  | { kind: "shelf_gap"; id: string; item: string; books: SourceRef; shelf: SourceRef }
  | { kind: "price_rise"; id: string; item: string; supplier: Supplier; was: SourceRef; now: SourceRef }
  | { kind: "overdue_credit"; id: string; customers: SourceRef; owed: SourceRef; days: SourceRef }
  | { kind: "expiry"; id: string; item: string; left: SourceRef; days: SourceRef; value: SourceRef | null } // value: the office's alone (D-082)
  | { kind: "short_settlement"; id: string; day: SourceRef; short: SourceRef }
) &
  FindingMoves;

/**
 * What a person may do with a finding row (absent: nothing offered). `ids`: the findings the row stands for; `card`: the
 * kind a card stands for whole (the overdue card: every open overdue finding, read on the server when acted on); `why`:
 * a desk can explain it (the card: its own figure); `fix`: its kind has a recipe, drafted for each finding; `quiet`: the
 * member may Snooze and Dismiss it (an owner or a manager); `offer`: its fix is "Offer it", to one of these recipients.
 */
export type FindingMoves = { ids?: string[]; card?: string; why?: boolean; fix?: boolean; quiet?: boolean; offer?: Recipient[] };

/** A recipient surplus stock can be offered to: simulated, every one (the screen always says so). */
export type Recipient = { id: string; name: string };

/** A figure or the words around it, in an agent's stored words (a reply): text, or a cell. */
export type WordPart = { t: "text"; v: string } | { t: "ref"; ref: SourceRef };

/** An agent's other draft in the tray (a reminder, a package lapsed, a reply), decided like a reorder. */
export type TrayCard = {
  id: string;
  command: "customer.remind" | "package.expire" | "message.reply" | "surplus.give";
  status: Draft["status"];
  /** who it reaches, by name; null when the books hold none */
  customer: string | null;
  /** a reminder's template */
  template: "credit_due" | "package_expiring" | null;
  /** the figure a reminder carries, or the value a lapse clears: its cell; null when none is cited */
  figure: SourceRef | null;
  /** a reply's words, each figure its cell; null for the others, or words since erased */
  words: WordPart[] | null;
  /** a gift (surplus.give): the item and the recipient, by name from the cells it cites, and the quantity's cell while it
   * still holds the very quantity the draft gives; null for the others */
  gift?: { item: string | null; recipient: string | null; qty: SourceRef | null } | null;
  decision: DecisionStamp | null;
  canDecide: boolean;
};

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
  /** the agents' other drafts waiting (or decided since the brief) */
  tray?: TrayCard[];
};
