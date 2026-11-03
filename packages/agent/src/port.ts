import type { Cell, CellRef } from "@munshi/core/read";
import type { Role } from "@munshi/ai";

/**
 * Everything an agent run can do, handed in by the app already bound to ONE tenant and ONE run (ops.run). The agent
 * holds no pool and imports no core writer; the tenant is never a model argument.
 * - read: the app mints a snapshot of a named read (mintSnapshot, a `system` scope, this run's id) and returns its cells.
 * - resolve: the stored cell a ref names, under this tenant's RLS; null if there is none.
 * - propose: the app calls proposeDraft with this run as the proposer. Every number in the payload is mapped, by its
 *   JSON path, to the cell it came from (payloadRefs); core refuses the draft otherwise.
 * - finding: a watcher's finding of this tenant and its state (core's findingState: status, whether the latest watcher
 *   run of its kind still sees it, a draft awaiting a decision), with the cells of the row that run sees it in (its own
 *   row once it is no longer seen); null if there is none.
 * - trace: ids, fixed labels and timings only — never model text, a question, a name or anything from a bill.
 * - allow: core's allow() for one model call of this run's tenant: core counts the call; false refuses it, and the run
 *   abstains or its surface shows a template, never an error. Optional only until the app's port wires it: a port
 *   without it has no caps.
 * - taint: marks this run tainted (ai.run.tainted), because it read untrusted text, which may try to steer a model.
 *   Optional likewise.
 * - models: the aliases a call of `role` may use for `agent` (ref.ai_agent), in order: core's modelFor (the shop's
 *   choice, the default, then the other aliases allowed for the role; each enabled on the platform's
 *   allow-list). Empty: no model is allowed, and the surface shows its template. Optional: without it, the default.
 * - scope: what the person behind this run may read, by their role (core's askerIn): the named reads their role makes
 *   under the shop's switched-on capabilities, and the Ask desks those open. Ask routes only to those desks, a desk offers only
 *   those reads, and Why? or a fix needing any other abstains. Core refuses any other read too, as the last gate.
 *   Optional: a run with no person (the brief's narrator) reads nothing.
 * - memory: the notes in force the person behind the run may read (core's notesFor; memory is the office's, so none for
 *   counter staff), each a person's own words from one of their decisions. Asked only by the flows that take notes (Ask,
 *   and Why? on a finding or a card; Draft the fix asks, but calls no model), whose model calls get them as a stable
 *   prefix inside a delimited block; the photo, bill, inbox and brief flows never ask. The app's port gives them only
 *   when the models answer live. With none, every prompt is as it was. Optional: none.
 */
export type AgentPort = {
  read(name: string, params: Record<string, unknown>): Promise<{ snapshotId: string; rows: Record<string, Cell>[] }>;
  resolve(ref: CellRef): Promise<Cell | null>;
  propose(draft: DraftProposal): Promise<string>;
  finding(findingId: string): Promise<FindingRow | null>;
  trace(event: TraceEvent): void | Promise<void>;
  allow?(role: Role): Promise<boolean>;
  taint?(): Promise<void>;
  models?(agent: string, role: Role): Promise<string[]>;
  scope?(): Promise<AskerScope>;
  memory?(): Promise<MemoryNote[]>;
};

/** A note in force: its id (traced, never shown to a model), its kind and its words. */
export type MemoryNote = { id: string; kind: string; text: string };

/** What one person may read: core's reads and desks for their role and the shop's switched-on capabilities. */
export type AskerScope = { reads: ReadonlySet<string>; desks: ReadonlySet<string> };

// The reads whose cells carry untrusted text: a supplier's bill as the vision model copied it. An inbox message's own
// words are no read (no cell holds them): they come through an InboxPort's `message`, which taints the run the same way.
export const UNTRUSTED_READS: ReadonlySet<string> = new Set(["bill.lines"]);

export class TaintRefused extends Error {
  constructor() {
    super("refused: a tainted run proposes only the recipe the person tapped");
  }
}

/**
 * The port of a run a person started by tapping one recipe: booking.confirm, message.reply,
 * credit.record, purchase.record or order.confirm. Once the run reads untrusted text it is tainted (marked before the
 * read), and from then on this port refuses every proposal but that recipe's command, before core sees it. Core's own
 * fence is the database's taint list (approval.taint_recipe), which admits any of the five.
 */
