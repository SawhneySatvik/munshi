// Sarvam Vision through Sarvam's Document AI (docs.sarvam.ai/api-reference/doc-ai/job/parse, /status and /results, read
// 2 Nov 2026). The current API is one parse job: POST https://api.sarvam.ai/doc-ai/v1/job/parse (multipart `file`,
// `language`, `model`) creates and starts it and answers { job_id, status }; GET /doc-ai/v1/job/{job_id}/status until a
// terminal status (completed, partially_completed, failed, rejected); then GET /doc-ai/v1/job/{job_id}/results?format=json
// answers { documents: [{ pages: [{ page_number, content }] }] }. The older create → upload → start → poll → download-a-
// zip flow (document_intelligence) is the docs' "Legacy", superseded by this one. The key goes in `api-subscription-key`.
// UNVERIFIED: the docs say parse JSON holds "blocks with text, tag and bounding box" but show no example of a page's
// JSON, so pageBlocks reads the shapes below and gives a block no place unless its box is one of them.
import { z } from "zod";
import type { RoleBinding } from "../config.ts";
import { apiKey, baseUrl, withRetry, type Deps } from "./client.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, sha256Hex, viaFixture } from "./fixtures.ts";
import { ModelError, redact } from "./redact.ts";
import type { DocBlock, DocumentResult } from "./types.ts";

type Raw = Omit<DocumentResult, "provider"> & { provider: string };
const Box = z.tuple([z.number().int().min(0).max(1000), z.number().int().min(0).max(1000), z.number().int().min(0).max(1000), z.number().int().min(0).max(1000)]);
const RAW_SHAPE = z.object({
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number(),
  complete: z.boolean(),
  pages: z.array(z.object({ page: z.number().int(), blocks: z.array(z.object({ text: z.string(), box: Box.nullable() })) })),
}) as unknown as z.ZodType<Raw>;

/** How long one document job may take, polling included; and the wait between polls. */
export const DOCUMENT_BUDGET_MS = 120_000;
const POLL_MS = 2_000;
// Bounds on what one bill's job may bring back, beyond which it is refused: Sarvam Vision's own page cap (10 a PDF), a
// bill's worth of blocks, and the results body read.
export const MAX_PAGES = 10;
const MAX_BLOCKS = 2_000;
const MAX_RESULT_CHARS = 2_000_000;
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);

const grid = (v: number) => Math.min(1000, Math.max(0, Math.round(v)));

/**
 * One page's blocks, in the order given, from what the results endpoint holds for a page (its `content` as JSON, or the
 * page object itself). A block's text is `text` (or `content`); its place is `bbox` [x1, y1, x2, y2] in the page's
 * `width` × `height`, or `region` { x, y, width, height } normalised to 0–1, each turned to the 0–1000 grid.
 */
