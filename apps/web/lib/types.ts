// The shape the owner home reads. It mirrors what core will return (findings and drafts whose numbers are refs into
// stored snapshot cells), so wiring core in later swaps the data source, not the components.

export type Lang = "en" | "hi";
export type Localized = Record<Lang, string>;

/** Points at one stored snapshot cell. `row` is 1-based, as shown in the source drawer. */
export type SourceRef = { label: Localized; snapshotId: string; row: number; col: string };

export type CellValue =
  | { t: "int"; v: number }
  | { t: "money"; minor: number; currency: "INR" }
  | { t: "text"; v: string }
  | { t: "date"; v: string };

export type Column = { key: string; numeric?: boolean };

/** A shelf photo reduced to slots: one string per shelf, "#" a packet, "." an empty space. */
export type ShelfPhoto = { takenAt: string; shelves: string[] };

export type Snapshot = {
  id: string;
  query: string;
  readAt: string;
  title: Localized;
  simulatedSupplier?: boolean;
  columns: Column[];
  rows: Array<Record<string, CellValue>>;
  photo?: ShelfPhoto;
};

export type Supplier = { name: Localized; simulated: boolean };

export type Finding =
  | { kind: "shelf_gap"; id: string; item: Localized; books: SourceRef; shelf: SourceRef }
  | { kind: "price_rise"; id: string; item: Localized; supplier: Supplier; was: SourceRef; now: SourceRef }
  | { kind: "overdue_credit"; id: string; customers: SourceRef; owed: SourceRef; days: SourceRef };

/** A line whose number has no source yet: shown as "Cannot verify", never as a figure. */
export type Unverified = { what: Localized; reason: Localized };

export type Draft = {
  id: string;
  command: "reorder.place";
  item: Localized;
  supplier: Supplier;
  qty: SourceRef;
  // TODO(core): the decision row's decided_by / decided_at once Approve calls core; until then the mock shows these.
  mockDecision: { by: string; at: string };
};

export type OwnerHome = {
  shop: { name: Localized };
  owner: { greeting: Localized };
  briefAt: string;
  snapshots: Snapshot[];
  findings: Finding[];
  unverified: Unverified[];
  draft: Draft;
};
