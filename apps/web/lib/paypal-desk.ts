// The PayPal desk's shape, shared by its server read (lib/server/paypal-desk.ts) and its screen: plain data, so it
// crosses to the client as is.
import type { Floor } from "./ops-types";
import type { PaypalDraftView, PaypalLinkView, PaypalPanel } from "./server/paypal-panel";
import type { Snapshot, SourceRef } from "./types";

export const DESK_STATES = ["none", "draft", "live", "paid", "recorded", "cancelled", "failed"] as const;
export type DeskState = (typeof DESK_STATES)[number];
// In order of lateness: a customer who owes nothing now (here only for a link) first.
export const DESK_BUCKETS = ["clear", "not_due", "month", "two", "three", "older"] as const;
export type DeskBucket = (typeof DESK_BUCKETS)[number];

export type DeskDraft = PaypalDraftView & { canDecide: boolean };
export type DeskRow = {
  customer: { id: string; name: string };
  /** what they owe now; null: nothing (a customer here only for a link) */
  balance: SourceRef | null;
  overdue: SourceRef | null;
  since: SourceRef | null;
  /** days late, the overdue finding's cell; null: no open finding for them */
  days: SourceRef | null;
  late: boolean;
  bucket: DeskBucket;
  state: DeskState;
  /** the newest link, if any */
  link: PaypalLinkView | null;
  /** the amount the newest link (or the link draft waiting) was drafted for */
  linkAmount: SourceRef | null;
  drafts: DeskDraft[];
  /** a payment PayPal reported that the books do not hold yet, in the shop's currency */
  unrecorded: string | null;
  reminder: { status: "waiting" } | { status: "sent"; at: string | null } | null;
  /** the open overdue finding a reminder is drafted from */
  findingId: string | null;
  canLink: boolean;
  canRemind: boolean;
};

export type PaypalDesk = Floor & {
  mode: PaypalPanel["mode"];
  canSend: boolean;
  canRecord: boolean;
  rows: DeskRow[];
  /** the brief's overdue total: its overdue amount and how many customers, each a cell */
  total: { overdue: SourceRef; customers: SourceRef } | null;
  more: boolean;
  snapshots: Snapshot[];
};
