import type { Cell, CellRef } from "@munshi/core/read";
import type { Role } from "./providers/types.ts";

/**
 * Everything an agent run can do, handed in by the app already bound to ONE tenant and ONE run (ops.run). The agent
 * holds no pool and imports no core writer (gate B1); the tenant is never a model argument.
 * - read: the app mints a snapshot of a named read (mintSnapshot, a `system` scope, this run's id) and returns its cells.
 * - resolve: the stored cell a ref names, under this tenant's RLS; null if there is none.
 * - propose: the app calls proposeDraft with this run as the proposer. Every number in the payload is mapped, by its
 *   JSON path, to the cell it came from (payloadRefs); core refuses the draft otherwise.
 * - finding: a watcher's finding of this tenant and its state (core's findingState: status, whether the latest watcher
 *   run of its kind still sees it, a draft awaiting a decision), with the cells of the row that run sees it in (its own
 *   row once it is no longer seen); null if there is none.
 * - trace: ids, fixed labels and timings only — never model text, a question, a name or anything from a bill.
 * - allow: core's allow() for one model call of this run's tenant (BLUEPRINT §4.6): core counts the call; false refuses
 *   it, and the run abstains or its surface shows a template, never an error. Optional only until the app's port wires
 *   it: a port without it has no caps.
 * - taint: marks this run tainted (ai.run.tainted), because it read untrusted text (§7.8). Optional likewise.
 */
export type AgentPort = {
  read(name: string, params: Record<string, unknown>): Promise<{ snapshotId: string; rows: Record<string, Cell>[] }>;
  resolve(ref: CellRef): Promise<Cell | null>;
  propose(draft: DraftProposal): Promise<string>;
  finding(findingId: string): Promise<FindingRow | null>;
  trace(event: TraceEvent): void | Promise<void>;
  allow?(role: Role): Promise<boolean>;
  taint?(): Promise<void>;
};

// The reads whose cells carry untrusted text: a supplier's bill as the vision model copied it. (Inbound messages and
// transcripts join when the inbox's reads exist.)
export const UNTRUSTED_READS: ReadonlySet<string> = new Set(["bill.lines"]);

export class TaintRefused extends Error {
  constructor() {
    super("refused: a tainted run proposes only the recipe the person tapped");
  }
}

/**
 * The port of a run a person started by tapping one recipe (BLUEPRINT §7.8, R4 O1): booking.confirm, message.reply,
 * credit.record, purchase.record or order.confirm. Once the run reads untrusted text it is tainted (marked before the
 * read), and from then on this port refuses every proposal but that recipe's command, before core sees it. Core's own
 * fence is the database's taint list (approval.taint_recipe), which admits any of the five.
 */
export function tappedPort<P extends AgentPort>(port: P, recipe: string): P {
  let tainted = false;
  return {
    ...port,
    async read(name, params) {
      if (UNTRUSTED_READS.has(name) && !tainted) {
        tainted = true;
        await port.taint?.();
      }
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
