// What the hero chain's screens read (built on the server in lib/server/hero.ts): an asked question and its answer, a
// counted shelf, a read bill, and the drafts they leave for a person. Every figure is a SourceRef into a snapshot the
// run minted, the snapshots travelling with the result for the source drawer. Plain data, so it crosses to the client.
import type { DecisionStamp, Draft, Snapshot, SourceRef, Supplier } from "./types";

/** What the server takes: a question's length, a recording (a minute of 16 or 24 kHz 16-bit mono is under 3 MB; the
 *  mic stops itself at a minute) and a photo. next.config's server-action body limit sits above the largest. */
export const MAX_QUESTION = 500;
export const MAX_AUDIO = 4 * 1024 * 1024;
export const MAX_PHOTO = 10 * 1024 * 1024;
export const MAX_RECORDING_MS = 60_000;

/** One piece of an answer: the model's words, a figure (a cell, shown with its unit), a name from the books, or a
 *  segment that failed its check and shows "Cannot verify". */
export type AnswerPart = { t: "text"; v: string } | { t: "ref"; ref: SourceRef } | { t: "name"; v: string } | { t: "cannot" };

/** Why an answer abstained: the agent's fixed reasons (packages/agent answer.ts MISSING), never model text. */
export type Abstained = { kind: "abstain"; missing: string[] };

export type AskReply = { kind: "answer"; desk: string; segments: AnswerPart[][] } | Abstained;

export type AskTurn = {
  /** The run's id. */
  id: string;
  at: string;
  via: "text" | "voice";
  /** The person's own words: what they typed, or what the voice model heard. Null when it heard nothing. */
  words: string | null;
  reply: AskReply;
  snapshots: Snapshot[];
  /** The model answers were replayed from recorded responses (no live model was asked). */
  recorded: boolean;
};

export type AskError = "signed_out" | "empty" | "too_long" | "not_audio" | "edition" | "other";
export type AskState = { turn: AskTurn } | { error: AskError } | null;

type DraftBase = { id: string; status: Draft["status"]; decision: DecisionStamp | null; canDecide: boolean };

/** A stock.count drafted from a shelf photo: what the photo shows against what the books hold, both cells. */
export type CountDraft = DraftBase & { command: "stock.count"; itemId: string; item: string; counted: SourceRef | null; expected: SourceRef | null };

/** A purchase.record drafted from a bill photo: each figure is a cell read on the bill. */
export type BillDraft = DraftBase & {
  command: "purchase.record";
  supplier: Supplier;
  billNo: string;
  billDate: SourceRef | null;
  lines: Array<{ item: string; qty: SourceRef | null; cost: SourceRef | null }>;
};

export type PhotoDraft = CountDraft | BillDraft;

/** The drafts a photo left waiting, with the snapshots their figures point into. */
export type Waiting = { drafts: PhotoDraft[]; snapshots: Snapshot[] };

/** A box on a photo in the photo's own pixels, as the segment model returned it. */
export type Box = { x1: number; y1: number; x2: number; y2: number };

export type ShelfLine = {
  itemId: string;
  item: string;
  counted: SourceRef;
  onHand: SourceRef;
  gap: boolean;
  /** The segment model's boxes for this item, read back from its stored response, and the photo size they are in. */
  boxes: Box[];
  size: { w: number; h: number } | null;
  draft: CountDraft | null;
};

export type ShelfOutcome =
  | {
      kind: "counted";
      lines: ShelfLine[];
      /** Items the vision model named but that could not be counted, by the agent's fixed reasons. */
      uncounted: Array<{ item: string; why: string }>;
      /** The vision model's words for products outside the catalogue (digit-free; shown as the model's, untrusted). */
      unrecognised: string[];
    }
  | { kind: "refused"; why: string };

export type ShelfState = { result: ShelfOutcome; snapshots: Snapshot[]; recorded: boolean } | { error: AskError | "refused" } | null;

export type BillReadLine = {
  /** The line's text as printed on the bill: the model's reading of a photo, untrusted. */
  printed: string;
  /** The catalogue item it matched by exact name or alias, or null (left out of the draft). */
  item: string | null;
  qty: SourceRef;
  cost: SourceRef;
  /** A unit price above the last paid: the bill's cell and the last bill's cell. */
  rise: { was: SourceRef } | null;
  /** Where each figure was printed, on the 0–1000 grid of the page. */
  qtyAt: Box | null;
  costAt: Box | null;
};

export type BillOutcome =
  | { kind: "read"; billNo: string; billDate: SourceRef | null; lines: BillReadLine[]; draft: BillDraft | null; why: string | null }
  /** The supplier's bill with this number is already in the books: nothing drafted; the recorded bill's page. */
  | { kind: "recorded"; billNo: string; billId: string | null }
  | { kind: "refused"; why: string };

export type BillState = { result: BillOutcome; snapshots: Snapshot[]; recorded: boolean } | { error: AskError | "refused" | "supplier" } | null;

/** A decided photo draft: its card from the books, the item's on-hand read after a count, the bill a purchase wrote. */
export type DecidePhotoState =
  | { draft: PhotoDraft; snapshots: Snapshot[]; after: SourceRef | null; billId: string | null }
  | { error: "refused" | "not_proposed" | "signed_out" | "other" }
  | null;
