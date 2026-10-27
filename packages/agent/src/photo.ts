// What the photo flows (shelf.ts, bill.ts) share: stills only, the vision call with no tools, reads through the port,
// and traces of ids and fixed labels only — never a phrase, a bill's text or anything else a model or a photo said.
import type { Cell, CellRef } from "@munshi/core/read";
import type { EvidencePort, TraceKind } from "./port.ts";
import type { Deps } from "./providers/client.ts";
import { generate } from "./providers/generate.ts";
import { ModelError } from "./providers/redact.ts";
import type { GenerateRequest } from "./providers/types.ts";

export type PhotoOptions = { port: EvidencePort; deps?: Deps; now?: () => number };

// The fixed labels the photo flows and the voice flow put in a trace (a test holds every event to this list, with
// run.ts's TRACE_LABELS for the question the voice flow asks).
export const FLOW_LABELS: ReadonlySet<string> = new Set([
  "vision",
  "segment",
  "voice",
  "model_error",
  "items.list",
  "count.shelf",
  "stock.on_hand",
  "bill.lines",
  "purchases.last_price",
  "shelf_count",
  "bill_read",
  "refused",
  "stock.count",
  "purchase.record",
  "not_a_still",
  "tool_call",
  "unreadable",
  "unplaced",
]);

/** The image type of a still (PNG or JPEG, by its first bytes); null for anything else — a video is never sent. */
export function stillType(b: Uint8Array): "image/png" | "image/jpeg" | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((x, i) => b[i] === x)) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

export const dataUrl = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString("base64")}`;

export async function traced(o: PhotoOptions, kind: TraceKind, label: string, ids: string[] = [], since?: number): Promise<void> {
  const now = o.now ?? Date.now;
  await o.port.trace({ kind, label, ids, ms: since === undefined ? 0 : Math.max(0, Math.round(now() - since)) });
}

/**
 * One vision call, quarantined: no tools are offered, and an answer that tries a tool call anyway is refused whole
 * (nothing in it is used). A model failure is "model_error"; neither carries the model's text.
 */
export async function look(o: PhotoOptions, req: Omit<GenerateRequest, "role" | "tools">): Promise<{ json: unknown; model: string } | "tool_call" | "model_error"> {
  const t0 = (o.now ?? Date.now)();
  try {
    const r = await generate({ ...req, role: "vision" }, o.deps);
    await traced(o, "model", "vision", [], t0);
    if (r.toolCalls.length > 0 || r.json === undefined) return "tool_call";
    return { json: r.json, model: r.model };
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    await traced(o, "model", "model_error", [], t0);
    return "model_error";
  }
}

export type Read = { snapshotId: string; rows: Record<string, Cell>[] };

export async function mint(o: PhotoOptions, query: string, params: Record<string, unknown>): Promise<Read> {
  const t0 = (o.now ?? Date.now)();
  const snap = await o.port.read(query, params);
  await traced(o, "read", query, [snap.snapshotId], t0);
  return snap;
}

export const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
export const num = (c: Cell | undefined) => (c && (c.kind === "integer" || c.kind === "money" || c.kind === "quantity") ? Number(c.num) : null);
export const txt = (c: Cell | undefined) => (c?.kind === "text" ? c.txt : null);