export function pageBlocks(page: unknown): DocBlock[] {
  let p = page as Record<string, unknown> | null;
  if (p && typeof p.content === "string" && /^\s*[[{]/.test(p.content)) {
    try {
      p = JSON.parse(p.content) as Record<string, unknown>;
    } catch {
      return [];
    }
  }
  if (!p || typeof p !== "object") return [];
  const w = typeof p.width === "number" && p.width > 0 ? p.width : null;
  const h = typeof p.height === "number" && p.height > 0 ? p.height : null;
  const blocks = Array.isArray(p) ? p : Array.isArray(p.blocks) ? p.blocks : [];
  return blocks.flatMap((b): DocBlock[] => {
    const o = b as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : typeof o.content === "string" ? o.content : null;
    if (text === null || !text.trim()) return [];
    let box: DocBlock["box"] = null;
    const bb = o.bbox;
    const r = o.region as Record<string, unknown> | undefined;
    if (Array.isArray(bb) && bb.length === 4 && bb.every((v) => typeof v === "number") && w && h) {
      const [x1, y1, x2, y2] = bb as number[];
      box = [grid(((x1 as number) / w) * 1000), grid(((y1 as number) / h) * 1000), grid(((x2 as number) / w) * 1000), grid(((y2 as number) / h) * 1000)];
    } else if (r && [r.x, r.y, r.width, r.height].every((v) => typeof v === "number")) {
      const [x, y, rw, rh] = [r.x, r.y, r.width, r.height] as number[];
      box = [grid((x as number) * 1000), grid((y as number) * 1000), grid(((x as number) + (rw as number)) * 1000), grid(((y as number) + (rh as number)) * 1000)];
    }
    if (box && (box[0] > box[2] || box[1] > box[3])) box = null;
    return [{ text, box }];
  });
}

/**
 * Sarvam's adapter for documents (document.ts dispatches to it): a PDF's pages as Sarvam Vision reads them. `language`:
 * the document's, BCP-47 (the API's default is Indic).
 */
export async function sarvamReadDocument(file: Uint8Array, mime: "application/pdf", language: string, { provider, model }: RoleBinding, d: Deps): Promise<DocumentResult> {
  const env = d.env ?? process.env;
  const mode = parseMode(d.mode ?? env.MUNSHI_MODEL_MODE);
  const raw = await viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, { kind: "document", provider, model, file: sha256Hex(file), language }, RAW_SHAPE, async () => {
    const key = apiKey(provider, env);
    const doFetch = d.fetch ?? fetch;
    const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const t0 = Date.now();
    const signal = AbortSignal.timeout(DOCUMENT_BUDGET_MS);
    const at = (path: string) => new URL(path, baseUrl(provider)).toString();
    const once = async (path: string, init: RequestInit = {}) => {
      const res = await doFetch(at(path), { ...init, headers: { "api-subscription-key": key }, signal });
      if (!res.ok) {
        const msg = redact((await res.text()).slice(0, 300), env);
        throw Object.assign(new Error(`document call failed (${res.status}): ${msg}`), { status: res.status });
      }
      const body = await res.text();
      if (body.length > MAX_RESULT_CHARS) throw new ModelError("document result is too large");
      return JSON.parse(body) as Record<string, unknown>;
    };
    // Only reads are retried: the POST that creates a job is sent once, so a retry never starts (and bills) a second job.
    const read = (path: string) => withRetry(() => once(path), d, signal);
    const form = new FormData();
    form.append("file", new Blob([file as BlobPart], { type: mime }), "document.pdf");
    form.append("language", language);
    form.append("model", model);
    let job: Record<string, unknown>;
    try {
      job = await once("/doc-ai/v1/job/parse", { method: "POST", body: form });
    } catch (err) {
      if (err instanceof ModelError) throw err;
      const status = (err as { status?: unknown }).status;
      throw new ModelError(err instanceof Error ? err.message : "document call failed", typeof status === "number" ? status : undefined, undefined, env);
    }
    const jobId = typeof job.job_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(job.job_id) ? job.job_id : null;
    if (!jobId) throw new ModelError("document job had no id");
    let status = typeof job.status === "string" ? job.status.toLowerCase() : "";
    for (let polls = 0; !TERMINAL.has(status); polls++) {
      if (signal.aborted || polls >= DOCUMENT_BUDGET_MS / POLL_MS) throw new ModelError("document job timed out", undefined, "timeout");
      await sleep(POLL_MS);
      const s = await read(`/doc-ai/v1/job/${jobId}/status`);
      status = typeof s.status === "string" ? s.status.toLowerCase() : "";
    }
    if (status !== "completed" && status !== "partially_completed") throw new ModelError(`document job ${status}`);
    const out = await read(`/doc-ai/v1/job/${jobId}/results?format=json`);
    const first = (Array.isArray(out.documents) ? out.documents[0] : null) as Record<string, unknown> | null | undefined;
    const given = Array.isArray(first?.pages) ? (first.pages as Record<string, unknown>[]) : [];
    if (given.length > MAX_PAGES) throw new ModelError("document has too many pages");
    const pages = given.map((p, i) => ({ page: typeof p.page_number === "number" ? p.page_number : i + 1, blocks: pageBlocks(p) }));
    if (pages.reduce((n, p) => n + p.blocks.length, 0) > MAX_BLOCKS) throw new ModelError("document has too many blocks");
    // partially_completed: some pages were not read. Said, never drafted from silently (bill.ts refuses partly_read).
    return { provider, model, latencyMs: Date.now() - t0, complete: status === "completed", pages };
  });
  return { ...raw, provider };
}