export function tappedPort<P extends AgentPort>(port: P, recipe: string): P {
  let tainted = false;
  const taint = async () => {
    if (tainted) return;
    tainted = true;
    await port.taint?.();
  };
  const inbox = "message" in port ? (port as unknown as InboxPort) : null;
  return {
    ...port,
    ...(inbox
      ? {
          async message(messageId: string) {
            await taint();
            return inbox.message(messageId);
          },
        }
      : {}),
    async read(name, params) {
      if (UNTRUSTED_READS.has(name)) await taint();
      return port.read(name, params);
    },
    async propose(draft) {
      if (tainted && draft.command !== recipe) throw new TaintRefused();
      return port.propose(draft);
    },
  };
}

export type DraftProposal = { command: string; payload: unknown; basedOn: CellRef[]; payloadRefs: Record<string, CellRef>; findingId?: string };

export type FindingRow = {
  id: string;
  kind: string;
  snapshotId: string;
  row: number;
  cells: Record<string, Cell>;
  status: string;
  current: boolean;
  openDraft: boolean;
};

export type TraceEvent = { kind: TraceKind; label: string; ids: string[]; ms: number };
export type TraceKind = "route" | "model" | "read" | "budget" | "validate" | "answer" | "abstain" | "propose" | "evidence";

/** A place on a photo: [x_min, y_min, x_max, y_max] on the 0–1000 grid, (0, 0) at the top-left. */
export type Place = [number, number, number, number];

/** One catalogue item counted on a shelf photo: the segment model's raw response as it arrived, its sha256, its matches. */
export type ShelfCountRecord = { itemId: string; photoSha256: string; phrase: string; model: string; raw: string; rawSha256: string; matches: number };

/** A supplier's bill as the vision model read it, for the supplier the person named. Text is untrusted; null: not read. */
export type BillReadRecord = {
  supplierId: string;
  photoSha256: string;
  model: string;
  billNo: string | null;
  billDate: string | null;
  lines: { text: string; qtyMilli: number; qtyAt: Place | null; unitCostMinor: number; unitCostAt: Place | null }[];
};

/**
 * The photo flows' port (shelf count, bill reading): the agent port of one photo run, plus core's two evidence writers
 * (recordShelfCount, recordBillRead) bound to that run. Each returns the stored row's id; the flow then reads its cells
 * through `read` (count.shelf, bill.lines), so every number it shows or drafts is a cell.
 */
export type EvidencePort = AgentPort & {
  recordCount(count: ShelfCountRecord): Promise<string>;
  recordBill(bill: BillReadRecord): Promise<string>;
};

/** An inbox message's own words as stored: the text a customer typed, or the transcript a run stored (a voice note's, or
 * a photo's list as the vision model copied it). Untrusted: it reaches a model only inside a <data> block. */
export type InboxWords = { kind: "text" | "audio" | "image" | "other"; text: string | null; transcript: string | null };

/** What a model may point at in a message: a field and its span, in code points of the stored words. Never a value. */
export type SpanAt = { start: number; end: number } & ({ field: "amount" } | { field: "quantity" } | { field: "date"; direction?: "next" | "last" } | { field: "item" });
export type Extracted = { extractId: string; itemId?: string | null } | { refusal: string };

/**
 * The inbox flows' port (chat → order, a reply, campaign copy): the agent port of one run a person's tap started, plus
 * core's inbox writers bound to that run and its member. `message` reads the message's words (and, through tappedPort,
 * taints the run first); `saveTranscript` stores a transcript once (core's saveTranscript); `recordExtracts` has core
 * read each span (an item span core matches to the catalogue by name or alias) and store it for this run (core's
 * recordExtracts: a span it cannot read fills nothing); `writeCopy` and `writeReply` store words whose figures are ref
 * tokens, each a cell of this shop (core's writeCopy and writeReply for this run). Each returns ids; figures come
 * back only as cells of reads (order.extracts, inbox.extract).
 */
export type InboxPort = AgentPort & {
  /** the run's id: a read of what this run stored (order.extracts) names it */
  runId: string;
  message(messageId: string): Promise<InboxWords | null>;
  saveTranscript(messageId: string, transcript: string): Promise<void>;
  recordExtracts(messageId: string, spans: SpanAt[]): Promise<Extracted[]>;
  writeCopy(campaignId: string, body: string): Promise<string>;
  writeReply(body: string): Promise<string>;
};
