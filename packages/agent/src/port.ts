import type { Cell, CellRef } from "@munshi/core/read";

/**
 * Everything an agent run can do, handed in by the app already bound to ONE tenant and ONE run (ops.run). The agent
 * holds no pool and imports no core writer (gate B1); the tenant is never a model argument.
 * - read: the app mints a snapshot of a named read (mintSnapshot, a `system` scope, this run's id) and returns its cells.
 * - resolve: the stored cell a ref names, under this tenant's RLS; null if there is none.
 * - propose: the app calls proposeDraft with this run as the proposer. Every number in the payload is mapped, by its
 *   JSON path, to the cell it came from (payloadRefs); core refuses the draft otherwise.
 * - finding: a watcher's finding of this tenant, with the cells of its snapshot row; null if there is none.
 * - trace: ids, fixed labels and timings only — never model text, a question, a name or anything from a bill.
 */
export type AgentPort = {
  read(name: string, params: Record<string, unknown>): Promise<{ snapshotId: string; rows: Record<string, Cell>[] }>;
  resolve(ref: CellRef): Promise<Cell | null>;
  propose(draft: DraftProposal): Promise<string>;
  finding(findingId: string): Promise<FindingRow | null>;
  trace(event: TraceEvent): void | Promise<void>;
};

export type DraftProposal = { command: string; payload: unknown; basedOn: CellRef[]; payloadRefs: Record<string, CellRef>; findingId?: string };

export type FindingRow = { id: string; kind: string; snapshotId: string; row: number; cells: Record<string, Cell> };

export type TraceEvent = { kind: TraceKind; label: string; ids: string[]; ms: number };
export type TraceKind = "route" | "model" | "read" | "budget" | "validate" | "answer" | "abstain" | "propose";
